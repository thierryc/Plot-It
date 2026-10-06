import { samplePlan, type MotionPlan } from './motion-plan';
import { eventSignal, indexPenCounts, simulationSignal, type PenCounts, type PlotSignal } from './plot-signals';

export interface SimulationView { time: number; state: 'running' | 'paused' | 'tool-change' | 'finished' | 'stopped'; speed: number; tool: string; pass: number; signal: PlotSignal | null }
/** Playback only. The Plot workspace owns the canvas and all controls. */
export class Simulation {
  private time = 0;
  private rate = 1;
  private state: SimulationView['state'] = 'running';
  private frame = 0;
  private last: number | null = null;
  private passedTools = new Set<number>();
  private waiting: number | null = null;
  private stops: number[];
  private counts: PenCounts[];
  private entered = -1;
  private settled = -1;
  constructor(private plan: MotionPlan, private onUpdate: (view: SimulationView) => void, private onSignal: (signal: PlotSignal) => void = () => {}) {
    this.counts = indexPenCounts(plan);
    this.stops = plan.events.flatMap((event, index) => event.kind === 'tool' ? [index] : []);
    this.update(); this.frame = requestAnimationFrame(this.tick);
  }
  play(): void {
    if (this.state === 'finished' || this.state === 'stopped') { this.time = 0; this.passedTools.clear(); this.entered = this.settled = -1; }
    if (this.waiting !== null) { this.passedTools.add(this.waiting); this.waiting = null; }
    this.state = 'running'; this.last = null; this.update();
  }
  pause(): void { if (this.state !== 'running') return; this.state = 'paused'; this.last = null; this.update(); }
  stop(): void { this.time = 0; this.waiting = null; this.passedTools.clear(); this.entered = this.settled = -1; this.state = 'stopped'; this.last = null; this.update(); }
  setRate(rate: number): void { if ([1, 2, 5, 10].includes(rate)) { this.rate = rate; this.last = null; } }
  seek(time: number): void {
    this.time = Math.max(0, Math.min(this.plan.duration, time));
    this.waiting = null; this.state = this.time === this.plan.duration ? 'finished' : 'paused';
    this.passedTools = new Set(this.stops.filter(index => this.plan.events[index]!.start <= this.time));
    this.last = null; this.update();
  }
  private tick = (now: number): void => {
    if (this.state === 'running') {
      const next = Math.min(this.plan.duration, this.time + (this.last === null ? 0 : (now - this.last) / 1000 * this.rate));
      const stop = this.stops.find(index => this.plan.events[index]!.start >= this.time && this.plan.events[index]!.start <= next && !this.passedTools.has(index));
      if (stop !== undefined) { this.waiting = stop; this.time = this.plan.events[stop]!.start; this.state = 'tool-change'; }
      else { this.time = next; if (this.time >= this.plan.duration) this.state = 'finished'; }
      this.update();
    }
    this.last = now; this.frame = requestAnimationFrame(this.tick);
  };
  private update(): void {
    const sample = samplePlan(this.plan, this.time);
    // Emit every crossed event, even when a fast frame skips whole strokes.
    if (this.state !== 'stopped') {
      if (sample.index < this.settled) this.entered = this.settled = sample.index - 1;
      while (this.settled + 1 < this.plan.events.length) {
        const index = this.settled + 1, event = this.plan.events[index]!;
        if (event.start > this.time) break;
        const emit = (phase: 'started' | 'settled') => {
          const signal = eventSignal(this.plan, this.counts, index, phase, (event.start + (phase === 'settled' ? event.duration : 0)) * 1000);
          this.onSignal({ ...signal, source: 'simulation' });
        };
        if (this.entered !== index) { emit('started'); this.entered = index; }
        if (event.start + event.duration > this.time) break;
        if (event.kind === 'tool' && this.waiting === index) break;
        emit('settled'); this.settled = index;
      }
    }
    const pass = this.plan.passes.reduce((current, pass, index) => pass.start <= this.time ? index : current, 0);
    this.onUpdate({ time: this.time, state: this.state, speed: this.state === 'running' ? sample.speed : 0, tool: this.plan.passes[pass]?.tool ?? '', pass,
      signal: this.state === 'stopped' ? null : simulationSignal(this.plan, this.counts, this.time) });
  }
  destroy(): void { cancelAnimationFrame(this.frame); }
}
