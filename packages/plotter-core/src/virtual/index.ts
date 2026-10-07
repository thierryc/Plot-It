import { ascii,text } from '../protocol.js';
import type { ByteTransport,Clock,NativePoint,T3Parameters } from '../types.js';
/** Deterministic, fast clock. Observers see every elapsed interval, not UI frames. */
export class VirtualClock implements Clock {
  private time=0;private observers=new Set<(time:number)=>void>();
  private timers=new Set<{at:number;callback:()=>void}>();
  now():number{return this.time;}
  subscribe(observer:(time:number)=>void):()=>void{this.observers.add(observer);return()=>this.observers.delete(observer);}
  advance(ms:number):void{if(!Number.isFinite(ms)||ms<0)throw new Error('Invalid virtual time.');const target=this.time+ms;let count=0;for(;;){const next=[...this.timers].filter(t=>t.at<=target).sort((a,b)=>a.at-b.at)[0];if(!next)break;if(++count>100000)throw new Error('Virtual timer limit exceeded');this.time=Math.max(this.time,next.at);for(const o of this.observers)o(this.time);this.timers.delete(next);next.callback();}this.time=target;for(const o of this.observers)o(this.time);}
  schedule(ms:number,callback:()=>void):()=>void{const timer={at:this.time+ms,callback};this.timers.add(timer);return()=>{this.timers.delete(timer);};}
  async sleep(ms:number):Promise<void>{this.advance(ms);}
}
interface Queued { command:string;kind:'motor'|'pen'|'enable';duration:number;delta?:NativePoint;up?:boolean;pulse?:number;rate?:number;period?:number;modes?:number[];native?:T3Parameters }
interface TickAxis {rate:bigint;acceleration:bigint;jerk:bigint;accumulator:bigint}
interface Active { item:Queued;start:number;end:number;from:NativePoint;fromPulse:number;ticks:number;axes?:TickAxis[];mechanical?:{x:number;y:number} }
export interface VirtualTrace {timeMs:number;phase:'accepted'|'started'|'completed'|'rejected';command:string;position:NativePoint;penUp:boolean;pulse:number;queue:number}
export interface VirtualOptions {
  firmware?:'2.8.1'|'3.0.2'|'3.1.0'|'3.1.6'|'3.1.7';fifoCapacity?:number;futureReplies?:boolean;
  fragmentBytes?:number;supplyAdc?:number;replyDelayMs?:number;
  onCommand?:(command:string,board:VirtualEbb)=>void;
  homingMechanics?:{x:number;y:number;stepsPerMm:number;switchMissing?:boolean};
}
/** Stateful protocol emulator. Never imports the planner, compiler or preview sampler. */
export class VirtualEbb {
  readonly trace:VirtualTrace[]=[];readonly commands:string[]=[];
  commandCount=0;completedCount=0;liftCount=0;lowerCount=0;droppedCommands=0;droppedTraceEntries=0;readonly gpio=new Map<number,number>();
  position:NativePoint={m1:0,m2:0};penUp=true;pulse=0;motorsOn=false;
  accumulators:NativePoint={m1:0,m2:0};buttonPressed=false;limitTriggered=false;nickname='Virtual EBB';
  readonly servo=new Map<number,number>();supplyAdc:number;
  private queue:Queued[]=[];private active:Active|null=null;private powerLost=false;private future:boolean;
  private capacity:number;private listeners=new Set<(board:VirtualEbb)=>void>();
  private motorModes=[0,0];private limitMask=0;mechanical:{x:number;y:number}|null=null;
  constructor(readonly clock:VirtualClock,private options:VirtualOptions={}) {
    this.future=options.futureReplies??false;this.supplyAdc=options.supplyAdc??300;
    const capacity=options.fifoCapacity??1;if(!Number.isInteger(capacity)||capacity<1||capacity>1024)throw new Error('Invalid virtual FIFO capacity.');
    this.capacity=capacity;this.mechanical=options.homingMechanics?{x:options.homingMechanics.x,y:options.homingMechanics.y}:null;this.servo.set(4,21850);this.servo.set(5,15700);clock.subscribe(now=>{this.advance(now);for(const listener of this.listeners)listener(this);});
  }
  get firmware():string{return this.options.firmware??'2.8.1';}
  get queued():number{return this.queue.length+(this.active?1:0);}
  subscribe(listener:(board:VirtualEbb)=>void):()=>void{this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  get activeCommand():string|null{return this.active?.item.command??null;}
  private event(command:string,phase:VirtualTrace['phase'],timeMs=this.clock.now()):void{
    if(phase==='completed'){this.completedCount++;if(command.startsWith('SP,1,'))this.liftCount++;if(command.startsWith('SP,0,'))this.lowerCount++;}
    this.trace.push({timeMs,phase,command,position:{...this.position},penUp:this.penUp,pulse:this.pulse,queue:this.queued});
    if(this.trace.length>20000){this.trace.splice(1000,2000);this.droppedTraceEntries+=2000;}
  }
  private begin(at:number):void{
    if(this.active||!this.queue.length)return;const item=this.queue.shift()!;
    this.active={item,start:at,end:at+item.duration,from:{...this.position},fromPulse:this.pulse,ticks:0,...(this.mechanical?{mechanical:{...this.mechanical}}:{})};
    if(item.kind==='enable'){this.motorModes=item.modes!;this.motorsOn=this.motorModes.some(Boolean);this.accumulators={m1:0,m2:0};}
    if(item.native){const p=item.native;this.active.axes=[p.axis1,p.axis2].map((axis,i)=>{
      const r=BigInt(axis.rate),a=BigInt(axis.acceleration),j=BigInt(axis.jerk),first=r-a/2n+j/6n+a;
      const initial=first<0n||first===0n&&(a+j<0n||a+j===0n&&j<0n)?2147483647n:0n;
      return{rate:r-a/2n+j/6n,acceleration:a-j,jerk:j,accumulator:p.clear&(1<<i)?initial:BigInt(i===0?this.accumulators.m1:this.accumulators.m2)};
    });}
    if(item.kind==='pen')this.penUp=item.up!;
    this.event(item.command,'started',at);
  }
  private advance(now:number):void{
    while(this.active) {
      const active=this.active,elapsed=Math.max(0,Math.min(active.item.duration,now-active.start));
      if(active.axes){const ticks=Math.min(active.item.native!.ticks,Math.floor(elapsed*25+1e-7));
        // Literal ISR recurrence: deliberately does not call production prediction.
        while(active.ticks<ticks){for(const [i,axis]of active.axes.entries()){
          axis.acceleration+=axis.jerk;axis.rate+=axis.acceleration;axis.accumulator+=axis.rate;
          const negative=axis.accumulator<0n,overflow=axis.accumulator>=2147483648n;
          if(negative||overflow){axis.accumulator+=negative?2147483648n:-2147483648n;const key=i===0?'m1':'m2';this.position[key]+=negative?-1:1;}
        }active.ticks++;}
        this.accumulators={m1:Number(active.axes[0]!.accumulator),m2:Number(active.axes[1]!.accumulator)};
      }
      if(active.item.kind==='pen'){const delta=active.item.pulse!-active.fromPulse,movement=active.item.rate?Math.min(Math.abs(delta),active.item.rate*elapsed/(active.item.period??24)):Math.abs(delta);this.pulse=Math.round(active.fromPulse+Math.sign(delta)*movement);}
      if(active.item.delta){
        // Separate step interpreter: signed step counts progress monotonically and
        // land exactly at the endpoint. This is not the production sample function.
        let f=elapsed/active.item.duration;const d=active.item.delta;
        if(active.mechanical&&this.options.homingMechanics){
          const s=this.options.homingMechanics.stepsPerMm,start=active.mechanical;
          const physical=(ratio:number)=>{
            if(this.motorModes[0]&&!this.motorModes[1]&&d.m1<0){const travel=-d.m1*ratio/s,diagonal=Math.min(travel,2*start.y);return{x:start.x-diagonal/2-Math.max(0,travel-diagonal),y:start.y-diagonal/2};}
            const m1=this.motorModes[0]?d.m1*ratio:0,m2=this.motorModes[1]?d.m2*ratio:0;return{x:start.x+(m1+m2)/(2*s),y:Math.max(0,start.y+(m1-m2)/(2*s))};
          };
          if(this.limitMask&2&&!this.options.homingMechanics.switchMissing&&physical(f).x<=0){let low=0,high=f;for(let n=0;n<40;n++){const mid=(low+high)/2;if(physical(mid).x>0)low=mid;else high=mid;}f=high;active.end=active.start+f*active.item.duration;this.limitTriggered=true;this.queue=[];}
          this.mechanical=physical(f);if(Math.abs(this.mechanical.x)<1e-8)this.mechanical.x=0;
        }
        const step=(n:number)=>Math.sign(n)*Math.floor(Math.abs(n)*f+1e-10);
        this.position={m1:active.from.m1+step(d.m1),m2:active.from.m2+step(d.m2)};
      }
      if(now<active.end)break;
      this.active=null;this.event(active.item.command,'completed',active.end);this.begin(active.end);
    }
  }
  private async enqueue(item:Queued):Promise<void>{
    while(this.queue.length>=this.capacity&&this.active)await this.clock.sleep(Math.max(0,this.active.end-this.clock.now()));
    this.queue.push(item);this.event(item.command,'accepted');this.begin(this.clock.now());
  }
  losePower():void{this.supplyAdc=0;this.powerLost=true;}
  createTransport():ByteTransport&{disconnect():void} {
    let connected=true,buffer='';const chunks:Uint8Array[]=[];let waiting:((value:Uint8Array|null)=>void)|null=null;
    const listeners=new Set<()=>void>();
    const deliver=(reply:string)=>{
      const bytes=ascii(`${reply}\r\n`),size=this.options.fragmentBytes??3;
      for(let i=0;i<bytes.length;i+=Math.max(1,size))chunks.push(bytes.slice(i,i+Math.max(1,size)));
      if(waiting&&chunks.length){const resolve=waiting;waiting=null;resolve(chunks.shift()!);}
    };
    const disconnect=()=>{if(!connected)return;connected=false;chunks.length=0;waiting?.(null);waiting=null;for(const listener of listeners)listener();};
    return{
      write:async(bytes)=>{
        if(!connected)throw new Error('USB disconnected');buffer+=text(bytes);
        while(buffer.includes('\r')){
          const end=buffer.indexOf('\r'),command=buffer.slice(0,end);buffer=buffer.slice(end+1);
          this.commandCount++;this.commands.push(command);if(this.commands.length>20000){this.commands.splice(1000,2000);this.droppedCommands+=2000;}this.options.onCommand?.(command,this);
          let response:string;
          try{response=await this.handle(command);}catch(error){this.event(command,'rejected');response=`!${String(error)}`;}
          if(this.options.replyDelayMs)await this.clock.sleep(this.options.replyDelayMs);
          if(!connected)throw new Error('USB disconnected');deliver(response);
        }
      },
      read:async()=>chunks.length?chunks.shift()!:connected?new Promise(resolve=>{if(waiting)throw new Error('Only one reader may own the transport.');waiting=resolve;}):null,
      close:async()=>disconnect(),disconnect,
      onDisconnect:listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
    };
  }
  private async handle(command:string):Promise<string>{
    if(command.startsWith('ST,')){const name=command.slice(3);if(!/^[A-Za-z0-9 _-]{0,16}$/.test(name))throw new Error('Invalid nickname');this.nickname=name;return this.future?'ST':'OK';}
    const [name,...fields]=command.split(','),values=fields.filter(field=>field!=='B').map(Number);
    if(values.some(v=>!Number.isInteger(v)))throw new Error('Invalid integer parameter');
    this.advance(this.clock.now());
    const ack=()=>this.future?name!:'OK';
    const query=(payload:string,terminator=false)=>this.future?`${name},${payload}`:payload+(terminator?'\r\nOK':'');
    if(name==='V')return(this.future?'V,':'')+`EBB Firmware Version ${this.firmware}`;
    if(name==='QG'){
      const busy=this.queued?8+(this.queue.length?1:0):0,bits=busy+(this.penUp?16:0)+(this.buttonPressed?32:0)+(this.firmware.startsWith('3.')&&this.powerLost?64:0)+(this.limitTriggered?128:0);this.powerLost=false;this.buttonPressed=this.limitTriggered=false;
      return query(bits.toString(16).padStart(2,'0'));
    }
    if(name==='QS')return query(`${this.position.m1},${this.position.m2}`,true);
    if(name==='QC')return query(`394,${this.supplyAdc}`,true);
    if(name==='CU'&&this.firmware.startsWith('3.')){
      if(values[0]===10&&[0,1].includes(values[1]!)){const response=this.future?values[1]===0?'CUOK':ack():values[1]===1?'':ack();this.future=values[1]===1;return response;}
      if(values[0]===4){if(this.queued)throw new Error('FIFO change while busy');this.capacity=Math.min(32,Math.max(1,values[1]!));return ack();}
      if(values[0]===51){this.limitMask=values[1]!;return ack();}
      if([50,52,53,60].includes(values[0]!))return ack();
    }
    if(name==='PD'||name==='PO'){if(fields[0]!=='B'||values.length!==2||values[0]!<0||values[0]!>7||![0,1].includes(values[1]!))throw new Error('Invalid GPIO');if(name==='PO')this.gpio.set(values[0]!,values[1]!);return ack();}
    if(name==='PI'){if(command!=='PI,B,1')throw new Error('Unsupported virtual input');return`PI,${this.options.homingMechanics?.switchMissing||this.mechanical&&this.mechanical.x<=0?1:0}`;}
    if(name==='QU'&&this.firmware.startsWith('3.'))return query(values[0]===2?'32':values[0]===3?String(this.capacity):'0',true);
    if(name==='QT')return query(this.nickname,true);
    if(name==='SC'){
      if(values.length!==2||![2,4,5,8,9,11,12].includes(values[0]!))throw new Error('Unsupported SC parameter');
      this.servo.set(values[0]!,values[1]!);return ack();
    }
    if(name==='SR'){if(values.length<1||values.length>2||values[0]!<0||values[0]!>65535||values.length===2&&![0,1].includes(values[1]!))throw new Error('Invalid SR');return ack();}
    if(name==='EM'){
      if(values.length!==2||values.some(v=>![0,1,2].includes(v)))throw new Error('Invalid motor mode');
      await this.enqueue({command,kind:'enable',duration:0,modes:values});return ack();
    }
    if(name==='CS'){if(this.queued)throw new Error('CS while busy');this.position={m1:0,m2:0};this.accumulators={m1:0,m2:0};return ack();}
    if(name==='ES'){
      if(values.length>1||!values.every(v=>v===0||v===1))throw new Error('Invalid ES');
      const interrupted=!!this.active&&this.active.item.kind==='motor';
      if(this.firmware.startsWith('3.')){this.active=null;this.queue=[];}
      else {if(this.active?.item.kind==='motor')this.active=null;this.queue=this.queue.filter(item=>item.kind!=='motor');this.begin(this.clock.now());}
      if(values[0]===1)this.motorsOn=false;
      return query(interrupted?'1':'0',true);
    }
    if(name==='SP'){
      if(values[0]===3&&this.firmware.startsWith('3.')){
        this.servo.set(5,this.servo.get(4)!);this.penUp=true;this.pulse=this.servo.get(4)!;
        for(const q of this.queue)if(q.kind==='pen'){q.up=true;q.pulse=this.pulse;}return ack();
      }
      if(values.length!==3||![0,1].includes(values[0]!)||values[1]!<1||values[1]!>65535||![1,2].includes(values[2]!))throw new Error('Invalid pen command');
      const up=values[0]===1;await this.enqueue({command,kind:'pen',up,pulse:this.servo.get(up?4:5)!,rate:this.servo.get(up?11:12)??0,period:(this.servo.get(8)??8)*(this.servo.get(9)??3),duration:values[1]!});return ack();
    }
    if(name==='T3'||name==='TD'){
      if(!this.firmware.startsWith('3.')||!this.motorsOn||values.length!==(name==='T3'?8:10))throw new Error('Unsupported native command');
      const ticks=values[0]!;if(ticks<1||ticks>4294967295||values.slice(1,-1).some(v=>v< -2147483648||v>2147483647)||values.at(-1)!<0||values.at(-1)!>3)throw new Error('Invalid T3 parameter');
      const halves:T3Parameters[]=name==='T3'?[{ticks,axis1:{rate:values[1]!,acceleration:values[2]!,jerk:values[3]!},axis2:{rate:values[4]!,acceleration:values[5]!,jerk:values[6]!},clear:values[7]!}]:[
        {ticks,axis1:{rate:values[1]!,acceleration:0,jerk:values[4]!},axis2:{rate:values[5]!,acceleration:0,jerk:values[8]!},clear:values[9]!},
        {ticks,axis1:{rate:values[2]!,acceleration:values[3]!,jerk:-values[4]!},axis2:{rate:values[6]!,acceleration:values[7]!,jerk:-values[8]!},clear:0}];
      for(const native of halves)await this.enqueue({command,kind:'motor',duration:ticks/25,native});return ack();
    }
    if(name==='SM'||name==='XM'){
      if(values.length!==3||values[0]!<1||values[0]!>65535||!this.motorsOn)throw new Error('Invalid motor command');
      const delta=name==='SM'?{m1:values[1]!,m2:values[2]!}:{m1:values[1]!+values[2]!,m2:values[1]!-values[2]!};
      for(const step of [delta.m1,delta.m2])if(step&&Math.abs(step)*1000/values[0]!<2||Math.abs(step)*1000/values[0]!>25000)throw new Error('Motor rate outside firmware range');
      await this.enqueue({command,kind:'motor',duration:values[0]!,delta});return ack();
    }
    throw new Error(`Unsupported command ${name}`);
  }
}

/** Optional wall-clock pacing for terminal inspection; fast tests use VirtualClock. */
export class RealtimeVirtualClock extends VirtualClock {
 private last:number;private closed=false;private cancelTick:()=>void=()=>{};private hostTimers=new Set<()=>void>();
 constructor(private host:Clock){super();this.last=host.now();this.tick();}
 private sync():void{const now=this.host.now(),elapsed=Math.max(0,now-this.last);this.last=now;this.advance(elapsed);}
 private tick():void{if(this.closed)return;this.cancelTick=this.host.schedule(20,()=>{this.sync();this.tick();});}
 dispose():void{this.closed=true;this.cancelTick();for(const cancel of this.hostTimers)cancel();this.hostTimers.clear();}
 override async sleep(ms:number):Promise<void>{const until=this.host.now()+ms;for(;;){const remaining=until-this.host.now();if(remaining<=0)break;await this.host.sleep(Math.min(20,remaining));this.sync();}}
 override schedule(ms:number,callback:()=>void):()=>void{let cancel:()=>void;cancel=this.host.schedule(ms,()=>{this.hostTimers.delete(cancel);this.sync();callback();});this.hostTimers.add(cancel);return()=>{cancel();this.hostTimers.delete(cancel);};}
}
