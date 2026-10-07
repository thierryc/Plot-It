import { describe, expect, it, vi } from 'vitest';
import { initialState } from './model';
import { buildMotionPlan } from './motion-plan';
import { PlotterCore } from './plotter-core';
import { supportsHardwareProfile, restoreNextDrawModel } from './machine-profiles';

describe('NextDraw setup and simulation profile', () => {
  it('preserves model choices with a default for old documents', () => {
    for (const model of ['8511','1117','2234']) expect(restoreNextDrawModel(model)).toBe(model);
    expect(restoreNextDrawModel(undefined)).toBe('8511');
    expect(restoreNextDrawModel('unknown')).toBe('8511');
    expect(supportsHardwareProfile('nextdraw')).toBe(true);
    expect(supportsHardwareProfile('axidraw')).toBe(true);
    expect(supportsHardwareProfile('xylodraw')).toBe(true);
  });
  it('prepares CoreXY preview geometry and retains the selected profile', () => {
    const settings = {...initialState.settings, profile:'nextdraw' as const, nextdrawModel:'1117' as const};
    const paths = [{tool:'#000000',points:[{x:15,y:15},{x:25,y:25}]}];
    const preview = buildMotionPlan(paths, settings);
    expect(preview.events.filter(e=>e.kind==='xy').map(e=>[e.from,e.to])).toEqual(buildMotionPlan(paths, initialState.settings).events.filter(e=>e.kind==='xy').map(e=>[e.from,e.to]));
    expect(preview.executable!.options.profile).toMatchObject({servoPin:2,servoMin:5400,servoMax:12600,servoChannels:1});
    expect(preview.settings).toMatchObject({profile:'nextdraw',nextdrawModel:'1117'});
  });
  it('admits the NextDraw profile while still requiring an actual connection before commands', async () => {
    const requestPort = vi.fn();
    const driver = new PlotterCore({supported:true,requestPort});
    const settings = {...initialState.settings,profile:'nextdraw' as const};
    expect(()=>driver.configurePen(settings)).not.toThrow();
    await expect(driver.setOrigin('nextdraw')).rejects.toThrow('Connect');
    await expect(driver.plot(buildMotionPlan([{tool:'#000000',points:[{x:15,y:15},{x:25,y:25}]}],settings))).rejects.toThrow('Connect');
    expect(requestPort).not.toHaveBeenCalled();
  });
});
