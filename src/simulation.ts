import {copyBoundary,validateRepeat,withRaisedReturn,variedCopy} from '@thierryc/plotter-core';
import {motionPlanFromProgram} from './motion-plan';
import { samplePlan, type MotionPlan } from './motion-plan';
import { eventSignal, indexPenCounts, simulationSignal, type PenCounts, type PlotSignal } from './plot-signals';

export interface SimulationView { time: number; state: 'running' | 'paused' | 'tool-change' | 'finished' | 'stopped'; speed: number; tool: string; pass: number; signal: PlotSignal | null;copy?:number;copies?:number|'continuous';remainingMs?:number;nextAction?:'delay'|'continue';plan?:MotionPlan;label?:string;pauseReason?:'tool'|'layer' }
/** Playback only. The Plot workspace owns the canvas and all controls. */
export class Simulation {
  private time = 0;private copy=1;private gapMs:number|null=null;private copyGate=false;private base:MotionPlan;
  private repeat:import('@thierryc/plotter-core').RepeatSettings;
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
    this.base=plan;this.repeat={copies:plan.settings.copies??1,intervalMs:plan.settings.repeatIntervalMs??0,requireContinue:plan.settings.repeatRequireContinue??false};validateRepeat(this.repeat);this.setCopyPlan();
    this.counts = indexPenCounts(this.plan);
    this.stops = this.plan.events.flatMap((event, index) => event.kind === 'tool' ? [index] : []);
    this.update(); this.frame = requestAnimationFrame(this.tick);
  }
  private setCopyPlan():void{let program=this.base.executable;if(this.base.settings.varyClosedStarts&&program)program=variedCopy(this.base.sourcePaths??[],program.options,this.copy,this.base.settings.pathRandomSeed,this.base.layers,this.base.settings.startAtMm);if(program&&copyBoundary(this.repeat,this.copy).more)program=withRaisedReturn(program);this.plan=program?motionPlanFromProgram(program,{...this.base.settings,returnToOrigin:program.options.returnToOrigin},this.base.sourcePaths,this.base.layers):this.base;}
  private nextCopy():void{this.copy++;this.time=0;this.gapMs=null;this.copyGate=false;this.passedTools.clear();this.waiting=null;this.entered=this.settled=-1;this.setCopyPlan();this.counts=indexPenCounts(this.plan);this.stops=this.plan.events.flatMap((e,i)=>e.kind==='tool'?[i]:[]);this.state='running';this.last=null;}
  play(): void {
    if(this.copyGate){this.nextCopy();this.update();return;}
    if (this.state === 'finished' || this.state === 'stopped') { this.copy=1;this.gapMs=null;this.copyGate=false;this.setCopyPlan();this.counts=indexPenCounts(this.plan);this.stops=this.plan.events.flatMap((e,i)=>e.kind==='tool'?[i]:[]);this.time = 0; this.passedTools.clear(); this.entered = this.settled = -1; }
    if (this.waiting !== null) { this.passedTools.add(this.waiting); this.waiting = null; }
    this.state = 'running'; this.last = null; this.update();
  }
  pause(): void { if (this.state !== 'running') return; this.state = 'paused'; this.last = null; this.update(); }
  stop(): void { this.gapMs=null;this.copyGate=false;this.time = 0; this.waiting = null; this.passedTools.clear(); this.entered = this.settled = -1; this.state = 'stopped'; this.last = null; this.update(); }
  setRate(rate: number): void { if ([1, 2, 5, 10].includes(rate)) { this.rate = rate; this.last = null; } }
  seek(time: number): void {
    this.gapMs=null;this.copyGate=false;this.time = Math.max(0, Math.min(this.plan.duration, time));
    this.waiting = null; this.state = this.time === this.plan.duration ? 'finished' : 'paused';
    this.passedTools = new Set(this.stops.filter(index => this.plan.events[index]!.start <= this.time));
    this.last = null; this.update();
  }
  private tick = (now: number): void => {
    if (this.state === 'running') {
      const elapsed=this.last===null?0:(now-this.last)*this.rate;
      if(this.gapMs!==null){this.gapMs=Math.max(0,this.gapMs-elapsed);if(this.gapMs===0){if(this.repeat.requireContinue){this.copyGate=true;this.state='tool-change';}else this.nextCopy();}this.update();this.last=now;this.frame=requestAnimationFrame(this.tick);return;}
      const next = Math.min(this.plan.duration, this.time + (this.last === null ? 0 : (now - this.last) / 1000 * this.rate));
      const stop = this.stops.find(index => this.plan.events[index]!.start >= this.time && this.plan.events[index]!.start <= next && !this.passedTools.has(index));
      if (stop !== undefined) { this.waiting = stop; this.time = this.plan.events[stop]!.start; this.state = 'tool-change'; }
      else { this.time = next; if(this.time>=this.plan.duration){const boundary=copyBoundary(this.repeat,this.copy);if(boundary.more){this.gapMs=boundary.intervalMs;if(this.gapMs===0){if(boundary.requireContinue){this.copyGate=true;this.state='tool-change';}else{this.update();this.nextCopy();}}}else this.state='finished';} }
      this.update();
    }
    this.last = now; this.frame = requestAnimationFrame(this.tick);
  };
  private update(): void {
    const sample = samplePlan(this.plan, this.time);
    // Emit every crossed event, even when a fast frame skips whole strokes.
    if (this.state !== 'stopped') {
      if (sample.index < this.settled && this.time+1e-8 < this.plan.events[this.settled]!.start) this.entered = this.settled = sample.index - 1;
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
    this.onUpdate({...(this.waiting!==null?{label:this.plan.events[this.waiting]?.label,pauseReason:this.plan.executable?.records[this.waiting]?.kind==='pause'?'layer' as const:'tool' as const}:{}),...(this.repeat.copies!==1?{copy:this.copy,copies:this.repeat.copies,remainingMs:this.gapMs??0,nextAction:this.copyGate?'continue' as const:this.gapMs!==null?'delay' as const:undefined,plan:this.plan}:{}),time: this.time, state: this.state, speed: this.state === 'running' ? sample.speed : 0, tool: this.plan.passes[pass]?.tool ?? '', pass,
      signal: this.state === 'stopped' ? null : simulationSignal(this.plan, this.counts, this.time) });
  }
  destroy(): void { cancelAnimationFrame(this.frame); }
}
