import { motorCommand } from './compiler.js';
import { servoCommands, penDuration } from './pen.js';
import { PlotterError, type Clock, type Firmware, type MachineProfile, type MotorRecord, type NativePoint, type PenSettings } from './types.js';
import { EbbProtocol } from './protocol.js';
export interface BoardStatus { idle:boolean; penUp:boolean; powerLost:boolean; limit:boolean; button:boolean }
/** Serial scheduling and device setup only. No path geometry or editor state. */
export class Feeder {
  private queuedUntil=0;private penUntil=0;private height:number|null=null;
  private b3=false;private powerFault=false;private limitFault=false;
  clearFaults():void{this.powerFault=this.limitFault=false;}
  constructor(readonly protocol:EbbProtocol,private clock:Clock,readonly firmware:Firmware,private onStatus:(status:BoardStatus)=>void=()=>{}){}
  get settledHeight():number|null{return this.height;}
  async status(expectedLimit=false):Promise<BoardStatus> {
    const reply=await this.protocol.request('QG'),bits=parseInt(reply.split(',').at(-1)!,16);
    this.powerFault ||= this.firmware.modern&&!!(bits&64);if(!expectedLimit)this.limitFault ||= this.firmware.modern&&!!(bits&128);
    const status={idle:(bits&15)===0,penUp:!!(bits&16),powerLost:this.powerFault,limit:expectedLimit?this.firmware.modern&&!!(bits&128):this.limitFault,button:!!(bits&32)};this.onStatus(status);return status;
  }
  async position():Promise<NativePoint> {
    const reply=(await this.protocol.request('QS')).replace(/^QS,/,''),parts=reply.split(',').map(Number);
    if(parts.length!==2||parts.some(p=>!Number.isInteger(p)||p<-2147483648||p>2147483647))throw new PlotterError('protocol','Invalid EBB step position.');
    return{m1:parts[0]!,m2:parts[1]!};
  }
  async power():Promise<{state:'detected'|'low';supply:number;current:number}> {
    const reply=(await this.protocol.request('QC')).replace(/^QC,/,''),parts=reply.split(',').map(Number);
    if(parts.length!==2||parts.some(p=>!Number.isInteger(p)||p<0||p>1023))throw new PlotterError('protocol','Invalid supply reading.');
    return{state:parts[1]!<250?'low':'detected',current:parts[0]!,supply:parts[1]!};
  }
  async drain(graceMs=10000,ignoreFaults=false):Promise<void> {
    const delay=this.penUntil-this.clock.now();if(delay>0)await this.clock.sleep(delay);
    this.penUntil=0;
    const deadline=Math.max(this.clock.now(),this.queuedUntil)+graceMs;
    for(;;) {
      const status=await this.status();
      if(status.powerLost&&!ignoreFaults)throw new PlotterError('power','Motor supply was interrupted.');
      if(status.limit&&!ignoreFaults)throw new PlotterError('origin','A limit event invalidated the origin.');
      if(status.idle){this.queuedUntil=0;return;}
      if(this.clock.now()>deadline)throw new PlotterError('timeout','The plotter did not become idle.');
      await this.clock.sleep(20);
    }
  }
  async purge(disable=false):Promise<boolean> {
    const busy=!(await this.status()).idle;
    const response=await this.protocol.request(`ES,${disable?1:0}`);this.height=null;this.queuedUntil=this.penUntil=0;
    if(disable&&this.firmware.modern)await this.protocol.request('SP,3');
    if(disable&&this.b3){await this.protocol.request('PO,B,3,0');this.b3=false;}
    return /^(?:ES,)?1(?:,|$)/.test(response)||busy&&!/^(?:ES,)?[01](?:,|$)/.test(response);
  }
  async configure(pen:PenSettings,profile:MachineProfile,temporaryDown=pen.down):Promise<void> {
    if(pen.synchronizedB3&&!profile.toolOutputB3)throw new PlotterError('invalid-plan','Unsupported B3 tool output.');
    for(const command of servoCommands(pen,profile,temporaryDown))await this.protocol.request(command);
  }
  async holdServo():Promise<void>{await this.protocol.request('SR,0,1');}
  async releaseServo(timeoutMs=60000):Promise<void>{await this.protocol.request(`SR,${timeoutMs}`);this.height=null;}
  async pen(target:number,pen:PenSettings,profile:MachineProfile,minimumMs=0,reload=false,semanticUp?:boolean,emergency=false):Promise<void> {
    await this.drain(10000,emergency);
    const up=semanticUp??target===pen.up;
    // Always restore both endpoints. Manual heights, preview and SP,3 must never
    // leave a stale Down pulse that later maps a plotting Down to the Up pulse.
    await this.configure(pen,profile,up?pen.down:target);
    const duration=Math.max(minimumMs,penDuration(this.height,target,up,pen,reload,profile));
    await this.protocol.request(`SP,${up?1:0},${duration},${profile.servoPin}`);
    this.penUntil=this.clock.now()+duration;this.queuedUntil=Math.max(this.clock.now(),this.queuedUntil)+duration;
    try{await this.drain(10000,emergency);this.height=target;}catch(error){this.height=null;throw error;}
    this.protocol.settled(`SP,${up?1:0},${duration},${profile.servoPin}`);
    if(pen.synchronizedB3){if(!profile.toolOutputB3)throw new PlotterError('invalid-plan','Unsupported B3 tool output.');await this.protocol.request('PD,B,3,0');await this.protocol.request(`PO,B,3,${up?0:1}`);this.b3=!up;}
  }
  invalidatePen():void{this.height=null;}
  async prepareModern():Promise<void>{
    await this.protocol.request('CU,10,1');
    const maximum=Number((await this.protocol.request('QU,2')).split(',').at(-1));
    if(!Number.isInteger(maximum)||maximum<2||maximum>1024)throw new PlotterError('protocol','Invalid FIFO capacity.');
    await this.protocol.request(`CU,4,${Math.min(maximum,16)}`);
    const actual=Number((await this.protocol.request('QU,3')).split(',').at(-1));if(actual!==Math.min(maximum,16))throw new PlotterError('protocol','FIFO configuration did not match.');
  }
  async preparePowerMonitor():Promise<void>{if(this.firmware.modern)await this.protocol.request('CU,60,250');}
  async motion(record:MotorRecord):Promise<void> {
    // Bound ahead-of-host time even on boards with a deep FIFO. Backpressure still
    // belongs to the device; no renderer/status callback is awaited on this path.
    const ahead=this.queuedUntil-this.clock.now();if(ahead>500)await this.clock.sleep(ahead-250);
    await this.protocol.request(motorCommand(record));
    this.queuedUntil=Math.max(this.clock.now(),this.queuedUntil)+record.durationMs;
  }
}
