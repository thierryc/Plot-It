import {it,expect} from 'vitest';
import * as core from './index.js';
import {VirtualClock,VirtualEbb} from './virtual/index.js';
import {motionCorpus,corpusOptions} from '../../../scripts/permissive-motion-corpus.mjs';
import type {MotorRecord,PlotOptions,SessionEvent} from './types.js';
it('settles the unchanged 18k-point native wave in exact ranges while preserving standalone events',async()=>{
 const fixture=motionCorpus().find((c:{id:string})=>c.id==='dense-18000')!,options={...corpusOptions(core,fixture,'t3'),profile:core.machineProfile('xylodraw',0,16),firmware:'3.1.7'} as PlotOptions,plan=core.compileJob(fixture.paths,options);
 const commands:string[]=[],clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7',onCommand:command=>{if(/^(T3|TD|SM),/.test(command))commands.push(command);}}),session=new core.PlotterSession(board.createTransport(),clock,options.profile);
 const settled:number[]=[],ranges:SessionEvent[]=[],diagnostics:SessionEvent[]=[];session.subscribe(e=>{if(e.kind==='record'&&e.phase==='settled')settled.push(e.recordId!);});session.subscribe(e=>{if(e.kind==='record-range')ranges.push(e);if(e.kind==='queue-diagnostic')diagnostics.push(e);},{settlementRanges:true});
 await session.connect();expect(await session.run(plan)).toBe('finished');
 expect(commands).toEqual(plan.records.filter((r):r is MotorRecord=>r.kind==='motor').map(core.motorCommand));expect(settled).toEqual(plan.records.map(r=>r.id));
 expect(ranges.flatMap(e=>Array.from({length:e.recordEndId!-e.recordId!+1},(_,i)=>e.recordId!+i))).toEqual(settled);expect(ranges.length).toBeLessThan(30);expect(ranges.some(e=>e.recordEndId!-e.recordId!>30000)).toBe(true);
 expect(board.penUp).toBe(true);expect(board.position).toEqual({m1:0,m2:0});expect(board.commands.some(c=>c.startsWith('S2,'))).toBe(false);
 expect(diagnostics.some(e=>e.stackHighWater===0xE71)).toBe(true);expect(diagnostics.filter(e=>e.queueOccupancy!==undefined).every(e=>e.queueOccupancy!<=16)).toBe(true);
 const motors=plan.records.filter((r):r is MotorRecord=>r.kind==='motor');expect(diagnostics.at(-1)?.queueEntriesAccepted).toBe(motors.reduce((n,r)=>n+(r.native?.command==='TD'?2:1),0));
},30000);
it('parses stack high-water as hexadecimal without weakening decimal FIFO framing',async()=>{
 const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7'}),protocol=new core.EbbProtocol(board.createTransport(),clock);await protocol.request('CU,10,1');expect(await protocol.request('QU,4')).toBe('QU,E71');expect(await protocol.request('QU,2')).toBe('QU,32');
});

function smallPlan(){return core.compileJob([{tool:'black',points:[{x:1,y:1},{x:3,y:1}]}],{profile:core.machineProfile('xylodraw',0,16),pen:{...core.defaultPen,up:30,down:60},speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:true,drawingMode:'profiled',backend:'t3',firmware:'3.1.7'});}
it('a genuinely absent pre-lift QG times out without a false final-Up settlement or return',async()=>{
 const plan=smallPlan(),finalUp=plan.records.find(r=>r.id>0&&r.kind==='pen'&&!r.penDown)!,clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7'}),bytes=board.createTransport();let failNext=false,missing=false;
 const transport={...bytes,write:async(data:Uint8Array)=>{if(failNext&&new TextDecoder().decode(data)==='QG\r'){missing=true;failNext=false;return;}await bytes.write(data);},read:async()=>{if(missing){clock.advance(5001);return new Promise<Uint8Array|null>(()=>{});}return bytes.read();}};
 const session=new core.PlotterSession(transport,clock,plan.options.profile),events:SessionEvent[]=[];session.subscribe(event=>{events.push(event);if(event.kind==='record'&&event.recordId===finalUp.id&&event.phase==='started')failNext=true;},{settlementRanges:true});
 await session.connect();await expect(session.run(plan)).rejects.toThrow(/timed out/);
 expect(session.state).toBe('failed');expect(session.origin.recoveryRequired).toBe(true);expect(board.penUp).toBe(false);
 expect(events.some(e=>e.kind==='record-range'&&e.recordId!<=finalUp.id&&e.recordEndId!>=finalUp.id)).toBe(false);
 expect(events.some(e=>e.kind==='record'&&e.recordId===finalUp.id&&e.phase==='queued')).toBe(false);
 expect(events.some(e=>e.kind==='record'&&e.recordId!>finalUp.id&&e.phase==='started')).toBe(false);
});
it('matching idle is insufficient to settle a stroke when controller position differs',async()=>{
 const plan=smallPlan(),lastDrawing=plan.records.filter((r):r is MotorRecord=>r.kind==='motor'&&r.penDown).at(-1)!,clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7'}),bytes=board.createTransport();let corrupt=false,query='';
 const transport={...bytes,write:async(data:Uint8Array)=>{query=new TextDecoder().decode(data);await bytes.write(data);},read:async()=>{const data=await bytes.read();if(corrupt&&query==='QS\r'&&data){corrupt=false;return new TextEncoder().encode('QS,12345,67890\n');}return data;}};
 const session=new core.PlotterSession(transport,clock,plan.options.profile),events:SessionEvent[]=[];session.subscribe(event=>{events.push(event);if(event.kind==='record'&&event.recordId===lastDrawing.id&&event.phase==='queued')corrupt=true;},{settlementRanges:true});
 await session.connect();await expect(session.run(plan)).rejects.toThrow(/differs from the compiled endpoint/);
 expect(session.origin.recoveryRequired).toBe(true);expect(events.some(e=>e.kind==='record-range'&&e.recordId!<=lastDrawing.id&&e.recordEndId!>=lastDrawing.id)).toBe(false);
});
it.each(['stop','cancel'] as const)('does not start hardware when %s arrives during async program transfer',async action=>{
 const plan=smallPlan(),clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7'}),session=new core.PlotterSession(board.createTransport(),clock,plan.options.profile),sequence=new core.JobSequence(session,clock);
 await session.connect();const before=board.commands.length;
 sequence.onProgram=async()=>{await Promise.resolve();sequence[action]();};
 expect(await sequence.run([{id:'drawing',plan}])).toBe(action==='stop'?'stopped':'cancelled');expect(board.commands.length).toBe(before);
});
