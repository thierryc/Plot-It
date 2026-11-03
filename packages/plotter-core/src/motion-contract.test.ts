import {describe,it,expect,vi} from 'vitest';
import * as planner from './planner.js';
import {planSCurve} from './scurve.js';
import {compileJob} from './compiler.js';
import {machineProfile} from './profiles.js';
import {defaultPen} from './pen.js';
import type {PlotOptions,Point,AxisParameters} from './types.js';
const options:PlotOptions={profile:machineProfile('xylodraw',0),pen:{...defaultPen},speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:false,drawingMode:'profiled'};
describe('independent motion equations and executable envelopes',()=>{
 it('gives a triangular move exactly two nonzero ramps and no floating-residue cruise',()=>{
  for(const length of [.0001,.001,.025,.2,1,2,6]){
   const phases=planner.planStroke([{x:0,y:0},{x:length,y:0}],35,200,.127);
   expect(phases).toHaveLength(2);expect(phases.every(p=>p.acceleration!==0)).toBe(true);
   expect(phases.reduce((sum,p)=>sum+p.duration,0)).toBeCloseTo(2*Math.sqrt(length/200),12);
  }
 });
 it('rejects fixed boundary speeds made unreachable by an adjacent stop',()=>{
  const points=[{x:0,y:0},{x:.01,y:0},{x:20,y:0}];
  expect(()=>planner.planStroke(points,35,200,0,false,10,0)).toThrow(/boundary/);
  expect(()=>planner.planStroke([...points].reverse(),35,200,0,false,0,10)).toThrow(/boundary/);
 });
 it('keeps native reversals at rest despite advisory straight source tangents',()=>{
  const points=[{x:0,y:0},{x:5,y:0},{x:0,y:0}],directions=[{x:1,y:0},{x:1,y:0}];
  for(const phases of [planner.planStroke(points,35,200,.127,false,0,0,directions),planSCurve(points,35,200,500000,.127,false,directions)]){
   const at=phases.find(p=>p.to.x===5)!;
   expect(at.initialSpeed+at.acceleration*at.duration+('jerk'in at?at.jerk*at.duration**2/2:0)).toBeCloseTo(0,8);
  }
 });
 it('prepares T3 without invoking the SM planner',()=>{
  const spy=vi.spyOn(planner,'planStroke').mockImplementation(()=>{throw new Error('SM invoked');});
  try{expect(()=>compileJob([{tool:'black',points:[{x:0,y:0},{x:10,y:0}]}],{...options,backend:'t3',firmware:'3.1.7'})).not.toThrow();}finally{spy.mockRestore();}
 });
 it('bounds scalar SM speed at quantized endpoints, including sparse and diagonal steps',()=>{
  for(const speed of [.1,1,35,120])for(const rotation of [0,90,180,270] as const){
   const o={...options,speed,travelSpeed:speed,profile:machineProfile('xylodraw',rotation)};
   const plan=compileJob([{tool:'black',points:[{x:0,y:0},{x:.01,y:.01},{x:.03,y:.01},{x:1,y:1.01},{x:2,y:1.02}]}],o);
   for(const r of plan.records)if(r.kind==='motor')expect(Math.hypot(r.toSteps.m1-r.fromSteps.m1,r.toSteps.m2-r.fromSteps.m2)*1000/(Math.SQRT2*o.profile.stepsPerMm*r.durationMs)).toBeLessThanOrEqual(speed+1e-7);
  }
 });
 it('integrates retained jerk phases with speed and acceleration continuity',()=>{
  for(const constant of [false,true]){
   let speed=0,acceleration=0;
   for(const p of planSCurve([{x:0,y:0},{x:.001,y:0},{x:5,y:0},{x:5,y:6}],35,200,500000,.127,constant)){
    expect(p.initialSpeed).toBeCloseTo(speed,8);expect(p.acceleration).toBeCloseTo(acceleration,7);
    expect(p.initialSpeed*p.duration+p.acceleration*p.duration**2/2+p.jerk*p.duration**3/6).toBeCloseTo(Math.hypot(p.to.x-p.from.x,p.to.y-p.from.y),8);
    speed=p.initialSpeed+p.acceleration*p.duration+p.jerk*p.duration**2/2;acceleration=p.acceleration+p.jerk*p.duration;
    expect(speed).toBeLessThanOrEqual(35+1e-8);expect(Math.abs(acceleration)).toBeLessThanOrEqual(200+1e-8);
   }
   expect(speed).toBeCloseTo(0,8);expect(acceleration).toBeCloseTo(0,7);
  }
 });
 it('checks every emitted T3/TD tick against source geometry and speed without production predictors',()=>{
  const points=[{x:0,y:0},{x:.02,y:.02},{x:4,y:.02},{x:4,y:3},{x:1,y:3}],scale=options.profile.stepsPerMm;
  const plan=compileJob([{tool:'black',points}],{...options,backend:'t3',firmware:'3.1.7',drawingMode:'constant'});
  let halves=0;
  for(const r of plan.records)if(r.kind==='motor'&&r.native&&r.penDown){
   let position={...r.fromSteps},carry={...r.native.accumulatorsBefore};
   for(const p of r.native.halves){halves++;const axes=[p.axis1,p.axis2],starts=axes.map((a,i)=>p.clear&(1<<i)?clearAccumulator(a):i===0?carry.m1:carry.m2),start={...position};
    for(let tick=1;tick<=p.ticks;tick++){
     const states=axes.map((a,i)=>independentTick(tick,a,starts[i]!));
     position={m1:start.m1+states[0]!.steps,m2:start.m2+states[1]!.steps};carry={m1:states[0]!.remainder,m2:states[1]!.remainder};
     const point={x:(position.m1+position.m2)/(2*scale),y:(position.m1-position.m2)/(2*scale)};
     expect(Math.min(...points.slice(1).map((end,i)=>segmentDistance(point,points[i]!,end)))).toBeLessThanOrEqual(Math.SQRT2/scale+1e-7);
     expect(Math.hypot(states[0]!.rate,states[1]!.rate)*25000/(2147483648*Math.SQRT2*scale)).toBeLessThanOrEqual(options.speed+1e-7);
    }
   }
   expect(position).toEqual(r.toSteps);expect(carry).toEqual(r.native.accumulatorsAfter);
  }
  expect(halves).toBeGreaterThan(10);
 });
});
// Protocol polynomial sums, evaluated with exact safe integers for these bounded
// fixtures. No production predictor, maximum-rate helper or emulator is called.
function adjusted(a:AxisParameters){return a.rate-Math.trunc(a.acceleration/2)+Math.trunc(a.jerk/6);}
function clearAccumulator(a:AxisParameters){const first=adjusted(a)+a.acceleration;return first<0||first===0&&(a.acceleration+a.jerk<0||a.acceleration+a.jerk===0&&a.jerk<0)?2147483647:0;}
function independentTick(t:number,a:AxisParameters,start:number){const sum=start+t*adjusted(a)+a.acceleration*t*(t+1)/2+a.jerk*t*(t*t-1)/6,steps=Math.floor(sum/2147483648);return{steps,remainder:sum-steps*2147483648,rate:adjusted(a)+a.acceleration*t+a.jerk*t*(t-1)/2};}
function segmentDistance(p:Point,a:Point,b:Point){const x=b.x-a.x,y=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/(x*x+y*y)));return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);}
