import {PlotterSession,Origin,type Clock,type MachineProfile,type Observer,type PenSettings,type ExecutablePlan,type PlotOptions,type Firmware} from '@thierryc/plotter-core';
import type {SerialPortLike} from './plotter-core';
import {executionPages,metadataPages,planHeader,PlanPageReceiver} from './execution-pages';
import {closeTransferredPort} from './serial-port-close';
/** Main-thread facade. Opened streams transfer to one dedicated execution owner. */
export class WorkerSession extends PlotterSession {
 private terminated=false;private transferCancelled=false;private pauseAfterTransfer=false;private transferring=false;private worker:Worker;private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();private nextId=0;private clientObservers=new Set<Observer>();private isConnected=false;private adjustable=false;private elapsed=0;private elapsedAt=performance.now();private configError:Error|null=null;
 override readonly origin:Origin;
 private constructor(private port:SerialPortLike,clock:Clock,profile:MachineProfile){
  super({read:async()=>null,write:async()=>{},close:async()=>{}},clock,profile);
  this.worker=new Worker(new URL('./execution.worker.ts',import.meta.url),{type:'module'});
  const invalidate=()=>{void this.request('invalidate',{}).catch(error=>{this.configError=error;});};
  this.origin=new class extends Origin{override invalidate(){super.invalidate();invalidate();}}();
  this.worker.onmessage=event=>{const data=event.data,s=data.snapshot;if(s){this.firmware=s.firmware;this.state=s.state;this.busy=s.busy||this.transferring;this.isConnected=s.connected;this.adjustable=s.canAdjustPen;this.power=s.power;this.elapsed=s.elapsedMs;this.elapsedAt=performance.now();this.profile=s.profile;Object.assign(this.origin,s.origin);}
   if(data.type==='events'){try{for(const e of [...data.events,{kind:'telemetry',timeMs:performance.now(),droppedDiagnostics:data.droppedDiagnostics??0}])for(const observer of this.clientObservers){try{const result=observer(e);if(result)void result.catch(()=>{});}catch{}}}finally{this.worker.postMessage({action:'events-ack'});}}
   if(data.type==='result'){const pending=this.pending.get(data.id);if(!pending)return;this.pending.delete(data.id);if(data.error)pending.reject(new Error(data.error));else pending.resolve(data.value);}
  };
  this.worker.onerror=event=>{this.terminated=true;this.transferCancelled=true;this.isConnected=false;this.busy=false;this.origin.source='unset';for(const pending of this.pending.values())pending.reject(new Error(event.message));this.pending.clear();};
 }
 static async open(port:SerialPortLike,clock:Clock,profile:MachineProfile):Promise<WorkerSession>{
  const session=new WorkerSession(port,clock,profile);
  try{await session.request('init',{readable:port.readable,writable:port.writable,profile},[port.readable!,port.writable!]);return session;}catch(error){session.worker.terminate();await port.close().catch(()=>{});throw error;}
 }
 private request(action:string,args:unknown={},transfer:Transferable[]=[]):Promise<any>{if(this.terminated)return Promise.reject(new Error('Execution worker is closed.'));const id=++this.nextId;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});try{this.worker.postMessage({id,action,args},transfer);}catch(error){this.pending.delete(id);reject(error);}});}
 override get connected(){return this.isConnected;}
 override get canAdjustPen(){return this.adjustable;}
 override get elapsedMs(){return this.busy?this.elapsed+Math.max(0,performance.now()-this.elapsedAt):this.elapsed;}
 override subscribe(observer:Observer){this.clientObservers.add(observer);return()=>{this.clientObservers.delete(observer);};}
 override async connect():Promise<Firmware>{return this.request('connect');}
 override configure(pen:PenSettings,profile=this.profile):void{this.penSettings={...pen};this.profile={...profile};void this.request('configure',{pen,profile}).catch(error=>{this.configError=error;});}
 private async transferPlan(plan:ExecutablePlan):Promise<void>{
  if(this.configError)throw this.configError;if(this.busy||this.transferring)throw new Error('Execution is already active.');
  this.transferCancelled=false;this.pauseAfterTransfer=false;this.transferring=true;this.busy=true;
  try{
   await this.request('plan-begin',{header:planHeader(plan)});
   for await(const page of metadataPages(plan)){
    if(this.transferCancelled)throw new Error('Executable transfer was cancelled before execution.');
    await this.request('plan-metadata',{page},[page.bytes]);
   }
   for await(const page of executionPages(plan.records)){
    if(this.transferCancelled)throw new Error('Executable transfer was cancelled before execution.');
    await this.request('plan-page',{page},[page.bytes]);
   }
   if(this.transferCancelled)throw new Error('Executable transfer was cancelled before execution.');
   await this.request('plan-end');
   if(this.transferCancelled)throw new Error('Executable transfer was cancelled before execution.');
  }
  catch(error){await this.request('plan-abort').catch(()=>{});throw error;}
  finally{this.transferring=false;this.busy=false;}
 }
 override async run(plan:ExecutablePlan){await this.transferPlan(plan);this.busy=true;const running=this.request('run');if(this.pauseAfterTransfer)this.pause();return running;}
 override async disconnect(){this.transferCancelled=true;await this.request('disconnect');this.terminated=true;for(const pending of this.pending.values())pending.reject(new Error('Execution worker is closed.'));this.pending.clear();this.worker.terminate();await closeTransferredPort(this.port);}
 override async lostConnection(){this.transferCancelled=true;await this.request('lostConnection').catch(()=>{});for(const pending of this.pending.values())pending.reject(new Error('The plotter disconnected.'));this.pending.clear();this.terminated=true;this.worker.terminate();await closeTransferredPort(this.port).catch(()=>{});this.isConnected=false;}
 override async setPen(percent:number){await this.request('setPen',{percent});}
 override async setOrigin(profile=this.profile,source:'automatic'|'explicit'='explicit'){await this.request('setOrigin',{profile,source});}
 override async engage(){await this.request('engage');}override async release(){await this.request('release');}
 override async relax(){await this.request('relax');}
 override async home(){await this.request('home');}
 override async returnToOrigin(options:PlotOptions){await this.request('returnToOrigin',{options});}
 override async checkPower(){return this.request('checkPower');}
 override async firmwareVersion(){return this.request('firmwareVersion');}
 override pause(){if(this.transferring){this.pauseAfterTransfer=true;return;}void this.request('pause').catch(()=>{});}override resume(){this.pauseAfterTransfer=false;void this.request('resume').catch(()=>{});}override stop(){if(this.transferring)this.transferCancelled=true;void this.request('stop').catch(()=>{});}override cancel(){if(this.transferring)this.transferCancelled=true;void this.request('cancel').catch(()=>{});}
 override async readName(){return this.request('readName');}override async rename(name:string){await this.request('rename',{name});}
 override async observedPosition(){return this.request('observedPosition');}override async waitUntilIdle(){await this.request('waitUntilIdle');}
 override async delay(ms:number){await this.request('delay',{ms});}
 override async moveTo(target:import('@thierryc/plotter-core').Point,options:PlotOptions,draw=false){await this.request('moveTo',{target,options,draw});}
 override async moveBy(delta:import('@thierryc/plotter-core').Point,options:PlotOptions,draw=false){await this.request('moveBy',{delta,options,draw});}
 override async drawTo(target:import('@thierryc/plotter-core').Point,options:PlotOptions){await this.moveTo(target,options,true);}
 override async drawPolyline(points:readonly import('@thierryc/plotter-core').Point[],options:PlotOptions){await this.request('drawPolyline',{points,options});}
 override async pollStatus(){throw new Error('Sequence scheduling belongs to the execution worker.');return super.pollStatus();}
 async runSequence(plan:ExecutablePlan,repeat:unknown,onStatus:(status:any)=>void,onProgram:(plan:ExecutablePlan,copy:number,segment:number)=>void,source?:unknown){
  const incoming=new PlanPageReceiver();
  const listener=async(event:MessageEvent)=>{
   const data=event.data;
   if(data.type==='events'&&data.sequenceStatus){onStatus(data.sequenceStatus);return;}
   if(!data.type?.startsWith('program-'))return;
   let error:string|undefined;
   try{
    if(data.type==='program-reference')onProgram(plan,data.copy,data.segment);
    else if(data.type==='program-begin')incoming.begin(data.header);
    else if(data.type==='program-metadata')await incoming.appendMetadata(data.page);
    else if(data.type==='program-page')await incoming.append(data.page);
    else if(data.type==='program-end')onProgram(incoming.finish(),data.copy,data.segment);
   }catch(cause){error=String(cause);incoming.clear();}
   this.worker.postMessage({action:'program-ack',args:{messageId:data.messageId,error}});
  };
  this.worker.addEventListener('message',listener);
  try{await this.transferPlan(plan);this.busy=true;const running=this.request('sequence',{repeat,source:(repeat as {varyClosedStarts?:boolean}).varyClosedStarts?source:undefined});if(this.pauseAfterTransfer)this.pause();return await running;}
  finally{this.worker.removeEventListener('message',listener);incoming.clear();}
 }
}
