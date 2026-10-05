import { afterEach, describe, expect, it, vi } from 'vitest';
import { Simulation, type SimulationView } from './simulation';
import { buildMotionPlan } from './motion-plan';
import { initialState } from './model';
const plan = buildMotionPlan([{ tool: '#000000', points: [{x:10,y:10},{x:20,y:10}] }, { tool: '#FF0000', points: [{x:30,y:10},{x:40,y:10}] }, { tool: '#000000', points: [{x:50,y:10},{x:60,y:10}] }], initialState.settings);
function playback() {
  let frame: FrameRequestCallback = () => undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const updates: SimulationView[] = [];
  const player = new Simulation(plan, view => updates.push(view));
  return { player, tick: (time: number) => frame(time), current: () => updates.at(-1)! };
}
afterEach(() => vi.unstubAllGlobals());
describe('shared simulation transport', () => {
  it('waits at every pen change at origin until explicitly continued', () => {
    const { player, tick, current } = playback();
    tick(0); tick(100000);
    expect(current().state).toBe('tool-change'); expect(current().tool).toBe('#FF0000'); expect(current().pass).toBe(1);
    expect(current().time).toBe(plan.passes[1]!.start);
    tick(200000); expect(current().state).toBe('tool-change');
    player.play(); tick(300000); tick(400000);
    expect(current().state).toBe('tool-change'); expect(current().pass).toBe(2);
    player.play(); tick(500000); tick(600000); expect(current().state).toBe('finished');
    player.destroy();
  });
  it('pauses in place, resumes without advancing while paused, and resets on Stop', () => {
    const { player, tick, current } = playback();
    tick(0); tick(100); const time = current().time;
    player.pause(); tick(10000); expect(current().time).toBe(time); expect(current().state).toBe('paused');
    player.play(); tick(11000); tick(11100); expect(current().time).toBeGreaterThan(time);
    player.stop(); expect(current().time).toBe(0); expect(current().state).toBe('stopped');
    player.play(); tick(12000); tick(13000); expect(current().state).not.toBe('stopped'); player.destroy();
  });
  it('scrubs to a paused position and replay resets every pending pen change', () => {
    const { player, tick, current } = playback();
    player.seek(plan.passes[1]!.start + .05); expect(current().state).toBe('paused'); expect(current().pass).toBe(1);
    player.seek(plan.duration); expect(current().state).toBe('finished');
    player.play(); player.setRate(10); tick(0); tick(100000);
    expect(current().state).toBe('tool-change'); expect(current().pass).toBe(1); player.destroy();
  });
});
