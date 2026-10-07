import {PlotterSession,JobSequence,variedCopy,type SessionEvent,type MachineProfile,type ExecutablePlan,type PenSettings} from '@thierryc/plotter-core';
import {browserClock} from '@thierryc/plotter-core/browser';
let session:PlotterSession|null=null,sequence:JobSequence|null=null,reader:ReadableStreamDefaultReader<Uint8Array>|null=null,writer:WritableStreamDefaultWriter<Uint8Array>|null=null;
const snapshot=()=>session?{firmware:session.firmware,state:session.state,busy:session.busy||!!sequence?.busy,canAdjustPen:session.canAdjustPen&&(!sequence?.busy||session.busy),connected:session.connected,power:session.power,elapsedMs:sequence?.busy?sequence.elapsedMs:session.elapsedMs,profile:session.profile,origin:{source:session.origin.source,profile:session.origin.profile,steps:session.origin.steps,motorsOn:session.origin.motorsOn,recoveryRequired:session.origin.recoveryRequired}}:null;
let batch:SessionEvent[]=[],timer:ReturnType<typeof setTimeout>|null=null;
const flush=()=>{if(timer){clearTimeout(timer);timer=null;}if(batch.length){self.postMessage({type:'events',events:batch,snapshot:snapshot()});batch=[];}};
self.onmessage=async(event:MessageEvent)=>{const {id,action,args}=event.data;try{
 if(action==='init'){
  reader=(args.readable as ReadableStream<Uint8Array>).getReader();writer=(args.writable as WritableStream<Uint8Array>).getWriter();let closed=false;
  session=new PlotterSession({read:async()=>{const result=await reader!.read();return result.done?null:result.value;},write:bytes=>writer!.write(bytes),close:async()=>{if(closed)return;closed=true;await reader!.cancel().catch(()=>{});reader!.releaseLock();await writer!.close().catch(()=>{});writer!.releaseLock();}},browserClock,args.profile as MachineProfile);
  session.subscribe(e=>{batch.push(e);if(batch.length>=200||e.kind==='state')flush();else timer??=setTimeout(flush,20);});
 }else{
  if(!session)throw new Error('Initialize the execution worker first.');let value:unknown;
  if(action==='connect')value=await session.connect();
  else if(action==='disconnect')await session.disconnect();
  else if(action==='lostConnection')await session.lostConnection();
  else if(action==='configure')session.configure(args.pen as PenSettings,args.profile);
  else if(action==='run')value=await session.run(args.plan as ExecutablePlan);
  else if(action==='sequence'){
   sequence=new JobSequence(session,browserClock);sequence.onProgram=(plan,copy,segment)=>{flush();self.postMessage({type:'program',plan,copy,segment});};sequence.onStatus=status=>self.postMessage({type:'sequence',status,snapshot:snapshot()});try{value=await sequence.run(args.segments,args.repeat,args.repeat.varyClosedStarts?copy=>[{id:'drawing',plan:variedCopy(args.source.paths,args.source.options,copy,args.repeat.seed,args.source.layers,args.source.offsetMm)}]:undefined);}finally{sequence=null;}
  }
  else if(action==='setPen')await session.setPen(args.percent);
  else if(action==='setOrigin')await session.setOrigin(args.profile,args.source);
  else if(action==='engage')await session.engage();else if(action==='release')await session.release();
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
  flush();self.postMessage({type:'result',id,value,snapshot:snapshot()});return;
 }
 self.postMessage({type:'result',id,snapshot:snapshot()});
 }catch(error){flush();self.postMessage({type:'result',id,error:String(error),snapshot:snapshot()});}};
