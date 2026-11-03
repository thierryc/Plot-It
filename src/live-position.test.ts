import { describe, expect, it } from 'vitest';
import { positionPlanTime } from './live-position';
import { initialState } from './model';
import type { MotionPlan } from './motion-plan';
import { livePlotView } from './live-plot';

const turn = Math.sqrt(10);
const plan: MotionPlan = { passes: [], settings: initialState.settings, duration: turn + 5, events: [
  {kind:'xy',start:0,duration:turn,from:{x:0,y:0},to:{x:10,y:0},initialSpeed:0,acceleration:2,penDown:true,tool:'#111'},
  {kind:'xy',start:turn,duration:5,from:{x:10,y:0},to:{x:0,y:0},initialSpeed:2,acceleration:0,penDown:false,tool:'#111'},
] };

describe('measured position in the live overlay', () => {
  it('uses acceleration to reveal the right amount of the drawing', () => {
    expect(positionPlanTime(plan, {x:5,y:0}, 0, turn)).toBeCloseTo(Math.sqrt(5));
  });
  it('does not jump to a later pass over the same coordinates', () => {
    expect(positionPlanTime(plan, {x:5,y:0}, 0, plan.duration)).toBeCloseTo(Math.sqrt(5));
    expect(positionPlanTime(plan, {x:5,y:0}, turn, plan.duration)).toBeCloseTo(turn + 2.5);
  });
  it('does not reveal unqueued paths or move completed progress backward', () => {
    expect(positionPlanTime(plan, {x:10,y:0}, 0, 1)).toBe(0);
    expect(positionPlanTime(plan, {x:0,y:0}, 2, turn)).toBe(2);
  });
  it('shows measured progress even when all drawing commands were acknowledged', () => {
    const view = livePlotView(plan, {state:'plotting',completed:2,total:2}, false, 1);
    expect(view.percent).toBeLessThan(20); expect(view.time).toBe(1);
    expect(livePlotView(plan, {state:'finished',completed:2,total:2}, true, 1).percent).toBe(100);
  });
  it('skips a 100k settled prefix without reading each earlier event', () => {
    let reads = 0;
    const events = new Proxy([] as MotionPlan['events'], {
      get(_target, key) {
        if (key === 'length') return 100000;
        if (typeof key === 'string' && /^\d+$/.test(key)) {
          reads++;
          const index = Number(key);
          return {kind:'xy', start:index, duration:1, from:{x:index,y:0}, to:{x:index+1,y:0}, initialSpeed:1, acceleration:0, penDown:true, tool:'#111'};
        }
        return undefined;
      },
    });
    expect(positionPlanTime({...plan, events, duration:100000}, {x:99999.5,y:0}, 99999, 100000)).toBeCloseTo(99999.5);
    expect(reads).toBeLessThan(25);
  });

});
