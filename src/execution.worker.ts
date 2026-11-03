import {PlotterSession,JobSequence,variedCopy,type MachineProfile,type ExecutablePlan,type PenSettings} from '@thierryc/plotter-core';
import {executionPages,metadataPages,planHeader,PlanPageReceiver} from './execution-pages';
import {ExecutionTelemetry} from './execution-telemetry';
import {browserClock} from '@thierryc/plotter-core/browser';
let session:PlotterSession|null=null,sequence:JobSequence|null=null,reader:ReadableStreamDefaultReader<Uint8Array>|null=null,writer:WritableStreamDefaultWriter<Uint8Array>|null=null;
const snapshot=()=>session?{firmware:session.firmware,state:session.state,busy:session.busy||!!sequence?.busy,canAdjustPen:session.canAdjustPen&&(!sequence?.busy||session.busy),connected:session.connected,power:session.power,elapsedMs:sequence?.busy?sequence.elapsedMs:session.elapsedMs,profile:session.profile,origin:{source:session.origin.source,profile:session.origin.profile,steps:session.origin.steps,motorsOn:session.origin.motorsOn,recoveryRequired:session.origin.recoveryRequired}}:null;
let pendingSequenceStatus:unknown;
const telemetry=new ExecutionTelemetry();let timer:ReturnType<typeof setTimeout>|null=null,inFlight=false;
const flushWaiters:Array<()=>void>=[];
const flush=()=>{if(timer){clearTimeout(timer);timer=null;}if(inFlight)return;if(telemetry.length||pendingSequenceStatus){inFlight=true;self.postMessage({type:'events',events:telemetry.take(),sequenceStatus:pendingSequenceStatus,droppedDiagnostics:telemetry.droppedDiagnostics,snapshot:snapshot()});pendingSequenceStatus=undefined;}else for(const resolve of flushWaiters.splice(0))resolve();};
const flushAll=()=>new Promise<void>(resolve=>{flushWaiters.push(resolve);flush();});
const incoming=new PlanPageReceiver();let prepared:ExecutablePlan|null=null;
let programMessageId=0;const programAcks=new Map<number,{resolve:()=>void;reject:(error:Error)=>void}>();
const programMessage=(data:object,transfer:Transferable[]=[])=>new Promise<void>((resolve,reject)=>{const messageId=++programMessageId;programAcks.set(messageId,{resolve,reject});self.postMessage({...data,messageId},{transfer});});
const sendProgram=async(plan:ExecutablePlan,original:ExecutablePlan,copy:number,segment:number)=>{
 await flushAll();
 if(plan===original){await programMessage({type:'program-reference',copy,segment});return;}
 await programMessage({type:'program-begin',header:planHeader(plan),copy,segment});
 for await(const page of metadataPages(plan))await programMessage({type:'program-metadata',page},[page.bytes]);
 for await(const page of executionPages(plan.records))await programMessage({type:'program-page',page},[page.bytes]);
 await programMessage({type:'program-end',copy,segment});
};
self.onmessage=async(event:MessageEvent)=>{const {id,action,args}=event.data;
 if(action==='events-ack'){inFlight=false;flush();return;}
 if(action==='program-ack'){const ack=programAcks.get(args.messageId);programAcks.delete(args.messageId);if(args.error)ack?.reject(new Error(args.error));else ack?.resolve();return;}
 try{
 if(action==='init'){
  reader=(args.readable as ReadableStream<Uint8Array>).getReader();writer=(args.writable as WritableStream<Uint8Array>).getWriter();let closed=false;
  session=new PlotterSession({read:async()=>{const result=await reader!.read();return result.done?null:result.value;},write:bytes=>writer!.write(bytes),close:async()=>{if(closed)return;closed=true;await reader!.cancel().catch(()=>{});reader!.releaseLock();await writer!.close().catch(()=>{});writer!.releaseLock();}},browserClock,args.profile as MachineProfile);
  session.subscribe(e=>{telemetry.push(e);if(telemetry.length>=200||e.kind==='state'||e.kind==='pen-confirmation')flush();else timer??=setTimeout(flush,20);},{settlementRanges:true});
 }else{
  if(!session)throw new Error('Initialize the execution worker first.');let value:unknown;
  if(action==='connect')value=await session.connect();
  else if(action==='disconnect')await session.disconnect();
  else if(action==='lostConnection')await session.lostConnection();
  else if(action==='configure')session.configure(args.pen as PenSettings,args.profile);
  else if(action==='plan-begin'){if(session.busy||sequence?.busy||prepared)throw new Error('Execution is already active.');incoming.begin(args.header);}
  else if(action==='plan-metadata')await incoming.appendMetadata(args.page);
  else if(action==='plan-page')await incoming.append(args.page);
  else if(action==='plan-end')prepared=incoming.finish();
  else if(action==='plan-abort'){incoming.clear();prepared=null;}
  else if(action==='run'){if(!prepared)throw new Error('Transfer the complete executable before running.');const plan=prepared;prepared=null;value=await session.run(plan);}
  else if(action==='sequence'){
   if(!prepared)throw new Error('Transfer the complete executable before starting a sequence.');const original=prepared;prepared=null;
   sequence=new JobSequence(session,browserClock);sequence.onProgram=(plan,copy,segment)=>sendProgram(plan,original,copy,segment);sequence.onStatus=status=>{pendingSequenceStatus=status;flush();};try{value=await sequence.run([{id:'drawing',plan:original}],args.repeat,args.repeat.varyClosedStarts?copy=>[{id:'drawing',plan:variedCopy(args.source.paths,args.source.options,copy,args.repeat.seed,args.source.layers,args.source.offsetMm)}]:undefined);}finally{sequence=null;}
  }
  else if(action==='setPen')await session.setPen(args.percent);
  else if(action==='setOrigin')await session.setOrigin(args.profile,args.source);
  else if(action==='engage')await session.engage();else if(action==='release')await session.release();
  else if(action==='relax')await session.relax();
  else if(action==='home')await session.home();else if(action==='returnToOrigin')await session.returnToOrigin(args.options);
  else if(action==='checkPower')value=await session.checkPower();else if(action==='firmwareVersion')value=await session.firmwareVersion();
  else if(action==='readName')value=await session.readName();else if(action==='rename')await session.rename(args.name);
  else if(action==='observedPosition')value=await session.observedPosition();else if(action==='waitUntilIdle')await session.waitUntilIdle();else if(action==='delay')await session.delay(args.ms);
  else if(action==='moveTo')await session.moveTo(args.target,args.options,args.draw);else if(action==='moveBy')await session.moveBy(args.delta,args.options,args.draw);else if(action==='drawPolyline')await session.drawPolyline(args.points,args.options);
  else if(action==='invalidate')session.origin.invalidate();
  else if(action==='pause'){if(sequence?.busy)sequence.pause();else session.pause();}
  else if(action==='resume'){if(sequence?.busy)sequence.continue();else session.resume();}
  else if(action==='stop'){if(sequence?.busy)sequence.stop();else session.stop();}
  else if(action==='cancel'){if(sequence?.busy)sequence.cancel();else session.cancel();}
  else throw new Error('Unsupported worker operation.');
  await flushAll();self.postMessage({type:'result',id,value,snapshot:snapshot()});return;
 }
 self.postMessage({type:'result',id,snapshot:snapshot()});
 }catch(error){await flushAll();self.postMessage({type:'result',id,error:String(error),snapshot:snapshot()});}};
