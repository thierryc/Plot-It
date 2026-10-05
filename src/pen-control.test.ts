import { describe, expect, it } from 'vitest';
import { PenState, penTransition, servoPosition } from './pen-control';

describe('calibrated standard servo', () => {
  it('preserves existing physical positions and rejects invalid heights', () => {
    expect([0,30,50,60,100].map(servoPosition)).toEqual([28000,21850,17750,15700,7500]);
    for (const height of [-1,101,NaN,Infinity]) expect(() => servoPosition(height)).toThrow('between 0 and 100');
  });
  it('uses controlled rates and sufficient PWM periods, including an unknown starting height', () => {
    const lower = penTransition(50,60), raise = penTransition(60,50), full = penTransition(100,0);
    expect(lower.rate).toBe(1230); expect(raise.rate).toBe(1845);
    expect(lower.duration).toBe(120); expect(raise.duration).toBe(120);
    expect(full.duration).toBeGreaterThan(120);
    expect(full.duration).toBeGreaterThanOrEqual((Math.ceil(20500/full.rate)+1)*24);
    expect(penTransition(null,50).duration).toBe(432);
    expect(penTransition(50,50,0).duration).toBe(0);
  });
  it('keeps requested, acknowledged and settled targets distinct', () => {
    const state = new PenState(); state.requested = 60;
    expect(state.current(0)).toBeNull(); state.accept(60,0);
    expect(state.current(0)).toBe(60); expect(state.settled).toBeNull();
    state.settle(); expect(state.settled).toBe(60);
    state.invalidate(); expect([state.requested,state.acknowledged,state.settled]).toEqual([null,null,null]);
  });
  it('expires idle knowledge after servo power-off and preserves it while job power is held', () => {
    const state = new PenState(); state.accept(50,1000);
    expect(state.current(60_999)).toBe(50); expect(state.current(61_000)).toBeNull();
    state.accept(50,1000); state.powerHeld = true;
    expect(state.current(121_000)).toBe(50);
    state.powerHeld = false; expect(state.current(121_000)).toBeNull();
  });
  it('invalidates knowledge only when valid calibration changes', () => {
    const state = new PenState(); state.accept(50,0);
    expect(state.configure({penUp:50,penDown:60})).toBe(false); expect(state.current(1)).toBe(50);
    expect(() => state.configure({penUp:101,penDown:60})).toThrow(); expect(state.up).toBe(50);
    expect(state.configure({penUp:30,penDown:60})).toBe(true); expect(state.current(1)).toBeNull();
  });
});
