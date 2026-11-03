import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import * as core from './index.js';
import {VirtualClock,VirtualEbb} from './virtual/index.js';
import {motionCorpus,corpusOptions} from '../../../scripts/permissive-motion-corpus.mjs';
import {inspectExecutable} from '../../../scripts/permissive-motion-oracle.mjs';
import type {PlotOptions,ExecutablePlan,Rotation,Path} from './types.js';
const frozen=JSON.parse(readFileSync(new URL('../../../scripts/fixtures/motion-regression.json',import.meta.url),'utf8'));
const cruiseBefore=JSON.parse(readFileSync(new URL('../../../scripts/fixtures/motion-anchors.json',import.meta.url),'utf8'));
type Config={id:Parameters<typeof core.machineProfile>[0];servo:'standard'|'brushless';resolution:8|16;rotation:Rotation};
type Target={backend:'sm'|'t3';firmware:'3.0.2'|'3.1.0'|'3.1.6'|'3.1.7'};
type Case={key:string;config:Config;target:Target;expected:ReturnType<typeof summarize>};
const paths=frozen.paths as Path[];
const sha=(value:unknown)=>createHash('sha256').update(core.canonical(value)).digest('hex');
function optionsFor(config:Config,target:Target):PlotOptions {
 return {...frozen.baseOptions,profile:core.machineProfile(config.id,config.rotation,config.resolution,config.servo),pen:{...core.defaultPen,up:config.servo==='brushless'?60:30,down:config.servo==='brushless'?30:52,reloadWaitMs:75},...target};
}
function summarize(plan:ExecutablePlan){
 return {planDigest:sha(plan),recordsDigest:sha(plan.records),geometryDigest:sha(plan.records.filter(r=>r.kind==='motor').map(r=>[r.fromSteps,r.toSteps,r.penDown,r.sourceId??null])),recordCount:plan.records.length,durationMs:plan.durationMs,drawingMm:plan.drawingMm,travelMm:plan.travelMm,penRecords:plan.records.filter(r=>r.kind==='pen').map(r=>[r.startMs,r.durationMs,r.penDown,r.reload??false]),sourceEndpoints:paths.map(p=>{const a=plan.records.filter((r):r is core.MotorRecord=>r.kind==='motor'&&r.penDown&&r.sourceId===p.sourceId);return[p.sourceId,a[0]?.fromSteps??null,a.at(-1)?.toSteps??null];}),endpoint:plan.records.findLast((r):r is core.MotorRecord=>r.kind==='motor')?.toSteps};
}
const qualified=(row:Case)=>row.target.backend==='sm'&&row.target.firmware==='3.1.7';
function anchors(plan:ExecutablePlan){return{rests:plan.records.filter((r):r is core.MotorRecord=>r.kind==='motor'&&r.restBefore).map(r=>({from:r.fromSteps,sourceId:r.sourceId,tool:r.tool,penDown:r.penDown,width:r.width})),stationary:plan.records.filter((r):r is core.MotorRecord=>r.kind==='motor'&&r.fromSteps.m1===r.toSteps.m1&&r.fromSteps.m2===r.toSteps.m2).map(r=>({at:r.fromSteps,durationMs:r.durationMs,sourceId:r.sourceId,tool:r.tool,penDown:r.penDown,restBefore:r.restBefore})),nonmotion:plan.records.filter(r=>r.kind!=='motor').map(({id:_id,startMs:_start,...r})=>r)};}
function assertBehavior(plan:ExecutablePlan,row:Case,expected:ReturnType<typeof summarize>){
 const actual=summarize(plan);
 if(!qualified(row)){expect(actual).toEqual(expected);return;}
 expect(plan.planningModel).toBe(core.SM_CRUISE_MODEL);expect(plan.timingModel).toBe(frozen.timingModel);
 expect(actual.durationMs).toBeLessThanOrEqual(expected.durationMs+1e-7);expect(actual.recordCount).toBeLessThanOrEqual(expected.recordCount);
 expect(actual.sourceEndpoints).toEqual(expected.sourceEndpoints);expect(actual.endpoint).toEqual(expected.endpoint);
 expect(actual.penRecords.map(p=>p.slice(1))).toEqual(expected.penRecords.map(p=>p.slice(1)));
 expect(()=>inspectExecutable(plan,paths,{checkCoverage:plan.drawingMm>0})).not.toThrow();
}

