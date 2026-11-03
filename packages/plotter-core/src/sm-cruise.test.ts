import {describe,it,expect} from 'vitest';
import {compileJob,compilePhases,motorCommand,withRaisedReturn,validatePlan} from './compiler.js';
import {compileLayerProgram} from './layer-program.js';
import {compileLayers} from './sequence.js';
import {smCompilation} from './sm-compilation.js';
import {smBounds,smExactCorridor} from './sm-bounds.js';
import {machineProfile,toNative} from './profiles.js';
import {planStroke,type Phase} from './planner.js';
import {defaultPen} from './pen.js';
import type {ExecutionRecord,MachineProfile,MotorRecord,NativePoint,PlotOptions,Point} from './types.js';

const B=2147483648,HZ=25000;
const profile=machineProfile('xylodraw',0,8,'standard');
const cruise:Phase={from:{x:0,y:0},to:{x:35,y:0},duration:1,initialSpeed:35,acceleration:0,restBefore:false};
const compile=(phases:Phase[],firmware?:string,p=profile,speed=35)=>compilePhases(phases,p,'black',true,toNative(phases[0]!.from,p),0,undefined,speed,firmware);
const settings:PlotOptions={profile,pen:{...defaultPen},speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:true,drawingMode:'profiled',backend:'sm',firmware:'3.1.7'};
const longPath={tool:'black',sourceId:'line',points:[{x:10,y:10},{x:210,y:10}]};

