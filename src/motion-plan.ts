import type { Point, PlotSettings } from './model';
import type { PlotPath } from './svg';
import { planPolyline } from './trajectory';
import { quantizePoint, roundStepPath, stepPathVertices, profileStepsPerMm } from './motion';
import { COMPILED_MAX_STEP_RATE, COMPILED_MIN_STEP_RATE } from './motion-command';
import type { PlotPen } from './pens';
import { penTransition, servoPosition, penTimingSettings, travelSettlingDelay } from './pen-control';

export interface MotionEvent {
  kind: 'xy' | 'pen' | 'tool'; start: number; duration: number;
  from: Point; to: Point; initialSpeed: number; acceleration: number;
  penDown: boolean; tool: string; width?: number;
  /** Required rest boundary, including simplified short moves that start above zero. */
  stopBefore?: boolean;
}
export interface PenPass { tool: string; start: number; end: number; startEvent: number; endEvent: number }
export interface MotionPlan { events: MotionEvent[]; duration: number; settings: PlotSettings; passes: PenPass[]; pens?: PlotPen[] }
export interface MotionSample { position: Point; speed: number; penDown: boolean; tool: string; index: number; progress: number }
export function buildMotionPlan(paths: PlotPath[], settings: PlotSettings, onProgress?: (fraction: number) => void): MotionPlan {
  penTimingSettings(settings);
  let completed = 0;
  for (const value of [settings.speed, settings.travelSpeed, settings.drawAcceleration, settings.travelAcceleration]) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Speeds and accelerations must be positive.');
  }
  if (!Number.isFinite(settings.cornering) || settings.cornering < 0) throw new Error('Cornering must be non-negative.');
  servoPosition(settings.penUp); servoPosition(settings.penDown);
  const eligible: PlotPath[] = [];
  for (const path of paths) {
    const points = roundStepPath(path.points, settings);
    if (points.length < 2) continue;
    const previous = eligible.at(-1);
    // Preserve protected operations and deliberately requested line breaks.
    if (!settings.maxPenDownMm && previous && !previous.orderGroup && !path.orderGroup && previous.tool === path.tool && previous.width === path.width
      && Math.hypot(previous.points.at(-1)!.x-path.points[0]!.x, previous.points.at(-1)!.y-path.points[0]!.y) < 1e-9) {
      previous.points = [...previous.points, ...path.points.slice(1)];
    } else eligible.push({...path, points:[...path.points]});
  }
  const events: MotionEvent[] = []; const passes: PenPass[] = []; let duration = 0; let cursor = { x: 0, y: 0 }; let tool = ''; let width: number | undefined;
  let penPosition: number | null = null;
  const add = (event: Omit<MotionEvent, 'start'>) => { events.push({ ...event, start: duration }); duration += event.duration; };
  const pen = (down: boolean, reload = false) => {
    const target = down ? settings.penDown : settings.penUp;
    const seconds = penTransition(penPosition, target, !down, 0, settings, reload).duration / 1000; penPosition = target;
    add({ kind: 'pen', duration: seconds, from: cursor, to: cursor, initialSpeed: 0, acceleration: 0, penDown: down, tool });
  };
  const xy = (points: Point[], down: boolean) => {
    const vertices = stepPathVertices(points, settings), clean = vertices.map(vertex => vertex.position);
    if (clean.length < 2) return;
    const maximumVelocity = Math.min(down ? settings.speed : settings.travelSpeed, COMPILED_MAX_STEP_RATE / (Math.SQRT2 * profileStepsPerMm(settings.profile)));
    const motion = planPolyline(clean, { acceleration: down ? settings.drawAcceleration : settings.travelAcceleration, maximumVelocity, cornering: down ? settings.cornering : 0 }, vertices.map(vertex => vertex.requested));
    for (const block of motion) add(normalizeMotionTiming({ ...block, kind: 'xy', penDown: down, tool, width, start: duration }, settings));
    cursor = clean.at(-1)!;
  };
  if (eligible.length) pen(false);
  for (const [pathIndex, path] of eligible.entries()) {
    if (path.points.length < 2) continue;
    if (tool !== path.tool) {
      if (tool) {
        // Pen swaps happen at origin; these moves are shared by preview and execution.
        xy([cursor, { x: 0, y: 0 }], false);
        passes.at(-1)!.end = duration; passes.at(-1)!.endEvent = events.length;
        add({ kind: 'tool', duration: 0, from: cursor, to: cursor, initialSpeed: 0, acceleration: 0, penDown: false, tool: path.tool });
      }
      passes.push({ tool: path.tool, start: duration, end: duration, startEvent: events.length - (tool ? 1 : 0), endEvent: events.length });
    }
    tool = path.tool; width = path.width;
    const target=roundStepPath(path.points,settings)[0]!;
    const travelWait=travelSettlingDelay(Math.hypot(target.x-cursor.x,target.y-cursor.y));
    xy([cursor, path.points[0]!], false);
    if (travelWait) {
      // An ordinary zero-step XM dwell keeps the pen raised at the destination.
      // It is part of the shared timeline and drains before the lowering event.
      add({kind:'xy',duration:travelWait/1000,from:cursor,to:cursor,initialSpeed:0,acceleration:0,penDown:false,tool,stopBefore:true});
    }
    pen(true); xy(path.points, true);
    const next = eligible[pathIndex + 1];
    const nextStart = next && roundStepPath(next.points, settings)[0];
    const reload = !!settings.maxPenDownMm && next?.tool === tool && !!nextStart && Math.hypot(nextStart.x-cursor.x,nextStart.y-cursor.y) < 1e-9;
    pen(false, reload);
    onProgress?.(++completed / eligible.length);
  }
  if (settings.returnToOrigin) xy([cursor, { x: 0, y: 0 }], false);
  if (passes.length) { passes.at(-1)!.end = duration; passes.at(-1)!.endEvent = events.length; }
  return { events, duration, settings: { ...structuredClone(settings), pauseOnToolChange: true }, passes };
}
export function sampleEvent(event: MotionEvent, seconds: number): { position: Point; speed: number } {
  const t = Math.max(0, Math.min(event.duration, seconds));
  const length = Math.hypot(event.to.x-event.from.x, event.to.y-event.from.y);
  const distance = Math.max(0, Math.min(length, event.initialSpeed*t + event.acceleration*t*t/2));
  const f = length ? distance/length : 0;
  return { position: { x: event.from.x+(event.to.x-event.from.x)*f, y: event.from.y+(event.to.y-event.from.y)*f }, speed: event.kind === 'xy' ? Math.max(0,event.initialSpeed+event.acceleration*t) : 0 };
}
export function samplePlan(plan: MotionPlan, time: number): MotionSample {
  const t = Math.max(0,Math.min(plan.duration,time));
  let lo=0, hi=plan.events.length;
  while(lo<hi) { const mid=(lo+hi)>>>1; if(plan.events[mid]!.start<=t) lo=mid+1; else hi=mid; }
  const index=Math.max(0,lo-1), event=plan.events[index];
  if(!event) return {position:{x:0,y:0},speed:0,penDown:false,tool:'',index:0,progress:1};
  return {...sampleEvent(event,t-event.start),penDown:event.penDown,tool:event.tool,index,progress:plan.duration?t/plan.duration:1};
}
export interface CompiledMotion { command: string; targetSteps: Point; durationMs: number }
export const MOTION_INTERVAL_MS = 15;
const MAX_MOTION_INTERVALS = 1_000_000;

