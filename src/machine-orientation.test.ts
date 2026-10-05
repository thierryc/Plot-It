import { describe, expect, it } from 'vitest';
import { initialState, type PlotSettings } from './model';
import { canvasPoint, machinePoint, restoreMachineOrientation, MACHINE_ORIENTATIONS } from './motion';
import { buildMotionPlan, compileMotion } from './motion-plan';

describe('standard machine orientation', () => {
  it('uses the confirmed clockwise mapping without changing the canvas axes', () => {
    expect(initialState.settings.machineRotation).toBe(90);
    expect(machinePoint({x:10,y:0})).toEqual({x:0,y:10});
    expect(machinePoint({x:0,y:10})).toEqual({x:-10,y:0});
    expect(canvasPoint({x:-10,y:20})).toEqual({x:20,y:10});
    expect(MACHINE_ORIENTATIONS.map(option => option.rotation)).toEqual([90,180,270,0]);
    expect(MACHINE_ORIENTATIONS[0].label).toBe('Standard');
  });

  it.each(['axidraw', 'xylodraw'] as const)('uses Standard for both axes and firmware paths on %s', profile => {
    const scale = profile === 'axidraw' ? 40 : 50;
    for (const [to, expected] of [
      [{x:10,y:0}, {x:0,y:10*scale}],
      [{x:0,y:10}, {x:-10*scale,y:0}],
    ]) for (const lm of [true, false]) {
      const settings: PlotSettings = {...initialState.settings,profile,returnToOrigin:false};
      delete settings.machineRotation; // Missing settings also use the new standard.
      const plan = buildMotionPlan([{points:[{x:0,y:0},to!],tool:'#000000'}], settings);
      let cursor = {x:0,y:0}, motor1 = 0, motor2 = 0;
      for (const event of plan.events) for (const move of compileMotion(event,settings,cursor,lm)) {
        const values = move.command.split(',').map(Number);
        motor1 += lm ? values[2]! : values[2]! + values[3]!;
        motor2 += lm ? values[5]! : values[2]! - values[3]!;
        cursor = move.targetSteps;
      }
      expect(cursor).toEqual(expected);
      expect({x:(motor1+motor2)/2,y:(motor1-motor2)/2}).toEqual(expected);
    }
  });

  it.each([undefined, {}, {machineRotation:0}, {machineRotation:45}, {machineRotation:'90'}])('upgrades absent, old Standard, or invalid saved settings: %j', saved => {
    expect(restoreMachineOrientation(saved)).toEqual({machineRotation:90,machineOrientationVersion:2});
  });

  it.each([90,180,270])('retains an existing explicit %s-degree correction', rotation => {
    expect(restoreMachineOrientation({machineRotation:rotation}).machineRotation).toBe(rotation);
  });

  it.each([0,90,180,270])('restores a new %s-degree choice without applying the standard twice', rotation => {
    const saved = {machineRotation:rotation,machineOrientationVersion:2};
    expect(restoreMachineOrientation(saved)).toEqual(saved);
    expect(restoreMachineOrientation(restoreMachineOrientation(saved))).toEqual(saved);
  });
});
