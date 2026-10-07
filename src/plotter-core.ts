import {assertHardwareProfile} from './machine-profiles';
import {PlotterSession,JobSequence,CheckpointIndex,capabilities,digest,variedCopy,type ByteTransport,type Clock,type SessionEvent,type ExecutablePlan,type Checkpoint} from '@thierryc/plotter-core';
import {initialState,type PlotSettings,type Point} from './model';
import {motionPlanFromProgram,type MotionPlan} from './motion-plan';
import {coreOptions} from './core-settings';
import {executionFromEditor} from './plotter-adapter';
import {eventSignal,indexPenCounts,type PlotSignal,type PenCounts} from './plot-signals';
import type {PenSettings} from './pen-control';
import {parsePowerStatus,unavailablePower,type PowerStatus} from './ebb-power';

export interface SerialPortInfo {usbVendorId?:number;usbProductId?:number}
export interface SerialPortLike {
  readable:ReadableStream<Uint8Array>|null;writable:WritableStream<Uint8Array>|null;
  open(options:{baudRate:number}):Promise<void>;close():Promise<void>;getInfo():SerialPortInfo;
}
export interface SerialTransport {readonly supported:boolean;requestPort():Promise<SerialPortLike>;addEventListener?(type:'disconnect',listener:(event:Event)=>void):void}
export interface ExecutionOptions {positionBudgetMs?:number;maxCompiledCommands?:number;sleep?:(ms:number)=>Promise<void>;clock?:Clock;sessionFactory?:(port:SerialPortLike,clock:Clock,profile:import('@thierryc/plotter-core').MachineProfile)=>Promise<PlotterSession>}
export interface PlotProgress {completed:number;total:number;state:'idle'|'plotting'|'pausing'|'paused'|'tool-change'|'stopping'|'returning'|'stopped'|'cancelled'|'finished';tool?:string;copy?:number;copies?:number|'continuous';remainingMs?:number;nextAction?:'delay'|'continue';label?:string;pauseReason?:'tool'|'layer'}
export interface PlotterTrace {time:number;elapsedMs?:number;commandId:number|null;command:string;reason:string;event:number;state:PlotProgress['state'];phase:'requested'|'written'|'received'|'acknowledged'|'settled'|'failed';pen:number|null;response?:string;error?:string}
export interface PlotterJobTrace {protocol:'ebb-native-sm-v1'|'ebb-native-t3-v2';startedAt:string;firmware:string|null;settings:PlotSettings;estimatedDuration:number;plan:MotionPlan;executable:ExecutablePlan;signals:PlotSignal[];droppedSignals:number;entries:PlotterTrace[];droppedEntries:number;checkpoint?:Checkpoint;variants?:Array<{copy:number;digest:string;program:ExecutablePlan}>}
/** Compatibility facade only. All device behavior is implemented by the new package. */
export class PlotterCore {
  private session:PlotterSession|null=null;private port:SerialPortLike|null=null;private connectingNow=false;
  private settings:PlotSettings={...initialState.settings};private traceEntries:PlotterTrace[]=[];private penEntries:PlotterTrace[]=[];private job:PlotterJobTrace|null=null;
  private view:PlotProgress={completed:0,total:0,state:'idle'};private signal:PlotSignal|null=null;private plan:MotionPlan|null=null;private eventIds:number[]=[];
  private penCounts:PenCounts[]=[];
  private closing:Promise<void>=Promise.resolve();
  private sequence:JobSequence|null=null;
  private checkpointIndex:CheckpointIndex|null=null;private checkpointLayers:string[]=[];
  private sequenceRunning=false;
  private needsRecovery=false;private sequenceElapsed:number|null=null;
  private serialId=0;private recordId=0;private pen:number|null=null;private lastElapsed=0;private label='';private clock:Clock;
  onConnectionChange:()=>void=()=>{};onProgress:(p:PlotProgress)=>void=()=>{};onPosition:((p:Point)=>void)|null=null;onSignal:(s:PlotSignal)=>void=()=>{};
  constructor(private transport:SerialTransport,private execution:ExecutionOptions={}){
    this.clock=execution.clock??{now:()=>performance.now(),sleep:ms=>execution.sleep?.(ms)??new Promise(resolve=>setTimeout(resolve,ms)),schedule:(ms,callback)=>{const timer=setTimeout(callback,ms);return()=>clearTimeout(timer);}};
    transport.addEventListener?.('disconnect',event=>{if(event.target===this.port){this.needsRecovery||=this.active||!!this.session?.origin.recoveryRequired;this.closing=this.session?.lostConnection()??Promise.resolve();this.port=null;this.onConnectionChange();}});
  }
  get supported():boolean{return this.transport.supported;}get connected():boolean{return !!this.session?.connected;}get connecting():boolean{return this.connectingNow;}
  get active():boolean{return this.sequenceRunning||!!this.sequence?.busy||(this.session?.busy??false);}get canAdjustPen():boolean{return this.sequence?.busy&&!this.session?.busy?false:this.session?.canAdjustPen??(this.connected&&!this.active);}
  get motionCapabilities(){return this.session?.firmware?capabilities(this.session.firmware):null;}
  get firmwareLabel():string|null{return this.connected?this.session?.firmware?.version??null:null;}
  get progress():PlotProgress{return {...this.view};}get executionSignal():PlotSignal|null{return this.signal?structuredClone(this.signal):null;}
  get motorsOn():boolean{return this.session?.origin.motorsOn??false;}get originStatus():'unset'|'automatic'|'explicit'{return this.connected?this.session?.origin.source??'unset':'unset';}
  get originAvailable():boolean{return this.originStatus!=='unset'&&!this.active;}
  hasOrigin(profile:PlotSettings['profile']):boolean{return this.connected&&!!this.session&&this.session.origin.source!=='unset'&&this.session.origin.profile?.id===coreOptions({...this.settings,profile}).profile.id;}
  invalidateOrigin():void{if(this.active)throw new Error('Wait until the plotter is idle.');this.session?.origin.invalidate();}
  get powerStatus():PowerStatus{const p=this.session?.power;return p?parsePowerStatus(`${p.current},${p.supply}`):unavailablePower();}
  get elapsedMs():number{if(!this.active&&this.sequenceElapsed!==null)return this.sequenceElapsed;return this.sequence?.busy?this.sequence.elapsedMs:this.session?.elapsedMs??this.lastElapsed;}
  get diagnosticTrace():PlotterTrace[]{return structuredClone(this.traceEntries);}
  get diagnosticPenTrace():PlotterTrace[]{return structuredClone(this.penEntries);}
  clearCheckpoint():void{if(this.active)throw new Error('Wait until the job is idle.');if(this.job)delete this.job.checkpoint;}
  get completedCheckpoint():Checkpoint|undefined{return this.job?.checkpoint?structuredClone(this.job.checkpoint):undefined;}
  get diagnosticJobTrace():PlotterJobTrace|null{return this.job?structuredClone(this.job):null;}
  configurePen(settings:PenSettings):void{if(this.active)throw new Error('Wait until the plotter is idle before changing pen heights.');const next={...this.settings,...settings};assertHardwareProfile(next.profile);const options=coreOptions(next);this.session?.configure(options.pen,options.profile);this.settings=next;}
  private device():PlotterSession{if(!this.connected)throw new Error('Connect the plotter first.');return this.session!;}
  private observe=(event:SessionEvent):void=>{
    if(event.kind==='exchange'){
      if(event.phase==='requested')this.serialId++;
      const entry:PlotterTrace={time:event.timeMs,elapsedMs:this.elapsedMs,commandId:this.serialId,command:event.command!,phase:event.phase as PlotterTrace['phase'],reason:this.active?'fresh core execution':'manual/connection',event:this.view.completed,state:this.view.state,pen:this.pen,response:event.response,error:event.error};
      this.traceEntries.push(entry);if(this.traceEntries.length>500)this.traceEntries.shift();
      if(/^(SC|SP|SR|ES|EM)(,|$)/.test(entry.command)||entry.phase==='failed'){this.penEntries.push(entry);if(this.penEntries.length>200)this.penEntries.shift();}
      if(this.job){this.job.entries.push(entry);if(this.job.entries.length>20000){this.job.entries.splice(1000,2000);this.job.droppedEntries+=2000;}}
    }else if(event.kind==='position'&&event.position)this.onPosition?.({...event.position});
    else if(event.kind==='record'&&this.plan){
      const id=event.recordId!,index=this.eventIds[id]!,first=this.eventIds[id-1]!==index,last=this.eventIds[id+1]!==index;
      if(index===undefined)return;this.recordId=id;
      if(event.phase==='settled'&&this.job&&this.checkpointIndex)this.job.checkpoint=this.checkpointIndex.at(id,this.view.copy??1,this.checkpointLayers[id]??'',this.settings.varyClosedStarts?((this.settings.pathRandomSeed??1)^Math.imul(this.view.copy??1,0x9e3779b9))>>>0:this.settings.pathRandomSeed??1);
      if(event.phase==='started'&&!first||event.phase!=='started'&&!last)return;
      const phase=event.phase as PlotSignal['phase'];this.signal=eventSignal(this.plan,this.penCounts,index,phase,this.elapsedMs);this.pen=this.signal.penHeight;
      this.onSignal(structuredClone(this.signal));if(this.job){this.job.signals.push(structuredClone(this.signal));if(this.job.signals.length>20000){this.job.signals.splice(1000,2000);this.job.droppedSignals+=2000;}}
      if(phase==='queued'){this.view={...this.view,completed:index+1};this.onProgress({...this.view});}
    }else if(event.kind==='state'){
      const state=event.state==='starting'||event.state==='running'||event.state==='finished'&&this.sequenceRunning?'plotting':event.state==='failed'?'cancelled':event.state as PlotProgress['state'];
      this.view={...this.view,state,...(state==='tool-change'&&this.plan?{tool:this.plan.events[this.eventIds[this.recordId]!]!.tool,label:this.plan.events[this.eventIds[this.recordId]!]!.label,pauseReason:this.plan.executable?.records[this.recordId]?.kind==='pause'?'layer' as const:'tool' as const}:{})};this.onProgress({...this.view});
    }
  };
  async connect():Promise<string>{
    assertHardwareProfile(this.settings.profile);
    if(this.connected)return this.label;if(this.connectingNow)throw new Error('A plotter connection is already in progress.');if(!this.supported)throw new Error('Web Serial is unavailable. Open Plot-it in desktop Chrome or Edge.');
    this.connectingNow=true;this.onConnectionChange();
    try{
      await this.closing;
      const port=await this.transport.requestPort();await port.open({baudRate:9600});this.port=port;
      if(!port.readable||!port.writable)throw new Error('The serial port did not open correctly.');
      let session:PlotterSession;
      if(this.execution.sessionFactory)session=await this.execution.sessionFactory(port,this.clock,coreOptions(this.settings).profile);
      else{const reader=port.readable.getReader(),writer=port.writable.getWriter();let closed=false;
        const bytes:ByteTransport={read:async()=>{const r=await reader.read();return r.done?null:r.value;},write:b=>writer.write(b),close:async()=>{if(closed)return;closed=true;await reader.cancel().catch(()=>{});reader.releaseLock();writer.releaseLock();await port.close();}};
        session=new PlotterSession(bytes,this.clock,coreOptions(this.settings).profile);
      }
      if(this.needsRecovery||this.session?.origin.recoveryRequired)session.origin.invalidate();session.subscribe(this.observe);this.session=session;session.configure(coreOptions(this.settings).pen);
      const firmware=await session.connect(),info=port.getInfo();this.label=`${info.usbVendorId?.toString(16)??'unknown'}:${info.usbProductId?.toString(16)??'unknown'} · EBB Firmware Version ${firmware.version}`;return this.label;
    }catch(error){await this.session?.lostConnection();this.port=null;throw error;}finally{this.connectingNow=false;this.onConnectionChange();}
  }
  async disconnect():Promise<void>{if(this.connectingNow)throw new Error('Wait until the plotter is idle before disconnecting.');if(this.session?.connected)await this.session.disconnect();this.lastElapsed=this.elapsedMs;this.session=null;this.port=null;this.onConnectionChange();}
  async jog(delta:Point,settings:PlotSettings):Promise<void>{this.configurePen(settings);await this.device().moveBy(delta,coreOptions(settings));}
  async home():Promise<void>{await this.device().home();this.needsRecovery=false;}
  async firmwareVersion():Promise<string>{return this.device().firmwareVersion();}
  async checkPowerSupply():Promise<PowerStatus>{if(this.active)throw new Error('Wait until the plotter is idle.');await this.device().checkPower();return this.powerStatus;}
  async setPen(percent:number,_force=false):Promise<void>{await this.device().setPen(percent);}
  async setOrigin(profile:PlotSettings['profile']='axidraw',source:'automatic'|'explicit'='explicit'):Promise<void>{assertHardwareProfile(profile);await this.device().setOrigin(coreOptions({...this.settings,profile}).profile,source);this.needsRecovery=false;}
  async ensureOrigin(profile:PlotSettings['profile']):Promise<void>{if(!this.hasOrigin(profile))await this.setOrigin(profile,'automatic');}
  async engageMotors():Promise<void>{await this.device().engage();}
  async disengageMotors(up=this.settings.penUp):Promise<void>{this.configurePen({...this.settings,penUp:up});await this.device().release();}
  async returnToOrigin(settings:PlotSettings):Promise<void>{this.configurePen(settings);await this.device().returnToOrigin(coreOptions(settings));}
  pause():void{if(this.sequence?.busy)this.sequence.pause();else this.session?.pause();}resume():void{if(this.sequence?.busy)this.sequence.continue();else this.session?.resume();}stop():void{if(this.sequence?.busy)this.sequence.stop();else this.session?.stop();}cancel():void{if(this.sequence?.busy)this.sequence.cancel();else this.session?.cancel();}
  async plot(input:MotionPlan):Promise<void>{
    assertHardwareProfile(input.settings.profile);
    if(this.active)throw new Error('Wait until the plotter is idle.');
    const {plan,eventIds}=executionFromEditor(input);if(plan.records.length>(this.execution.maxCompiledCommands??1000000))throw new Error('Compiled job exceeds command limit.');
    this.sequenceElapsed=null;this.configurePen(input.settings);
    this.checkpointIndex=new CheckpointIndex(plan);let layer='';this.checkpointLayers=plan.records.map(r=>{layer=r.label??layer;return layer;});
    const session=this.device();this.plan=structuredClone(input);this.eventIds=eventIds;this.penCounts=indexPenCounts(this.plan);this.view={completed:0,total:input.events.length,state:'plotting'};this.signal=null;
    this.job={protocol:plan.backend==='t3'?'ebb-native-t3-v2':'ebb-native-sm-v1',startedAt:new Date().toISOString(),firmware:this.firmwareLabel,settings:structuredClone(input.settings),estimatedDuration:input.duration,plan:structuredClone(input),executable:structuredClone(plan),signals:[],droppedSignals:0,entries:[],droppedEntries:0};
    const repeat={copies:input.settings.copies??1,intervalMs:input.settings.repeatIntervalMs??0,requireContinue:input.settings.repeatRequireContinue??false,varyClosedStarts:input.settings.varyClosedStarts??false,seed:input.settings.pathRandomSeed??1};
    if(repeat.copies===1){try{await session.run(plan);}catch(error){this.view={...this.view,state:'cancelled'};this.onProgress({...this.view});throw error;}return;}
    const sequence=this.sequence=new JobSequence(session,this.clock);
    const useProgram=(actual:ExecutablePlan,copy:number)=>{this.plan=motionPlanFromProgram(actual,{...input.settings,returnToOrigin:actual.options.returnToOrigin},input.sourcePaths,input.layers);this.eventIds=actual.records.map((_,i)=>i);this.penCounts=indexPenCounts(this.plan);this.checkpointIndex=new CheckpointIndex(actual);let layer='';this.checkpointLayers=actual.records.map(r=>{layer=r.label??layer;return layer;});this.view={...this.view,completed:0,total:actual.records.length};if(this.job){const identity=digest(actual);if(identity!==digest(plan)&&!this.job.variants?.some(v=>v.digest===identity)){this.job.variants??=[];this.job.variants.push({copy,digest:identity,program:structuredClone(actual)});if(this.job.variants.length>2)this.job.variants.shift();}}};
    sequence.onProgram=useProgram;sequence.onStatus=status=>{if(['finished','stopped','cancelled','failed'].includes(status.state))this.sequenceElapsed=status.elapsedMs;const state=status.state==='waiting'?'plotting':status.state==='continue'?'tool-change':status.state==='drawing'?'plotting':status.state==='failed'?'cancelled':status.state as PlotProgress['state'];this.view={...this.view,state,copy:status.copy,copies:status.copies,remainingMs:status.remainingMs,...(status.state==='waiting'?{nextAction:'delay' as const}:status.state==='continue'?{nextAction:'continue' as const}:{nextAction:undefined})};this.onProgress({...this.view});};
    this.sequenceRunning=true;
    const remote=session as PlotterSession & {runSequence?:(plan:ExecutablePlan,repeat:unknown,onStatus:typeof sequence.onStatus,onProgram:typeof sequence.onProgram,source?:unknown)=>Promise<unknown>};
    try{if(remote.runSequence)await remote.runSequence(plan,repeat,sequence.onStatus,useProgram,{paths:input.sourcePaths,layers:input.layers,options:plan.options,offsetMm:input.settings.startAtMm??0});else await sequence.run([{id:'drawing',plan}],repeat,repeat.varyClosedStarts?copy=>[{id:'drawing',plan:variedCopy(input.sourcePaths??[],plan.options,copy,repeat.seed,input.layers,input.settings.startAtMm??0)}]:undefined);}finally{this.sequence=null;this.sequenceRunning=false;}
  }
}
