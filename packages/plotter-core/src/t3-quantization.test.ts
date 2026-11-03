import {describe,it,expect} from 'vitest';
import * as core from './index.js';
import {motionCorpus,corpusOptions} from '../../../scripts/permissive-motion-corpus.mjs';
import type {AxisParameters,MachineProfile,MotorRecord,NativePoint,PlotOptions,Point} from './types.js';
import type {JerkPhase} from './scurve.js';
const B=2147483648,HZ=25000;

describe('P2 native endpoint quantization',()=>{
 it.each(['xylodraw','axidraw','axidraw-a3'] as const)('admits the unchanged dense 18,000-point drawing at 16×: %s',id=>{
  const dense=motionCorpus().find((c:{id:string})=>c.id==='dense-18000')!;
  const options={...corpusOptions(core,dense,'t3'),profile:core.machineProfile(id,0,16,'standard'),firmware:'3.1.7'} as PlotOptions;
  const plan=core.compileJob(dense.paths,options);
  expect(()=>core.validatePlan(plan)).not.toThrow();
  const drawing=plan.records.filter((r):r is core.MotorRecord=>r.kind==='motor'&&r.penDown);
  expect(drawing.at(-1)!.toSteps).toEqual(core.toNative(dense.paths[0].points.at(-1),options.profile));
  expect(plan.records.at(-1)!.to).toEqual({x:0,y:0});
 },20000);

 it.each([-1,1] as const)('fits a one-tick %i step only after the minimum safe integer duration',sign=>{
  for(const residue of [0,1])for(const stationaryAxis of [false,true])for(const acceleration of [-200,0,200]){
   const profile=core.machineProfile('xylodraw',0,16),factor=profile.stepsPerMm*(stationaryAxis?Math.SQRT2:1),speed=stationaryAxis?70:100;
   // The first phase independently establishes carry 0/1 for positive motion,
   // or B-1/B-2 for negative motion. The zero-step middle phase retains it.
   const rate=residue?(B-5)/3:B/4,ticks=residue?3:4;
   const initialSpeed=rate*HZ/(B*factor),firstAcceleration=residue?(1+1e-12)*HZ**2/(B*factor):0;
   const duration=ticks/HZ,distance=initialSpeed*duration+firstAcceleration*duration**2/2;
   const point=(d:number)=>stationaryAxis?{x:sign*d/Math.SQRT2,y:sign*d/Math.SQRT2}:{x:sign*d,y:0};
   const tinyDistance=.02/factor,tinyDuration=2*tinyDistance/(initialSpeed+Math.sqrt(initialSpeed**2+2*acceleration*tinyDistance));
   const phases:JerkPhase[]=[
    {from:point(0),to:point(distance),duration,initialSpeed,acceleration:firstAcceleration,jerk:0,restBefore:true},
    {from:point(distance),to:point(1.49/factor),duration:(1.49/factor-distance)/initialSpeed,initialSpeed,acceleration:0,jerk:0,restBefore:false},
    {from:point(1.49/factor),to:point(1.51/factor),duration:tinyDuration,initialSpeed,acceleration,jerk:0,restBefore:false},
   ];
   expect(Math.ceil(tinyDuration*HZ)).toBe(1);
   const records=core.compileJerkPhases(phases,profile,'black',true,{m1:0,m2:0},0,undefined,speed),replayed=replay(records,profile,speed),last=replayed.at(-1)!;
   const carry=sign>0?residue:B-1-residue;
   expect(last.before).toEqual({m1:carry,m2:stationaryAxis?0:carry});
   expect(last.clear).toBe(0);expect(last.ticks).toBe(3);
   expect(records.at(-1)!.toSteps).toEqual({m1:sign*2,m2:stationaryAxis?0:sign*2});
   // Triangle inequality bounds the sum of all legal per-tick rate vectors.
   // Even an arbitrary rate schedule cannot overflow from this carry in 2 ticks.
   const required=sign>0?B-carry:carry+1;
   const minimumTicks=Math.ceil(Math.hypot(required,stationaryAxis?0:required)/(speed*B*Math.SQRT2*profile.stepsPerMm/HZ));
   expect(minimumTicks).toBe(3);expect(last.ticks).toBe(minimumTicks);
  }
 });

 it('rejects an infeasible native duration at the bounded horizon instead of returning partial axes',()=>{
  const phases:JerkPhase[]=[
   {from:{x:0,y:0},to:{x:.0049,y:0},duration:.0049,initialSpeed:1,acceleration:0,jerk:0,restBefore:true},
   {from:{x:.0049,y:0},to:{x:.0051,y:0},duration:.0002,initialSpeed:1,acceleration:0,jerk:0,restBefore:false},
  ];
  expect(()=>core.compileJerkPhases(phases,core.machineProfile('xylodraw',0,16),'black',true,{m1:0,m2:0},0,undefined,.001)).toThrow(/bounded command horizon/);
 });

 it('exhausts the finite endpoint retry limit on an unsupported phase without returning stale axes',()=>{
  const phases:JerkPhase[]=[
   {from:{x:0,y:0},to:{x:.01,y:0},duration:8/HZ,initialSpeed:31.25,acceleration:0,jerk:0,restBefore:true},
   {from:{x:.01,y:0},to:{x:500.01,y:0},duration:1/HZ,initialSpeed:1,acceleration:0,jerk:0,restBefore:false},
  ];
  expect(()=>core.compileJerkPhases(phases,core.machineProfile('xylodraw',0,16),'black',true,{m1:0,m2:0})).toThrow('Cannot quantize T3 endpoint within the bounded command horizon.');
 });

 const variants=(['xylodraw','axidraw','axidraw-a3','nextdraw-8511','nextdraw-1117','nextdraw-2234'] as const).flatMap(id=>(id.startsWith('nextdraw')?['standard','brushless'] as const:['standard'] as const).map(servo=>({id,servo})));
 const configurations=variants.flatMap(v=>([8,16] as const).flatMap(resolution=>([0,90,180,270] as const).map(rotation=>({...v,resolution,rotation}))));
 it.each(configurations)('replays seeded native ticks and carried state: $id/$servo/$resolution/$rotation',config=>{
  const profile=core.machineProfile(config.id,config.rotation,config.resolution,config.servo);
  let seed=0x51b7+configurations.indexOf(config);const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  const points:Point[]=[{x:10,y:10},{x:10.025,y:10.025},{x:10.05,y:10.025},{x:10.025,y:10.025}];
  for(let i=0;i<10;i++){const p=points.at(-1)!;points.push({x:p.x+.006+random()*.25,y:p.y+(random()-.5)*.4});}
  const speed=[5,15,35,70][configurations.indexOf(config)%4]!;
  const options:PlotOptions={profile,pen:{...core.defaultPen},speed,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:false,drawingMode:'profiled',backend:'t3',firmware:'3.1.7'};
  const plan=core.compileJob([{tool:'black',sourceId:'seeded',points}],options);
  const records=plan.records.filter((r):r is MotorRecord=>r.kind==='motor'&&r.penDown);
  expect(records[0]!.fromSteps).toEqual(core.toNative(points[0]!,profile));
  expect(records.at(-1)!.toSteps).toEqual(core.toNative(points.at(-1)!,profile));
  replay(records,profile,speed,points);
 });
});

