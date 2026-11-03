import {describe,it,expect} from 'vitest';
import * as core from './index.js';
import {VirtualClock,VirtualEbb} from './virtual/index.js';
import {motionCorpus,corpusOptions} from '../../../scripts/permissive-motion-corpus.mjs';
import {inspectExecutable,inspectCheckpoint,inspectTrace} from '../../../scripts/permissive-motion-oracle.mjs';
import type {ExecutablePlan,PlotOptions,Path} from './types.js';
const cases=motionCorpus({dense:false}) as {id:string;paths:Path[]}[];
const options=(c=cases[0]!,backend:'sm'|'t3'='sm')=>corpusOptions(core,c,backend) as PlotOptions;
describe('reference-free migration behavior',()=>{
 for(const c of cases)for(const backend of ['sm','t3'] as const)it(`preserves source geometry and executable constraints: ${c.id}/${backend}`,()=>{
  const plan=core.compileJob(c.paths,options(c,backend));expect(()=>inspectExecutable(plan,c.paths,{minimumPenDwellMs:200})).not.toThrow();
 }); // Known legacy T3 constant corner coverage failure; retain as candidate gate.
 it('keeps tool order, final raised state and serialized artwork/settings round trips',()=>{
  const c=cases.find(c=>c.id==='multi-pen')!,job=core.preparePaths(c.paths,options(c)),restored=core.importPrepared(core.exportPrepared(job));
  expect(restored.paths).toEqual(c.paths);expect(restored.options).toEqual(job.options);
  expect(inspectExecutable(restored.program,c.paths).toolOrder).toEqual(['black','red','black']);
 });
 it('is sensitive to a deleted drawing, early pen wait and wrong endpoint without calling validatePlan',()=>{
  const c=cases[0]!,plan=core.compileJob(c.paths,options(c));
  const missing=structuredClone(plan);missing.records=missing.records.filter(r=>r.kind!=='motor'||!r.penDown);expect(()=>inspectExecutable(missing,c.paths)).toThrow();
  const early=structuredClone(plan),pen=early.records.find(r=>r.kind==='pen'&&r.penDown)!;pen.durationMs=1;retime(early);expect(()=>inspectExecutable(early,c.paths,{minimumPenDwellMs:200})).toThrow(/pen wait/);
  const wrong=structuredClone(plan),motor=wrong.records.find(r=>r.kind==='motor'&&r.penDown)!;motor.to.x+=1;expect(()=>inspectExecutable(wrong,c.paths)).toThrow(/endpoint/);
 });
 it('independently checks settled resume evidence and detects position/distance corruption',()=>{
  const c=cases.find(c=>c.id==='long-line')!,plan=core.compileJob(c.paths,options(c)),record=plan.records.findIndex(r=>r.kind==='motor'&&r.penDown),checkpoint=core.checkpointAt(plan,record);
  expect(()=>inspectCheckpoint(checkpoint,plan)).not.toThrow();expect(()=>inspectCheckpoint({...checkpoint,position:{m1:checkpoint.position.m1+1,m2:checkpoint.position.m2}},plan)).toThrow(/resume corruption/);
  expect(()=>inspectCheckpoint({...checkpoint,drawingMm:checkpoint.drawingMm+1},plan)).toThrow(/resume corruption/);
  const resumed=core.resumeCheckpoint(plan,checkpoint),first=resumed.records.find(r=>r.kind==='motor'&&r.penDown)!;
  expect(Math.hypot(first.from.x-plan.records[record]!.to.x,first.from.y-plan.records[record]!.to.y)).toBeLessThan(.03);
  expect(resumed.drawingMm+checkpoint.drawingMm).toBeCloseTo(plan.drawingMm,1);
 });
 it('executes queued pen delays before motion and detects an early-start trace mutation',async()=>{
  const c=cases.find(c=>c.id==='tiny-single-step')!,o=options(c),clock=new VirtualClock(),board=new VirtualEbb(clock),session=new core.PlotterSession(board.createTransport(),clock,o.profile);await session.connect();await session.run(core.compileJob(c.paths,o));
  expect(()=>inspectTrace(board.trace)).not.toThrow();expect(board.position).toEqual({m1:0,m2:0});expect(board.penUp).toBe(true);
  expect(()=>inspectTrace([{phase:'started',timeMs:100,command:'SP,0,200,1'},{phase:'started',timeMs:101,command:'SM,25,1,1'}])).toThrow(/pen wait/);
  await session.disconnect();
 });
});
it('detects normalized record deletion and shortcut corruption from source geometry alone',()=>{
 const c=cases.find(c=>c.id==='reversal')!,plan=core.compileJob(c.paths,options(c)),drawing=plan.records.filter((r):r is core.MotorRecord=>r.kind==='motor'&&r.penDown);
 // Replace the entire reversal with a connected start/end chord; all native
 // positions, IDs, timestamps and totals are rebuilt to eliminate easy failures.
 const shortcut=structuredClone(plan),first=drawing[0]!,last=drawing.at(-1)!,removed=new Set(drawing.map(r=>r.id));
 const chord={...structuredClone(first),to:{...last.to},toSteps:{...last.toSteps},durationMs:drawing.reduce((n,r)=>n+r.durationMs,0)};
 shortcut.records=shortcut.records.flatMap(r=>r.id===first.id?[chord]:removed.has(r.id)?[]:[r]);normalize(shortcut);
 expect(()=>inspectExecutable(shortcut,c.paths,{checkCoverage:false})).not.toThrow();expect(()=>inspectExecutable(shortcut,c.paths)).toThrow(/ordered interior/);
 const deleted=structuredClone(plan),cutoff=drawing.findIndex(r=>r.to.x<r.from.x&&r.to.x<25),victims=new Set(drawing.slice(0,cutoff+1).map(r=>r.id));
 const next=deleted.records.find(r=>r.id===drawing[cutoff+1]!.id) as core.MotorRecord;next.from={...first.from};next.fromSteps={...first.fromSteps};next.durationMs+=drawing.slice(0,cutoff+1).reduce((n,r)=>n+r.durationMs,0);deleted.records=deleted.records.filter(r=>!victims.has(r.id));normalize(deleted);
 expect(()=>inspectExecutable(deleted,c.paths,{checkCoverage:false})).not.toThrow();expect(()=>inspectExecutable(deleted,c.paths)).toThrow(/ordered interior/);
});
function normalize(plan:ExecutablePlan){retime(plan);plan.drawingMm=0;plan.travelMm=0;for(const r of plan.records)if(r.kind==='motor'){const d=Math.hypot(r.to.x-r.from.x,r.to.y-r.from.y);if(r.penDown)plan.drawingMm+=d;else plan.travelMm+=d;}}
function retime(plan:ExecutablePlan){let ms=0;for(const [id,r]of plan.records.entries()){r.id=id;r.startMs=ms;ms+=r.durationMs;}plan.durationMs=ms;}
// Enable as the candidate lands. These are executable specification tests, not
// required legacy output snapshots: the legacy tiny/constant policies fail them.
describe('candidate nominal planner gates',()=>{
 it.each([.001,.01,.1,1])('starts and ends a %.3f mm stroke at rest with analytical triangular timing',length=>{
  const a=200,phases=core.planStroke([{x:0,y:0},{x:length,y:0}],35,a,0);
  expect(phases[0]!.initialSpeed).toBeCloseTo(0,10);expect(phases.at(-1)!.initialSpeed+phases.at(-1)!.acceleration*phases.at(-1)!.duration).toBeCloseTo(0,10);
  expect(phases.reduce((sum,p)=>sum+p.duration,0)).toBeCloseTo(2*Math.sqrt(length/a),9);assertNominal(phases,35,a);
 });
 it('treats constant mode as a bounded target speed with ramps',()=>{const p=core.planStroke([{x:0,y:0},{x:1,y:0}],35,200,0,true);expect(p[0]!.initialSpeed).toBe(0);assertNominal(p,35,200);});
 it('rejects an unreachable requested boundary speed',()=>{expect(()=>core.planStroke([{x:0,y:0},{x:.01,y:0}],35,200,0,false,35,0)).toThrow();});
 it('keeps deduplicated source directions aligned with the surviving segments',()=>{
  const plain=[{x:0,y:0},{x:5,y:0},{x:5,y:5}],repeated=[{x:0,y:0},{x:0,y:0},{x:5,y:0},{x:5,y:5}];
  const reference=core.planStroke(plain,35,200,.127,false,0,0,[{x:5,y:0},{x:0,y:5}]);
  const dedup=core.planStroke(repeated,35,200,.127,false,0,0,[{x:0,y:0},{x:5,y:0},{x:0,y:5}]);
  expect(dedup).toEqual(reference);assertNominal(dedup,35,200);
 });
 it('handles finite sub-step direction metadata without changing vertex order',()=>{
  const p=core.planStroke([{x:0,y:0},{x:.000001,y:0},{x:5,y:0},{x:5,y:5}],35,200,.127,false,0,0,[{x:.000001,y:0},{x:4.999999,y:0},{x:0,y:5}]);assertNominal(p,35,200);expect(p.at(-1)!.to).toEqual({x:5,y:5});
 });
 it.each([[{x:NaN,y:0},{x:0,y:5}],[{x:Infinity,y:0},{x:0,y:5}]])('rejects malformed source direction vectors',directions=>{expect(()=>core.planStroke([{x:0,y:0},{x:5,y:0},{x:5,y:5}],35,200,.127,false,0,0,directions)).toThrow();});
 it('stops at every vertex when cornering is disabled',()=>{const p=core.planStroke([{x:0,y:0},{x:10,y:0},{x:20,y:0}],35,200,0),at=p.find(q=>Math.abs(q.to.x-10)<1e-8)!;expect(at.initialSpeed+at.acceleration*at.duration).toBeCloseTo(0,9);});
});
function assertNominal(phases:core.Phase[],limit:number,a:number){
 let previous=0,position=phases[0]?.from;for(const p of phases){expect(p.from).toEqual(position);position=p.to;expect(p.duration).toBeGreaterThan(0);expect(p.initialSpeed).toBeCloseTo(previous,8);const end=p.initialSpeed+p.acceleration*p.duration;expect(Math.min(p.initialSpeed,end)).toBeGreaterThanOrEqual(-1e-9);expect(Math.max(p.initialSpeed,end)).toBeLessThanOrEqual(limit+1e-9);expect(Math.abs(p.acceleration)).toBeLessThanOrEqual(a+1e-9);expect(p.initialSpeed*p.duration+.5*p.acceleration*p.duration**2).toBeCloseTo(Math.hypot(p.to.x-p.from.x,p.to.y-p.from.y),8);previous=end;}
 expect(previous).toBeCloseTo(0,8);
}
