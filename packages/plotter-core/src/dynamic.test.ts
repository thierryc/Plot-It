import {describe,it,expect} from 'vitest';
import * as core from './index.js';
import {junctionSpeed,motionSegments} from './junction.js';
import {motionCorpus,corpusOptions} from '../../../scripts/permissive-motion-corpus.mjs';
import {inspectExecutable} from '../../../scripts/permissive-motion-oracle.mjs';
import {VirtualClock,VirtualEbb} from './virtual/index.js';
import type {Point,PlotOptions,MotorRecord,AxisParameters} from './types.js';
import type {DynamicMotionOptions} from './dynamic.js';
import type {JerkPhase} from './scurve.js';

const motion:DynamicMotionOptions={speed:35,acceleration:200,jerk:500000,cornering:.127,curveAcceleration:100,anticipationMm:3};
const options:PlotOptions={profile:core.machineProfile('xylodraw',0,16),pen:{...core.defaultPen},speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:true,drawingMode:'profiled',backend:'t3',firmware:'3.1.7',motionStrategy:'dynamic'};
const line=[{x:10,y:10},{x:70,y:10}];
const paths=[{tool:'black',sourceId:'flow',points:[{x:10,y:10},{x:10.1,y:10},{x:18,y:11},{x:23,y:14},{x:23,y:20},{x:23,y:14},{x:30,y:16}]}];
const circle=(r:number,n:number):Point[]=>Array.from({length:n+1},(_,i)=>({x:40+r*Math.cos(2*Math.PI*i/n),y:40+r*Math.sin(2*Math.PI*i/n)}));
const distance=(a:Point,b:Point)=>Math.hypot(b.x-a.x,b.y-a.y);
const duration=(p:readonly JerkPhase[])=>p.reduce((sum,q)=>sum+q.duration,0);
const near=(a:number,b:number,tolerance=2e-9+Math.abs(b)*2e-9)=>expect(Math.abs(a-b)).toBeLessThanOrEqual(tolerance);

/** Independent polynomial integration, critical-speed extrema and continuity.
 * It intentionally does not invoke the production transition/reachability math. */
function inspect(phases:readonly JerkPhase[],points:readonly Point[],o=motion){
  expect(phases.length).toBeGreaterThan(0);let velocity=0,acceleration=0,position=points[0]!;
  for(const p of phases){
    expect(p.from).toEqual(position);expect(p.duration).toBeGreaterThan(0);
    near(p.initialSpeed,velocity);near(p.acceleration,acceleration,2e-7);
    const t=p.duration;near(p.initialSpeed*t+p.acceleration*t*t/2+p.jerk*t**3/6,distance(p.from,p.to));
    expect(Math.abs(p.jerk)).toBeLessThanOrEqual(o.jerk);
    const times=[0,t],critical=p.jerk?-p.acceleration/p.jerk:-1;if(critical>0&&critical<t)times.push(critical);
    for(const time of times){const v=p.initialSpeed+p.acceleration*time+p.jerk*time*time/2;expect(v).toBeGreaterThanOrEqual(-2e-7);expect(v).toBeLessThanOrEqual(o.speed+2e-7);expect(Math.abs(p.acceleration+p.jerk*time)).toBeLessThanOrEqual(o.acceleration+2e-7);}
    velocity=p.initialSpeed+p.acceleration*t+p.jerk*t*t/2;acceleration=p.acceleration+p.jerk*t;position=p.to;
    if(p.restBefore){near(p.initialSpeed,0);near(p.acceleration,0);}
  }
  near(velocity,0);near(acceleration,0,2e-7);expect(position).toEqual(points.at(-1));
  for(const p of points.slice(1))expect(phases.some(q=>distance(q.to,p)<1e-9)).toBe(true);
}
function speedAtDistance(phases:readonly JerkPhase[],s:number):number {
  for(const p of phases){const d=distance(p.from,p.to);if(s>d){s-=d;continue;}let lo=0,hi=p.duration;for(let n=0;n<60;n++){const t=(lo+hi)/2,x=p.initialSpeed*t+p.acceleration*t*t/2+p.jerk*t**3/6;if(x<s)lo=t;else hi=t;}const t=(lo+hi)/2;return p.initialSpeed+p.acceleration*t+p.jerk*t*t/2;}
  return 0;
}

