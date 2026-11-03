// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {initialState} from './model';
import {coreOptions} from './core-settings';
import {serializePlotIt,parsePlotIt} from './document-file';
import {validateSettings,validateJob} from './network-protocol';
import {preparePaths,DEFAULT_WORKLOAD_CHECKPOINTS,digest} from '@thierryc/plotter-core';
import {validateNativePreview} from './native-preview';
describe('workload settings',()=>{
 it('defaults to continuous and ignores stored inactive limits in the core identity',()=>{expect(initialState.settings.workloadMode).toBe('continuous');expect(coreOptions(initialState.settings).workloadCheckpoints).toBeUndefined();expect(coreOptions({...initialState.settings,workloadLimits:{...DEFAULT_WORKLOAD_CHECKPOINTS,maxDrawingMm:25}})).toEqual(coreOptions(initialState.settings));});
 it('round-trips periodic limits and restores continuous in older documents',()=>{const state=structuredClone(initialState);state.settings.workloadMode='periodic';state.settings.workloadLimits={...DEFAULT_WORKLOAD_CHECKPOINTS,maxDrawingMm:25};expect(parsePlotIt(serializePlotIt(state)).state.settings.workloadLimits).toEqual(state.settings.workloadLimits);expect(coreOptions(state.settings).workloadCheckpoints).toEqual(state.settings.workloadLimits);const legacy=JSON.parse(serializePlotIt(state));delete legacy.document.settings.workloadMode;delete legacy.document.settings.workloadLimits;expect(parsePlotIt(JSON.stringify(legacy)).state.settings.workloadMode).toBe('continuous');});
 it.each([{workloadMode:'auto'},{workloadLimits:{maxDrawingRecords:0,maxDrawingMs:10000,maxDrawingMm:250}},{workloadLimits:{maxDrawingRecords:1.5,maxDrawingMs:10000,maxDrawingMm:250}}])('rejects invalid portable settings %j',bad=>{expect(()=>validateSettings({...initialState.settings,...bad})).toThrow(/Invalid|integer/);});
 it('reconstructs SDK checkpoint settings and the exact preview identity',()=>{const settings={...initialState.settings,profile:'xylodraw' as const,machineRotation:0 as const,workloadMode:'periodic' as const,workloadLimits:{...DEFAULT_WORKLOAD_CHECKPOINTS,maxDrawingMm:15}},prepared=preparePaths([{tool:'black',points:[{x:10,y:10},{x:60,y:10}]}],coreOptions(settings)),accepted=validateJob({version:2,requestId:'workload-sdk',prepared});expect(digest(coreOptions(accepted.plan.settings))).toBe(digest(prepared.options));expect(()=>validateNativePreview(accepted.plan)).not.toThrow();expect(accepted.plan.executable?.workloadCheckpoints).toEqual(prepared.program.workloadCheckpoints);});
});
