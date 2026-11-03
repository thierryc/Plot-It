import {describe,expect,it} from 'vitest';
import {compileJob,validatePlan,withRaisedReturn} from './compiler.js';
import {compileLayerProgram} from './layer-program.js';
import {preparePaths,validatePreparedJob} from './prepared-job.js';
import {checkpointAt,validateCheckpoint} from './resume.js';
import {digest} from './identity.js';
import {defaultPen} from './pen.js';
import {machineProfile} from './profiles.js';
import {COMPILER_VERSION,PLANNING_MODEL,SM_CRUISE_MODEL,PEN_TIMING_MODEL} from './version.js';
import type {PlotOptions} from './types.js';
const paths=[{tool:'black',sourceId:'line',points:[{x:10,y:10},{x:70,y:10}]}];
const options:PlotOptions={profile:machineProfile('xylodraw',0),pen:defaultPen,speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:false,drawingMode:'profiled',backend:'sm',firmware:'3.1.7'};
describe('P3a preparation and settled-checkpoint identity',()=>{
 it('versions prepared output and only the qualified modern SM model',()=>{
  expect(COMPILER_VERSION).toBe('native-v5');
  const current=compileJob(paths,options);expect(current.planningModel).toBe(SM_CRUISE_MODEL);expect(current.timingModel).toBe(PEN_TIMING_MODEL);
  for(const firmware of [undefined,'2.8.1','3.0.2','3.1.0','3.1.6'])expect(compileJob(paths,{...options,firmware}).planningModel).toBe(PLANNING_MODEL);
  expect(compileJob(paths,{...options,backend:'t3'}).planningModel).toBe(PLANNING_MODEL);
 });
 it('rejects an old direct modern-SM identity before execution',()=>{
  const plan=compileJob(paths,options);
  expect(()=>validatePlan({...plan,planningModel:PLANNING_MODEL})).toThrow(/model/);
  expect(()=>validatePlan({...plan,planningModel:SM_CRUISE_MODEL,options:{...options,firmware:'2.8.1'}})).toThrow(/model/);
 });
 it('rejects old prepared wrappers and stale SM checkpoints while preserving editable paths',()=>{
  const prepared=preparePaths(paths,options),original=structuredClone(paths);expect(()=>validatePreparedJob(prepared)).not.toThrow();
  expect(()=>validatePreparedJob({...prepared,compiler:'native-v4'})).toThrow(/identity/);
  const record=prepared.program.records.findIndex(r=>r.kind==='motor'&&r.penDown),checkpoint=checkpointAt(prepared.program,record);
  const oldPlan={...prepared.program,planningModel:PLANNING_MODEL};
  expect(()=>validateCheckpoint({...checkpoint,programDigest:digest(oldPlan)},prepared.program)).toThrow(/Stale/);
  expect(paths).toEqual(original);expect(preparePaths(paths,options).paths).toEqual(original);
 });
 it('propagates qualified model through layered programs and raised return compilation',()=>{
  const layered=compileLayerProgram([{id:'a',name:'A',paths}],options);
  expect(layered.planningModel).toBe(SM_CRUISE_MODEL);expect(()=>validatePlan(layered)).not.toThrow();
  const returned=withRaisedReturn(compileJob(paths,options));expect(returned.planningModel).toBe(SM_CRUISE_MODEL);expect(()=>validatePlan(returned)).not.toThrow();
 });
});