/** Literal integer ISR, independent of production predictors and rate helpers. */
function axisState(p:AxisParameters,carry:number,clear:boolean){
 let rate=p.rate-Math.trunc(p.acceleration/2)+Math.trunc(p.jerk/6),acceleration=p.acceleration-p.jerk;
 const first=rate+p.acceleration;
 const accumulator=clear?(first<0||first===0&&(p.acceleration+p.jerk<0||p.acceleration+p.jerk===0&&p.jerk<0)?B-1:0):carry;
 return{rate,acceleration,accumulator,position:0};
}
function replay(records:readonly MotorRecord[],profile:MachineProfile,speed:number,points?:readonly Point[]){
 const halves:{before:NativePoint;ticks:number;clear:number}[]=[];
 let previousCarry:NativePoint={m1:0,m2:0},previousPosition=records[0]!.fromSteps,peakSpeed=0,maximumDistance=0;
 for(const record of records){
  expect(record.fromSteps).toEqual(previousPosition);expect(record.native!.accumulatorsBefore).toEqual(previousCarry);
  let position={...record.fromSteps},carry={...record.native!.accumulatorsBefore};
  for(const p of record.native!.halves){
   halves.push({before:{...carry},ticks:p.ticks,clear:p.clear});
   const states=[axisState(p.axis1,carry.m1,!!(p.clear&1)),axisState(p.axis2,carry.m2,!!(p.clear&2))];
   const axes=[p.axis1,p.axis2];
   for(let tick=0;tick<p.ticks;tick++){
    for(const [i,s]of states.entries()){
     s.acceleration+=axes[i]!.jerk;s.rate+=s.acceleration;s.accumulator+=s.rate;
     if(s.accumulator<0){s.accumulator+=B;s.position--;}
     else if(s.accumulator>=B){s.accumulator-=B;s.position++;}
     if(s.accumulator<0||s.accumulator>=B)throw new Error('Literal ISR accumulator escaped its one-step tick range.');
    }
    peakSpeed=Math.max(peakSpeed,Math.hypot(states[0]!.rate,states[1]!.rate)*HZ/(B*Math.SQRT2*profile.stepsPerMm));
    if(points){
     const m1=position.m1+states[0]!.position,m2=position.m2+states[1]!.position,u=(m1+m2)/(2*profile.stepsPerMm),v=(m1-m2)/(2*profile.stepsPerMm);
     const point=profile.rotation===90?{x:v,y:-u}:profile.rotation===180?{x:-u,y:-v}:profile.rotation===270?{x:-v,y:u}:{x:u,y:v};
     maximumDistance=Math.max(maximumDistance,Math.min(...points.slice(1).map((end,i)=>segmentDistance(point,points[i]!,end))));
    }
   }
   position={m1:position.m1+states[0]!.position,m2:position.m2+states[1]!.position};carry={m1:states[0]!.accumulator,m2:states[1]!.accumulator};
  }
  expect(position).toEqual(record.toSteps);expect(carry).toEqual(record.native!.accumulatorsAfter);
  previousPosition=position;previousCarry=carry;
 }
 expect(peakSpeed).toBeLessThanOrEqual(speed+1e-7);
 if(points)expect(maximumDistance).toBeLessThanOrEqual(Math.SQRT2/profile.stepsPerMm+1e-7);
 return halves;
}
function segmentDistance(p:Point,a:Point,b:Point){const x=b.x-a.x,y=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/(x*x+y*y)));return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);}
