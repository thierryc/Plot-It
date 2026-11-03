import { motorCommand } from './compiler.js';
import { servoCommands,servoPulse,servoRate,planPenTransition,servoIdentity,validateServoProfile } from './pen.js';
import { PlotterError, type Clock, type Firmware, type MachineProfile, type MotorRecord, type NativePoint, type PenSettings, type PenConfirmation } from './types.js';
import { EbbProtocol } from './protocol.js';
export interface QueueDiagnostic {queueMaximum:number;queueCapacity:number;queueOccupancy?:number;queueEntriesAccepted:number;stackHighWater?:number}
export interface BoardStatus { idle:boolean; penUp:boolean; powerLost:boolean; limit:boolean; button:boolean }
/** Serial scheduling and device setup only. No path geometry or editor state. */
export class Feeder {
  private queuedUntil=0;private penUntil=0;private height:number|null=null;private pulse:number|null=null;private configuredServo:string|null=null;private configuredPin:number|null=null;
  private safeRB1=false;
  private confirmation:PenConfirmation={penState:'unknown'};
  private confirmPen(confirmation:PenConfirmation):void{
    if(this.confirmation.penState===confirmation.penState&&this.confirmation.penHeight===confirmation.penHeight)return;
    this.confirmation=confirmation;
    try{this.onPenConfirmation({...confirmation});}catch{/* Observers cannot interrupt execution. */}
  }
  private queueMaximum=0;private queueCapacity=0;private queueEntriesAccepted=0;private lastQueueDiagnostic=-Infinity;
  private servoHeld=false;private servoPowerUntil=0;
  private setup=new Map<string,string>();private setupRevision:number|undefined;private pendingMutationRevision:number|undefined;private setupGeneration=0;
  private b3=false;private powerFault=false;private limitFault=false;
  clearFaults():void{this.powerFault=this.limitFault=false;}
  constructor(readonly protocol:EbbProtocol,private clock:Clock,readonly firmware:Firmware,private onStatus:(status:BoardStatus)=>void=()=>{},private onTimingExtension:(timing:{minimumMs:number;durationMs:number;extensionMs:number})=>void=()=>{},private onQueueDiagnostic:(diagnostic:QueueDiagnostic)=>void=()=>{},private onPenConfirmation:(confirmation:PenConfirmation)=>void=()=>{}){}
  private invalidateSetup():void{this.confirmPen({penState:'unknown'});this.setupGeneration++;this.setup.clear();this.setupRevision=this.protocol.configurationRevision;this.invalidatePen();}
  private syncSetup():void{
    const revision=this.protocol.configurationRevision;
    // Observers may read settledHeight while our own write awaits its ACK. That
    // write is expected, but must not become a reusable cache entry yet.
    if(this.protocol.healthy!==false&&this.pendingMutationRevision!==undefined&&revision===this.pendingMutationRevision)return;
    if(this.setupRevision!==revision||this.protocol.healthy===false)this.invalidateSetup();
  }
  private assertSetup(generation:number):void{
    this.syncSetup();if(this.setupGeneration!==generation)throw new PlotterError('protocol','Controller configuration changed during a pen operation. Retry after the plotter is idle.');
  }
  private useServo(profile:MachineProfile):void{
    this.safeRB1=this.firmware.version==='3.1.7'&&profile.servoKind!=='brushless'&&profile.servoPin===1&&profile.servoChannels===8;
    const identity=servoIdentity(profile);if(identity!==this.configuredServo){this.invalidateSetup();this.configuredServo=identity;this.configuredPin=profile.servoPin;}
  }
  /** Own mutations adopt the revision only after an uncontested ACK. A raw
   * write through protocol.request() must not be hidden by a late owned ACK. */
  private async mutate(command:string,key?:string):Promise<string>{
    this.syncSetup();const pending=this.protocol.request(command),revision=this.protocol.configurationRevision;
    this.pendingMutationRevision=revision;
    try{
      const reply=await pending;
      if(this.protocol.configurationRevision!==revision)throw new PlotterError('protocol','Controller configuration changed during an awaited write. Retry after the plotter is idle.');
      this.setupRevision=revision;
      if(key&&this.firmware.modern&&Number.isInteger(revision))this.setup.set(key,command);
      return reply;
    }catch(error){this.invalidateSetup();throw error;}finally{if(this.pendingMutationRevision===revision)this.pendingMutationRevision=undefined;}
  }
  private async setting(command:string,allowSkip=true):Promise<void>{
    this.syncSetup();const key=command.startsWith('SC,')?command.split(',').slice(0,2).join(','):'SR';
    if(allowSkip&&this.pendingMutationRevision===undefined&&this.firmware.modern&&this.protocol.healthy&&this.setup.get(key)===command)return;
    await this.mutate(command,key);
  }
  get settledHeight():number|null{this.syncSetup();if(this.clock.now()>=this.servoPowerUntil)this.invalidatePen();return this.height;}
  async status(expectedLimit=false):Promise<BoardStatus> {
    const reply=await this.protocol.request('QG'),bits=parseInt(reply.split(',').at(-1)!,16);
    const newPowerLoss=this.firmware.modern&&!!(bits&64);
    this.powerFault ||= newPowerLoss;if(!expectedLimit)this.limitFault ||= this.firmware.modern&&!!(bits&128);
    const status={idle:(bits&15)===0,penUp:!!(bits&16),powerLost:this.powerFault,limit:expectedLimit?this.firmware.modern&&!!(bits&128):this.limitFault,button:!!(bits&32)};
    if(newPowerLoss)this.invalidateSetup();else if(status.powerLost)this.invalidatePen();
    this.onStatus(status);return status;
  }
  async position():Promise<NativePoint> {
    const reply=(await this.protocol.request('QS')).replace(/^QS,/,''),parts=reply.split(',').map(Number);
    if(parts.length!==2||parts.some(p=>!Number.isInteger(p)||p<-2147483648||p>2147483647)){this.invalidateSetup();throw new PlotterError('protocol','Invalid EBB step position.');}
    return{m1:parts[0]!,m2:parts[1]!};
  }
  async power():Promise<{state:'detected'|'low';supply:number;current:number}> {
    const reply=(await this.protocol.request('QC')).replace(/^QC,/,''),parts=reply.split(',').map(Number);
    if(parts.length!==2||parts.some(p=>!Number.isInteger(p)||p<0||p>1023)){this.invalidateSetup();throw new PlotterError('protocol','Invalid supply reading.');}
    if(parts[1]!<250)this.invalidateSetup();return{state:parts[1]!<250?'low':'detected',current:parts[0]!,supply:parts[1]!};
  }
  async drain(graceMs=10000,ignoreFaults=false):Promise<BoardStatus> {
    const delay=this.penUntil-this.clock.now();if(delay>0)await this.clock.sleep(delay);
    this.penUntil=0;
    const deadline=Math.max(this.clock.now(),this.queuedUntil)+graceMs;
    for(;;) {
      const status=await this.status();
      if(status.powerLost&&!ignoreFaults)throw new PlotterError('power','Motor supply was interrupted.');
      if(status.limit&&!ignoreFaults){this.invalidateSetup();throw new PlotterError('origin','A limit event invalidated the origin.');}
      if(status.idle){this.queuedUntil=0;return status;}
      if(this.clock.now()>deadline){this.invalidateSetup();throw new PlotterError('timeout','The plotter did not become idle.');}
      await this.clock.sleep(20);
    }
  }
  async purge(disable=false):Promise<boolean> {
    const busy=!(await this.status()).idle;
    this.invalidateSetup();const response=await this.mutate(`ES,${disable?1:0}`);this.queuedUntil=this.penUntil=0;
    if(disable&&this.firmware.modern)await this.mutate('SP,3');
    if(disable&&this.b3){await this.mutate('PO,B,3,0');this.b3=false;}
    return /^(?:ES,)?1(?:,|$)/.test(response)||busy&&!/^(?:ES,)?[01](?:,|$)/.test(response);
  }
  async configure(pen:PenSettings,profile:MachineProfile,temporaryDown=pen.down):Promise<void> {
    validateServoProfile(profile);
    this.useServo(profile);
    if(pen.synchronizedB3&&!profile.toolOutputB3)throw new PlotterError('invalid-plan','Unsupported B3 tool output.');
    for(const command of servoCommands(pen,profile,temporaryDown))await this.setting(command);
  }
  /** With unknown position, apply this policy during the next initialized SP. */
  async holdServo():Promise<void>{
    this.syncSetup();
    if(this.clock.now()>=this.servoPowerUntil)this.invalidatePen();
    if(this.pulse!==null)await this.rearmServoPower(0);
    this.servoHeld=true;
  }
  async releaseServo(timeoutMs=60000):Promise<void>{
    await this.rearmServoPower(timeoutMs);this.servoHeld=false;this.invalidatePen();
  }
  private async rearmServoPower(timeoutMs:number):Promise<boolean>{
    this.syncSetup();
    const oldExpiry=this.servoPowerUntil;
    await this.drain();
    this.syncSetup();
    if(this.clock.now()>=oldExpiry)this.invalidatePen();
    if(this.pulse===null)return false;
    const generation=this.setupGeneration,pulse=this.pulse;
    if(this.configuredPin!==1)throw new PlotterError('invalid-plan','Servo power can only be rearmed at a confirmed standard pulse.');
    if(!Number.isInteger(timeoutMs)||timeoutMs<0||timeoutMs>65535)throw new PlotterError('invalid-plan','Invalid servo timeout.');
    // SR changes only the reload value. A same-target servo command reloads
    // the live timer. Avoid S2 on the independently reproduced RB1 fault path.
    await this.setting(`SR,${timeoutMs},1`,false);this.assertSetup(generation);const sentAt=this.clock.now();
    const up=this.setup.get('SC,4')===`SC,4,${pulse}`;
    if(this.safeRB1){
      // A temporary manual height may no longer equal the configured Down.
      // Bind SC5 to the confirmed pulse before rearming; configure() restores it.
      if(!up)await this.setting(`SC,5,${pulse}`);
      await this.mutate(`SP,${up?1:0},1,1`);
    }else await this.mutate(`S2,${pulse},4,0,1`);
    this.penUntil=sentAt+1;this.queuedUntil=sentAt+1;const status=await this.drain();this.assertSetup(generation);
    if(this.safeRB1&&status.penUp!==up){this.invalidateSetup();throw new PlotterError('protocol','Controller pen state differs during servo power rearming.');}
    const continuous=this.clock.now()<oldExpiry;
    this.servoPowerUntil=timeoutMs===0?Infinity:sentAt+timeoutMs;
    // The old timer could expire during awaited writes/ACKs. Holding now does
    // not restore knowledge of the mechanical position across that power gap.
    if(!continuous)this.invalidatePen();
    return continuous;
  }
  async pen(target:number,pen:PenSettings,profile:MachineProfile,minimumMs=0,reload=false,semanticUp?:boolean,emergency=false):Promise<void> {
    await this.drain(10000,emergency);
    this.syncSetup();
    this.useServo(profile);
    const up=semanticUp??target===pen.up;
    // Always restore both endpoints. Manual heights, preview and SP,3 must never
    // leave a stale Down pulse that later maps a plotting Down to the Up pulse.
    if(servoIdentity(profile)!==this.configuredServo||profile.servoKind!=='brushless'&&this.clock.now()>=this.servoPowerUntil)this.invalidatePen();
    // Protect known finite-powered state before any awaited setup. If rearming
    // finishes after its old deadline the helper invalidates it; startup then
    // follows the same unknown-state contract. SC/SR latency cannot spend a
    // finite lifetime once the live timer has been rearmed to indefinite.
    if(profile.servoKind!=='brushless'&&this.pulse!==null&&this.servoPowerUntil!==Infinity)await this.rearmServoPower(0);
    let initializationMs=0,transition=planPenTransition(this.pulse,target,up,pen,profile,reload,minimumMs);
    if(this.safeRB1&&this.pulse===null&&!up){
      // Establish an explicit calibrated Up first. Rate zero avoids a sweep
      // from an unknown pulse. Hold power throughout the subsequent Down.
      initializationMs=planPenTransition(null,pen.up,true,pen,profile).durationMs;
      await this.pen(pen.up,{...pen,servoTimeoutMs:0},profile,0,false,true,emergency);
      transition=planPenTransition(this.pulse,target,up,pen,profile,reload,Math.max(0,minimumMs-initializationMs));
    }
    const duration=transition.durationMs,generation=this.setupGeneration;
    const immediateUp=this.safeRB1&&transition.initialize;
    // Unknown output is initialized explicitly; do not assume it lies between
    // today's chosen endpoints or sweep through a signed-overflow pulse delta.
    if(transition.initialize&&!this.safeRB1){
      // Free both supported pen pins, including boot's RP4, before shrinking SC8.
      // Otherwise a one-channel RP5 output could be allocated outside slot zero.
      await this.mutate('S2,0,4');await this.mutate('S2,0,5');
    }
    await this.configure(pen,profile,up?pen.down:target);
    if(immediateUp)await this.setting('SC,11,0');
    // A finite timer must outlast the electrical/settling transition. SR alone
    // does not start its countdown; the following SP does. Timeout zero holds.
    const requestedTimeout=pen.servoTimeoutMs??60000;
    const powerTimeout=this.servoHeld||requestedTimeout===0?0:Math.max(requestedTimeout,duration+transition.refreshMs);
    if(profile.servoKind!=='brushless'){if(powerTimeout>65535)throw new PlotterError('invalid-plan','Pen transition exceeds the finite servo power horizon.');await this.setting(`SR,${powerTimeout},1`,this.pulse!==null&&this.servoPowerUntil===Infinity);}
    const totalDuration=initializationMs+duration;
    if(minimumMs>0&&totalDuration>minimumMs)this.onTimingExtension({minimumMs,durationMs:totalDuration,extensionMs:totalDuration-minimumMs});
    this.assertSetup(generation);
    this.invalidatePen();const sentAt=this.clock.now();
    const command=immediateUp?'SP,2,0,1':`SP,${up?1:0},${duration},${profile.servoPin}`;
    await this.mutate(command);
    this.penUntil=sentAt+duration;this.queuedUntil=Math.max(sentAt,this.queuedUntil)+duration;
    try{
      const status=await this.drain(10000,emergency);
      this.assertSetup(generation);
      // The firmware derives PEN from the queued pulse's equality to SC,4,
      // including temporary manual heights and coincident Up/Down calibration.
      // Idle and an SP acknowledgement alone do not confirm this state.
      const expectedUp=servoPulse(target,profile)===servoPulse(pen.up,profile);
      if(status.penUp!==expectedUp)throw new PlotterError('protocol',`Controller pen state differs from the requested ${up?'Up':'Down'}. Reconnect and check the pen before plotting.`);
      this.servoPowerUntil=profile.servoKind==='brushless'||powerTimeout===0?Infinity:sentAt+powerTimeout;
      if(!status.powerLost){this.height=target;this.pulse=transition.targetPulse;}
    }catch(error){this.invalidateSetup();throw error;}
    if(immediateUp)await this.setting(`SC,11,${servoRate(pen.raiseRate,profile)}`);
    this.protocol.settled(command);
    if(pen.synchronizedB3){if(!profile.toolOutputB3)throw new PlotterError('invalid-plan','Unsupported B3 tool output.');await this.mutate('PD,B,3,0');await this.mutate(`PO,B,3,${up?0:1}`);this.b3=!up;}
    this.assertSetup(generation);
    // An emergency Up may complete under a previously latched power fault. It
    // does not establish energized pose or reusable configuration confidence.
    if(this.powerFault)this.invalidateSetup();
    else this.confirmPen({penState:servoPulse(target,profile)===servoPulse(pen.up,profile)?'up':'down',penHeight:target});
  }
  async relaxServo(pen:PenSettings,profile:MachineProfile):Promise<void> {
    this.useServo(profile);
    // Standard RB1 can be relaxed by removing its dedicated servo supply.
    // Other outputs retain their established pin-disable path.
    if(!this.safeRB1)await this.mutate(`S2,0,${profile.servoPin+3}`);
    if(profile.servoKind!=='brushless')await this.mutate(`SR,${pen.servoTimeoutMs??60000},0`);
    this.invalidateSetup();
    this.servoHeld=false;this.servoPowerUntil=0;this.invalidatePen();
  }
  invalidatePen():void{this.height=null;this.pulse=null;}
  async prepareModern():Promise<void>{
    await this.protocol.request('CU,10,1');
    const maximum=Number((await this.protocol.request('QU,2')).split(',').at(-1));
    if(!Number.isInteger(maximum)||maximum<2||maximum>32)throw new PlotterError('protocol','Invalid FIFO capacity.');
    await this.protocol.request(`CU,4,${Math.min(maximum,16)}`);
    const actual=Number((await this.protocol.request('QU,3')).split(',').at(-1));if(actual!==Math.min(maximum,16))throw new PlotterError('protocol','FIFO configuration did not match.');
    this.queueMaximum=maximum;this.queueCapacity=actual;this.queueEntriesAccepted=0;this.lastQueueDiagnostic=-Infinity;
  }
  /** These are observations, never evidence of execution or position. */
  private publishQueue(extra:Partial<QueueDiagnostic>):void {
    try{this.onQueueDiagnostic({queueMaximum:this.queueMaximum,queueCapacity:this.queueCapacity,queueEntriesAccepted:this.queueEntriesAccepted,...extra});}catch{/* Diagnostics cannot interrupt execution. */}
  }
  async idleDiagnostics():Promise<void>{
    if(!this.queueCapacity)return;
    const stackHighWater=parseInt((await this.protocol.request('QU,4')).split(',').at(-1)!,16);
    if(!Number.isSafeInteger(stackHighWater)||stackHighWater<0)throw new PlotterError('protocol','Invalid stack high-water value.');
    this.publishQueue({stackHighWater});
  }
  private async queueDiagnostics():Promise<void>{
    if(!this.queueCapacity||this.firmware.minor===0&&this.firmware.patch<2||this.clock.now()-this.lastQueueDiagnostic<2000)return;
    const queueOccupancy=Number((await this.protocol.request('QU,6')).split(',').at(-1));
    if(!Number.isInteger(queueOccupancy)||queueOccupancy<0||queueOccupancy>this.queueMaximum)throw new PlotterError('protocol','Invalid FIFO occupancy.');
    this.lastQueueDiagnostic=this.clock.now();this.publishQueue({queueOccupancy});
  }
  async preparePowerMonitor():Promise<void>{if(this.firmware.modern)await this.protocol.request('CU,60,250');}
  async motion(record:MotorRecord):Promise<void> {
    // Bound ahead-of-host time even on boards with a deep FIFO. Backpressure still
    // belongs to the device; no renderer/status callback is awaited on this path.
    const ahead=this.queuedUntil-this.clock.now();
    const boundedSM=this.firmware.version==='3.1.7'&&!record.native&&record.durationMs<=100&&
      (record.fromSteps.m1!==record.toSteps.m1||record.fromSteps.m2!==record.toSteps.m2);
    // Include the next short SM command in the host's planned lead bound.
    // Stationary waits and native T3 scheduling retain their existing policy.
    if(boundedSM?ahead+record.durationMs>500:ahead>500)await this.clock.sleep(boundedSM?Math.max(0,ahead+record.durationMs-250):ahead-250);
    await this.protocol.request(motorCommand(record));
    this.queuedUntil=Math.max(this.clock.now(),this.queuedUntil)+record.durationMs;
    this.queueEntriesAccepted+=record.native?.command==='TD'?2:1;
    await this.queueDiagnostics();
  }
}
