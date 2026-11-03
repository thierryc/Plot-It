import {describe,it,expect} from 'vitest';
import {initialState} from './model';
import {penTimingSettings} from './pen-settings';
import {parsePlotIt,serializePlotIt} from './document-file';
import {coreOptions} from './core-settings';
import {buildMotionPlan} from './motion-plan';
import {validateJob,validateSettings} from './network-protocol';
import {executionFromEditor} from './plotter-adapter';
import {applyHandling} from '@thierryc/plotter-core';
describe('explicit pen timing migration',()=>{
 it('migrates signed legacy extras once, keeps rate settings, and rejects negative new-model extras',()=>{
  const raw={penDelayUpMs:-200,penDelayDownMs:-500,penRateRaise:12,penRateLower:23};
  const current=penTimingSettings(raw);expect(current).toMatchObject({penDelayUpMs:0,penDelayDownMs:0,penRateRaise:12,penRateLower:23,penTimingModel:'ebb-pulse-v1'});
  expect(penTimingSettings(current)).toEqual(current);expect(()=>penTimingSettings({...current,penDelayUpMs:-1})).toThrow();
 });
 it('preserves editable document artwork and the migrated marker through save/load',()=>{
  const source=JSON.parse(serializePlotIt(structuredClone(initialState)));delete source.document.settings.penTimingModel;source.document.settings.penDelayUpMs=-500;source.document.settings.penDelayDownMs=-50;
  const restored=parsePlotIt(JSON.stringify(source)).state;expect(restored.items).toEqual(source.document.items);expect(restored.settings.penDelayUpMs).toBe(0);expect(restored.settings.penDelayDownMs).toBe(0);
  expect(parsePlotIt(serializePlotIt(restored)).state.settings.penTimingModel).toBe('ebb-pulse-v1');
  const raw={...initialState.settings,penTimingModel:undefined,penDelayUpMs:-300};expect(validateSettings(raw).penDelayUpMs).toBe(0);expect(coreOptions(raw).pen.upDelayMs).toBe(0);
 });
 it('rejects old event-only execution while geometry can be prepared again',()=>{
  const plan=buildMotionPlan([{tool:'black',points:[{x:0,y:0},{x:1,y:0}]}],initialState.settings),stale={...plan,executable:undefined};
  expect(()=>executionFromEditor(stale)).toThrow(/prepared again/);expect(()=>validateJob({version:1,requestId:'legacy',plan:stale})).toThrow(/prepared again/);
  expect(()=>executionFromEditor(plan)).not.toThrow();
 });
 it('preserves explicit servo calibration/allowances when applying a motion recipe',()=>{
  const options=coreOptions(initialState.settings),profile={...options.profile,servoSettleUpMs:321,servoStartupMs:456};
  expect(applyHandling({...options,profile},'technical').profile).toMatchObject({servoSettleUpMs:321,servoStartupMs:456});
 });
});