/** Put integer timing/rate corrections into the shared plan, including preview. */
export function normalizeMotionTiming(event: MotionEvent, settings: PlotSettings): MotionEvent {
  if (event.kind !== 'xy') return { ...event };
  let result = { ...event };
  for (let attempt = 0; attempt < 20; attempt++) {
    const duration = compileMotion(result, settings, quantizePoint(event.from, settings)).reduce((sum, move) => sum + move.durationMs, 0) / 1000;
    if (Math.abs(duration - result.duration) < 1e-12) return result;
    const ratio = result.duration / duration;
    result = { ...result, duration, initialSpeed: result.initialSpeed * ratio, acceleration: result.acceleration * ratio * ratio };
  }
  throw new Error('Unable to resolve integer motion timing.');
}
/** Documented timed mixed-axis moves; all firmware uses the same command path. */
export function compileMotion(event: MotionEvent, settings: PlotSettings, currentSteps: Point): CompiledMotion[] {
  if (event.kind !== 'xy') return [];
  const result: CompiledMotion[] = [];
  const intervals = Math.max(1, Math.ceil(event.duration * 1000 / MOTION_INTERVAL_MS));
  if (!Number.isFinite(intervals) || intervals > MAX_MOTION_INTERVALS) throw new Error('Compiled job exceeds command limit.');
  // Never speed up a planned ramp just to fit integer milliseconds.
  const totalMs = Math.max(intervals, Math.ceil(event.duration * 1000 - 1e-9));
  let previous = currentSteps, sentMs = 0, pendingMs = 0;
  const append = (targetSteps: Point, durationMs: number) => {
    result.push({ command: `XM,${durationMs},${targetSteps.x - previous.x},${targetSteps.y - previous.y}`, targetSteps, durationMs });
    previous = targetSteps;
  };
  for (let i = 1; i <= intervals; i++) {
    const targetSteps = quantizePoint(i === intervals ? event.to : sampleEvent(event, event.duration * i / intervals).position, settings);
    const until = Math.round(totalMs * i / intervals);
    pendingMs += until - sentMs; sentMs = until;
    const dx = targetSteps.x - previous.x, dy = targetSteps.y - previous.y;
    if (!dx && !dy) continue;
    const motors = [Math.abs(dx + dy), Math.abs(dx - dy)];
    const maximumMs = Math.floor(Math.min(...motors.filter(steps => steps > 0)) * 1000 / COMPILED_MIN_STEP_RATE);
    // Keep slow accumulated movement above the board's minimum native motor rate.
    if (pendingMs > maximumMs) { append(previous, pendingMs - maximumMs); pendingMs = maximumMs; }
    append(targetSteps, Math.max(pendingMs, Math.ceil(Math.max(...motors) * 1000 / COMPILED_MAX_STEP_RATE)));
    pendingMs = 0;
  }
  // Preserve trailing sub-step time without issuing a stream of empty commands.
  if (pendingMs) append(previous, pendingMs);
  return result;
}