describe('Dynamic physical-distance nominal S-curves',()=>{
  it.each([1e-8,.0001,.025,.1,1,6,60,1000])('integrates a %s mm triangular or cruising stroke',length=>{
    const p=[{x:0,y:0},{x:length,y:0}],result=core.planDynamicMotion(p,motion);inspect(result.phases,p);
    expect(result.spans).toHaveLength(1);expect(result.stops).toEqual([0,length]);
    near(duration(result.phases),duration(core.planSCurve(p,35,200,500000,.127)));
  });
  it('preserves scalar derivatives across geometry instead of restarting at vertices',()=>{
    const p=[{x:0,y:0},{x:.4,y:0},{x:8,y:1}],o={...motion,curveAcceleration:100000,cornering:1000,anticipationMm:0},result=core.planDynamicMotion(p,o);
    inspect(result.phases,p,o);expect(result.spans).toHaveLength(1);
    const i=result.phases.findIndex(q=>q.to.x===.4&&q.to.y===0),next=result.phases[i+1]!;
    expect(next.acceleration).toBeGreaterThan(100);expect(next.restBefore).toBe(false);
    expect(result.phases.filter(q=>q.restBefore)).toHaveLength(1);
  });
  it('keeps collinear subdivision timing invariant and compiles canonical source identically',()=>{
    const split=Array.from({length:601},(_,i)=>({x:10+i/10,y:10})),a=core.planDynamicMotion(line,motion),b=core.planDynamicMotion(split,motion);
    expect(b.spans).toEqual(a.spans);near(duration(a.phases),duration(b.phases));inspect(b.phases,split);
    expect(core.compileJob([{tool:'black',points:split}],options)).toEqual(core.compileJob([{tool:'black',points:line}],options));
  });
  it.each([3,12])('converges on radius %s mm circles across tessellation densities',r=>{
    const coarse=circle(r,256),fine=circle(r,2048),a=core.planDynamicMotion(coarse,motion),b=core.planDynamicMotion(fine,motion);
    inspect(a.phases,coarse);inspect(b.phases,fine);
    expect(Math.abs(duration(a.phases)/duration(b.phases)-1)).toBeLessThan(.05);
    const lengthA=coarse.slice(1).reduce((sum,p,i)=>sum+distance(coarse[i]!,p),0),lengthB=fine.slice(1).reduce((sum,p,i)=>sum+distance(fine[i]!,p),0);
    for(const f of [.2,.35,.5,.65,.8])expect(Math.abs(speedAtDistance(a.phases,f*lengthA)/speedAtDistance(b.phases,f*lengthB)-1)).toBeLessThan(.05);
    const interior=b.spans.filter(s=>s.fromMm>3&&s.toMm<lengthB-3);for(const span of interior)expect(span.peakSpeed).toBeLessThanOrEqual(Math.sqrt(100*r)*1.05);
  });
  it('conservatively caps both cells adjoining a positive boundary junction without stopping there',()=>{
    const p=[{x:0,y:0},{x:5,y:0},{x:10,y:2}],o={...motion,curveAcceleration:100000,cornering:.001,anticipationMm:0},result=core.planDynamicMotion(p,o),segments=motionSegments(p),cap=junctionSpeed(segments[0]!,segments[1]!,35,200,.001);
    inspect(result.phases,p,o);expect(result.stops).toHaveLength(2);
    for(const span of result.spans.filter(s=>s.fromMm<=5&&s.toMm>=5))expect(span.speedLimit).toBeLessThanOrEqual(cap);
    expect(speedAtDistance(result.phases,5)).toBeGreaterThan(0);expect(speedAtDistance(result.phases,5)).toBeLessThanOrEqual(cap+1e-7);
  });
  it('moves a finite slowdown earlier without spreading mandatory stops into zero-speed cells',()=>{
    const p=[{x:0,y:0},{x:10,y:0},{x:15,y:2},{x:15,y:8}],a=core.planDynamicMotion(p,{...motion,anticipationMm:0}),b=core.planDynamicMotion(p,{...motion,anticipationMm:3});
    inspect(b.phases,p);expect(speedAtDistance(b.phases,7)).toBeLessThan(speedAtDistance(a.phases,7));
    expect(b.spans.every(s=>s.speedLimit>0)).toBe(true);expect(b.stops.length).toBeGreaterThan(2);
  });
  it.each([60,90,180])('stops at a %s degree source turn and restarts without changing geometry',degrees=>{
    const p=[{x:0,y:0},{x:4,y:0},{x:4+4*Math.cos(degrees*Math.PI/180),y:4*Math.sin(degrees*Math.PI/180)}],result=core.planDynamicMotion(p,motion);
    inspect(result.phases,p);expect(result.stops).toContain(4);near(speedAtDistance(result.phases,4),0,2e-7);
    expect(result.phases.filter(q=>q.restBefore)).toHaveLength(2);
  });
  it('preserves zero-cornering stops at every retained vertex',()=>{
    const p=[{x:0,y:0},{x:.01,y:0},{x:.02,y:0},{x:2,y:.1}],o={...motion,cornering:0},result=core.planDynamicMotion(p,o);
    inspect(result.phases,p,o);expect(result.stops).toHaveLength(4);expect(result.phases.filter(q=>q.restBefore)).toHaveLength(3);
  });
  it('retains hard source corners through collapsed native vertices and native reversals',()=>{
    const native=[{x:0,y:0},{x:1,y:0},{x:1,y:0},{x:2,y:0}],source=[{x:0,y:0},{x:1,y:0},{x:1,y:.001},{x:2,y:.001}],result=core.planDynamicMotion(native,motion,source);
    expect(result.stops).toContain(1);inspect(result.phases,native);
    const reversal=core.planDynamicMotion([{x:0,y:0},{x:1,y:0},{x:0,y:0}],motion,[{x:0,y:0},{x:1,y:0},{x:2,y:0}]);expect(reversal.stops).toEqual([0,1,2]);
  });
  it('handles duplicates/all-collapsed geometry and validates finite settings/source correspondence',()=>{
    expect(core.planDynamicMotion([{x:1,y:1},{x:1,y:1}],motion).phases).toEqual([]);
    const tinyTail=[{x:0,y:0},{x:.1,y:0},{x:.1,y:1e-13},{x:.1+1e-13,y:0}],tail=core.planDynamicMotion(tinyTail,motion);
    expect(tail.stops).toEqual([0,.1]);expect(tail.phases.at(-1)!.to).toEqual({x:.1,y:0});
    expect(()=>core.planDynamicMotion(line,motion,[line[0]!])).toThrow(/correspondence/);
    for(const value of [-1,NaN,Infinity,21])expect(()=>core.planDynamicMotion(line,{...motion,anticipationMm:value})).toThrow();
    expect(()=>core.planDynamicMotion([{x:0,y:0},{x:NaN,y:0}],motion)).toThrow();
  });
  it('maintains scalar contracts on deterministic varied-length smooth paths and jerk scales',()=>{
    let seed=0x44594e41;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
    for(let n=0;n<30;n++){let heading=0;const p:Point[]=[{x:0,y:0}],o={...motion,jerk:[1000,20000,500000][n%3]!,speed:5+random()*30,anticipationMm:random()*5};for(let i=0;i<20;i++){heading+=(random()-.5)*.8;const d=.001+random()*3,previous=p.at(-1)!;p.push({x:previous.x+d*Math.cos(heading),y:previous.y+d*Math.sin(heading)});}inspect(core.planDynamicSCurve(p,o),p,o);}
  });
});

