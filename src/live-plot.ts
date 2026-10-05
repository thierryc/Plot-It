import type { Point } from "./model";
import { positionPlanTime } from "./live-position";
import { samplePlan, type MotionPlan } from './motion-plan';
import { PlotOverlay } from './plot-overlay';
import type { PlotProgress } from './plotter';

const clock = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;

export function livePlotView(plan: MotionPlan, progress: PlotProgress, ended: boolean, executedTime?: number) {
  const event = plan.events[Math.max(0, progress.completed - 1)];
  const time = progress.state === "finished" ? plan.duration : executedTime ?? (progress.completed > 0 && event ? event.start + event.duration : 0);
  const paused = progress.state === 'paused' || progress.state === 'tool-change';
  const ending = progress.state === 'stopping' || progress.state === 'returning';
  const sample = samplePlan(plan, time);
  const status = progress.state === 'tool-change' ? `Change pen to ${progress.tool ?? 'next color'}`
    : progress.state === 'paused' ? 'Paused'
    : progress.state === 'pausing' ? 'Pausing…'
    : progress.state === 'stopping' ? 'Stopping…'
    : progress.state === 'returning' ? 'Returning to origin'
    : progress.state === 'stopped' ? 'Stopped · Returned to origin'
    : progress.state === 'finished' ? 'Complete'
    : progress.state === 'cancelled' ? 'Cancelled'
    : sample.penDown ? 'Pen down' : 'Pen up';
  return {
    time, status, paused, ending,
    percent: progress.state === 'finished' ? 100 : Math.min(99, executedTime !== undefined && plan.duration > 0 ? Math.round(time / plan.duration * 100) : progress.total ? Math.round(progress.completed / progress.total * 100) : 0),
    timeLabel: `${clock(time)} / ${clock(plan.duration)} estimated`,
    pauseLabel: progress.state === 'tool-change' ? 'Continue' : paused ? 'Resume' : 'Pause',
    pauseDisabled: ended || ending || progress.state === 'pausing',
    stopDisabled: ended || ending,
    exitDisabled: !ended,
  };
}

/** Position tracking and drawing only; the shared sidebar owns playback controls. */
export class LivePlot {
  private visual: PlotOverlay;
  private progress: PlotProgress;
  private measuredPosition: Point | null = null;
  private executedTime = 0;
  private ended = false;
  constructor(private plan: MotionPlan, paper: SVGSVGElement, private onUpdate: (view: ReturnType<typeof livePlotView>, progress: PlotProgress) => void) {
    this.progress = { completed: 0, total: plan.events.length, state: 'plotting' };
    this.visual = new PlotOverlay(plan, paper);
  }
  observePosition(position: Point): void { this.measuredPosition = position; this.update(this.progress); }
  update(progress: PlotProgress, manualPen?: boolean): void {
    this.progress = progress;
    const returning = progress.state === 'returning' || progress.state === 'stopped';
    const queued = livePlotView(this.plan, progress, this.ended).time;
    if (this.measuredPosition && !returning) this.executedTime = positionPlanTime(this.plan, this.measuredPosition, this.executedTime, queued);
    // A settled pen change is known exactly even without optional position queries.
    if (progress.state === 'tool-change') this.executedTime = queued;
    const view = livePlotView(this.plan, progress, this.ended, this.measuredPosition ? this.executedTime : undefined);
    this.visual.update(view.time, {
      position: returning || progress.state === 'tool-change' ? { x: 0, y: 0 } : this.measuredPosition ?? undefined,
      penDown: returning || view.paused ? manualPen ?? false : manualPen,
    });
    this.onUpdate(view, progress);
  }
  finish(): void { this.ended = true; this.update(this.progress); }
  destroy(): void { this.visual.destroy(); }
}
