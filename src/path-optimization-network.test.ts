import { describe, expect, it } from 'vitest';
import { initialState, type PlotSettings } from './model';
import { validateSettings } from './network-protocol';
describe('network optimization settings',()=>{
  it('accepts current controls and legacy plans without optional optimization fields',()=>{
    const settings:PlotSettings={...initialState.settings,pathJoinToleranceMm:.15,pathSimplifyToleranceMm:.01,closedPathStart:'random',pathRandomSeed:0xffffffff};
    expect(validateSettings(settings)).toEqual(settings);
    for (const key of ['pathJoinToleranceMm','pathSimplifyToleranceMm','closedPathStart','pathRandomSeed'] as const) delete settings[key];
    expect(validateSettings(settings)).toEqual(settings);
  });
  it.each([{pathJoinToleranceMm:-1},{pathSimplifyToleranceMm:Infinity},{closedPathStart:'bad'},{pathRandomSeed:-1},{pathRandomSeed:'5'}])('rejects malformed controls (%j)',bad=>{
    expect(()=>validateSettings({...initialState.settings,...bad})).toThrow('Invalid');
  });
});