describe('P0 historical matrix and P3a bounded modern SM behavior',()=>{
 it('covers72stockconfigurations and360primary/compatibility admission cases',()=>{
  expect(frozen.variants).toHaveLength(9);expect(frozen.rows).toHaveLength(360);
  expect(new Set(frozen.rows.map((r:Case)=>`${r.config.id}/${r.config.servo}/${r.config.resolution}/${r.config.rotation}`)).size).toBe(72);
  const targets=new Set(['sm/3.1.7','t3/3.1.7','sm/3.0.2','sm/3.1.0','sm/3.1.6']);
  const configurations=new Map<string,Set<string>>();
  for(const row of frozen.rows as Case[]){const key=`${row.config.id}/${row.config.servo}/${row.config.resolution}/${row.config.rotation}`,seen=configurations.get(key)??new Set<string>();seen.add(`${row.target.backend}/${row.target.firmware}`);configurations.set(key,seen);}
  for(const seen of configurations.values())expect(seen).toEqual(targets);
  expect(new Set(frozen.variants.map((v:Config)=>`${v.id}/${v.servo}`))).toEqual(new Set(['xylodraw/standard','axidraw/standard','axidraw-a3/standard',...['nextdraw-8511','nextdraw-1117','nextdraw-2234'].flatMap(id=>['standard','brushless'].map(servo=>`${id}/${servo}`))]));
  expect([frozen.compiler,frozen.planningModel,frozen.timingModel]).toEqual(['native-v4','axi-ca-junction-v1','ebb-pulse-v1']);
  expect(core.COMPILER_VERSION).toBe('native-v5');expect(core.PLANNING_MODEL).toBe(frozen.planningModel);expect(core.PEN_TIMING_MODEL).toBe(frozen.timingModel);
 });
 it.each(frozen.rows as Case[])('retains unchanged hashes or qualified cruise behavior: $key',row=>{
  const plan=core.compileJob(paths,optionsFor(row.config,row.target));
  expect(()=>core.validatePlan(plan)).not.toThrow();assertBehavior(plan,row,row.expected);
  if(qualified(row)){
   const original=cruiseBefore.rows.find((r:{key:string})=>r.key===row.key);expect(original.originalPlanSha256).toBe(row.expected.planDigest);
   const {key:_key,originalPlanSha256:_hash,...expected}=original;
   expect(JSON.parse(JSON.stringify(anchors(plan)))).toEqual(expected);
  }
 });
});

