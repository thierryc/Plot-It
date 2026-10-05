import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState } from './model';
import { defaultPens } from './pens';
import type { PlotPath } from './svg';
import type { MotionPlan } from './motion-plan';
let worker: { postMessage: ReturnType<typeof vi.fn>; onmessage?: (event: MessageEvent) => void };
const paths: PlotPath[] = [
  { tool: '#000000', points: [{ x: 20, y: 20 }, { x: 25, y: 20 }] },
  { tool: '#FF0000', points: [{ x: 30, y: 20 }, { x: 35, y: 20 }] }
];
beforeEach(async () => {
  vi.resetModules(); worker = { postMessage: vi.fn() }; vi.stubGlobal('self', worker);
  // Import the actual worker entry in a context without document/window.
  await import('./planner.worker');
});
afterEach(() => vi.unstubAllGlobals());
function run(overrides: Record<string, unknown> = {}) {
  worker.postMessage.mockClear();
  worker.onmessage!({ data: { paths, settings: structuredClone(initialState.settings), paper: initialState.paper, preferences: defaultPens(), ...overrides } } as MessageEvent);
  return worker.postMessage.mock.calls.at(-1)![0] as { plan?: MotionPlan; error?: string };
}
describe('actual planner worker entry', () => {
  it('starts without browser DOM globals and returns pen metadata, motion and settled pen boundaries', () => {
    expect(typeof document).toBe('undefined'); const result = run();
    expect(result.error).toBeUndefined(); const plan = result.plan!;
    expect(plan.pens?.map(pen => pen.color)).toEqual(['#000000', '#FF0000']);
    expect(plan.passes.map(pass => pass.tool)).toEqual(['#000000', '#FF0000']); expect(plan.duration).toBeGreaterThan(0);
    const boundary = plan.events[plan.passes[1]!.startEvent]!;
    expect(boundary.kind).toBe('tool'); expect(boundary.from).toEqual({ x: 0, y: 0 }); expect(boundary.penDown).toBe(false);
    expect(worker.postMessage.mock.calls.some(([data]) => data.progress)).toBe(true);
  });
  it('returns explicit validation errors and can process another request afterward', () => {
    expect(run({ settings: { ...initialState.settings, speed: 0 } }).error).toContain('must be positive');
    expect(run().plan?.passes).toHaveLength(2);
  });
  it('returns a zero-motion plan when artwork is genuinely empty or clipped away', () => {
    for (const source of [[], [{ tool: '#000000', points: [{ x: -20, y: -20 }, { x: -10, y: -20 }] }]]) {
      const plan = run({ paths: source }).plan!; expect(plan.events).toEqual([]); expect(plan.passes).toEqual([]); expect(plan.duration).toBe(0);
    }
  });
  it('keeps the discovered palette when every pen is excluded', () => {
    const preferences = defaultPens(); preferences.excluded = ['#000000', '#FF0000'];
    const plan = run({ preferences }).plan!;
    expect(plan.events).toEqual([]); expect(plan.pens).toHaveLength(2); expect(plan.pens!.every(pen => !pen.included)).toBe(true);
  });
});
