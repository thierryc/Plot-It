import {validateNativePreview} from './native-preview';
import {motorCommand} from '@thierryc/plotter-core';
import { type CompiledMotion, type MotionEvent, type MotionPlan } from './motion-plan';
import { indexPenCounts, type PenCounts } from './plot-signals';

export interface PlotStep {
  index: number;
  event: MotionEvent;
  moves: Array<CompiledMotion & { durationMs: number }>;
}
export interface PlotProcess { plan: MotionPlan; steps: PlotStep[]; penCounts: PenCounts[] }

/** Both USB adapters execute this validated snapshot, compiled before hardware moves. */
export function compilePlotProcess(input: MotionPlan, maxCommands = 1_000_000): PlotProcess {
  if (!input.passes.length || !input.events.length) throw new Error('There are no paths to plot.');
  const plan = structuredClone(input);
  // Physical pen adjustment can leave its height different from cached state.
  // Require a real, stationary lift before any travel or drawing from origin.
  if (plan.events[0]!.kind !== 'pen' || plan.events[0]!.penDown) throw new Error('The plot must start by raising the pen at the origin.');
  if(plan.executable){const program=validateNativePreview(plan);if(program.records.length>maxCommands)throw new Error('Compiled job exceeds command limit.');return{plan,steps:program.records.map((r,index)=>({index,event:plan.events[index]!,moves:r.kind==='motor'?[{command:motorCommand(r),targetSteps:{x:(r.toSteps.m1+r.toSteps.m2)/2,y:(r.toSteps.m1-r.toSteps.m2)/2},durationMs:r.durationMs}]:[]})),penCounts:indexPenCounts(plan)};}
  throw new Error('Legacy event-only plans must be prepared again from source geometry.');
}

export interface PlotProcessIO {
  waitUntilIdle(): Promise<void>;
  /** Pause and graceful stop are serviced only where planned velocity is zero. */
  boundary(step: PlotStep): Promise<boolean>;
  cancelled(): boolean;
  changeTool(tool: string): Promise<void>;
  movePen(down: boolean, durationMs: number): Promise<void>;
  moveXY(move: PlotStep['moves'][number], step: PlotStep): Promise<void>;
  signal(step: PlotStep, phase: 'started' | 'queued' | 'settled'): void;
  progress(completed: number): void;
}

/** Queue continuous XY blocks together; every pen change has barriers on both sides. */
export async function executePlotProcess(process: PlotProcess, io: PlotProcessIO): Promise<number> {
  const pending: PlotStep[] = [];
  const settle = async () => {
    await io.waitUntilIdle();
    for (const step of pending.splice(0)) io.signal(step, 'settled');
  };
  let completed = 0;
  for (const step of process.steps) {
    const { event } = step;
    if (event.kind !== 'xy' || event.stopBefore || event.initialSpeed < 1e-9) {
      await settle();
      if (!await io.boundary(step)) break;
    }
    if (io.cancelled()) break;
    io.signal(step, 'started');
    if (event.kind === 'tool') await io.changeTool(event.tool);
    else if (event.kind === 'pen') await io.movePen(event.penDown, Math.round(event.duration * 1000));
    else for (const move of step.moves) {
      if (io.cancelled()) break;
      await io.moveXY(move, step);
    }
    if (io.cancelled()) break;
    io.signal(step, 'queued'); pending.push(step);
    if (event.kind !== 'xy') await settle();
    completed = step.index + 1; io.progress(completed);
  }
  if (!io.cancelled()) await settle();
  return completed;
}
