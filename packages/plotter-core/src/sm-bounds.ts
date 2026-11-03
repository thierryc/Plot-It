import {fromNative} from './profiles.js';
import type {Phase} from './planner.js';
import type {MachineProfile,MotorRecord,Point} from './types.js';

const ACCUMULATOR=2147483648,TICKS_PER_SECOND=25000;
/** EBB 3.1.7 SM uses single-precision rate conversion and unsigned carried
 * accumulators. These are protocol arithmetic facts, not firmware source.
 * Reference: https://evil-mad.github.io/EggBot/ebb.html#SM */
export function smRate(steps:number,durationMs:number):number {
  return steps?Math.trunc(Math.fround(Math.fround(Math.abs(steps))*Math.fround(Math.fround(85899345.92)/Math.fround(durationMs)))):0;
}

/** Bounds hold for every incoming accumulator in [0,2^31), including repeats.
 * An axis stops accumulating once its requested step count has completed. */
export function smBounds(record:MotorRecord,phase:Phase,profile:MachineProfile):{ticks:number;speed:number;axisRate:number;distance:number} {
  const deltas=[record.toSteps.m1-record.fromSteps.m1,record.toSteps.m2-record.fromSteps.m2];
  const rates=deltas.map(n=>smRate(n,record.durationMs)),counts=deltas.map(Math.abs);
  const completion=counts.map((n,i)=>n?n*ACCUMULATOR/rates[i]!:0);
  const ticks=counts.some(Boolean)?Math.ceil(Math.max(...completion)):record.durationMs*25;
  // q(t) is the continuous, per-axis-clamped rate path. It is piecewise linear
  // with only the two axis completion breakpoints. Distance to a closed line
  // segment is convex on each piece, so its maximum occurs at a breakpoint.
  let distance=0;
  for(const t of [0,...completion]){
    const q=fromNative({m1:record.fromSteps.m1+Math.sign(deltas[0]!)*Math.min(counts[0]!,t*rates[0]!/ACCUMULATOR),m2:record.fromSteps.m2+Math.sign(deltas[1]!)*Math.min(counts[1]!,t*rates[1]!/ACCUMULATOR)},profile);
    distance=Math.max(distance,segmentDistance(q,phase.from,phase.to));
  }
  // At every tick, min(n,floor((carry+t*rate)/2^31)) differs from q(t) by
  // less than one step per active axis. CoreXY is a rotation plus uniform scale.
  distance+=Math.sqrt(counts.filter(Boolean).length)/(Math.SQRT2*profile.stepsPerMm);
  return{ticks,speed:Math.hypot(...rates)*TICKS_PER_SECOND/(ACCUMULATOR*Math.SQRT2*profile.stepsPerMm),axisRate:Math.max(...rates)*TICKS_PER_SECOND/ACCUMULATOR,distance};
}
/** Tighter geometry certificate when the inexpensive bound is inconclusive. At any
 * tick the two extrema (carry 0 and 2^31-1) enclose every possible axis state.
 * Check the four rectangle corners only when an extremum takes a step. This
 * is bounded by four times the requested step count, not elapsed wait time. */
export interface SMProofBudget {remaining:number}
export function smExactCorridor(record:MotorRecord,phase:Phase,profile:MachineProfile,tolerance:number,budget:SMProofBudget):boolean {
  const deltas=[record.toSteps.m1-record.fromSteps.m1,record.toSteps.m2-record.fromSteps.m2],counts=deltas.map(Math.abs),rates=deltas.map(n=>smRate(n,record.durationMs));
  const states=[0,1].flatMap(axis=>[0,ACCUMULATOR-1].map(carry=>({axis,carry,steps:0})));
  for(;;){
    if(budget.remaining--<=0)return false;
    for(const a of [states[0]!,states[1]!])for(const b of [states[2]!,states[3]!]){
      const q=fromNative({m1:record.fromSteps.m1+Math.sign(deltas[0]!)*a.steps,m2:record.fromSteps.m2+Math.sign(deltas[1]!)*b.steps},profile);
      if(segmentDistance(q,phase.from,phase.to)>tolerance)return false;
    }
    let next=Infinity;
    for(const state of states)if(state.steps<counts[state.axis]!)next=Math.min(next,Math.ceil(((state.steps+1)*ACCUMULATOR-state.carry)/rates[state.axis]!));
    if(!Number.isFinite(next))return true;
    for(const state of states)state.steps=Math.min(counts[state.axis]!,Math.floor((state.carry+next*rates[state.axis]!)/ACCUMULATOR));
  }
}
function segmentDistance(p:Point,a:Point,b:Point):number {
  const x=b.x-a.x,y=b.y-a.y,length=x*x+y*y,t=length?Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/length)):0;
  return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);
}
