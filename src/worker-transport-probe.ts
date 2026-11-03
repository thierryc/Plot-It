import {VirtualClock,VirtualEbb} from '@thierryc/plotter-core/virtual';
import {machineProfile,compileJob,defaultPen} from '@thierryc/plotter-core';
import {browserClock} from '@thierryc/plotter-core/browser';
import {WorkerSession} from './worker-session';
/** Browser acceptance for transferable serial streams. Opens no physical port. */
export async function verifyWorkerTransport():Promise<string>{
 const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7',fragmentBytes:1}),transport=board.createTransport(),profile=machineProfile('xylodraw',0),start=performance.now();let closed=false;
 const port={readable:new ReadableStream<Uint8Array>({async pull(controller){const bytes=await transport.read();if(bytes)controller.enqueue(bytes);else controller.close();},cancel:()=>transport.close()}),writable:new WritableStream<Uint8Array>({async write(bytes){clock.advance(Math.max(0,performance.now()-start-clock.now()));await transport.write(bytes);},close:()=>transport.close()}),open:async()=>{},close:async()=>{if(port.readable.locked||port.writable.locked)throw new Error('Cannot close a serial port with locked streams.');closed=true;await transport.close();},getInfo:()=>({})};
 const worker=await WorkerSession.open(port,browserClock,profile);await worker.connect();const options={profile,pen:{...defaultPen,up:30,down:60},speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:true,drawingMode:'profiled' as const,backend:'t3' as const,firmware:'3.1.7'};
 let confirmedPenState:string|undefined;
 worker.subscribe(event=>{if(event.kind==='pen-confirmation')confirmedPenState=event.penConfirmation?.penState;});
 worker.configure(options.pen,profile);
 const before={...board.position},manualStart=board.commands.length;
 for(const percent of [30,60]){
  await worker.setPen(percent);
  if(board.position.m1!==before.m1||board.position.m2!==before.m2)throw new Error('Manual pen control changed the virtual XY position.');
  if(confirmedPenState!==(percent===30?'up':'down'))throw new Error('Transferred worker omitted the confirmed manual pen state.');
  if(board.penUp!==(percent===30))throw new Error(`Manual pen ${percent} did not settle to the requested state.`);
 }
 const manual=board.commands.slice(manualStart);
 if(manual.some(command=>/^(SM|XM|HM|LM|LT|L3|T3|TD|CS)(,|$)/.test(command)))throw new Error('Manual pen control issued XY motion or cleared position counters.');
 if(!manual.includes('QG'))throw new Error('Manual pen control skipped controller state verification.');
 await worker.run(compileJob([{tool:'black',points:[{x:1,y:1},{x:3,y:1}]}],options));
 if(confirmedPenState!=='up')throw new Error('Transferred worker omitted the final confirmed Up.');
 if(board.position.m1||board.position.m2||!board.penUp)throw new Error('Transferred worker did not return raised to origin.');
 await worker.disconnect();if(!closed)throw new Error('Worker did not release the transport.');
 if(board.commands.some(command=>/^S2(,|$)/.test(command)))throw new Error('Safe RB1 profile issued S2.');
 return`Worker transfer passed · manual Up30/Down60 without XY/CS · QG verified · no S2 · ${board.commands.length} commands · final M1=0 M2=0 · pen UP · streams released`;
}

/** Actual execution worker + transferable streams; uses only the independent fake board. */
export async function verifyDenseWorkerTransport(full=false):Promise<string>{
 const fixture=(await import('../scripts/fixtures/permissive-motion-corpus.json')).default.dense;
 const count=full?fixture.count:1000,profile=machineProfile('xylodraw',0,16),clock=new VirtualClock(),commands:string[]=[],board=new VirtualEbb(clock,{firmware:'3.1.7',fragmentBytes:64,onCommand:command=>{if(/^(SM|T3|TD),/.test(command))commands.push(command);}}),transport=board.createTransport();
 const started=performance.now();let closed=false;
 const port={readable:new ReadableStream<Uint8Array>({async pull(controller){const bytes=await transport.read();if(bytes)controller.enqueue(bytes);else controller.close();},cancel:()=>transport.close()}),writable:new WritableStream<Uint8Array>({async write(bytes){clock.advance(Math.max(0,performance.now()-started-clock.now()));await transport.write(bytes);},close:()=>transport.close()}),open:async()=>{},close:async()=>{if(port.readable.locked||port.writable.locked)throw new Error('Transferred streams are still locked.');closed=true;await transport.close();},getInfo:()=>({})};
 const options={profile,pen:{...defaultPen,up:30,down:52,upDelayMs:200,downDelayMs:200},speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:true,drawingMode:'profiled' as const,backend:'t3' as const,firmware:'3.1.7'};
 const paths=[{tool:'black',sourceId:`${fixture.id}:0`,points:Array.from({length:count},(_,i)=>({x:full?fixture.offsetX+i*fixture.stepX:1+i*.02,y:full?fixture.offsetY+fixture.amplitude*Math.sin(i*fixture.radiansPerPoint):1+Math.sin(i*.04)*.1}))}];
 const plan=compileJob(paths,options),expected:string[]=[];let settledRecords=0,rangeEvents=0,droppedDiagnostics=0,programs=0;
 const {motorCommand}=await import('@thierryc/plotter-core');
 const addExpected=(program:typeof plan)=>{expected.push(...program.records.filter(r=>r.kind==='motor').map(motorCommand));};
 const session=await WorkerSession.open(port,browserClock,profile);
 session.subscribe(event=>{if(event.kind==='record-range'){settledRecords+=event.recordEndId!-event.recordId!+1;rangeEvents++;}if(event.kind==='telemetry')droppedDiagnostics=event.droppedDiagnostics??0;});
 try{
  await session.connect();addExpected(plan);await session.run(plan);
  if(!full){const repeated=compileJob(paths,{...options,returnToOrigin:false});await session.runSequence(repeated,{copies:2,intervalMs:0,requireContinue:false},()=>{},program=>{programs++;addExpected(program);});}
  if(commands.length!==expected.length||commands.some((command,i)=>command!==expected[i]))throw new Error('Paged worker changed or omitted a motor command.');
  if(!board.penUp||session.state!=='finished')throw new Error('Final pen state or execution state was not confirmed.');
  if(full&&(board.position.m1||board.position.m2))throw new Error('Dense reference wave did not return to the compiled origin.');
  if(!full&&programs!==2)throw new Error('Paged variant/reference program delivery did not complete.');
  if(rangeEvents>=settledRecords/10)throw new Error('Dense settlement expanded into individual UI records.');
  await session.disconnect();if(!closed)throw new Error('Worker did not release the transferred streams.');
  return`PASS · actual worker / real transferable streams / fake EBB only\n${count} source points · ${commands.length} exact motor commands · ${settledRecords} settled records in ${rangeEvents} ranges\n${full?'One continuous reference wave':'Single run + two copies; paged raised-return variant and original reference'} · ${droppedDiagnostics} coalesced/dropped diagnostics\nFinal pen UP · streams released · ${(performance.now()-started).toFixed(0)} ms elapsed`;
 }catch(error){await session.lostConnection().catch(()=>{});throw error;}
}