describe('P3a bounded straight SM cruise',()=>{
 it('uses fewer commands inside a positive straight cruise on the validated firmware',()=>{
  const previous=compile([cruise]),candidate=compile([cruise],'3.1.7');
  expect(candidate.length).toBeLessThan(previous.length/2);
  expect(duration(candidate)).toBeLessThanOrEqual(duration(previous));
  expect(candidate.at(-1)!.toSteps).toEqual(previous.at(-1)!.toSteps);
  for(const carry of [{m1:0,m2:0},{m1:B-1,m2:0},{m1:1,m2:B-1},{m1:B/2,m2:B/3|0}]){
   const result=replay(candidate,profile,carry,[cruise.from,cruise.to]);
   expect(result.longestTicks).toBeLessThanOrEqual(2500);
   expect(result.peakRateSpeed).toBeLessThanOrEqual(35+1e-7);
  }
 });

 it.each([undefined,'2.8.1','3.0.2','3.1.6','3.1.8'])('retains exact legacy commands for unvalidated firmware %s',firmware=>{
  expect(compile([cruise],firmware)).toEqual(compile([cruise]));
 });

 it('preserves ramp commands, real stationary waits, and sparse low-rate phases',()=>{
  const ramps=planStroke([{x:0,y:0},{x:50,y:0}],35,200,.127).filter(p=>p.acceleration!==0);
  for(const phase of ramps)expect(compile([phase],'3.1.7')).toEqual(compile([phase]));
  const waits:Phase[]=[{...cruise,to:cruise.from,duration:.123,initialSpeed:0},
   {...cruise,to:{x:.1,y:0},duration:1,initialSpeed:.1}];
  for(const phase of waits)expect(compile([phase],'3.1.7',profile,phase.initialSpeed||35)).toEqual(compile([phase],undefined,profile,phase.initialSpeed||35));
 });

 it('keeps every phase anchor and the first rest marker',()=>{
  const phases=planStroke([{x:0,y:0},{x:50,y:0},{x:50,y:30},{x:20,y:30}],35,200,0);
  const records=compile(phases,'3.1.7');
  for(const phase of phases)expect(records.some(r=>same(r.toSteps,toNative(phase.to,profile)))).toBe(true);
  expect(records.filter(r=>r.restBefore).map(r=>r.fromSteps)).toEqual(compile(phases).filter(r=>r.restBefore).map(r=>r.fromSteps));
  replay(records,profile,{m1:B-1,m2:13},[{x:0,y:0},{x:50,y:0},{x:50,y:30},{x:20,y:30}]);
 });

 it('reduces a complete long-line job after certifying every retained ramp and travel phase',()=>{
  const before=compileJob([longPath],{...settings,firmware:'3.1.6'}),after=compileJob([longPath],settings);
  expect(after.records.length).toBeLessThan(before.records.length*.7);
  expect(after.durationMs).toBeLessThan(before.durationMs);
  expect(smCompilation(after)?.certified).toBe(true);
  for(const carry of [{m1:0,m2:0},{m1:B-1,m2:0},{m1:1,m2:B-1},{m1:B/2,m2:B/3|0}]){
   const oldTicks=replay(before.records,profile,carry,undefined,[longPath]);
   const newTicks=replay(after.records,profile,carry,undefined,[longPath]);
   expect(newTicks.totalTicks).toBeLessThanOrEqual(oldTicks.totalTicks);
   expect(newTicks.stationaryTicks).toBe(oldTicks.stationaryTicks);
  }
 });

 it('falls back to the exact complete original program when the shared proof budget is exhausted',()=>{
  const budget={remaining:0},fallback=compileJob([longPath],settings,'drawing',0,budget),before=compileJob([longPath],{...settings,firmware:'3.1.6'});
  expect(fallback.records).toEqual(before.records);expect(fallback.durationMs).toBe(before.durationMs);
  expect(smCompilation(fallback)?.certified).toBe(false);expect(budget.remaining).toBeLessThan(0);
 });

 it('preserves the complete prefix and legacy return for fresh, cloned, and layered plans',()=>{
  const noReturn={...settings,returnToOrigin:false};
  const plans=[compileJob([longPath],noReturn),compileLayerProgram([{id:'a',name:'line',paths:[longPath]}],noReturn)];
  for(const plan of plans){
   const fresh=withRaisedReturn(plan),roundtrip=withRaisedReturn(JSON.parse(JSON.stringify(plan)));
   expect(fresh).toEqual(roundtrip);expect(fresh.records.slice(0,plan.records.length)).toEqual(plan.records);
   const last=plan.records.filter((r):r is MotorRecord=>r.kind==='motor').at(-1)!;
   const legacy=compilePhases(planStroke([last.to,{x:0,y:0}],settings.travelSpeed,settings.travelAcceleration,0),profile,last.tool,false,last.toSteps,plan.durationMs,undefined,settings.travelSpeed);
   expect(fresh.records.slice(plan.records.length).map(r=>motorCommand(r as MotorRecord))).toEqual(legacy.map(motorCommand));
   replay(fresh.records,profile,{m1:B-1,m2:37},undefined,[longPath]);
  }
 });

 it('keeps layer preparation deterministic and falls back across the whole composition',()=>{
  const tiny={tool:'black',sourceId:'tiny',points:Array.from({length:20},(_,i)=>({x:10+i*.01,y:50+8*Math.sin(i*.04)}))};
  expect(smCompilation(compileJob([tiny],settings))?.certified).toBe(false);
  const layers=[{id:'a',name:'line',paths:[longPath]},{id:'b',name:'tiny',paths:[tiny],pause:true,delayMs:200}];
  const a=compileLayerProgram(layers,settings),b=compileLayerProgram(JSON.parse(JSON.stringify(layers)),{...settings});
  expect(a).toEqual(b);
  const baseline=compileLayerProgram(layers,{...settings,firmware:'3.1.6'});
  expect(a.records.map(r=>r.kind==='motor'?motorCommand(r):[r.kind,r.durationMs,r.penDown])).toEqual(baseline.records.map(r=>r.kind==='motor'?motorCommand(r):[r.kind,r.durationMs,r.penDown]));
  const segments=compileLayers(layers,settings),oldSegments=compileLayers(layers,{...settings,firmware:'3.1.6'});
  expect(segments.map(s=>s.plan?.records.map(r=>r.kind==='motor'?motorCommand(r):[r.kind,r.durationMs,r.penDown]))).toEqual(oldSegments.map(s=>s.plan?.records.map(r=>r.kind==='motor'?motorCommand(r):[r.kind,r.durationMs,r.penDown])));
  replay(a.records,profile,{m1:B-1,m2:37},undefined,[longPath,tiny]);
 });

 it.each([undefined,'2.8.1','3.1.6'])('rejects a layer that enables a different firmware target inside %s',firmware=>{
  const layers=[{id:'a',name:'line',paths:[longPath],options:settings}];
  expect(()=>compileLayers(layers,{...settings,firmware})).toThrow(/firmware/);
  expect(()=>compileLayerProgram(layers,{...settings,firmware})).toThrow(/firmware/);
  const jsonLayers=[{id:'a',name:'line',paths:[longPath],overrides:JSON.parse('{"firmware":"3.1.7"}')}];
  expect(()=>compileLayers(jsonLayers,{...settings,firmware})).toThrow(/firmware/);
 });

 it('inherits an omitted layer firmware and rejects an explicit older target or executable override',()=>{
  const inherited=compileLayers([{id:'a',name:'line',paths:[longPath],options:{...settings,firmware:undefined}}],settings)[0]!.plan!;
  expect(inherited.options.firmware).toBe('3.1.7');
  expect(inherited.records).toEqual(compileJob([longPath],settings).records);
  expect(()=>compileLayerProgram([{id:'a',name:'line',paths:[longPath],options:{...settings,firmware:'3.1.6'}}],settings)).toThrow(/firmware/);
  const raw=compileLayerProgram([{id:'a',name:'line',paths:[longPath]}],{...settings,firmware:'3.1.6'});
  raw.records.find(r=>r.settings)!.settings!.firmware='3.1.7';
  expect(()=>validatePlan(raw)).toThrow(/firmware/);
 });

 it('bounds float32 completion and refines signed, stationary-axis rectangles with a finite work budget',()=>{
  const r:MotorRecord={id:0,kind:'motor',startMs:0,durationMs:100,tool:'black',penDown:true,from:{x:0,y:0},to:{x:.01,y:.01},fromSteps:{m1:0,m2:0},toSteps:{m1:1,m2:0},restBefore:false};
  const phase={...cruise,to:r.to,duration:.1,initialSpeed:Math.hypot(r.to.x,r.to.y)/.1};
  const bound=smBounds(r,phase,profile);
  expect(bound.ticks).toBe(2501);
  expect(replay([r],profile,{m1:0,m2:0}).totalTicks).toBe(bound.ticks);
  expect(smExactCorridor(r,phase,profile,Math.SQRT2/profile.stepsPerMm,{remaining:100})).toBe(true);
  expect(smExactCorridor(r,{...phase,to:{x:0,y:1}},profile,.001,{remaining:100})).toBe(false);
  expect(smExactCorridor(r,phase,profile,Math.SQRT2/profile.stepsPerMm,{remaining:0})).toBe(false);
 });

 const variants=(['xylodraw','axidraw','axidraw-a3','nextdraw-8511','nextdraw-1117','nextdraw-2234'] as const).flatMap(id=>(id.startsWith('nextdraw')?['standard','brushless'] as const:['standard'] as const).map(servo=>({id,servo})));
 const configurations=variants.flatMap(v=>([8,16] as const).flatMap(resolution=>([0,90,180,270] as const).map(rotation=>({...v,resolution,rotation}))));
 it.each(configurations)('replays the complete carried stream, including unchanged ramps and repeats: $id/$servo/$resolution/$rotation',config=>{
  const p=machineProfile(config.id,config.rotation,config.resolution,config.servo);
  const paths=[{tool:'black',sourceId:'a',points:[{x:5,y:5},{x:80,y:5},{x:80,y:25}]},
   {tool:'blue',sourceId:'b',points:[{x:5,y:30},{x:70,y:31},{x:8,y:32}]}];
  const options:PlotOptions={profile:p,pen:{...defaultPen},speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:40,returnToOrigin:true,drawingMode:'profiled',backend:'sm',firmware:'3.1.7'};
  const plan=compileJob(paths,options),old=compileJob(paths,{...options,firmware:'3.1.6'});
  expect(plan.durationMs).toBeLessThanOrEqual(old.durationMs);
  expect(plan.records.length).toBeLessThanOrEqual(old.records.length);
  expect(plan.records.filter(r=>r.kind==='pen').map(r=>[r.penDown,r.durationMs,r.reload])).toEqual(old.records.filter(r=>r.kind==='pen').map(r=>[r.penDown,r.durationMs,r.reload]));
  let carry={m1:1,m2:B-1},oldCarry={...carry};
  for(let copy=0;copy<2;copy++){
   const actual=replay(plan.records,p,carry,undefined,paths),previous=replay(old.records,p,oldCarry,undefined,paths);
   expect(actual.totalTicks).toBeLessThanOrEqual(previous.totalTicks);expect(actual.stationaryTicks).toBe(previous.stationaryTicks);
   carry=actual.carry;oldCarry=previous.carry;
  }
 });
});

