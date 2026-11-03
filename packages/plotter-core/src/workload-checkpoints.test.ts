import {describe,it,expect} from 'vitest';
import {compileJob,validatePlan,toNative,machineProfile,defaultPen,preparePaths,exportPrepared,importPrepared,DEFAULT_WORKLOAD_CHECKPOINTS,penRecordReload,checkpointAt,CheckpointIndex,resumeAtDistance,prepareLayerJob,type PlotOptions,type MotorRecord} from './index.js';
const options:PlotOptions={profile:machineProfile('xylodraw',0,16),pen:{...defaultPen},speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:true,drawingMode:'profiled',backend:'t3',firmware:'3.1.7'};
const path={tool:'black',sourceId:'original-wave',points:[{x:10,y:10},{x:110,y:10}]};
const draw=(plan:ReturnType<typeof compileJob>)=>plan.records.filter((r):r is MotorRecord=>r.kind==='motor'&&r.penDown);
function checkChunks(plan:ReturnType<typeof compileJob>){
 const limits=plan.options.workloadCheckpoints!;let records:MotorRecord[]=[];
 for(const r of plan.records){if(r.kind==='motor'&&r.penDown)records.push(r);if(r.kind==='pen'&&!r.penDown&&records.length){expect(records.length).toBeLessThanOrEqual(limits.maxDrawingRecords);expect(records.reduce((sum,r)=>sum+r.durationMs,0)).toBeLessThanOrEqual(limits.maxDrawingMs+1e-7);expect(records.reduce((sum,r)=>sum+Math.hypot(r.to.x-r.from.x,r.to.y-r.from.y),0)).toBeLessThanOrEqual(limits.maxDrawingMm+1e-7);expect(records[0]!.restBefore).toBe(true);records=[];}}
 expect(()=>validatePlan(plan)).not.toThrow();
}
describe('opt-in physical workload checkpoints',()=>{
 it.each(['standard','dynamic'] as const)('preserves %s continuous commands when the option is absent',motionStrategy=>{
  const base=compileJob([path],{...options,motionStrategy}),off=compileJob([path],{...options,motionStrategy,workloadCheckpoints:undefined});expect(off).toEqual(base);expect(base.workloadCheckpoints).toBeUndefined();expect(base.records.some(r=>r.kind==='pen'&&r.workloadCheckpoint)).toBe(false);
 });
 it.each(['standard','dynamic'] as const)('splits a single segment and replans %s at the same native point',motionStrategy=>{
  const o={...options,motionStrategy,workloadCheckpoints:{...DEFAULT_WORKLOAD_CHECKPOINTS,maxDrawingMs:1000}},plan=compileJob([path],o),again=compileJob([path],o);expect(plan).toEqual(again);checkChunks(plan);
  expect(plan.workloadCheckpoints!.cuts.length).toBeGreaterThan(0);expect(plan.workloadCheckpoints!.addedDurationMs).toBeGreaterThan(0);
  const motors=draw(plan);expect(motors[0]!.fromSteps).toEqual(toNative(path.points[0]!,o.profile));expect(motors.at(-1)!.toSteps).toEqual(toNative(path.points.at(-1)!,o.profile));
  const chunks=[...new Map(motors.map(r=>[JSON.stringify(r.workloadChunk),r.workloadChunk!])).values()];expect(chunks[0]!.sourceFromMm).toBe(0);expect(chunks.at(-1)!.sourceToMm).toBe(100);
  for(let i=1;i<chunks.length;i++)expect(chunks[i]!.sourceFromMm).toBe(chunks[i-1]!.sourceToMm);
  for(const [index,r]of plan.records.entries())if(r.kind==='pen'&&r.workloadCheckpoint){expect(r.penDown).toBe(false);expect(r.reload).toBe(false);expect(r.from).toEqual(r.to);const next=plan.records[index+1]!;expect(next.kind).toBe('pen');expect(next.penDown).toBe(true);expect(next.to).toEqual(r.to);expect(r.workloadCheckpoint.sourceId).toBe(path.sourceId);}
 });
 it('enforces compiled record budgets on a dense curve, with deterministic source vertices',()=>{
  const points=Array.from({length:301},(_,i)=>({x:10+i*.1,y:20+Math.sin(i*.04)})),o={...options,workloadCheckpoints:{maxDrawingRecords:100,maxDrawingMs:10000,maxDrawingMm:250}},plan=compileJob([{...path,points}],o);checkChunks(plan);expect(plan.workloadCheckpoints!.cuts.length).toBeGreaterThan(3);expect(draw(plan).at(-1)!.toSteps).toEqual(toNative(points.at(-1)!,o.profile));
 });
 it.each(['2.8.1','3.1.7'])('supports %s SM and preserves mechanical reload waits separately',firmware=>{
  const o={...options,backend:'sm' as const,firmware,maxPenDownMm:40,pen:{...options.pen,reloadWaitMs:700},workloadCheckpoints:{maxDrawingRecords:2000,maxDrawingMs:10000,maxDrawingMm:15}},plan=compileJob([path],o);checkChunks(plan);
  expect(plan.records.some(r=>r.kind==='pen'&&r.reload)).toBe(true);for(const [i,r]of plan.records.entries())if(r.kind==='pen'&&r.workloadCheckpoint)expect(penRecordReload(plan,i)).toBe(false);
 });
 it('retains source/chunk resume evidence and unique identities across layers',()=>{
  const o={...options,workloadCheckpoints:{...DEFAULT_WORKLOAD_CHECKPOINTS,maxDrawingMm:20}},job=prepareLayerJob([{id:'first',name:'First',paths:[{...path,sourceId:undefined}]},{id:'second',name:'Second',paths:[{...path,sourceId:undefined}]}],o),plan=job.program;
  expect(importPrepared(exportPrepared(job))).toEqual(job);expect(new Set(plan.workloadCheckpoints!.cuts.map(c=>c.identity.sourceId))).toEqual(new Set(['first:path:0','second:path:0']));
  const record=plan.records.find(r=>r.kind==='pen'&&r.workloadCheckpoint)!;expect(new CheckpointIndex(plan).at(record.id)).toEqual(checkpointAt(plan,record.id));expect(checkpointAt(plan,record.id).workloadChunk?.sourceId).toBe('first:path:0');
  const resumed=resumeAtDistance(plan,20);checkChunks(resumed);expect(draw(resumed)[0]!.sourceId).toBe('first:path:0');
 });
 it('rejects a layer that disables the globally selected checkpoint policy',()=>{expect(()=>prepareLayerJob([{id:'layer',name:'Layer',paths:[path],options}],{...options,workloadCheckpoints:DEFAULT_WORKLOAD_CHECKPOINTS})).toThrow(/Layer workload checkpoint policy/);});
 it('fails explicitly when a rest-to-rest native movement cannot fit the budget',()=>{expect(()=>compileJob([path],{...options,workloadCheckpoints:{maxDrawingRecords:1,maxDrawingMs:.04,maxDrawingMm:.000001}})).toThrow(/Workload budgets/);});
 it('rejects tampered over-budget prepared programs and round-trips the policy and cuts',()=>{
  const job=preparePaths([path],{...options,workloadCheckpoints:{...DEFAULT_WORKLOAD_CHECKPOINTS,maxDrawingMm:20}});expect(importPrepared(exportPrepared(job))).toEqual(job);const bad=structuredClone(job.program);bad.options.workloadCheckpoints!.maxDrawingRecords=1;expect(()=>validatePlan(bad)).toThrow(/workload checkpoint budget/);
 });
});
