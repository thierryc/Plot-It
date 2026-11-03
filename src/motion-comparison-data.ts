import type { PlotSettings } from './model';
import { samplePlan, type MotionPlan } from './motion-plan';

/** Dynamic is deliberately opt-in; Auto does not imply the accepted T3 backend. */
export function dynamicUnavailable(settings: PlotSettings, firmware = settings.motionFirmware || '3.1.7'): string {
  if (settings.motionPreference !== 'scurve') return 'Dynamic requires the S-curve (T3) motion backend.';
  if (firmware !== '3.1.7') return 'Dynamic requires EBB firmware 3.1.7.';
  if (settings.drawingMode === 'constant') return 'Dynamic requires Accelerated drawing motion.';
  return '';
}
/** Periodic cuts differ by strategy, so their pen-down spans cannot be paired by index. */
export function motionComparisonUnavailable(settings: PlotSettings, firmware = settings.motionFirmware || '3.1.7'): string {
  return dynamicUnavailable(settings, firmware) || (settings.workloadMode === 'periodic'
    ? 'Motion comparison requires Continuous long strokes: periodic checkpoint positions can differ between strategies.'
    : '');
}
export interface ComparisonPoint { distance: number; time: number; speed: number; x: number; y: number; reason?: string }
export interface ComparisonStroke { points: ComparisonPoint[]; length: number }
export interface ComparisonData { strokes: ComparisonStroke[]; peak: number; penDownSeconds: number; commands: number }
/** Sample the compiled clock, retaining record endpoints for distance/time lookup. */
export function comparisonData(plan: MotionPlan): ComparisonData {
  const strokes: ComparisonStroke[] = [];
  let stroke: ComparisonStroke | undefined, peak = 0, penDownSeconds = 0;
  for (const [index,event] of plan.events.entries()) {
    if (!event.penDown || event.kind !== 'xy') { if (!event.penDown) stroke = undefined; continue; }
    penDownSeconds += event.duration;
    if (!stroke) { stroke = { points: [], length: 0 }; strokes.push(stroke); }
    const record = plan.executable?.records[index];
    const reason = record && 'motionReason' in record && typeof record.motionReason === 'string' ? record.motionReason : event.stopBefore ? 'stop' : undefined;
    // Fixed subdivisions bound work per command and preserve the executable's curve.
    for (let part = 0; part <= 8; part++) {
      const time = event.start + event.duration * part / 8;
      const sample = samplePlan(plan, part === 8 ? Math.max(event.start,time-1e-9) : time);
      const point = part === 8 ? event.to : sample.position;
      const previous = stroke.points.at(-1);
      if (previous) stroke.length += Math.hypot(point.x-previous.x,point.y-previous.y);
      peak = Math.max(peak,sample.speed);
      stroke.points.push({distance:stroke.length,time,speed:sample.speed,x:point.x,y:point.y,...(reason?{reason}:{})});
    }
  }
  return {strokes,peak,penDownSeconds,commands:plan.executable?.records.length??plan.events.length};
}
/** Both graphs seek one physical drawing distance, independently of their clocks. */
export function timeAtDistance(stroke: ComparisonStroke | undefined, distance: number): number {
  if (!stroke?.points.length) return 0;
  const points=stroke.points, target=Math.max(0,Math.min(stroke.length,distance));
  let low=0,high=points.length-1;
  while(low<high){const mid=(low+high)>>>1;if(points[mid]!.distance<target)low=mid+1;else high=mid;}
  const next=points[low]!,previous=points[Math.max(0,low-1)]!;
  const fraction=next.distance===previous.distance?0:(target-previous.distance)/(next.distance-previous.distance);
  return previous.time+(next.time-previous.time)*fraction;
}
export function speedColor(speed: number, maximum: number): string { return `hsl(${240-240*Math.min(1,Math.max(0,speed/(maximum||1)))} 75% 45%)`; }

/** Display-only decimation; distance/time lookup continues to use the full samples. */
export function comparisonDisplayPoints(points: readonly ComparisonPoint[], budget=4000): readonly ComparisonPoint[] {
  if(points.length<=budget)return points;
  const count=Math.max(2,budget);
  return Array.from({length:count},(_,i)=>points[Math.round(i*(points.length-1)/(count-1))]!);
}