function duration(records:readonly MotorRecord[]){return records.reduce((n,r)=>n+r.durationMs,0);}
function same(a:NativePoint,b:NativePoint){return a.m1===b.m1&&a.m2===b.m2;}
function segmentDistance(p:Point,a:Point,b:Point){const x=b.x-a.x,y=b.y-a.y,d=x*x+y*y,t=d?Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/d)):0;return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);}
function point(native:NativePoint,p:MachineProfile){const x=(native.m1+native.m2)/(2*p.stepsPerMm),y=(native.m1-native.m2)/(2*p.stepsPerMm);return p.rotation===90?{x:y,y:-x}:p.rotation===180?{x:-x,y:-y}:p.rotation===270?{x:-y,y:x}:{x,y};}

/** Literal 3.1.7 float32 parser and ISR, independent of compiler bound helpers.
 * Each completed axis stops accumulating. Pen/delay/source/rest do not reset it. */
function replay(records:readonly ExecutionRecord[],p:MachineProfile,inputCarry:NativePoint,polyline?:readonly Point[],paths?:readonly {sourceId:string;points:Point[]}[]){
 let carry={...inputCarry},position:NativePoint|undefined,longestTicks=0,peakRateSpeed=0,totalTicks=0,stationaryTicks=0;
 for(const record of records){
  if(record.kind!=='motor'){totalTicks+=record.durationMs*25;continue;}
  expect(record.native).toBeUndefined();if(position)expect(record.fromSteps).toEqual(position);else position={...record.fromSteps};
  const command=motorCommand(record).split(',').map(Number),ms=command[1]!,deltas=[command[2]!,command[3]!];
  const factor=Math.fround(Math.fround(85899345.92)/Math.fround(ms));
  const rates=deltas.map(n=>n?Math.trunc(Math.fround(Math.fround(Math.abs(n))*factor)):0),remaining=deltas.map(Math.abs);
  const accumulated=[carry.m1,carry.m2],coordinates=[position.m1,position.m2];
  peakRateSpeed=Math.max(peakRateSpeed,Math.hypot(...rates)*HZ/(B*Math.SQRT2*p.stepsPerMm));
  const source=polyline??(record.penDown?paths?.find(path=>path.sourceId===record.sourceId)?.points:undefined);
  let ticks=0;
  while(remaining.some(Boolean)){
   if(++ticks>Math.ceil(ms*HZ/1000)+HZ)throw new Error('SM failed to complete within its duration and one-second guard.');
   for(let axis=0;axis<2;axis++)if(remaining[axis]){
    accumulated[axis]!+=rates[axis]!;
    if(accumulated[axis]!>=B){accumulated[axis]!-=B;remaining[axis]!--;coordinates[axis]!+=Math.sign(deltas[axis]!);}
   }
   if(source){const q=point({m1:coordinates[0]!,m2:coordinates[1]!},p);let distance=Infinity;
    for(let i=1;i<source.length;i++)distance=Math.min(distance,segmentDistance(q,source[i-1]!,source[i]!));
    if(distance>Math.SQRT2/p.stepsPerMm+1e-7)throw new Error(`SM tick left source corridor: ${distance}.`);
   }
  }
  if(!deltas.some(Boolean)){ticks=ms*25;stationaryTicks+=ticks;}
  totalTicks+=ticks;longestTicks=Math.max(longestTicks,ticks);position={m1:coordinates[0]!,m2:coordinates[1]!};expect(position).toEqual(record.toSteps);
  carry={m1:accumulated[0]!,m2:accumulated[1]!};
 }
 return{carry,longestTicks,peakRateSpeed,totalTicks,stationaryTicks};
}
