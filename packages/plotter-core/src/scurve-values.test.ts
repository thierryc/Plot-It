import {describe,it,expect} from 'vitest';
import {planSCurve,type JerkPhase} from './scurve.js';
import type {Point} from './types.js';

/** Original deterministic value fixtures; expected values are integrated cubic
 * equations and physical limits, not another planner's numerical output. */
describe('S-curve attainable limits and small real velocity changes',()=>{
 it('keeps every phase distance consistent when look-ahead can reach the exact speed cap',()=>{
  // Seed 0x504c4f54, jerk-polyline case 27 in the offline numerical matrix.
  const points=[{x:0,y:0},{x:9.602882680346964,y:0},{x:19.406762060709298,y:16.34046160057187},{x:0,y:0}];
  const speed=17.719774406814654,acceleration=3744.5347071161145,jerk=774.7819615979033;
  inspectPhases(planSCurve(points,speed,acceleration,jerk,.05),points,speed,acceleration,jerk);
 });
 const nearCaps=[.1,1,17.719774406814654,35,199].flatMap(speed=>[1e-12,1e-11,9e-11,1.1e-10,1e-9].flatMap(delta=>[100,774.7819615979033,500000].map(jerk=>({speed,delta,jerk}))));
 it.each(nearCaps)('integrates a real near-cap corner ramp at speed $speed, delta $delta, jerk $jerk',({speed,delta,jerk})=>{
  const acceleration=200,half=Math.SQRT1_2,cornering=(speed-delta)**2*(1-half)/(acceleration*half);
  const points=[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000}],before=structuredClone(points);
  inspectPhases(planSCurve(points,speed,acceleration,jerk,cornering),points,speed,acceleration,jerk);
  expect(points).toEqual(before);
 });
});

function inspectPhases(phases:JerkPhase[],points:Point[],limit:number,accelerationLimit:number,jerkLimit:number):void {
 expect(phases.length).toBeGreaterThan(0);
 let position=points[0]!,velocity=0,acceleration=0;
 const near=(actual:number,expected:number,tolerance=2e-9+Math.abs(expected)*2e-9)=>expect(Math.abs(actual-expected)).toBeLessThanOrEqual(tolerance);
 for(const p of phases){
  expect(Number.isFinite(p.duration)&&p.duration>0).toBe(true);expect(p.from).toEqual(position);
  near(p.initialSpeed,velocity);near(p.acceleration,acceleration,2e-7);
  const t=p.duration,length=Math.hypot(p.to.x-p.from.x,p.to.y-p.from.y);
  near(p.initialSpeed*t+p.acceleration*t*t/2+p.jerk*t*t*t/6,length);
  expect(Math.abs(p.jerk)).toBeLessThanOrEqual(jerkLimit+1e-7);
  const times=[0,t],critical=p.jerk?-p.acceleration/p.jerk:-1;if(critical>0&&critical<t)times.push(critical);
  for(const time of times){
   const speed=p.initialSpeed+p.acceleration*time+p.jerk*time*time/2;
   expect(speed).toBeGreaterThanOrEqual(-2e-7);expect(speed).toBeLessThanOrEqual(limit+2e-7);
   expect(Math.abs(p.acceleration+p.jerk*time)).toBeLessThanOrEqual(accelerationLimit+2e-7);
  }
  velocity=p.initialSpeed+p.acceleration*t+p.jerk*t*t/2;acceleration=p.acceleration+p.jerk*t;position=p.to;
 }
 near(velocity,0);near(acceleration,0,2e-7);expect(position).toEqual(points.at(-1));
 for(const vertex of points.slice(1))expect(phases.some(p=>p.to.x===vertex.x&&p.to.y===vertex.y)).toBe(true);
}
