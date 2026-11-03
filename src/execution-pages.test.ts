import {it,expect} from 'vitest';
import {compileJob,machineProfile,defaultPen,motorCommand,validatePlan,digest} from '../packages/plotter-core/src/index.js';
import {executionPages,metadataPages,planHeader,PlanPageReceiver,EXECUTION_PAGE_BYTES,EXECUTION_PAGE_RECORDS} from './execution-pages';
import {ExecutionTelemetry} from './execution-telemetry';
const plan=()=>compileJob([{tool:'black',points:Array.from({length:1000},(_,i)=>({x:1+i*.02,y:1+Math.sin(i*.04)*.1}))}],{profile:machineProfile('xylodraw',0,16),pen:defaultPen,speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:true,drawingMode:'profiled',backend:'t3',firmware:'3.1.7'});
it('transfers exact native commands, IDs and carried accumulators in bounded pages',async()=>{
 const original=plan(),receiver=new PlanPageReceiver();receiver.begin(planHeader(original));for await(const page of metadataPages(original))await receiver.appendMetadata(page);let count=0;
 for await(const page of executionPages(original.records)){expect(page.bytes.byteLength).toBeLessThanOrEqual(EXECUTION_PAGE_BYTES);expect(page.count).toBeLessThanOrEqual(EXECUTION_PAGE_RECORDS);await receiver.append(structuredClone(page,{transfer:[page.bytes]}));expect(page.bytes.byteLength).toBe(0);count++;}
 expect(count).toBeGreaterThan(1);const received=receiver.finish();expect(JSON.parse(JSON.stringify(received))).toEqual(JSON.parse(JSON.stringify(original)));expect(()=>validatePlan(received)).not.toThrow();expect(received.records.filter(r=>r.kind==='motor').map(motorCommand)).toEqual(original.records.filter(r=>r.kind==='motor').map(motorCommand));
});
it('rejects corrupt, repeated, incomplete and oversized transfers before execution',async()=>{
 const original=plan(),pages=[];for await(const page of executionPages(original.records))pages.push(page);
 const receiver=new PlanPageReceiver();receiver.begin(planHeader(original));for await(const page of metadataPages(original))await receiver.appendMetadata(page);await expect(receiver.append(pages[1]!)).rejects.toThrow(/order/);
 const corrupt=structuredClone(pages[0]!);const corruptBytes=new Uint8Array(corrupt.bytes);corruptBytes[5]=corruptBytes[5]!^1;await expect(receiver.append(corrupt)).rejects.toThrow(/digest/);
 await receiver.append(pages[0]!);await expect(receiver.append(pages[0]!)).rejects.toThrow(/order/);expect(()=>receiver.finish()).toThrow(/Incomplete/);
 const oversized=structuredClone(original.records[0]!);oversized.label='x'.repeat(EXECUTION_PAGE_BYTES);await expect(executionPages([oversized]).next()).rejects.toThrow(/budget/);
});
it('bounds a stalled renderer backlog and preserves one exact continuous settlement range',()=>{
 const journal=new ExecutionTelemetry();
 for(let id=0;id<100000;id++){journal.push({kind:'exchange',phase:'acknowledged',command:'T3',timeMs:id});journal.push({kind:'record',phase:'queued',recordId:id,timeMs:id});}
 journal.push({kind:'record-range',phase:'settled',recordId:0,recordEndId:99999,timeMs:100001});journal.push({kind:'position',position:{x:0,y:0},timeMs:100001});
 expect(journal.length).toBeLessThanOrEqual(journal.limit);expect(journal.droppedDiagnostics).toBeGreaterThan(100000);
 expect(journal.take().filter(e=>e.kind==='record-range')).toEqual([{kind:'record-range',phase:'settled',recordId:0,recordEndId:99999,timeMs:100001}]);
});
it('merges adjacent physical settlement ranges without expanding their records',()=>{
 const journal=new ExecutionTelemetry();for(let id=0;id<100000;id++){journal.push({kind:'record-range',phase:'settled',recordId:id,recordEndId:id,timeMs:id});journal.push({kind:'position',position:{x:id,y:0},timeMs:id});}
 const events=journal.take();expect(events.filter(e=>e.kind==='record-range')).toEqual([{kind:'record-range',phase:'settled',recordId:0,recordEndId:99999,timeMs:99999}]);expect(events).toHaveLength(2);
});
it('retains the latest pen authority when a stalled renderer overflows diagnostics and noncontiguous ranges',()=>{
 const journal=new ExecutionTelemetry();journal.push({kind:'pen-confirmation',timeMs:0,penConfirmation:{penState:'down',penHeight:60}});
 for(let id=0;id<1500;id++)journal.push({kind:'record-range',phase:'settled',recordId:id*2,recordEndId:id*2,timeMs:id});
 journal.push({kind:'pen-confirmation',timeMs:1501,penConfirmation:{penState:'up',penHeight:30}});
 for(let id=0;id<1500;id++)journal.push({kind:'exchange',phase:'acknowledged',command:'SM',timeMs:1502+id});
 expect(journal.length).toBeLessThanOrEqual(journal.limit);expect(journal.take().filter(e=>e.kind==='pen-confirmation')).toEqual([{kind:'pen-confirmation',timeMs:1501,penConfirmation:{penState:'up',penHeight:30}}]);
 journal.push({kind:'pen-confirmation',timeMs:4000,penConfirmation:{penState:'down'}});journal.push({kind:'pen-confirmation',timeMs:4001,penConfirmation:{penState:'unknown'}});
 expect(journal.take()).toEqual([{kind:'pen-confirmation',timeMs:4001,penConfirmation:{penState:'unknown'}}]);
});

