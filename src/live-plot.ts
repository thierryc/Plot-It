import type { Point } from "./model";
import { positionPlanTime } from "./live-position";
import { samplePlan, type MotionPlan } from './motion-plan';
import { PlotOverlay } from './plot-overlay';
import type { PlotProgress } from './plotter';
import type { PlotSignal } from './plot-signals';

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
    time, status, paused, ending, penDown: sample.penDown,
    penState: 'unknown' as 'unknown' | 'up' | 'down',
    requestedPenDown: undefined as boolean | undefined, acceptedPenDown: undefined as boolean | undefined,
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
  private confirmedPenDown: boolean | undefined;
  private requestedPenDown: boolean | undefined;
  private acceptedPenDown: boolean | undefined;
  private frame: number | null = null;
  private sidebarTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSidebar = -Infinity;
  private forceSidebar = false;
  private destroyed = false;
  private hasSignals = false;
  constructor(private plan: MotionPlan, paper: SVGSVGElement, private onUpdate: (view: ReturnType<typeof livePlotView>, progress: PlotProgress) => void) {
    this.progress = { completed: 0, total: plan.events.length, state: 'plotting' };
    this.visual = new PlotOverlay(plan, paper);
  }
  observePosition(position: Point): void { this.measuredPosition = position; this.schedule(); }
  observeSignal(signal: PlotSignal): void {
    this.hasSignals = true;
    if (signal.penState !== undefined) this.confirmedPenDown = signal.penState === 'unknown' ? undefined : signal.penState === 'down';
    if (signal.requestedPenDown !== undefined) this.requestedPenDown = signal.requestedPenDown;
    if (signal.acceptedPenDown !== undefined) this.acceptedPenDown = signal.acceptedPenDown;
    if (signal.kind === 'pen') {
      if (signal.phase === 'started') this.requestedPenDown = signal.penDown;
      if (signal.phase === 'queued') this.acceptedPenDown = signal.penDown;
    }
    if (signal.phase === 'settled' && signal.penState !== 'unknown') {
      this.executedTime = Math.max(this.executedTime, signal.planTime);
      if (signal.penState === undefined) this.confirmedPenDown = signal.penDown;
    }
    this.schedule();
  }
  update(progress: PlotProgress, manualPen?: boolean): void {
    if (progress.state !== this.progress.state) this.forceSidebar = true;
    this.progress = progress;
    if (manualPen !== undefined) this.confirmedPenDown = manualPen;
    if (progress.state === 'cancelled') this.confirmedPenDown = undefined;
    this.schedule();
  }
  private schedule(): void {
    if (!this.destroyed && this.frame === null) this.frame = requestAnimationFrame(time => {
      this.frame = null;
      this.render(time);
    });
  }
  private render(now: number): void {
    const progress = this.progress;
    const returning = progress.state === 'returning' || progress.state === 'stopped';
    const queued = progress.state === 'finished' ? this.plan.duration : progress.completed > 0
      ? (() => { const event = this.plan.events[progress.completed - 1]; return event ? event.start + event.duration : 0; })() : 0;
    if (this.measuredPosition && !returning) this.executedTime = positionPlanTime(this.plan, this.measuredPosition, this.executedTime, queued);
    if (progress.state === 'tool-change') this.executedTime = queued;
    const view = livePlotView(this.plan, progress, this.ended, this.measuredPosition || this.hasSignals ? this.executedTime : undefined);
    view.penState = this.confirmedPenDown === undefined ? 'unknown' : this.confirmedPenDown ? 'down' : 'up';
    view.requestedPenDown = this.requestedPenDown;
    view.acceptedPenDown = this.acceptedPenDown;
    view.penDown = this.confirmedPenDown ?? false;
    if (progress.state === 'cancelled') view.status = 'Cancelled · Pen state unknown';
    else if (progress.state === 'plotting') view.status = this.requestedPenDown !== undefined && this.requestedPenDown !== this.confirmedPenDown
      ? `Pen ${this.requestedPenDown ? 'down' : 'up'} requested · awaiting confirmation`
      : this.confirmedPenDown === undefined ? 'Pen state unknown' : this.confirmedPenDown ? 'Pen down' : 'Pen up';
    this.visual.update(view.time, {
      position: returning || progress.state === 'tool-change' ? { x: 0, y: 0 } : this.measuredPosition ?? undefined,
      penDown: view.penDown,
    });
    if (this.forceSidebar || now - this.lastSidebar >= 100) {
      this.forceSidebar = false;
      this.lastSidebar = now;
      if (this.sidebarTimer !== null) clearTimeout(this.sidebarTimer);
      this.sidebarTimer = null;
      this.onUpdate(view, progress);
    } else if (this.sidebarTimer === null) {
      this.sidebarTimer = setTimeout(() => { this.sidebarTimer = null; this.schedule(); }, 100 - (now - this.lastSidebar));
    }
  }
  finish(): void { this.ended = true; this.forceSidebar = true; this.schedule(); }
  destroy(): void {
    this.destroyed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.sidebarTimer !== null) clearTimeout(this.sidebarTimer);
    this.visual.destroy();
  }
}
