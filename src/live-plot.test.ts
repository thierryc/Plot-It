import { describe, expect, it } from 'vitest';
import { livePlotView } from './live-plot';
import { buildMotionPlan } from './motion-plan';
import { initialState } from './model';
import type { PlotProgress } from './plotter';

const plan = buildMotionPlan([{ points: [{ x: 10, y: 10 }, { x: 30, y: 20 }], tool: '#111' }], initialState.settings);
const progress = (state: PlotProgress['state'], completed = 0): PlotProgress => ({ state, completed, total: plan.events.length });

describe('live plotting panel', () => {
  it('keeps Exit disabled and progress below 100 until execution finishes', () => {
    const view = livePlotView(plan, progress('plotting', plan.events.length), false);
    expect(view.percent).toBe(99);
    expect(view.exitDisabled).toBe(true);
    expect(view.timeLabel).toContain('estimated');
    expect(view.stopDisabled).toBe(false);
  });
  it('offers Resume after pause and Continue for a tool change', () => {
    expect(livePlotView(plan, progress('paused'), false).pauseLabel).toBe('Resume');
    const view = livePlotView(plan, { ...progress('tool-change'), tool: '#ff0000' }, false);
    expect(view.pauseLabel).toBe('Continue'); expect(view.status).toContain('#ff0000');
    expect(view.paused).toBe(true); expect(view.stopDisabled).toBe(false);
  });
  it('disables pause during settling and disables both controls during return', () => {
    expect(livePlotView(plan, progress('pausing'), false).pauseDisabled).toBe(true);
    const view = livePlotView(plan, progress('returning'), false);
    expect(view.status).toBe('Returning to origin');
    expect(view.pauseDisabled).toBe(true); expect(view.stopDisabled).toBe(true);
    expect(view.exitDisabled).toBe(true);
  });
  it('enables Exit only after the controller finishes cleanup', () => {
    expect(livePlotView(plan, progress('stopped'), false).exitDisabled).toBe(true);
    const stopped = livePlotView(plan, progress('stopped', 3), true);
    expect(stopped.status).toContain('Returned to origin'); expect(stopped.exitDisabled).toBe(false);
    expect(stopped.pauseDisabled).toBe(true);
    const finished = livePlotView(plan, progress('finished', plan.events.length), true);
    expect(finished.percent).toBe(100); expect(finished.exitDisabled).toBe(false);
  });
});
