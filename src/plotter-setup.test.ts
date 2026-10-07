import { describe, expect, it } from 'vitest';
import { initialState } from './model';
import { machinePoint } from './motion';
import { buildMotionPlan, compileMotion } from './motion-plan';
import { PLOTTER_POSITIONS, setupAngle, setupArmRetracted, setupPen, setupSize } from './plotter-setup';

describe('physical setup preview', () => {
  it.each(PLOTTER_POSITIONS)('keeps the moving arm on the pen with $label', ({ rotation }) => {
    const settings = { ...initialState.settings, machineRotation: rotation };
    const position = { x: -17, y: 31 };
    const local = setupPen(position, settings);
    const angle = ((setupAngle(settings) + 360) % 360) as typeof rotation;
    expect(machinePoint(local, angle)).toEqual(position);
    expect(setupPen({ x: 0, y: 0 }, settings)).toEqual({ x: 0, y: 0 });
  });
  it.each(PLOTTER_POSITIONS)('retracts at origin only for top/left placement: $label', ({ rotation }) => {
    const settings = { ...initialState.settings, machineRotation: rotation };
    expect(setupArmRetracted(settings)).toBe(rotation === 180 || rotation === 270);
  });
  it('preserves the existing default direction and uses overall model dimensions', () => {
    expect(setupAngle(initialState.settings)).toBe(0);
    expect(setupSize(initialState.settings)).toEqual({ width: 406.4, height: 546.1 });
    expect(setupSize({ ...initialState.settings, axidrawModel: 'v3-a3' })).toEqual({ width: 469.9, height: 660.4 });
    expect(setupSize({ ...initialState.settings, profile: 'xylodraw' })).toEqual({ width: 558.8, height: 635 });
  });
  it('changes the decorative model without changing planned or compiled motion', () => {
    const paths = [{ tool: '#000000', points: [{ x: 15, y: 20 }, { x: 40, y: 50 }] }];
    const a4 = buildMotionPlan(paths, initialState.settings);
    const a3 = buildMotionPlan(paths, { ...initialState.settings, axidrawModel: 'v3-a3' });
    expect(a3.events).toEqual(a4.events);
    expect(a3.duration).toBe(a4.duration);
    const event = a4.events.find(event => event.kind === 'xy')!;
    expect(compileMotion(event, a3.settings, { x: 0, y: 0 }))
      .toEqual(compileMotion(event, a4.settings, { x: 0, y: 0 }));
  });
});
