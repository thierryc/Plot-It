import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {compileJob,sampleExecution,validatePlan,motorCommand} from './compiler.js';
import {predictT3Axis,encodeT3,encodeTD,maximumRate} from './ebb-math.js';
import {planSCurve,transitionDistance} from './scurve.js';
import {machineProfile,toNative} from './profiles.js';
import {defaultPen} from './pen.js';
import {PlotterSession} from './session.js';
import {VirtualClock,VirtualEbb} from './virtual/index.js';
import {firmwareFromReply} from './protocol.js';
import {selectBackend} from './capabilities.js';
import type {PlotOptions,T3Parameters} from './types.js';
const options:PlotOptions={profile:machineProfile('xylodraw',0),pen:{...defaultPen,up:30,down:52},speed:35,travelSpeed:70,acceleration:200,travelAcceleration:400,cornering:.127,maxPenDownMm:15,returnToOrigin:true,drawingMode:'profiled',backend:'t3',firmware:'3.1.7',drawingJerk:500000,travelJerk:330200};
const paths=[{tool:'black',points:[{x:55,y:10},{x:65,y:10},{x:65.05,y:10.025},{x:80,y:30},{x:60,y:30}]}];
describe('modern EBB backend',()=>{
 it('rejects a requested jerk below native resolution before execution',()=>{expect(()=>compileJob(paths,{...options,drawingJerk:1})).toThrow(/native resolution/);});
 it('matches the ten pinned Plotink integer reference vectors',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../reference/t3-vectors.json',import.meta.url),'utf8'));
  for(const entry of fixture.results){const [ticks,rate,acceleration,jerk,accum]=entry.inputs;const actual=predictT3Axis(ticks,{rate,acceleration,jerk},accum);expect([actual.steps,actual.accumulator]).toEqual(entry.plotink);}
 });
 it('agrees with an independent literal ISR for signed rates, nonzero state and reversals',async()=>{
  let seed=51;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  for(let n=0;n<80;n++){
   const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7'}),transport=board.createTransport();
   const p:T3Parameters={ticks:1+Math.floor(random()*300),axis1:{rate:Math.floor((random()-.5)*1e8),acceleration:Math.floor((random()-.5)*10000),jerk:Math.floor((random()-.5)*100)},axis2:{rate:0,acceleration:0,jerk:0},clear:n%2?0:3};
   await transport.write(new TextEncoder().encode('EM,2,2\r'));clock.advance(0);
   board.accumulators.m1=Math.floor(random()*2147483648);const expected=predictT3Axis(p.ticks,p.axis1,p.clear?'clear':board.accumulators.m1);
   await transport.write(new TextEncoder().encode(encodeT3(p)+'\r'));clock.advance(p.ticks/25);
   expect(board.position.m1).toBe(expected.steps);expect(board.accumulators.m1).toBe(expected.accumulator);
  }
 });
 it('plans acceleration plateaus and reduced-peak moves within continuous limits',()=>{
  for(const length of [.025,.1,1,6,100]){
   const phases=planSCurve([{x:0,y:0},{x:length,y:0}],35,200,500000,.127);
   expect(phases.at(-1)!.to.x).toBe(length);expect(phases[0]!.initialSpeed).toBe(0);
   for(const p of phases){expect(Math.abs(p.jerk)).toBeLessThanOrEqual(500000);expect(Math.abs(p.acceleration)).toBeLessThanOrEqual(200+1e-7);expect(p.initialSpeed).toBeLessThanOrEqual(35+1e-7);expect(Math.abs(p.acceleration+p.jerk*p.duration)).toBeLessThanOrEqual(200+1e-7);}
  }
  expect(transitionDistance(0,35,200,500000)).toBeGreaterThan(35**2/400);
 });
 it.each([8,16] as const)('replays bounds then two drawing jobs at %dx, using the independent board',async resolution=>{
  const o={...options,profile:machineProfile('xylodraw',0,resolution)},clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7',fragmentBytes:1}),session=new PlotterSession(board.createTransport(),clock,o.profile);await session.connect();
  for(const intent of ['bounds','drawing','drawing']as const){const start=board.trace.length,plan=compileJob(paths,o,intent);validatePlan(plan);await session.run(plan);expect(board.position).toEqual({m1:0,m2:0});expect(board.penUp).toBe(true);
   const motors=board.trace.slice(start).filter(e=>e.phase==='started'&&/^(T3|TD),/.test(e.command));expect(motors.length).toBeGreaterThan(0);expect(motors.some(e=>!e.penUp)).toBe(intent==='drawing');
   for(const r of plan.records)if(r.kind==='motor'){expect(sampleExecution(plan,r.startMs+r.durationMs-1e-8).position).toBeDefined();if(r.native)for(const p of r.native.halves){expect(maximumRate(p.ticks,p.axis1)).toBeLessThanOrEqual(2147054150);const actual=Math.hypot(maximumRate(p.ticks,p.axis1),maximumRate(p.ticks,p.axis2))*25000/2147483648/(Math.SQRT2*o.profile.stepsPerMm);expect(actual).toBeLessThanOrEqual((r.penDown?o.speed:o.travelSpeed)+1e-7);}}
  }
 });
 it('compiles exact lattice endpoints for short, negative and near-zero-axis moves',()=>{
  for(const endpoint of [{x:.025,y:0},{x:.1,y:.099},{x:-1,y:1},{x:6,y:0}]){const plan=compileJob([{tool:'black',points:[{x:0,y:0},endpoint]}],{...options,maxPenDownMm:0,returnToOrigin:false});const drawn=plan.records.filter(r=>r.kind==='motor'&&r.penDown);expect(drawn.at(-1)).toMatchObject({toSteps:toNative(endpoint,options.profile)});}
 });
 it('expands TD into exactly two T3 commands with state carry and twice the tick count',async()=>{
  const a:T3Parameters={ticks:1000,axis1:{rate:0,acceleration:0,jerk:100},axis2:{rate:0,acceleration:0,jerk:0},clear:3},b:T3Parameters={ticks:1000,axis1:{rate:49950016,acceleration:100000,jerk:-100},axis2:a.axis2,clear:0};
  const first=predictT3Axis(a.ticks,a.axis1),second=predictT3Axis(b.ticks,b.axis1,first.accumulator),clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7'}),transport=board.createTransport();
  await transport.write(new TextEncoder().encode('EM,2,2\r'+encodeTD(a,b)+'\r'));clock.advance(80);expect(board.position.m1).toBe(first.steps+second.steps);expect(board.accumulators.m1).toBe(second.accumulator);expect(board.queued).toBe(0);
 });
 it('keeps physical Auto on SM until hardware acceptance and rejects mismatched firmware before movement',async()=>{
  expect(selectBackend(firmwareFromReply('EBB Firmware Version 3.1.7'))).toBe('sm');expect(selectBackend(firmwareFromReply('EBB Firmware Version 3.1.7'),'auto',true)).toBe('t3');
  const clock=new VirtualClock(),board=new VirtualEbb(clock),session=new PlotterSession(board.createTransport(),clock,options.profile);await session.connect();const count=board.commands.length;await expect(session.run(compileJob(paths,options))).rejects.toThrow(/firmware/);expect(board.commands.length).toBe(count);
 });
 it('rejects a corrupted native prediction before writes',()=>{const plan=structuredClone(compileJob(paths,options));const r=plan.records.find(r=>r.kind==='motor'&&r.native)!;if(r.kind==='motor')r.toSteps.m1++;expect(()=>validatePlan(plan)).toThrow();});
});
