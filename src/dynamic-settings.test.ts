// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {coreOptions} from './core-settings';
import {initialState} from './model';
import {parsePlotIt,serializePlotIt} from './document-file';
import {validateJob,validateSettings} from './network-protocol';
import {updateWorkspaceSetting} from './workspace-settings';
import {Plotter} from './plotter';
import {buildMotionPlan} from './motion-plan';
import {validateNativePreview} from './native-preview';
import {preparePaths,digest} from '@thierryc/plotter-core';

const configured={...initialState.settings,profile:'xylodraw' as const,motionPreference:'scurve' as const,motionFirmware:'3.1.7',drawingMode:'profiled' as const,machineRotation:0 as const};
const paths=[{tool:'#000000',points:[{x:10,y:10},{x:30,y:10},{x:35,y:15}]}];

describe('Dynamic settings and portable admission',()=>{
  it('keeps Standard core options unchanged even when Dynamic tuning is saved',()=>{
    const implicit={...configured};delete implicit.motionStrategy;
    expect(coreOptions({...configured,motionStrategy:'standard',dynamicCurveAcceleration:50,dynamicAnticipationMm:8})).toEqual(coreOptions(implicit));
    expect(coreOptions(initialState.settings)).not.toHaveProperty('motionStrategy');
  });
  it('stores resolved tuning on explicit enable and retains it across strategy changes',()=>{
    const settings={...configured},plotter=new Plotter(),input=document.createElement('input');
    input.value='dynamic';updateWorkspaceSetting(settings,'motionStrategy',input,plotter);
    expect(settings).toMatchObject({motionStrategy:'dynamic',dynamicCurveAcceleration:100,dynamicAnticipationMm:3,motionPreference:'scurve'});
    input.value='80';updateWorkspaceSetting(settings,'drawAcceleration',input,plotter);
    expect(settings.dynamicCurveAcceleration).toBe(80);
    input.value='standard';updateWorkspaceSetting(settings,'motionStrategy',input,plotter);
    input.value='dynamic';updateWorkspaceSetting(settings,'motionStrategy',input,plotter);
    expect(settings.dynamicCurveAcceleration).toBe(80);
  });
  it('round-trips documents and gives older files the Standard strategy',()=>{
    const state=structuredClone(initialState);
    Object.assign(state.settings,configured,{motionStrategy:'dynamic',dynamicCurveAcceleration:75,dynamicAnticipationMm:4});
    const restored=parsePlotIt(serializePlotIt(state)).state;
    // Connected firmware remains discovered state; new strategy/tuning are durable.
    expect(restored.settings).toEqual({...state.settings,motionFirmware:undefined});
    expect(coreOptions(restored.settings)).toMatchObject({motionStrategy:'dynamic',dynamicCurveAcceleration:75,dynamicAnticipationMm:4});
    const legacy=JSON.parse(serializePlotIt(state));
    for(const key of ['motionStrategy','dynamicCurveAcceleration','dynamicAnticipationMm'])delete legacy.document.settings[key];
    expect(parsePlotIt(JSON.stringify(legacy)).state.settings.motionStrategy).toBe('standard');
  });
  it.each([
    {motionStrategy:'guess'}, {dynamicCurveAcceleration:0}, {dynamicCurveAcceleration:201},
    {dynamicCurveAcceleration:'100'}, {dynamicAnticipationMm:-1}, {dynamicAnticipationMm:21}, {dynamicAnticipationMm:NaN}
  ])('rejects invalid saved and network tuning: %j',bad=>{
    expect(()=>validateSettings({...configured,...bad})).toThrow(/Invalid/);
    const state=structuredClone(initialState);Object.assign(state.settings,configured,bad);
    expect(()=>parsePlotIt(serializePlotIt(state))).toThrow(/Invalid/);
  });
  it.each([false,true])('admits SDK Dynamic jobs with explicit tuning=%s through editor reconstruction',explicit=>{
    const options={...coreOptions({...configured,motionStrategy:'dynamic'}),...(explicit?{dynamicCurveAcceleration:75,dynamicAnticipationMm:4}:{})};
    const prepared=preparePaths(paths,options);
    const accepted=validateJob({version:2,requestId:'dynamic-sdk',prepared});
    expect(accepted.plan.settings.motionStrategy).toBe('dynamic');
    expect(digest(coreOptions(accepted.plan.settings))).toBe(digest(prepared.options));
    expect(()=>validateNativePreview(accepted.plan)).not.toThrow();
    expect(digest(accepted.plan.executable)).toBe(digest(prepared.program));
  });
  it('rejects an edited Dynamic preview instead of plotting stale timing',()=>{
    const plan=buildMotionPlan(paths,{...configured,motionStrategy:'dynamic',dynamicCurveAcceleration:75,dynamicAnticipationMm:3});
    expect(()=>validateNativePreview(plan)).not.toThrow();
    plan.settings.dynamicAnticipationMm=6;
    expect(()=>validateNativePreview(plan)).toThrow(/Prepare again/);
  });
});
