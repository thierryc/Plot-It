import type { Point } from './model';
import { samplePlan, type MotionEvent, type MotionPlan } from './motion-plan';

export interface PenCounts { up: number; down: number }
export interface PlotSignal {
  source: 'simulation' | 'plotter';
  phase: 'started' | 'queued' | 'settled';
  eventIndex: number;
  kind: MotionEvent['kind'];
  planTime: number;
  elapsedMs: number;
  position: Point;
  target: Point;
  penDown: boolean;
  penHeight: number;
  tool: string;
  penCounts: PenCounts;
}

/** Index once; seeking and telemetry never count animation frames as pen moves. */
export function indexPenCounts(plan: MotionPlan): PenCounts[] {
  let up = 0, down = 0;
  return plan.events.map(event => {
    if (event.kind === 'pen') { if (event.penDown) down++; else up++; }
    return { up, down };
  });
}

export function eventSignal(plan: MotionPlan, counts: PenCounts[], eventIndex: number, phase: PlotSignal['phase'], elapsedMs: number): PlotSignal {
  const event = plan.events[eventIndex]!;
  return {
    source: 'plotter', phase, eventIndex, kind: event.kind,
    planTime: event.start + (phase === 'settled' ? event.duration : 0), elapsedMs,
    position: { ...(phase === 'settled' ? event.to : event.from) }, target: { ...event.to },
    penDown: event.penDown, penHeight: event.penDown ? plan.settings.penDown : plan.settings.penUp,
    tool: event.tool, penCounts: { ...counts[eventIndex]! },
  };
}

export function simulationSignal(plan: MotionPlan, counts: PenCounts[], time: number): PlotSignal | null {
  if (!plan.events.length) return null;
  const sample = samplePlan(plan, time);
  const event = plan.events[sample.index]!;
  return {
    source: 'simulation', phase: time >= event.start + event.duration ? 'settled' : 'started',
    eventIndex: sample.index, kind: event.kind, planTime: time, elapsedMs: time * 1000,
    position: { ...sample.position }, target: { ...event.to }, penDown: sample.penDown,
    penHeight: sample.penDown ? plan.settings.penDown : plan.settings.penUp,
    tool: sample.tool, penCounts: { ...counts[sample.index]! },
  };
}