it('transfers checkpoint metadata larger than 64 KiB with exact program identity',async()=>{
 const original=compileJob(Array.from({length:500},(_,i)=>({tool:'black',sourceId:`ligne-é-${i}`,points:[{x:1,y:1+i*.1},{x:11,y:1+i*.1}]})),{profile:machineProfile('xylodraw',0,16),pen:defaultPen,speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:true,drawingMode:'profiled',backend:'sm',firmware:'3.1.7',workloadCheckpoints:{maxDrawingRecords:2000,maxDrawingMs:10000,maxDrawingMm:5}});
 const header=planHeader(original),receiver=new PlanPageReceiver();expect(header.metadataBytes).toBeGreaterThan(EXECUTION_PAGE_BYTES);expect(JSON.stringify(header).length).toBeLessThan(EXECUTION_PAGE_BYTES);receiver.begin(header);
 let count=0;for await(const page of metadataPages(original)){expect(page.bytes.byteLength).toBeLessThanOrEqual(EXECUTION_PAGE_BYTES);await receiver.appendMetadata(structuredClone(page,{transfer:[page.bytes]}));expect(page.bytes.byteLength).toBe(0);count++;}
 expect(count).toBeGreaterThan(1);for await(const page of executionPages(original.records))await receiver.append(page);
 const received=receiver.finish();expect(()=>validatePlan(received)).not.toThrow();expect(digest(received)).toBe(digest(original));expect(received.workloadCheckpoints).toEqual(original.workloadCheckpoints);expect(received.records).toEqual(JSON.parse(JSON.stringify(original.records)));expect(received.records.filter(r=>r.kind==='motor').map(motorCommand)).toEqual(original.records.filter(r=>r.kind==='motor').map(motorCommand));
});
it('rejects corrupt, out-of-order and incomplete metadata and drops aborted in-flight pages',async()=>{
 const original=plan(),receiver=new PlanPageReceiver(),pages=[];for await(const page of metadataPages(original))pages.push(page);
 receiver.begin(planHeader(original));const first=pages[0]!;
 await expect(receiver.appendMetadata({...first,index:1})).rejects.toThrow(/order/);
 const corrupt=structuredClone(first),bytes=new Uint8Array(corrupt.bytes);bytes[0]=bytes[0]!^1;await expect(receiver.appendMetadata(corrupt)).rejects.toThrow(/digest/);
 expect(()=>receiver.finish()).toThrow(/Incomplete/);
 const pending=receiver.appendMetadata(first);receiver.clear();receiver.begin(planHeader(original));await expect(pending).rejects.toThrow(/order/);
 expect(()=>receiver.finish()).toThrow(/Incomplete/);await receiver.appendMetadata(first);await expect(receiver.appendMetadata(first)).rejects.toThrow(/order/);
 const recordPage=(await executionPages(original.records).next()).value!;const recordPending=receiver.append(recordPage);receiver.clear();receiver.begin(planHeader(original));await expect(recordPending).rejects.toThrow(/order/);
 receiver.clear();receiver.begin(planHeader(original));await receiver.appendMetadata(first);for await(const page of executionPages(original.records))await receiver.append(page);expect(digest(receiver.finish())).toBe(digest(original));
});
