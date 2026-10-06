import type { MotionPlan } from './motion-plan';

export interface PlotStatistics { drawingMm: number; travelMm: number; motionSeconds: number; penUp: number; penDown: number }
/** Distances in the executable, clipped and step-rounded plan, including home travel. */
export function plotStatistics(plan: MotionPlan): PlotStatistics {
  const result: PlotStatistics = { drawingMm: 0, travelMm: 0, motionSeconds: plan.duration, penUp: 0, penDown: 0 };
  for (const event of plan.events) {
    if (event.kind === 'xy') result[event.penDown ? 'drawingMm' : 'travelMm'] += Math.hypot(event.to.x-event.from.x,event.to.y-event.from.y);
    else if (event.kind === 'pen') result[event.penDown ? 'penDown' : 'penUp']++;
  }
  return result;
}