describe('P0 representative virtual semantics and qualified RB1 initialization',()=>{
 it.each(frozen.virtual as {key:string;runs:any[]}[])('preserves observed motion/SP/S2 timeline: $key',async captured=>{
  const row=(frozen.rows as Case[]).find(r=>r.key===captured.key)!,o=optionsFor(row.config,row.target),clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:row.target.firmware}),session=new core.PlotterSession(board.createTransport(),clock,o.profile);
  const extensions:unknown[]=[],queueDiagnostics:core.SessionEvent[]=[];await session.connect();session.subscribe(e=>{if(e.state==='tool-change')session.resume();if(e.kind==='timing-extension')extensions.push(e);if(e.kind==='queue-diagnostic')queueDiagnostics.push(e);});
  for(const expected of captured.runs){
   const diagnosticStart=queueDiagnostics.length,start=board.commands.length,traceStart=board.trace.length,time=clock.now(),plan=core.compileJob(paths,o,expected.intent);
   assertBehavior(plan,row,expected.plan);await session.run(plan);
   const safeRB1=row.target.firmware==='3.1.7'&&o.profile.servoKind!=='brushless'&&o.profile.servoPin===1&&o.profile.servoChannels===8;
   const allCommands=board.commands.slice(start),diagnosticCommands=allCommands.filter(c=>/^QU,[46]$/.test(c)),commands=allCommands.filter(c=>!/^QU,[46]$/.test(c)),timeline=board.trace.slice(traceStart).filter(t=>/^(SM|XM|T3|TD|SP|S2),/.test(t.command)).map(t=>[t.timeMs-time,t.phase,t.command,t.position.m1,t.position.m2,t.penUp,t.pulse]);
   // Historical mutation/motion goldens stay exact. Account separately for
   // new read-only stack/occupancy snapshots, including their bounded cadence.
   const observations=queueDiagnostics.slice(diagnosticStart);
   if(plan.backend==='t3'){
    expect(diagnosticCommands.filter(c=>c==='QU,4')).toHaveLength(2);
    const occupancy=observations.filter(e=>e.queueOccupancy!==undefined);
    expect(occupancy.length).toBeGreaterThan(0);expect(occupancy.length).toBeLessThanOrEqual(1+Math.ceil((clock.now()-time)/2000));
    for(let i=1;i<occupancy.length;i++)expect(occupancy[i]!.timeMs-occupancy[i-1]!.timeMs).toBeGreaterThanOrEqual(2000);
    expect(observations.filter(e=>e.stackHighWater!==undefined).map(e=>e.stackHighWater)).toEqual([0xE71,0xE71]);
    for(const e of observations){expect(e.queueMaximum).toBe(32);expect(e.queueCapacity).toBe(16);if(e.queueOccupancy!==undefined){expect(e.queueOccupancy).toBeGreaterThanOrEqual(0);expect(e.queueOccupancy).toBeLessThanOrEqual(16);}}
   }else{expect(diagnosticCommands).toEqual([]);expect(observations).toEqual([]);}
   const sc=commands.filter(c=>c.startsWith('SC,')).length,sr=commands.filter(c=>c.startsWith('SR,')).length,nonSetup=commands.filter(c=>!/^SC,(4|5|8|9|11|12),/.test(c)&&!c.startsWith('SR,'));
   expect(commands.filter(c=>c.startsWith('SC,2,'))).toEqual(expected.requiredSC2Commands);
   if(!qualified(row)&&!safeRB1){
    expect(sha(nonSetup)).toBe(expected.nonSetupCommandsSha256);expect(nonSetup).toHaveLength(expected.nonSetupCommandCount);
    expect(sha(timeline)).toBe(expected.semanticTimelineSha256);expect(timeline).toHaveLength(expected.semanticEventCount);
   }
   if(safeRB1){
    // Preserve the historical fixture. Only the separately tested S2-free
    // lifecycle is transformed; every planned motor command still executes.
    let initializing=false;const penCommands:string[]=[];
    for(const command of expected.penCommands as string[]){
     if(/^S2,0,/.test(command)){initializing=true;continue;}
     if(command.startsWith('S2,')){const pulse=Number(command.split(',')[1]);penCommands.push(`SP,${pulse===core.servoPulse(o.pen.up,o.profile)?1:0},1,1`);continue;}
     penCommands.push(initializing?'SP,2,0,1':command);initializing=false;
    }
    expect(commands.filter(c=>/^(SP|S2),/.test(c))).toEqual(penCommands);
    expect(commands.filter(c=>/^(SM|XM|T3|TD),/.test(c))).toEqual(plan.records.filter((r):r is core.MotorRecord=>r.kind==='motor').map(core.motorCommand));
    const started=board.trace.slice(traceStart).filter(t=>t.phase==='started'&&/^(SM|XM|T3|TD),/.test(t.command));
    const motors=plan.records.filter((r):r is core.MotorRecord=>r.kind==='motor').flatMap(r=>r.native?.command==='TD'?[r,r]:[r]);
    expect(started).toHaveLength(motors.length);
    for(const [i,event]of started.entries())expect(event.penUp).toBe(!motors[i]!.penDown);
   }else expect(commands.filter(c=>/^(SP|S2),/.test(c))).toEqual(expected.penCommands);
   if(!qualified(row)&&!safeRB1){expect(timeline.filter(t=>/^(SP|S2),/.test(t[2] as string))).toEqual(expected.penTimeline);expect(clock.now()-time).toBe(expected.elapsedMs);}
   else if(!qualified(row))expect(clock.now()-time).toBe(expected.elapsedMs);
   else expect(clock.now()-time).toBeLessThanOrEqual(expected.elapsedMs+1e-7);
   expect(board.position).toEqual(expected.endpoint);expect(board.penUp).toBe(expected.penUp);
   const initialized=commands.filter(c=>c==='SP,2,0,1').length;
   expect(sc).toBeLessThanOrEqual(expected.setupCounts.SC+2*initialized);expect(sr).toBeLessThanOrEqual(expected.setupCounts.SR);expect(commands.length).toBeLessThanOrEqual(expected.totalCommands);
  }
  expect(extensions).toEqual([]);expect(board.droppedCommands).toBe(0);expect(board.droppedTraceEntries).toBe(0);await session.disconnect();
 },20000);
});

describe('P2 closes the dense16 T3 admission gaps recorded at P0',()=>{
 it.each(frozen.dense.cases as {id:Config['id'];status:string;error:string}[])('admits the original dense input with unchanged pen timing: $id',entry=>{
  const dense=motionCorpus().find((c:{id:string})=>c.id===frozen.dense.recipe)!;
  expect(sha(dense.paths)).toBe(frozen.dense.geometryDigest);expect(entry.status).toBe('known-admission-gap');
  const options={...corpusOptions(core,dense,'t3'),profile:core.machineProfile(entry.id,0,16,'standard'),firmware:'3.1.7'} as PlotOptions;
  // Preserve P0's historical failure evidence; do not replace it with candidate
  // outputs. The same input must now actually compile and meet independent
  // ordered geometry coverage, endpoint and timeline checks.
  expect(entry.error).toBe('PlotterError: Cannot quantize T3 endpoint.');
  const plan=core.compileJob(dense.paths,options);
  expect(()=>core.validatePlan(plan)).not.toThrow();expect(()=>inspectExecutable(plan,dense.paths)).not.toThrow();
  expect(plan.records.filter(r=>r.kind==='pen').map(r=>r.durationMs)).toEqual([598,420,396]);
  expect(plan.records.filter(r=>r.kind==='pen').map(r=>r.penDown)).toEqual([false,true,false]);
 },20000);
});
