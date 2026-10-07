import { compileJob, compilePhases, validatePlan,validateOptions,splitForReload } from './compiler.js';
import { planStroke } from './planner.js';
import { fromNative,toNative as importNative } from './profiles.js';
import { defaultPen,validatePen } from './pen.js';
import { EbbProtocol, firmwareFromReply } from './protocol.js';
import { Feeder } from './feeder.js';
import { Origin } from './origin.js';
import {homeNextDraw} from './homing.js';
import {compileJerkPhases} from './modern-compiler.js';
import {planSCurve} from './scurve.js';
import { PlotterError, type ByteTransport, type Clock, type ExecutablePlan, type ExecutionRecord, type Firmware, type JobState, type MachineProfile, type Observer, type PenSettings, type PlotOptions, type SessionEvent } from './types.js';
/** One device owner. Geometry, firmware framing, pen setup and origin are composed services. */
export class PlotterSession {
  readonly origin=new Origin();firmware:Firmware|null=null;state:JobState='idle';busy=false;
  penSettings:PenSettings={...defaultPen};profile:MachineProfile;
  power:{state:'detected'|'low';supply:number;current:number}|null=null;
  private feeder:Feeder|null=null;private paused=false;private stopRequested=false;private cancelled=false;
  private link:EbbProtocol|null=null;private linkClosed=false;
  private pauseReady=false;private resumeWaiter:(()=>void)|null=null;private penOperation:Promise<void>|null=null;
  private startedAt:number|null=null;private finishedMs=0;private lastPowerPoll=-Infinity;
  private observers=new Set<Observer>();
  intendedPosition={x:0,y:0};
  private cancelOperation:Promise<boolean>|null=null;
  constructor(private transport:ByteTransport,private clock:Clock,profile:MachineProfile){this.profile={...profile};transport.onDisconnect?.(()=>{void this.lostConnection();});}
  subscribe(observer:Observer):()=>void {this.observers.add(observer);return()=>this.observers.delete(observer);}
  private emit(event:Omit<SessionEvent,'timeMs'>):void {
    for(const observer of this.observers){try{const result=observer({...event,timeMs:this.clock.now(),...(event.position?{position:{...event.position}}:{})});if(result)void result.catch(()=>{});}catch{/* UI observers cannot interrupt the feeder. */}}
  }
  private setState(state:JobState):void{this.state=state;this.emit({kind:'state',state});}
  get connected():boolean{return !this.linkClosed&&this.feeder!==null&&!!this.link?.healthy;}
  get canAdjustPen():boolean{return this.connected&&(!this.busy||this.pauseReady)&&!this.penOperation;}
  get elapsedMs():number{return this.startedAt===null?this.finishedMs:this.clock.now()-this.startedAt;}
  private device():Feeder{if(!this.feeder)throw new PlotterError('disconnected','Connect the plotter first.');return this.feeder;}
  private idle():void{this.device();if(this.busy)throw new PlotterError('busy','Wait until the plotter is idle.');}
  async connect():Promise<Firmware> {
    if(this.firmware&&this.connected)return this.firmware;
    if(this.linkClosed)throw new PlotterError('disconnected','Open a new transport before reconnecting.');
    const protocol=new EbbProtocol(this.transport,this.clock,e=>this.emit(e));
    this.link=protocol;
    try {const firmware=firmwareFromReply(await protocol.request('V'));if(this.profile.id.startsWith('nextdraw-')&&(!firmware.modern||firmware.minor===0&&firmware.patch<2))throw new PlotterError('unsupported-firmware','NextDraw profiles require firmware 3.0.2 or newer.');this.firmware=firmware;this.feeder=new Feeder(protocol,this.clock,firmware,status=>{if(status.button&&this.busy)this.pause();});await this.checkPower();await this.feeder.preparePowerMonitor();return firmware;}
    catch(error){this.linkClosed=true;await protocol.close();this.link=null;this.firmware=null;this.feeder=null;throw error;}
  }
  async disconnect():Promise<void>{this.idle();const f=this.device();if(this.origin.motorsOn)await this.release();this.linkClosed=true;await f.protocol.close();this.feeder=null;this.link=null;this.firmware=null;this.origin.invalidate();}
  async lostConnection():Promise<void>{if(this.linkClosed)return;this.linkClosed=true;const link=this.link;this.link=null;this.cancelled=true;this.resume();this.origin.invalidate();this.origin.motorsOn=false;this.feeder=null;this.firmware=null;this.setState('failed');await link?.close().catch(()=>{});}
  configure(pen:PenSettings,profile=this.profile):void{if(this.busy)throw new PlotterError('busy','Wait until the plotter is idle before changing pen heights.');validatePen(pen);this.penSettings={...pen};this.profile={...profile};}
  private requireProfile(profile:MachineProfile):void{const firmware=this.firmware;if(profile.id.startsWith('nextdraw-')&&firmware&&(!firmware.modern||firmware.minor===0&&firmware.patch<2))throw new PlotterError('unsupported-firmware','NextDraw profiles require 3.0.2 or newer.');}
  async checkPower():Promise<typeof this.power> {
    const f=this.device();this.power=await f.power();this.lastPowerPoll=this.clock.now();return this.power;
  }
  async pollStatus():Promise<import('./feeder.js').BoardStatus>{const status=await this.device().status();if(status.powerLost||status.limit){this.origin.invalidate();throw new PlotterError(status.powerLost?'power':'origin','Device status invalidated the origin.');}if(this.clock.now()-this.lastPowerPoll>=2000){await this.checkPower();if(this.power?.state==='low'){this.origin.invalidate();this.requirePower();}}return status;}
  private requirePower():void{if(this.power?.state==='low')throw new PlotterError('power','Motor supply is low or missing. Check the adapter/cable before plotting.');}
  async firmwareVersion():Promise<string>{return this.device().protocol.request('V');}
  async readName():Promise<string>{this.idle();return(await this.device().protocol.request('QT')).replace(/^QT,/,'');}
  async rename(name:string):Promise<void>{this.idle();if(!/^[A-Za-z0-9 _-]{0,16}$/.test(name))throw new PlotterError('invalid-plan','Nickname must be at most 16 ASCII letters, numbers, spaces, hyphens or underscores.');await this.device().protocol.request(`ST,${name}`);}
  async observedPosition(){this.idle();return fromNative(await this.device().position(),this.profile);}
  async waitUntilIdle():Promise<void>{this.idle();await this.device().drain();}
  async delay(ms:number):Promise<void>{if(!Number.isInteger(ms)||ms<0||ms>86400000)throw new PlotterError('invalid-plan','Invalid delay.');await this.manual(async()=>{this.cancelled=false;const f=this.device();await f.pen(this.penSettings.up,this.penSettings,this.profile,120);let left=ms;while(left>0){if(this.cancelled)throw new PlotterError('origin','Delay cancelled.');await this.waitPaused({id:-1,kind:'pen',startMs:0,durationMs:0,tool:'',from:this.intendedPosition,to:this.intendedPosition,penDown:false});const elapsed=Math.min(100,left);await this.clock.sleep(elapsed);left-=elapsed;await this.pollStatus();}});}
  private compileMove(points:readonly import('./types.js').Point[],options:PlotOptions,down:boolean,current=this.origin.steps){
    const speed=down?options.speed:options.travelSpeed,acceleration=down?options.acceleration:options.travelAcceleration;
    return options.backend==='t3'?compileJerkPhases(planSCurve(points,speed,acceleration,down?options.drawingJerk??500000:options.travelJerk??330200,down?options.cornering:0,down&&options.drawingMode==='constant'),options.profile,'',down,current,0,undefined,speed):compilePhases(planStroke(points,speed,acceleration,down?options.cornering:0,down&&options.drawingMode==='constant'),options.profile,'',down,current);
  }
  private async utilityMotion(points:readonly import('./types.js').Point[],options:PlotOptions,down:boolean):Promise<void>{
    const f=this.device();for(const r of this.compileMove(points,options,down)){if(this.cancelled){await f.purge(true);await f.pen(options.pen.up,options.pen,options.profile,120);throw new PlotterError('origin','Motion cancelled; restore origin.');}await f.motion(r);this.origin.steps={...r.toSteps};}await f.drain();this.emit({kind:'position',position:fromNative(await f.position(),options.profile)});
  }
  private preflightMotion(chunks:readonly (readonly import('./types.js').Point[])[],options:PlotOptions,down:boolean,current=this.origin.steps):void {if(options.firmware&&options.firmware!==this.firmware?.version)throw new PlotterError('unsupported-firmware','Interactive settings differ from connected firmware.');let count=0;for(const chunk of chunks){const records=this.compileMove(chunk,options,down,current);if((count+=records.length)>1000000)throw new PlotterError('invalid-plan','Interactive command limit exceeded.');let length=0;for(const r of records)length+=Math.hypot(r.to.x-r.from.x,r.to.y-r.from.y);if(down&&options.maxPenDownMm&&length>options.maxPenDownMm+1e-6)throw new PlotterError('invalid-plan','Quantized interactive stroke exceeds reload distance.');current=records.at(-1)?.toSteps??current;}}
  async moveTo(target:import('./types.js').Point,options:PlotOptions,draw=false):Promise<void>{
    validateOptions(options);this.requireProfile(options.profile);this.origin.require(options.profile);for(const n of [target.x,target.y])if(!Number.isFinite(n)||Math.abs(n)>1e6)throw new PlotterError('invalid-plan','Invalid interactive position.');
    const bounds=options.profile.bounds,swapped=options.profile.rotation===90||options.profile.rotation===270;
    let limited=bounds?{x:Math.max(0,Math.min(swapped?bounds.height:bounds.width,target.x)),y:Math.max(0,Math.min(swapped?bounds.width:bounds.height,target.y))}:{...target};
    const start=fromNative(this.origin.steps,options.profile);if(draw&&bounds){const maximum={x:swapped?bounds.height:bounds.width,y:swapped?bounds.width:bounds.height},d={x:target.x-start.x,y:target.y-start.y};let fraction=1;for(const key of ['x','y']as const)if(target[key]<0)fraction=Math.min(fraction,-start[key]/d[key]);else if(target[key]>maximum[key])fraction=Math.min(fraction,(maximum[key]-start[key])/d[key]);limited={x:start.x+d.x*fraction,y:start.y+d.y*fraction};}
    const chunks=draw?splitForReload([start,limited],options.maxPenDownMm,options.profile):[[start,limited]];this.preflightMotion(chunks,options,draw);
    await this.manual(async()=>{this.cancelled=false;this.profile={...options.profile};this.penSettings={...options.pen};this.intendedPosition={...target};await this.checkPower();this.requirePower();const f=this.device();
      for(const [i,chunk]of chunks.entries()){await f.pen(draw?options.pen.down:options.pen.up,options.pen,options.profile,120,false,!draw);await this.utilityMotion(chunk,options,draw);if(i<chunks.length-1)await f.pen(options.pen.up,options.pen,options.profile,120,true);}
      if(limited.x!==target.x||limited.y!==target.y)await f.pen(options.pen.up,options.pen,options.profile,120);
    });
  }
  async moveBy(delta:import('./types.js').Point,options:PlotOptions,draw=false):Promise<void>{const p=fromNative(this.origin.steps,options.profile);await this.moveTo({x:p.x+delta.x,y:p.y+delta.y},options,draw);}
  async drawTo(target:import('./types.js').Point,options:PlotOptions):Promise<void>{await this.moveTo(target,options,true);}
  async drawPolyline(points:readonly import('./types.js').Point[],options:PlotOptions):Promise<void>{
    validateOptions(options);this.requireProfile(options.profile);this.origin.require(options.profile);if(points.length<2||points.length>1000000)throw new PlotterError('invalid-plan','Invalid interactive path.');
    const bounds=options.profile.bounds,swapped=options.profile.rotation===90||options.profile.rotation===270;
    if(bounds&&points.some(p=>p.x<0||p.y<0||p.x>(swapped?bounds.height:bounds.width)||p.y>(swapped?bounds.width:bounds.height)))throw new PlotterError('invalid-plan','Clip the full path to machine bounds before drawing.');
    const chunks=splitForReload(points,options.maxPenDownMm,options.profile),approach=[fromNative(this.origin.steps,options.profile),points[0]!];this.preflightMotion([approach],options,false);this.preflightMotion(chunks,options,true,importNative(points[0]!,options.profile));
    await this.manual(async()=>{this.cancelled=false;const f=this.device();await this.checkPower();this.requirePower();await f.pen(options.pen.up,options.pen,options.profile,120);await this.utilityMotion([fromNative(this.origin.steps,options.profile),points[0]!],options,false);
      for(const [i,chunk]of chunks.entries()){await f.pen(options.pen.down,options.pen,options.profile,120,false,false);await this.utilityMotion(chunk,options,true);await f.pen(options.pen.up,options.pen,options.profile,120,i<chunks.length-1);}this.intendedPosition={...points.at(-1)!};
    });
  }
  private async manual(operation:()=>Promise<void>):Promise<void>{this.idle();this.busy=true;try{await operation();}catch(error){this.origin.invalidate();if(this.feeder){await this.feeder.purge(true).catch(()=>{});await this.feeder.pen(this.penSettings.up,this.penSettings,this.profile,120,false,true,true).catch(()=>{});}throw error;}finally{this.busy=false;}}
  async setPen(percent:number):Promise<void> {
    if(!this.canAdjustPen)throw new PlotterError('busy','Pause the plot and wait until it has stopped before adjusting the pen.');
    this.requireProfile(this.profile);const move=()=>this.device().pen(percent,this.penSettings,this.profile,120,false,percent===this.penSettings.up,percent===this.penSettings.up);
    if(!this.busy){await this.manual(move);return;}
    const operation=move();this.penOperation=operation;
    try{await operation;}finally{this.penOperation=null;}
  }
  async setOrigin(profile=this.profile,source:'automatic'|'explicit'='explicit'):Promise<void>{this.requireProfile(profile);await this.manual(async()=>{const f=this.device();if(source==='explicit'){await this.checkPower();this.requirePower();await f.status();f.clearFaults();}await this.origin.capture(f,profile,source);});this.profile={...profile};}
  async engage():Promise<void>{await this.manual(()=>this.origin.engage(this.device(),this.profile));}
  async home():Promise<void>{this.requireProfile(this.profile);await this.manual(async()=>{this.cancelled=false;this.origin.invalidate();await this.checkPower();this.requirePower();await this.device().status(true);this.device().clearFaults();await homeNextDraw(this.device(),this.clock,this.profile,this.penSettings,()=>this.cancelled||this.paused);await this.origin.capture(this.device(),this.profile,'explicit');});}
  async release():Promise<void>{await this.manual(async()=>{this.cancelled=false;const f=this.device();await f.pen(this.penSettings.up,this.penSettings,this.profile,120);await this.origin.release(f);});}
  private async returnRaised(options:PlotOptions):Promise<void> {
    this.origin.require(options.profile);const f=this.device();f.invalidatePen();await f.pen(options.pen.up,options.pen,options.profile,120);
    const from=fromNative(this.origin.steps,options.profile);
    for(const move of this.compileMove([from,{x:0,y:0}],options,false)){await f.motion(move);this.origin.steps={...move.toSteps};}
    await f.drain();this.emit({kind:'position',position:{x:0,y:0}});
  }
  async returnToOrigin(options:PlotOptions):Promise<void>{await this.manual(()=>this.returnRaised(options));}
  pause():void{if(this.busy&&!this.paused&&!this.stopRequested&&!this.cancelled){this.paused=true;this.setState('pausing');}}
  resume():void{this.paused=false;this.resumeWaiter?.();this.resumeWaiter=null;}
  stop():void{if(this.busy){this.stopRequested=true;this.resume();this.setState('stopping');}}
  cancel():void{this.cancelled=true;this.resume();if(this.busy&&this.feeder&&!this.cancelOperation){this.cancelOperation=this.feeder.purge(true);void this.cancelOperation.catch(()=>{});}}
  private async waitPaused(record:ExecutionRecord):Promise<void> {
    if(!this.paused)return;
    const f=this.device();await f.drain();if(f.settledHeight!==this.penSettings.up)await f.pen(this.penSettings.up,this.penSettings,this.profile,120);
    this.pauseReady=true;this.setState(record.kind==='tool'||record.kind==='pause'?'tool-change':'paused');
    while(this.paused&&!this.stopRequested&&!this.cancelled){await new Promise<void>(resolve=>{const cancel=this.clock.schedule(100,resolve);this.resumeWaiter=()=>{cancel();resolve();};});this.resumeWaiter=null;if(this.paused&&!this.cancelled&&!this.stopRequested)await this.pollStatus();}
    this.pauseReady=false;await this.penOperation;
    if(!this.stopRequested&&!this.cancelled&&record.kind==='motor'&&f.settledHeight!==(record.penDown?this.penSettings.down:this.penSettings.up))await f.pen(record.penDown?this.penSettings.down:this.penSettings.up,this.penSettings,this.profile,120);
    if(!this.stopRequested&&!this.cancelled)this.setState('running');
  }
  async run(input:ExecutablePlan,lifecycle:{keepMotors?:boolean}={}):Promise<JobState> {
    this.idle();validatePlan(input);this.requireProfile(input.options.profile);
    if(this.origin.recoveryRequired)throw new PlotterError('origin','Restore the physical origin and explicitly set it before plotting.');
    if(input.options.firmware!==undefined&&this.firmware?.version!==input.options.firmware)throw new PlotterError('unsupported-firmware','The connected firmware differs from the prepared program.');
    if(this.origin.source!=='unset'&&!this.origin.matches(input.options.profile))throw new PlotterError('origin','Machine scale or orientation changed. Set the origin again before plotting.');
    const plan=JSON.parse(JSON.stringify(input)) as ExecutablePlan,f=this.device();
    this.profile={...plan.options.profile};this.penSettings={...plan.options.pen};
    this.busy=true;this.paused=this.stopRequested=this.cancelled=false;this.cancelOperation=null;this.pauseReady=false;this.startedAt=this.clock.now();this.finishedMs=0;
    this.setState('starting');const pending:ExecutionRecord[]=[];
    const settle=async()=>{await f.drain();const observed=await f.position();if(observed.m1!==this.origin.steps.m1||observed.m2!==this.origin.steps.m2)throw new PlotterError('origin','Controller position differs from the compiled endpoint. Restore origin before plotting.');for(const r of pending.splice(0))this.emit({kind:'record',recordId:r.id,phase:'settled'});this.emit({kind:'position',position:fromNative(observed,this.profile)});};
    let result:JobState='finished',preparedHardware=false;
    try {
      await this.checkPower();this.requirePower();
      if(this.stopRequested||this.cancelled){result=this.cancelled?'cancelled':'stopped';return result;}
      preparedHardware=true;
      if(await f.purge(false)){this.origin.invalidate();throw new PlotterError('origin','Previous motion was interrupted. Restore the physical origin before starting a new plot.');}
      await f.drain(70000);if(plan.backend==='t3')await f.prepareModern();await f.preparePowerMonitor();await f.protocol.request('SC,2,0');await f.configure(this.penSettings,this.profile);if(this.profile.servoKind!=='brushless')await f.holdServo();
      // Force the real Up before origin setup or any return/homing motion.
      this.emit({kind:'record',recordId:0,phase:'started'});
      await f.pen(this.penSettings.up,this.penSettings,this.profile,plan.records[0]!.durationMs);
      this.emit({kind:'record',recordId:0,phase:'queued'});this.emit({kind:'record',recordId:0,phase:'settled'});
      if(!this.origin.matches(this.profile))await this.origin.capture(f,this.profile,'automatic');
      if(!this.origin.isAtOrigin()&&!this.cancelled)await this.returnRaised(plan.options);
      this.setState('running');
      for(const r of plan.records) {
        if(r.id===0)continue;
        if(r.kind!=='motor'||r.restBefore) {
          await settle();
          if(this.clock.now()-this.lastPowerPoll>=2000){await this.checkPower();this.requirePower();}
          await this.waitPaused(r);if(this.stopRequested||this.cancelled)break;
        }
        if(this.cancelled)break;
        if(r.settings){this.penSettings={...r.settings.pen};}
        this.emit({kind:'record',recordId:r.id,phase:'started'});
        if(r.kind==='tool'||r.kind==='pause'){this.paused=true;await this.waitPaused(r);}
        else if(r.kind==='delay'){let remaining=r.durationMs;while(remaining>0&&!this.cancelled&&!this.stopRequested){await this.waitPaused(r);if(this.cancelled||this.stopRequested)break;const duration=Math.min(100,remaining);await this.clock.sleep(duration);remaining-=duration;await this.pollStatus();}if(remaining>0)break;}
        else if(r.kind==='pen')await f.pen(r.penDown?this.penSettings.down:this.penSettings.up,this.penSettings,this.profile,r.durationMs,false,!r.penDown);
        else {await f.motion(r);this.origin.steps={...r.toSteps};if(this.clock.now()-this.lastPowerPoll>=2000){await this.checkPower();this.requirePower();}}
        if(this.cancelled)break;
        this.emit({kind:'record',recordId:r.id,phase:'queued'});pending.push(r);
        if(r.kind!=='motor')await settle();
      }
      if(this.cancelled){await this.cancelOperation;await f.purge(true);this.origin.invalidate();result='cancelled';}
      else {await settle();if(this.stopRequested){result='stopped';this.setState('returning');await this.returnRaised(plan.options);}}
      if(f.settledHeight!==this.penSettings.up)await f.pen(this.penSettings.up,this.penSettings,this.profile,120);if(this.profile.servoKind!=='brushless')await f.releaseServo(this.penSettings.servoTimeoutMs??60000);
    } catch(error) {
      result=this.cancelOperation&&this.cancelled?'cancelled':'failed';this.origin.invalidate();
      if(preparedHardware){await f.purge(true).catch(()=>{});await f.pen(this.penSettings.up,this.penSettings,this.profile,120,false,true,true).catch(()=>{});}
      if(result!=='cancelled')throw error;
    } finally {
      if(preparedHardware&&(!lifecycle.keepMotors||result!=='finished'))await this.origin.release(f).catch(()=>{this.origin.invalidate();});
      this.finishedMs=this.elapsedMs;this.startedAt=null;this.busy=false;this.pauseReady=false;this.paused=false;this.setState(result);
    }
    return result;
  }
  async drawPath(paths:Parameters<typeof compileJob>[0],options:PlotOptions):Promise<JobState>{return this.run(compileJob(paths,options));}
}
