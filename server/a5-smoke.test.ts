import { describe, expect, it } from 'vitest';
import { initialState } from '../src/model';
import { compileMotion } from '../src/motion-plan';
import { validateMotionCommand } from '../src/motion-command';
import { validateJob } from '../src/network-protocol';
import { a5SmokePlan, a5PerimeterPlan } from './test-fixtures/a5-smoke';

describe('A5 physical smoke-test preparation (no hardware)', () => {
  it.each(['portrait', 'landscape'] as const)('traces the exact A5 %s perimeter and returns to origin', orientation => {
    const plan = a5PerimeterPlan(initialState.settings, orientation);
    const [width, height] = orientation === 'portrait' ? [148, 210] : [210, 148];
    expect(validateJob({ version: 1, requestId: 'a5-perimeter', plan }).plan).toBe(plan);
    expect(plan.passes).toHaveLength(1);
    expect(plan.settings.machineRotation).toBe(initialState.settings.machineRotation);
    expect(plan.settings.penUp).toBe(50); expect(plan.settings.penDown).toBe(60);
    const drawing = plan.events.filter(event => event.kind === 'xy' && event.penDown);
    expect(drawing[0]!.from).toEqual({ x: 0, y: 0 });
    expect(drawing.at(-1)!.to).toEqual({ x: 0, y: 0 });
    let distance = 0;
    for (const event of drawing) {
      for (const p of [event.from, event.to]) {
        expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(width);
        expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(height);
      }
      expect((event.from.x === event.to.x && [0, width].includes(event.from.x)) ||
        (event.from.y === event.to.y && [0, height].includes(event.from.y))).toBe(true);
      distance += Math.hypot(event.to.x - event.from.x, event.to.y - event.from.y);
    }
    expect(distance).toBeCloseTo(716, 6);
    for (const corner of [{ x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }]) {
      expect(drawing.some(event => event.to.x === corner.x && event.to.y === corner.y)).toBe(true);
    }
    for (const lm of [true, false]) {
      let cursor = { x: 0, y: 0 };
      for (const event of plan.events) for (const move of compileMotion(event, plan.settings, cursor, lm)) {
        validateMotionCommand(move.command); cursor = move.targetSteps;
      }
      expect(cursor).toEqual({ x: 0, y: 0 });
    }
  });
  it.each(['axidraw', 'xylodraw'] as const)('keeps the drawing on A5 and preflights both firmware modes for %s', profile => {
    const plan = a5SmokePlan({ ...initialState.settings, profile, penUp: 30, penDown: 45 });
    expect(validateJob({ version: 1, requestId: 'a5-smoke', plan }).plan).toBe(plan);
    expect(plan.passes).toHaveLength(1);
    expect(plan.settings.penUp).toBe(30); expect(plan.settings.penDown).toBe(45);
    expect(plan.settings.returnToOrigin).toBe(true);
    for (const event of plan.events) {
      for (const point of [event.from, event.to]) {
        expect(point.x).toBeGreaterThanOrEqual(0); expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(124); expect(point.y).toBeLessThanOrEqual(124);
        if (event.penDown) { expect(point.x).toBeGreaterThanOrEqual(24); expect(point.y).toBeGreaterThanOrEqual(24); }
      }
    }
    for (const lm of [true, false]) {
      let cursor = { x: 0, y: 0 };
      for (const event of plan.events) for (const move of compileMotion(event, plan.settings, cursor, lm)) {
        validateMotionCommand(move.command); cursor = move.targetSteps;
      }
      expect(cursor).toEqual({ x: 0, y: 0 });
    }
  });
});
