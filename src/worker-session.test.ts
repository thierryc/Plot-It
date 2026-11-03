import {afterEach,expect,it,vi} from 'vitest';
import {compileJob,defaultPen,machineProfile} from '@thierryc/plotter-core';
import {VirtualClock} from '@thierryc/plotter-core/virtual';
import {WorkerSession} from './worker-session';
import {EXECUTION_PAGE_BYTES} from './execution-pages';

afterEach(()=>vi.unstubAllGlobals());
it.each(['stop','cancel'] as const)('honors %s during an acknowledged metadata page without starting execution',async action=>{
 let metadataArrived!:()=>void,releaseMetadata!:()=>void;
 const arrived=new Promise<void>(resolve=>{metadataArrived=resolve;});
 class FakeWorker {
  static current:FakeWorker;
  onmessage:((event:MessageEvent)=>void)|null=null;
  onerror:((event:ErrorEvent)=>void)|null=null;
  messages:Array<{id:number;action:string;args:any}>=[];
  hold=true;
  constructor(){FakeWorker.current=this;}
  terminate(){}
  postMessage(message:{id:number;action:string;args:any}){
   this.messages.push(message);
   const respond=()=>queueMicrotask(()=>this.onmessage?.({data:{type:'result',id:message.id,value:message.action==='run'?'finished':undefined}} as MessageEvent));
   if(message.action==='plan-metadata'&&this.hold){releaseMetadata=()=>{this.hold=false;respond();};metadataArrived();}
   else respond();
  }
 }
 vi.stubGlobal('Worker',FakeWorker);
 const profile=machineProfile('xylodraw',0,16),plan=compileJob(Array.from({length:500},(_,i)=>({tool:'black',points:[{x:1,y:1+i*.1},{x:11,y:1+i*.1}]})),{profile,pen:defaultPen,speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:true,drawingMode:'profiled',backend:'sm',firmware:'3.1.7',workloadCheckpoints:{maxDrawingRecords:2000,maxDrawingMs:10000,maxDrawingMm:5}});
 const session=await WorkerSession.open({readable:new ReadableStream(),writable:new WritableStream(),open:async()=>{},close:async()=>{},getInfo:()=>({})},new VirtualClock(),profile);
 const running=session.run(plan),rejected=expect(running).rejects.toThrow(/cancelled before execution/);
 await arrived;
 const worker=FakeWorker.current;
 expect(session.busy).toBe(true);expect(worker.messages.filter(m=>m.action==='plan-metadata')).toHaveLength(1);expect(worker.messages.some(m=>m.action==='plan-page'||m.action==='run')).toBe(false);
 session[action]();releaseMetadata();await rejected;
 expect(worker.messages.some(m=>m.action==='run'||m.action==='plan-end')).toBe(false);expect(worker.messages.at(-1)?.action).toBe('plan-abort');expect(session.busy).toBe(false);
 const before=worker.messages.length;
 await expect(session.run(plan)).resolves.toBe('finished');
 const retry=worker.messages.slice(before),pages=retry.filter(m=>m.action==='plan-metadata');expect(pages.length).toBeGreaterThan(1);expect(pages.every(m=>m.args.page.bytes.byteLength<=EXECUTION_PAGE_BYTES)).toBe(true);expect(retry.at(-1)?.action).toBe('run');
 await session.disconnect();
});