describe('Dynamic T3 compilation and identity',()=>{
  it('keeps implicit/explicit Standard records and historical prepared identity unchanged',()=>{
    const standard={...options,motionStrategy:undefined},a=core.compileJob(paths,standard),b=core.compileJob(paths,{...standard,motionStrategy:'standard'});
    expect(b.records).toEqual(a.records);expect(b.planningModel).toBe(core.PLANNING_MODEL);
    expect(core.preparePaths(paths,{...standard,motionStrategy:'standard',dynamicCurveAcceleration:10,dynamicAnticipationMm:9})).toEqual(core.preparePaths(paths,standard));
  });
  it('admits deterministic Dynamic prepared round trips and rejects mismatched strategy/model/settings',()=>{
    const a=core.preparePaths(paths,options);expect(core.preparePaths(paths,options)).toEqual(a);expect(a.program.planningModel).toBe(core.DYNAMIC_PLANNING_MODEL);
    expect(core.importPrepared(core.exportPrepared(a))).toEqual(a);
    for(const altered of [{motionStrategy:'standard'},{dynamicAnticipationMm:4},{backend:'sm'},{firmware:'3.1.6'},{drawingMode:'constant'}]){const bad=structuredClone(a);Object.assign(bad.options,altered);expect(()=>core.validatePreparedJob(bad)).toThrow();}
    expect(()=>core.validatePlan({...a.program,planningModel:core.PLANNING_MODEL})).toThrow(/model/);
  });
  it('rejects unsupported Dynamic combinations and invalid controls without fallback',()=>{
    for(const bad of [{backend:'sm'},{backend:undefined},{firmware:undefined},{firmware:'3.1.6'},{drawingMode:'constant'},{motionStrategy:'other'},{dynamicCurveAcceleration:0},{dynamicAnticipationMm:21}])expect(()=>core.compileJob(paths,{...options,...bad} as PlotOptions)).toThrow();
    expect(()=>core.compileJob(paths,{...options,drawingJerk:1})).toThrow(/native resolution/);
  });
  it('keeps pen-up motion and pen records unchanged, with advisory reasons only on Dynamic drawing',()=>{
    const a=core.compileJob(paths,options),b=core.compileJob(paths,{...options,motionStrategy:undefined});
    const semantic=(p:core.ExecutablePlan)=>p.records.filter(r=>r.kind!=='motor'||!r.penDown).map(({id:_id,startMs:_start,...r})=>r);
    expect(semantic(a)).toEqual(semantic(b));expect(a.records.some(r=>r.kind==='motor'&&r.motionReason)).toBe(true);
    expect(()=>inspectExecutable(a,paths)).not.toThrow();
  });
  it('preserves strategy through layers, resume, reload and varied copies; rejects layer strategy switches',()=>{
    const o={...options,maxPenDownMm:12},layers=[{id:'a',name:'First',paths},{id:'b',name:'Second',paths:[{tool:'black',points:circle(3,64)}],overrides:{speed:20}}],prepared=core.prepareLayerJob(layers,o),plan=prepared.program;
    expect(core.validatePreparedJob(prepared)).toEqual(prepared);expect(plan.records.some(r=>r.kind==='pen'&&r.reload)).toBe(true);
    expect(core.resumeAtDistance(plan,3).planningModel).toBe(core.DYNAMIC_PLANNING_MODEL);
    expect(core.variedCopy(layers[1]!.paths,options,2).planningModel).toBe(core.DYNAMIC_PLANNING_MODEL);
    expect(()=>core.compileLayerProgram([{...layers[0]!,options:{...o,motionStrategy:'standard'}}],o)).toThrow(/strategy/);
    expect(()=>core.compileLayerProgram([{...layers[0]!,overrides:{motionStrategy:'standard'} as never}],o)).toThrow(/strategy/);
    const bad=structuredClone(plan),settings=bad.records.find(r=>r.settings)!.settings!;settings.motionStrategy='standard';expect(()=>core.validatePlan(bad)).toThrow(/strategy/);
  });
  it.each(([8,16]as const).flatMap(resolution=>([0,90,180,270]as const).map(rotation=>({resolution,rotation}))))('independently replays native ticks at $resolution× / $rotation°',({resolution,rotation})=>{
    const o={...options,profile:core.machineProfile('xylodraw',rotation,resolution)},plan=core.compileJob(paths,o);
    replay(plan.records.filter((r):r is MotorRecord=>r.kind==='motor'&&r.penDown),o,paths[0]!.points);
    expect(plan.records.at(-1)!.to).toEqual({x:0,y:0});
  });
  it.each([8,16]as const)('admits unchanged dense 18,000-point geometry at %s×',resolution=>{
    const dense=motionCorpus().find((c:{id:string})=>c.id==='dense-18000')!,o={...corpusOptions(core,dense,'t3'),profile:core.machineProfile('xylodraw',0,resolution),firmware:'3.1.7',motionStrategy:'dynamic'} as PlotOptions,plan=core.compileJob(dense.paths,o);
    core.validatePlan(plan);const drawing=plan.records.filter((r):r is MotorRecord=>r.kind==='motor'&&r.penDown);
    expect(drawing.at(-1)!.toSteps).toEqual(core.toNative(dense.paths[0].points.at(-1),o.profile));expect(plan.records.at(-1)!.to).toEqual({x:0,y:0});
    replay(drawing,o);
  },20000);
  it('runs bounds then two Dynamic drawings against the independent 3.1.7 virtual board',async()=>{
    const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7'}),session=new core.PlotterSession(board.createTransport(),clock,options.profile);await session.connect();
    for(const intent of ['bounds','drawing','drawing']as const){const plan=core.compileJob(paths,options,intent);await session.run(plan);expect(board.position).toEqual({m1:0,m2:0});expect(board.penUp).toBe(true);}
    expect(board.droppedCommands).toBe(0);await session.disconnect();
  });
});

