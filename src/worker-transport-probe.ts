import {VirtualClock,VirtualEbb} from '@thierryc/plotter-core/virtual';
import {machineProfile,compileJob,defaultPen} from '@thierryc/plotter-core';
import {browserClock} from '@thierryc/plotter-core/browser';
import {WorkerSession} from './worker-session';
/** Browser acceptance for transferable serial streams. Opens no physical port. */
export async function verifyWorkerTransport():Promise<string>{
 const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7',fragmentBytes:1}),transport=board.createTransport(),profile=machineProfile('xylodraw',0),start=performance.now();let closed=false;
 const port={readable:new ReadableStream<Uint8Array>({async pull(controller){const bytes=await transport.read();if(bytes)controller.enqueue(bytes);else controller.close();},cancel:()=>transport.close()}),writable:new WritableStream<Uint8Array>({async write(bytes){clock.advance(Math.max(0,performance.now()-start-clock.now()));await transport.write(bytes);},close:()=>transport.close()}),open:async()=>{},close:async()=>{closed=true;await transport.close();},getInfo:()=>({})};
 const worker=await WorkerSession.open(port,browserClock,profile);await worker.connect();const options={profile,pen:{...defaultPen,up:30,down:52},speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:true,drawingMode:'profiled' as const,backend:'t3' as const,firmware:'3.1.7'};
 await worker.run(compileJob([{tool:'black',points:[{x:1,y:1},{x:3,y:1}]}],options));
 if(board.position.m1||board.position.m2||!board.penUp)throw new Error('Transferred worker did not return raised to origin.');
 await worker.disconnect();if(!closed)throw new Error('Worker did not release the transport.');return`Worker transfer passed · ${board.commands.length} commands · final M1=0 M2=0 · pen UP · streams released`;
}
