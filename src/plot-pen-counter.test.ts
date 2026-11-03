// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { PlotPenCounter } from './plot-pen-counter';
import { buildMotionPlan } from './motion-plan';
import { initialState } from './model';
import { indexPenCounts, simulationSignal } from './plot-signals';

describe('pen counter above the paper', () => {
  it('counts planned transitions on seek, never frames, and leaves plotted artwork untouched', () => {
    const frame = document.createElement('div');
    frame.innerHTML = '<svg><g id="artwork-layer"/></svg>';
    const paper = frame.querySelector('svg')!;
    const before = paper.innerHTML, counter = new PlotPenCounter(paper);
    const plan = buildMotionPlan([
      { tool: '#000000', points: [{ x: 10, y: 10 }, { x: 20, y: 10 }] },
      { tool: '#000000', points: [{ x: 40, y: 10 }, { x: 50, y: 10 }] },
    ], { ...initialState.settings, returnToOrigin: false });
    const counts = indexPenCounts(plan), down = plan.events.find(event => event.kind === 'pen' && event.penDown)!;
    for (let i = 0; i < 100; i++) counter.update(simulationSignal(plan, counts, down.start), true);
    expect(frame.querySelector('[data-pen-up-count]')!.textContent).toBe('1');
    expect(frame.querySelector('[data-pen-down-count]')!.textContent).toBe('1');
    expect(frame.querySelector('[data-pen-position]')!.textContent).toContain('X 10.00 · Y 10.00');
    counter.update(simulationSignal(plan, counts, plan.duration), true);
    expect(frame.querySelector('[data-pen-up-count]')!.textContent).toBe('3');
    expect(frame.querySelector('[data-pen-down-count]')!.textContent).toBe('2');
    counter.update(simulationSignal(plan, counts, down.start), true);
    expect(frame.querySelector('[data-pen-down-count]')!.textContent).toBe('1');
    counter.update(null, true);
    expect(frame.querySelector('[data-pen-down-count]')!.textContent).toBe('0');
    expect(paper.innerHTML).toBe(before);
    expect(paper.querySelector('[data-plot-pen-counter]')).toBeNull();
    counter.destroy(); expect(frame.querySelector('[data-plot-pen-counter]')).toBeNull();
  });
});
