import {PlotterSession,importPrepared,compileLayerProgram,variedCopy,compileJob,machineProfile,defaultPen,fromNative,selectBackend,JobSequence,type PlotOptions} from '@thierryc/plotter-core';
import {VirtualEbb,RealtimeVirtualClock} from '@thierryc/plotter-core/virtual';
import {browserClock} from '@thierryc/plotter-core/browser';
let session:PlotterSession|null=null,sequence:JobSequence|null=null,running=false;
self.onmessage=async(event:MessageEvent)=>{
 const {action,settings}=event.data;
 if(action!=='run'){if(action==='pause'){if(sequence?.busy)sequence.pause();else session?.pause();}if(action==='resume'){if(sequence?.busy)sequence.continue();else session?.resume();}if(action==='stop'){if(sequence?.busy)sequence.stop();else session?.stop();}if(action==='cancel'){if(sequence?.busy)sequence.cancel();else session?.cancel();}return;}
 if(running)return;let prepared;try{prepared=settings.preparedText?importPrepared(settings.preparedText):null;}catch(error){self.postMessage({type:'done',error:String(error),trace:null});return;}
 if(prepared?.repeat.copies==='continuous'){self.postMessage({type:'done',error:'Use finite copies for an imported acceptance job.',trace:null});return;}
 const selectedFirmware=prepared?.target.firmware??settings.firmware,selectedProfile=prepared?.options.profile??machineProfile(settings.profile);
 running=true;const clock=new RealtimeVirtualClock(browserClock),board=new VirtualEbb(clock,{firmware:selectedFirmware as '2.8.1'|'3.0.2'|'3.1.0'|'3.1.6'|'3.1.7',fragmentBytes:1,...(settings.scenario==='homing'?{homingMechanics:{x:20,y:40,stepsPerMm:selectedProfile.stepsPerMm}}:{})}),profile=selectedProfile,journal:unknown[]=[];
 const transport=board.createTransport();session=new PlotterSession(transport,clock,profile);let last=-Infinity,phase='connecting',lastPen=board.penUp;let viewBounds={minX:0,minY:0,maxX:80,maxY:30};
 const status=(force=false)=>{if(!force&&clock.now()-last<100)return;last=clock.now();const position=fromNative(board.position,profile);self.postMessage({type:'status',bounds:viewBounds,timeMs:clock.now(),phase,state:sequence?.busy?sequence.status.state:session?.state,copy:sequence?.status.copy??1,copies:sequence?.status.copies??prepared?.repeat.copies??settings.copies,remainingMs:sequence?.status.remainingMs??0,position,native:board.position,accumulators:board.accumulators,penUp:board.penUp,pulse:board.pulse,queue:board.queued,supply:board.supplyAdc,command:board.activeCommand,commands:board.commandCount,completed:board.completedCount,lifts:board.liftCount,lowers:board.lowerCount});};
 board.subscribe(()=>status());session.subscribe(e=>{journal.push(e);if(journal.length>20000)journal.splice(1000,2000);if(e.kind==='state'||lastPen!==board.penUp){lastPen=board.penUp;status(true);}});
 let error:string|null=null;
 try{
  await session.connect();const backend=prepared?.program.backend??selectBackend(session.firmware!,settings.backend,true),options:PlotOptions=prepared?.options??{profile,pen:{...defaultPen,up:profile.servoKind==='brushless'?60:30,down:profile.servoKind==='brushless'?30:52},speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:15,returnToOrigin:true,drawingMode:settings.drawing,drawingJerk:500000,travelJerk:330200,backend,firmware:selectedFirmware};
  if(settings.scenario==='homing'){session.configure(options.pen);await session.home();}
  const paths=[{tool:'black',points:[{x:10,y:10},{x:80,y:10},{x:80,y:30},{x:60,y:30}]}];
  if(settings.scenario==='manual-down')await session.setPen(options.pen.down);
  viewBounds={minX:0,minY:0,maxX:0,maxY:0};for(const path of prepared?.paths??paths)for(const p of path.points){viewBounds.minX=Math.min(viewBounds.minX,p.x);viewBounds.minY=Math.min(viewBounds.minY,p.y);viewBounds.maxX=Math.max(viewBounds.maxX,p.x);viewBounds.maxY=Math.max(viewBounds.maxY,p.y);}
  phase='bounds';await session.run(compileJob(prepared?.paths??paths,prepared?.options??options,'bounds'));
  phase='drawing';if(settings.scenario==='supply')clock.schedule(2000,()=>board.losePower());if(settings.scenario==='disconnect')clock.schedule(2000,()=>transport.disconnect());if(settings.scenario==='button')clock.schedule(1500,()=>{board.buttonPressed=true;});
  sequence=new JobSequence(session,clock);sequence.onStatus=()=>status(true);
  const segments=prepared?[{id:'drawing',plan:prepared.program}]:settings.scenario==='layers'?[{id:'drawing',plan:compileLayerProgram([{id:'empty',name:'Drying wait',paths:[],delayMs:2000},{id:'slow',name:'Slow layer',paths,overrides:{speed:15}},{id:'normal',name:'Default layer',paths}],options)}]:[{id:'drawing',plan:compileJob(paths,options)}];
  const repeat=prepared?.repeat??{copies:settings.copies,intervalMs:settings.gap*1000,requireContinue:false};await sequence.run(segments,repeat,prepared?.repeat.varyClosedStarts?copy=>[{id:'drawing',plan:variedCopy(prepared.paths,prepared.options,copy,prepared.repeat.seed,prepared.layers,prepared.startAtMm)}]:undefined);
  await session.waitUntilIdle();
 }catch(reason){error=String(reason);}finally{phase=error?'failed':'complete';status(true);if(session.connected&&!session.busy)await session.disconnect().catch(()=>{});self.postMessage({type:'done',error,trace:{format:'plot-it-virtual-ebb-v2',settings:{...settings,preparedText:undefined},preparedDigest:prepared?.digest,trace:board.trace,droppedTraceEntries:board.droppedTraceEntries,droppedCommands:board.droppedCommands,journal,position:board.position,penUp:board.penUp}});clock.dispose();running=false;}
};