/** Literal signed accumulator ISR, independent of predictT3Axis/maximumRate. */
function replay(records:readonly MotorRecord[],o:PlotOptions,source?:readonly Point[]){
  const B=2147483648,HZ=25000;let previous=records[0]!.fromSteps,carry={m1:0,m2:0},maximumSpeed=0,maximumDistance=0;
  const state=(p:AxisParameters,c:number,clear:boolean)=>{const rate=p.rate-Math.trunc(p.acceleration/2)+Math.trunc(p.jerk/6),first=rate+p.acceleration;return{rate,acceleration:p.acceleration-p.jerk,accumulator:clear?(first<0||first===0&&(p.acceleration+p.jerk<0||p.acceleration+p.jerk===0&&p.jerk<0)?B-1:0):c,steps:0};};
  for(const r of records){expect(r.fromSteps).toEqual(previous);expect(r.native!.accumulatorsBefore).toEqual(carry);let position={...r.fromSteps};
    for(const p of r.native!.halves){const axes=[p.axis1,p.axis2],s=[state(p.axis1,carry.m1,!!(p.clear&1)),state(p.axis2,carry.m2,!!(p.clear&2))];
      for(let tick=0;tick<p.ticks;tick++){
        for(let i=0;i<2;i++){const q=s[i]!;q.acceleration+=axes[i]!.jerk;q.rate+=q.acceleration;q.accumulator+=q.rate;if(q.accumulator<0){q.accumulator+=B;q.steps--;}else if(q.accumulator>=B){q.accumulator-=B;q.steps++;}if(q.accumulator<0||q.accumulator>=B)throw new Error('Native tick escaped one-step accumulator range.');}
        maximumSpeed=Math.max(maximumSpeed,Math.hypot(s[0]!.rate,s[1]!.rate)*HZ/(B*Math.SQRT2*o.profile.stepsPerMm));
        if(source){const point=core.fromNative({m1:position.m1+s[0]!.steps,m2:position.m2+s[1]!.steps},o.profile);let nearest=Infinity;for(let i=1;i<source.length;i++){const a=source[i-1]!,b=source[i]!,x=b.x-a.x,y=b.y-a.y,t=Math.max(0,Math.min(1,((point.x-a.x)*x+(point.y-a.y)*y)/(x*x+y*y)));nearest=Math.min(nearest,Math.hypot(point.x-a.x-t*x,point.y-a.y-t*y));}maximumDistance=Math.max(maximumDistance,nearest);}
      }
      position={m1:position.m1+s[0]!.steps,m2:position.m2+s[1]!.steps};carry={m1:s[0]!.accumulator,m2:s[1]!.accumulator};
    }
    expect(position).toEqual(r.toSteps);expect(carry).toEqual(r.native!.accumulatorsAfter);previous=position;
  }
  expect(maximumSpeed).toBeLessThanOrEqual(o.speed+1e-7);if(source)expect(maximumDistance).toBeLessThanOrEqual(Math.SQRT2/o.profile.stepsPerMm+1e-7);
}
