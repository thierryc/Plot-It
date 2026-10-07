import {planStroke} from '@thierryc/plotter-core';
import type {Point} from './model';
export interface TrajectoryOptions {acceleration:number;maximumVelocity:number;cornering:number}
export interface TrajectoryBlock {from:Point;to:Point;duration:number;initialSpeed:number;acceleration:number;stopBefore?:boolean}
export const SHORT_MOVE_SLICE_SECONDS=.025;
/** Compatibility types only; planning belongs to the fresh platform-neutral core. */
export function planPolyline(input:Point[],options:TrajectoryOptions,_directions:Point[]=input):TrajectoryBlock[]{
  return planStroke(input,options.maximumVelocity,options.acceleration,options.cornering).map(p=>({...p,stopBefore:p.restBefore}));
}
export function planSegment(from:Point,to:Point,entry:number,exit:number,options:TrajectoryOptions):TrajectoryBlock[]{
  return planStroke([from,to],options.maximumVelocity,options.acceleration,options.cornering,false,entry,exit).map(p=>({...p,stopBefore:p.restBefore}));
}
