import { DEFAULT_MACHINE_ROTATION, type Point } from './model';
import { compileMotion, MOTION_INTERVAL_MS, type CompiledMotion, type MotionEvent, type MotionPlan } from './motion-plan';
import { validateMotionCommand } from './motion-command';
import { indexPenCounts, type PenCounts } from './plot-signals';
import { penTransition, servoPosition } from './pen-control';

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
  servoPosition(plan.settings.penUp); servoPosition(plan.settings.penDown);
  if (!['axidraw', 'xylodraw'].includes(plan.settings.profile)
    || ![0, 90, 180, 270].includes(plan.settings.machineRotation ?? DEFAULT_MACHINE_ROTATION)
    || ![plan.settings.speed, plan.settings.travelSpeed, plan.settings.drawAcceleration, plan.settings.travelAcceleration].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid plot settings.');
  let steps: Point = { x: 0, y: 0 }, position: Point = { x: 0, y: 0 };
  let penDown = false, time = 0, commands = 0;
  let penHeight: number | null = null;
  const compiled = plan.events.map((event, index): PlotStep => {
    if (!['xy', 'pen', 'tool'].includes(event.kind)
      || ![event.start, event.duration, event.from.x, event.from.y, event.to.x, event.to.y, event.initialSpeed, event.acceleration].every(Number.isFinite)
      || event.duration < 0 || Math.abs(event.start - time) > 1e-6
      || Math.hypot(event.from.x - position.x, event.from.y - position.y) > 1e-6) throw new Error(`Invalid plot event ${index}.`);
    if (event.kind === 'pen') {
      if (Math.hypot(event.to.x - position.x, event.to.y - position.y) > 1e-6) throw new Error('A pen transition must be stationary.');
      const target = event.penDown ? plan.settings.penDown : plan.settings.penUp;
      const minimum = penTransition(penHeight, target, !event.penDown, 0, plan.settings, !event.penDown && !!plan.settings.maxPenDownMm && plan.events[index+1]?.kind === 'pen' && plan.events[index+1]?.penDown === true).duration;
      if (event.duration * 1000 < minimum - 1e-6 || event.duration * 1000 > 65535) throw new Error(`Invalid pen settling time at event ${index}.`);
      penHeight = target;
      penDown = event.penDown;
    } else if (event.penDown !== penDown || event.kind === 'tool' && penDown) {
      throw new Error(`Pen state does not match motion at event ${index}.`);
    }
    if (event.kind === 'xy') {
      const length = Math.hypot(event.to.x - event.from.x, event.to.y - event.from.y);
      const distance = event.initialSpeed * event.duration + .5 * event.acceleration * event.duration ** 2;
      if (event.duration <= 0 || event.initialSpeed < 0 || event.initialSpeed + event.acceleration * event.duration < -1e-6
        || Math.abs(distance - length) > Math.max(1e-5, length * 1e-6)) throw new Error(`Invalid motion rates at event ${index}.`);
    } else if (event.initialSpeed !== 0 || event.acceleration !== 0
      || event.kind === 'tool' && (event.duration !== 0 || Math.hypot(event.to.x, event.to.y) > 1e-6)) throw new Error(`Invalid stationary event ${index}.`);
    if (event.kind === 'xy' && Math.ceil(event.duration * 1000 / MOTION_INTERVAL_MS) + commands > maxCommands) throw new Error('Compiled job exceeds command limit.');
    const moves = compileMotion(event, plan.settings, steps).map(move => {
      validateMotionCommand(move.command);
      steps = move.targetSteps;
      return move;
    });
    commands += moves.length;
    if (commands > maxCommands) throw new Error('Compiled job exceeds command limit.');
    position = event.to; time += event.duration;
    return { index, event, moves };
  });
  if (penDown || Math.abs(time - plan.duration) > 1e-6) throw new Error('The plot must finish with the pen raised and a valid duration.');
  if (plan.settings.returnToOrigin && Math.hypot(position.x, position.y) > 1e-6) throw new Error('The plot must finish at the origin when return to origin is enabled.');
  return { plan, steps: compiled, penCounts: indexPenCounts(plan) };
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
