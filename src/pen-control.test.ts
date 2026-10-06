import { describe, expect, it } from 'vitest';
import { PenState, penTransition, servoPosition, servoSetup, PEN_UP_SETTLE_MS, PEN_DOWN_SETTLE_MS } from './pen-control';

describe('calibrated standard servo', () => {
  it('preserves existing physical positions and rejects invalid heights', () => {
    expect([0,30,50,60,100].map(servoPosition)).toEqual([28000,21850,17750,15700,7500]);
    for (const height of [-1,101,NaN,Infinity]) expect(() => servoPosition(height)).toThrow('between 0 and 100');
  });
  it('configures semantic endpoints and independent standard-servo rates', () => {
    expect(servoSetup(20,42)).toEqual(['SC,4,23900','SC,5,19390','SC,11,1845','SC,12,1230','SC,8,8','SC,9,3']);
    expect(servoSetup(42,20)).toEqual(['SC,4,19390','SC,5,23900','SC,11,1845','SC,12,1230','SC,8,8','SC,9,3']);
  });
  it('uses separate lowering and raising timing with explicit SP states', () => {
    const lower=penTransition(20,42,false), raise=penTransition(42,20,true);
    expect(lower.command).toBe(`SP,0,${lower.duration},1`);
    expect(raise.command).toBe(`SP,1,${raise.duration},1`);
    expect(lower.duration).toBeGreaterThan(raise.duration - PEN_UP_SETTLE_MS);
    expect(lower.duration).toBe(116 + PEN_DOWN_SETTLE_MS); expect(raise.duration).toBe(107 + 150);
    expect(lower.hostWaitMs).toBe(lower.duration-30);
    expect(penTransition(20,42,false,500).duration).toBe(500);
  });
  it.each([true,false])('covers both the pulse sweep and modeled mechanical transit (up=%s)', up => {
    for (const distance of [1,10,22,100]) {
      const move=penTransition(0,distance,up);
      expect(move.duration).toBeGreaterThanOrEqual(45+2.69*distance);
      expect(move.duration).toBeGreaterThanOrEqual(200*distance/(up?75:50));
    }
    expect(penTransition(null,50,up).duration).toBe(penTransition(0,100,up).duration);
  });
  it('keeps stationary waits finite and validates the firmware delay bound', () => {
    expect(penTransition(50,50,true)).toEqual({position:17750,duration:151,command:'SP,1,151,1',hostWaitMs:121});
    expect(penTransition(50,50,true,120).duration).toBe(151);
    for (const ms of [-1,NaN,65536]) expect(()=>penTransition(50,60,false,ms)).toThrow('settling time');
  });
  it('adds raise/lower settling once when executing a planned wait', () => {
    const up = penTransition(42,20,true);
    expect(up.duration).toBe(257);
    expect(penTransition(42,20,true,up.duration).duration).toBe(up.duration);
    const down=penTransition(20,42,false);
    expect(down.duration).toBe(116 + PEN_DOWN_SETTLE_MS);
    expect(penTransition(20,42,false,down.duration).duration).toBe(down.duration);
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
