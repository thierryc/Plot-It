import {PlotterSession,Origin,type Clock,type MachineProfile,type Observer,type PenSettings,type ExecutablePlan,type PlotOptions,type Firmware} from '@thierryc/plotter-core';
import type {SerialPortLike} from './plotter-core';
/** Main-thread facade. Opened streams transfer to one dedicated execution owner. */
export class WorkerSession extends PlotterSession {
 private worker:Worker;private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();private nextId=0;private clientObservers=new Set<Observer>();private isConnected=false;private adjustable=false;private elapsed=0;private elapsedAt=performance.now();private configError:Error|null=null;
 override readonly origin:Origin;
 private constructor(private port:SerialPortLike,clock:Clock,profile:MachineProfile){
  super({read:async()=>null,write:async()=>{},close:async()=>{}},clock,profile);
  this.worker=new Worker(new URL('./execution.worker.ts',import.meta.url),{type:'module'});
  const invalidate=()=>{void this.request('invalidate',{}).catch(error=>{this.configError=error;});};
  this.origin=new class extends Origin{override invalidate(){super.invalidate();invalidate();}}();
  this.worker.onmessage=event=>{const data=event.data,s=data.snapshot;if(s){this.firmware=s.firmware;this.state=s.state;this.busy=s.busy;this.isConnected=s.connected;this.adjustable=s.canAdjustPen;this.power=s.power;this.elapsed=s.elapsedMs;this.elapsedAt=performance.now();this.profile=s.profile;Object.assign(this.origin,s.origin);}
   if(data.type==='events')for(const e of data.events)for(const observer of this.clientObservers){try{const result=observer(e);if(result)void result.catch(()=>{});}catch{}}
   if(data.type==='result'){const pending=this.pending.get(data.id);if(!pending)return;this.pending.delete(data.id);if(data.error)pending.reject(new Error(data.error));else pending.resolve(data.value);}
  };
  this.worker.onerror=event=>{this.isConnected=false;this.busy=false;this.origin.source='unset';for(const pending of this.pending.values())pending.reject(new Error(event.message));this.pending.clear();};
 }
 static async open(port:SerialPortLike,clock:Clock,profile:MachineProfile):Promise<WorkerSession>{
  const session=new WorkerSession(port,clock,profile);
  try{await session.request('init',{readable:port.readable,writable:port.writable,profile},[port.readable!,port.writable!]);return session;}catch(error){session.worker.terminate();await port.close().catch(()=>{});throw error;}
 }
 private request(action:string,args:unknown={},transfer:Transferable[]=[]):Promise<any>{const id=++this.nextId;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});try{this.worker.postMessage({id,action,args},transfer);}catch(error){this.pending.delete(id);reject(error);}});}
 override get connected(){return this.isConnected;}
 override get canAdjustPen(){return this.adjustable;}
 override get elapsedMs(){return this.busy?this.elapsed+Math.max(0,performance.now()-this.elapsedAt):this.elapsed;}
 override subscribe(observer:Observer){this.clientObservers.add(observer);return()=>{this.clientObservers.delete(observer);};}
 override async connect():Promise<Firmware>{return this.request('connect');}
 override configure(pen:PenSettings,profile=this.profile):void{this.penSettings={...pen};this.profile={...profile};void this.request('configure',{pen,profile}).catch(error=>{this.configError=error;});}
 override async run(plan:ExecutablePlan){if(this.configError)throw this.configError;this.busy=true;return this.request('run',{plan});}
 override async disconnect(){await this.request('disconnect');await this.port.close();this.worker.terminate();}
 override async lostConnection(){await this.request('lostConnection').catch(()=>{});for(const pending of this.pending.values())pending.reject(new Error('The plotter disconnected.'));this.pending.clear();await this.port.close().catch(()=>{});this.worker.terminate();this.isConnected=false;}
 override async setPen(percent:number){await this.request('setPen',{percent});}
 override async setOrigin(profile=this.profile,source:'automatic'|'explicit'='explicit'){await this.request('setOrigin',{profile,source});}
 override async engage(){await this.request('engage');}override async release(){await this.request('release');}
 override async home(){await this.request('home');}
 override async returnToOrigin(options:PlotOptions){await this.request('returnToOrigin',{options});}
 override async checkPower(){return this.request('checkPower');}
 override async firmwareVersion(){return this.request('firmwareVersion');}
 override pause(){void this.request('pause').catch(()=>{});}override resume(){void this.request('resume').catch(()=>{});}override stop(){void this.request('stop').catch(()=>{});}override cancel(){void this.request('cancel').catch(()=>{});}
 override async readName(){return this.request('readName');}override async rename(name:string){await this.request('rename',{name});}
 override async observedPosition(){return this.request('observedPosition');}override async waitUntilIdle(){await this.request('waitUntilIdle');}
 override async delay(ms:number){await this.request('delay',{ms});}
 override async moveTo(target:import('@thierryc/plotter-core').Point,options:PlotOptions,draw=false){await this.request('moveTo',{target,options,draw});}
 override async moveBy(delta:import('@thierryc/plotter-core').Point,options:PlotOptions,draw=false){await this.request('moveBy',{delta,options,draw});}
 override async drawTo(target:import('@thierryc/plotter-core').Point,options:PlotOptions){await this.moveTo(target,options,true);}
 override async drawPolyline(points:readonly import('@thierryc/plotter-core').Point[],options:PlotOptions){await this.request('drawPolyline',{points,options});}
 override async pollStatus(){throw new Error('Sequence scheduling belongs to the execution worker.');return super.pollStatus();}
 async runSequence(plan:ExecutablePlan,repeat:unknown,onStatus:(status:any)=>void,onProgram:(plan:ExecutablePlan,copy:number,segment:number)=>void,source?:unknown){const listener=(event:MessageEvent)=>{if(event.data.type==='sequence')onStatus(event.data.status);else if(event.data.type==='program')onProgram(event.data.plan,event.data.copy,event.data.segment);};this.worker.addEventListener('message',listener);try{return await this.request('sequence',{segments:[{id:'drawing',plan}],repeat,source});}finally{this.worker.removeEventListener('message',listener);}}
}
