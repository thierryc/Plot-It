// Offline only. The reference forces setup writes through the same feeder;
// it does not change servo timing, motor records, hardware or product defaults.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import * as core from '../packages/plotter-core/dist/index.js';
import {Feeder} from '../packages/plotter-core/dist/feeder.js';
import {VirtualClock,VirtualEbb} from '../packages/plotter-core/dist/virtual/index.js';
import {motionCorpus,corpusOptions} from './permissive-motion-corpus.mjs';

const variants=[...['xylodraw','axidraw','axidraw-a3'].map(id=>({id,servo:'standard'})),...['nextdraw-8511','nextdraw-1117','nextdraw-2234'].flatMap(id=>['standard','brushless'].map(servo=>({id,servo})))];
const reload=motionCorpus({dense:false}).find(c=>c.id==='reload');
// This private hook is confined to the research harness. No cache-disable switch
// is exposed in the product. If the implementation changes, fail explicitly.
const setting=Feeder.prototype.setting;
assert.equal(typeof setting,'function','Update the offline no-elision reference for the current feeder');
async function run(plan,latency,elide){
 Feeder.prototype.setting=elide?setting:function(command){return setting.call(this,command,false);};
 const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7',replyDelayMs:latency}),session=new core.PlotterSession(board.createTransport(),clock,plan.options.profile);
 try{
  await session.connect();const start=clock.now(),first=board.commands.length;
  assert.equal(await session.run(plan),'finished');
  const commands=board.commands.slice(first),counts={SC:commands.filter(c=>c.startsWith('SC,')).length,SR:commands.filter(c=>c.startsWith('SR,')).length};
  assert.equal(board.droppedCommands,0);assert.equal(board.droppedTraceEntries,0);
  return{elapsedMs:clock.now()-start,commandCount:commands.length,setupCounts:counts,endpoint:{...board.position},penUp:board.penUp,semanticCommands:commands.filter(c=>/^(SM|XM|T3|TD|SP|S2),/.test(c))};
 }finally{await session.disconnect();Feeder.prototype.setting=setting;}
}
const rows=[];
for(const variant of variants)for(const backend of ['sm','t3']){
 const options={...corpusOptions(core,reload,backend),profile:core.machineProfile(variant.id,0,8,variant.servo),firmware:'3.1.7'},plan=core.compileJob(reload.paths,options),before=JSON.stringify(plan);
 for(const latencyMs of [0,1,5,10,20]){
  const reference=await run(plan,latencyMs,false),candidate=await run(plan,latencyMs,true);
  assert.deepEqual(candidate.semanticCommands,reference.semanticCommands);
  assert.deepEqual(candidate.endpoint,reference.endpoint);assert.equal(candidate.penUp,reference.penUp);
  assert.equal(JSON.stringify(plan),before);assert.ok(candidate.elapsedMs<=reference.elapsedMs+1e-7);
  assert.equal(reference.setupCounts.SC-candidate.setupCounts.SC,72);
  assert.equal(reference.setupCounts.SR-candidate.setupCounts.SR,variant.servo==='brushless'?0:12);
  if(latencyMs===0)assert.equal(candidate.elapsedMs,reference.elapsedMs);
  const {semanticCommands:_,...referenceMetrics}=reference,{semanticCommands:__,...candidateMetrics}=candidate;
  rows.push({...variant,backend,latencyMs,plannedMs:plan.durationMs,penEvents:plan.records.filter(r=>r.kind==='pen').length,penDwellMs:plan.records.filter(r=>r.kind==='pen').reduce((s,r)=>s+r.durationMs,0),semanticCommandsDigest:core.digest(candidate.semanticCommands),reference:referenceMetrics,candidate:candidateMetrics,savedMs:reference.elapsedMs-candidate.elapsedMs});
 }
}
const output='output/modern-driver-p1/latency-benchmark.json';mkdirSync('output/modern-driver-p1',{recursive:true});
writeFileSync(output,JSON.stringify({format:'modern-driver-setup-benchmark-v1',firmware:'3.1.7',resolution:8,rotation:0,hardwareOpened:false,reference:'same candidate with setup elision disabled in this harness only; frozen pre-change regression is tested separately',limitations:'Injected ACK latency; no physical speed/contact/settling claims. Servo values are test inputs, not calibration recommendations.',rows},null,2)+'\n');
console.log(JSON.stringify({output,cases:rows.length,tenMs:rows.filter(r=>r.latencyMs===10).map(r=>({id:r.id,servo:r.servo,backend:r.backend,beforeMs:r.reference.elapsedMs,afterMs:r.candidate.elapsedMs,savedMs:r.savedMs,removedSC:r.reference.setupCounts.SC-r.candidate.setupCounts.SC,removedSR:r.reference.setupCounts.SR-r.candidate.setupCounts.SR}))},null,2));
