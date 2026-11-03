/** Discrete EBB mathematics, adapted from Plotink ebb_calc.py 1.1.0 (MIT).
 * Copyright (c) 2025 Windell H. Oskay, Bantam Tools.
 * Full notice: ../reference/PLOTINK-LICENSE. All intermediate arithmetic is exact. */
import {PlotterError, type AxisParameters, type T3Parameters} from './types.js';
export const ACCUMULATOR = 2147483648n;
export const TICKS_PER_SECOND = 25000;
export function integer(value:number,min=-2147483648,max=2147483647):number {
  if(!Number.isSafeInteger(value)||value<min||value>max)throw new PlotterError('invalid-plan','Invalid EBB integer parameter.');
  return value;
}
export function floorDivide(a:bigint,b:bigint):bigint {const q=a/b;return a%b<0n?q-1n:q;}
export function initialAccumulator(axis:AxisParameters):number {
  const r=BigInt(axis.rate),a=BigInt(axis.acceleration),j=BigInt(axis.jerk);
  const first=r-a/2n+j/6n+a;
  return first<0n||first===0n&&(a+j<0n||a+j===0n&&j<0n)?2147483647:0;
}
export function predictT3Axis(ticks:number,axis:AxisParameters,accum:number|'clear'='clear'):{steps:number;accumulator:number;rate:number} {
  integer(ticks,0,4294967295);for(const n of Object.values(axis))integer(n);
  if(ticks===0)return{steps:0,accumulator:typeof accum==='number'?accum:0,rate:axis.rate};
  const t=BigInt(ticks),r=BigInt(axis.rate),a=BigInt(axis.acceleration),j=BigInt(axis.jerk);
  const start=BigInt(accum==='clear'?initialAccumulator(axis):integer(accum,0,2147483647));
  // Equivalent to the ISR recurrence, including signed truncation in pre-adjustment.
  const sum=start+t*(r-a/2n+j/6n)+a*t*(t+1n)/2n+j*t*(t*t-1n)/6n;
  const steps=floorDivide(sum,ACCUMULATOR),remainder=sum-steps*ACCUMULATOR;
  const rate=r-a/2n+j/6n+a*t+j*t*(t-1n)/2n;
  if(steps< -2147483648n||steps>2147483647n||rate< -2147483648n||rate>2147483647n)throw new PlotterError('invalid-plan','EBB prediction exceeds signed range.');
  return{steps:Number(steps),accumulator:Number(remainder),rate:Number(rate)};
}
export function maximumRate(ticks:number,axis:AxisParameters):number {
  const times=[1,ticks];if(axis.jerk){const vertex=.5-axis.acceleration/axis.jerk;for(const t of [Math.floor(vertex),Math.ceil(vertex)])if(t>=1&&t<=ticks)times.push(t);}
  return Math.max(...times.map(t=>Math.abs(predictT3Axis(t,axis,0).rate)));
}
export function validateT3(parameters:T3Parameters):void {
  integer(parameters.ticks,1,4294967295);integer(parameters.clear,0,3);
  for(const axis of [parameters.axis1,parameters.axis2]){
    for(const value of Object.values(axis))integer(value);
    if(maximumRate(parameters.ticks,axis)>2147054150)throw new PlotterError('invalid-plan','T3 step rate exceeds 24995 steps/s.');
    // Acceleration itself is an ISR signed value as well.
    integer(axis.acceleration+(parameters.ticks-1)*axis.jerk);
  }
}
export function encodeT3(p:T3Parameters):string {validateT3(p);return`T3,${p.ticks},${p.axis1.rate},${p.axis1.acceleration},${p.axis1.jerk},${p.axis2.rate},${p.axis2.acceleration},${p.axis2.jerk},${p.clear}`;}
export function encodeTD(a:T3Parameters,b:T3Parameters):string {
  validateT3(a);validateT3(b);
  if(a.ticks!==b.ticks||a.axis1.acceleration||a.axis2.acceleration||b.clear||a.axis1.jerk!==-b.axis1.jerk||a.axis2.jerk!==-b.axis2.jerk)throw new PlotterError('invalid-plan','TD is not equivalent to these T3 halves.');
  return`TD,${a.ticks},${a.axis1.rate},${b.axis1.rate},${b.axis1.acceleration},${a.axis1.jerk},${a.axis2.rate},${b.axis2.rate},${b.axis2.acceleration},${a.axis2.jerk},${a.clear}`;
}

/** Exact TD-axis endpoint from its literal two T3 halves. */
export function predictTDAxis(ticks:number,rate1:number,rate2:number,acceleration:number,jerk:number,accum:number|'clear'='clear'){const first=predictT3Axis(ticks,{rate:rate1,acceleration:0,jerk},accum),second=predictT3Axis(ticks,{rate:rate2,acceleration,jerk:-jerk},first.accumulator);return{steps:first.steps+second.steps,accumulator:second.accumulator,rate:second.rate,ticks:2*ticks};}
