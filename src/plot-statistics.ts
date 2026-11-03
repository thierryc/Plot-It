import {sequenceEstimate} from '@thierryc/plotter-core';
import type { MotionPlan } from './motion-plan';

export interface PlotStatistics { drawingMm: number; travelMm: number; motionSeconds: number; penUp: number; penDown: number;aggregateSeconds?:number|null;aggregateDrawingMm?:number|null;aggregateTravelMm?:number|null }
/** Distances in the executable, clipped and step-rounded plan, including home travel. */
export function plotStatistics(plan: MotionPlan): PlotStatistics {
  const result: PlotStatistics = { drawingMm: 0, travelMm: 0, motionSeconds: plan.duration, penUp: 0, penDown: 0 };
  for (const event of plan.events) {
    if (event.kind === 'xy') result[event.penDown ? 'drawingMm' : 'travelMm'] += Math.hypot(event.to.x-event.from.x,event.to.y-event.from.y);
    else if (event.kind === 'pen') result[event.penDown ? 'penDown' : 'penUp']++;
  }
  if(plan.executable&&(plan.settings.copies??1)!==1){const estimate=sequenceEstimate([{id:'drawing',plan:plan.executable}],{copies:plan.settings.copies??1,intervalMs:plan.settings.repeatIntervalMs??0,requireContinue:plan.settings.repeatRequireContinue??false});result.aggregateSeconds=estimate.totalMs===null?null:estimate.totalMs/1000;result.aggregateDrawingMm=estimate.drawingMm;result.aggregateTravelMm=estimate.travelMm;}
  return result;
}
