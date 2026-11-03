// Offline before/candidate comparisons. No physical adapters or devices.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import * as core from '../packages/plotter-core/dist/index.js';
import {motionCorpus,corpusOptions} from './permissive-motion-corpus.mjs';
import {inspectExecutable} from './permissive-motion-oracle.mjs';
const args=process.argv.slice(2),at=args.indexOf('--reference');
const referencePath=resolve(at<0?'output/modern-driver-p3a/before/core-dist/index.js':args[at+1]);
const before=await import(pathToFileURL(referencePath));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const variants=[...['xylodraw','axidraw','axidraw-a3'].map(id=>({id,servo:'standard'})),...['nextdraw-8511','nextdraw-1117','nextdraw-2234'].flatMap(id=>['standard','brushless'].map(servo=>({id,servo})))];
const corpus=motionCorpus(),rows=[],errors=[];
const anchors=plan=>({rests:plan.records.filter(r=>r.kind==='motor'&&r.restBefore).map(r=>[r.fromSteps,r.tool,r.penDown,r.sourceId,r.width]),waits:plan.records.filter(r=>r.kind==='motor'&&r.fromSteps.m1===r.toSteps.m1&&r.fromSteps.m2===r.toSteps.m2).map(r=>[r.fromSteps,r.durationMs,r.penDown,r.restBefore,r.sourceId]),other:plan.records.filter(r=>r.kind!=='motor').map(({id,startMs,...r})=>r)});
// Independent algebraic completion of the literal SM recurrence. An axis stops
// accumulating after its last step; nonmotor/zero-step waits retain carry.
function uninterruptedTicks(plan,input){
 const B=2147483648n;let carry=input.map(BigInt),ticks=0n;
 for(const r of plan.records){
  if(r.kind!=='motor'){ticks+=BigInt(r.durationMs)*25n;continue;}
  const counts=[r.toSteps.m1-r.fromSteps.m1,r.toSteps.m2-r.fromSteps.m2].map(Math.abs);
  if(!counts.some(Boolean)){ticks+=BigInt(r.durationMs)*25n;continue;}
  let completion=0n;
  for(let i=0;i<2;i++)if(counts[i]){
   const factor=Math.fround(Math.fround(85899345.92)/Math.fround(r.durationMs)),q=BigInt(Math.trunc(Math.fround(Math.fround(counts[i])*factor))),n=BigInt(counts[i]);
   assert.ok(q>0n);const own=(n*B-carry[i]+q-1n)/q;carry[i]+=q*own-n*B;assert.ok(carry[i]>=0n&&carry[i]<B);if(own>completion)completion=own;
  }
  ticks+=completion;
 }
 return Number(ticks);
}
function compare(c,variant,resolution,rotation,backend='sm',firmware='3.1.7'){
 const options=module=>({...corpusOptions(module,c,backend),profile:module.machineProfile(variant.id,rotation,resolution,variant.servo),firmware});
 const budget={remaining:200000},start=performance.now(),old=before.compileJob(c.paths,options(before)),middle=performance.now(),o=options(core),plan=core.compileJob(c.paths,o,'drawing',o.maxPenDownMm,budget),end=performance.now();
 try{
  core.validatePlan(plan);inspectExecutable(plan,c.paths);assert.deepEqual(anchors(plan),anchors(old));
  let stroke=0;for(const record of plan.records){if(record.kind==='motor'&&record.penDown)stroke+=Math.hypot(record.to.x-record.from.x,record.to.y-record.from.y);if(record.kind==='pen'&&!record.penDown){if(plan.options.maxPenDownMm)assert.ok(stroke<=plan.options.maxPenDownMm+1e-6);stroke=0;}}
  assert.ok(plan.durationMs<=old.durationMs+1e-7);assert.ok(plan.records.length<=old.records.length);
  if(backend==='t3'||firmware!=='3.1.7')assert.equal(hash(plan),hash(old));
  const modeled=backend==='sm'&&firmware==='3.1.7'?[[0,0],[1,2147483647],[2147483647,0],[0,2147483647],[1073741824,715827882]].map(carry=>{
   const oldTicks=uninterruptedTicks(old,carry),ticks=uninterruptedTicks(plan,carry);assert.ok(ticks<=oldTicks,`Modeled controller elapsed increased: ${ticks-oldTicks} ticks`);return{carry,oldTicks,ticks};
  }):undefined;
  const commands=plan.records.filter(r=>r.kind==='motor').map(core.motorCommand),oldCommands=old.records.filter(r=>r.kind==='motor').map(before.motorCommand);
  rows.push({caseId:c.id,profile:variant.id,servo:variant.servo,resolution,rotation,backend,firmware,oldRecords:old.records.length,records:plan.records.length,oldMs:old.durationMs,plannedMs:plan.durationMs,savedMs:old.durationMs-plan.durationMs,oldBytes:Buffer.byteLength(JSON.stringify(old)),bytes:Buffer.byteLength(JSON.stringify(plan)),commandsIdentical:hash(commands)===hash(oldCommands),proofEvents:200000-budget.remaining,modeled,oldCompileMs:middle-start,compileMs:end-middle,planSha256:hash(plan)});
 }catch(error){errors.push({caseId:c.id,profile:variant.id,servo:variant.servo,resolution,rotation,backend,firmware,error:String(error)});}
}
for(const variant of variants)for(const resolution of [8,16])for(const rotation of [0,90,180,270])for(const c of corpus.filter(c=>c.id!=='dense-18000'))compare(c,variant,resolution,rotation);
const parallel={id:'parallel100',paths:Array.from({length:100},(_,i)=>({tool:'black',sourceId:`line:${i}`,points:[{x:10,y:10+2*i},{x:110,y:10+2*i}]}))};
for(const id of ['xylodraw','axidraw'])for(const resolution of [8,16]){
 const variant={id,servo:'standard'},dense=corpus.find(c=>c.id==='dense-18000');compare(dense,variant,resolution,0);compare(dense,variant,resolution,0,'t3');
 if(id==='xylodraw'){
  compare(dense,variant,resolution,0,'sm','2.8.1');compare(parallel,variant,resolution,0);
 }
}
for(const c of corpus.filter(c=>c.id!=='dense-18000')){
 compare(c,{id:'xylodraw',servo:'standard'},8,0,'sm','2.8.1');compare(c,{id:'xylodraw',servo:'standard'},8,0,'t3');
}
const output='output/modern-driver-p3a/benchmark.json';mkdirSync('output/modern-driver-p3a',{recursive:true});
writeFileSync(output,JSON.stringify({format:'sm-cruise-comparison-v1',hardwareOpened:false,referencePath,sourceCorpusSha256:hash(JSON.parse(readFileSync(new URL('./fixtures/permissive-motion-corpus.json',import.meta.url),'utf8'))),limitations:['Compile timings are descriptive single samples; use separate warmed runs for a performance conclusion.','Wire duration and geometric checks do not establish physical contact or actual firmware stop latency.'],rows,errors},null,2)+'\n');
console.log(JSON.stringify({output,cases:rows.length,errors,representative:rows.filter(r=>r.caseId==='parallel100'||r.caseId==='dense-18000'&&r.profile==='xylodraw')}));
if(errors.length)process.exitCode=1;
