import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import * as core from '@thierryc/plotter-core';
import {VirtualClock,VirtualEbb} from '@thierryc/plotter-core/virtual';
import {motionCorpus,corpusOptions} from './permissive-motion-corpus.mjs';
import {inspectExecutable,inspectTrace} from './permissive-motion-oracle.mjs';
// Core + virtual exports only: no serial, browser permission, homing or hardware adapter.
const args=process.argv.slice(2),get=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const destination=resolve(get('--out','output/permissive-migration/benchmark.json')),repeats=Number(get('--repeats','3'));
if(!Number.isInteger(repeats)||repeats<1||repeats>20)throw new Error('repeats must be 1..20');
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),rows=[];
for(const c of motionCorpus())for(const backend of ['sm','t3']){
 const options=corpusOptions(core,c,backend),measurements=[];
 try{
  let job;for(let n=0;n<repeats;n++){global.gc?.();const before=process.memoryUsage(),start=performance.now();job=core.preparePaths(c.paths,options);const elapsedMs=performance.now()-start,after=process.memoryUsage();measurements.push({elapsedMs,heapDeltaBytes:after.heapUsed-before.heapUsed,rssBytes:after.rss});}
  const plan=job.program;let geometryCoverageError;
  try{inspectExecutable(plan,c.paths,{minimumPenDwellMs:200,checkCoverage:true});}catch(error){geometryCoverageError=String(error);}
  const summary=inspectExecutable(plan,c.paths,{minimumPenDwellMs:200,checkCoverage:false}),motors=plan.records.filter(r=>r.kind==='motor'),drawing=motors.filter(r=>r.penDown),pens=plan.records.filter(r=>r.kind==='pen');
  let virtual=null;if(c.id!=='dense-18000'){const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:options.firmware}),session=new core.PlotterSession(board.createTransport(),clock,options.profile);await session.connect();session.subscribe(e=>{if(e.state==='tool-change')session.resume();});await session.run(plan);inspectTrace(board.trace);virtual={elapsedMs:clock.now(),endpoint:board.position,penUp:board.penUp,commands:board.commandCount};await session.disconnect();}
  rows.push({id:c.id,backend,inputPoints:c.paths.reduce((n,p)=>n+p.points.length,0),geometrySha256:digest(c.paths),...summary,...(geometryCoverageError?{geometryCoverageError}:{}),recordKinds:Object.fromEntries(['motor','pen','tool','pause','delay'].map(k=>[k,plan.records.filter(r=>r.kind===k).length])),motorEndpointsBySource:c.paths.map(p=>({sourceId:p.sourceId,first:drawing.find(r=>r.sourceId===p.sourceId)?.fromSteps,last:drawing.findLast(r=>r.sourceId===p.sourceId)?.toSteps})),penOrdering:pens.map(p=>p.penDown?'down':'up'),penDurationMs:pens.map(p=>p.durationMs),serializedBytes:Buffer.byteLength(JSON.stringify(job)),recordSummarySha256:digest(plan.records.map(r=>({kind:r.kind,durationMs:r.durationMs,to:r.to,penDown:r.penDown}))),prepare:measurements,virtual});
 }catch(error){rows.push({id:c.id,backend,error:String(error),prepare:measurements});}
}
const result={format:'plot-it-permissive-baseline-v1',createdAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,platform:process.platform,arch:process.arch,repeats,gcExposed:!!global.gc,corpusSha256:createHash('sha256').update(await readFile(new URL('./fixtures/permissive-motion-corpus.json',import.meta.url))).digest('hex'),limitations:['Virtual pen ramp is continuous; trace proves queue ordering only, never electrical refresh bounds or physical contact.','Heap deltas and wall times are observations, not portable hard performance limits.','Dense case uses linear ordered geometry checks and omits virtual execution.'],rows};
await mkdir(dirname(destination),{recursive:true});await writeFile(destination,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({destination,cases:rows.length,errors:rows.filter(r=>r.error||r.geometryCoverageError).map(r=>({id:r.id,backend:r.backend,error:r.error??r.geometryCoverageError}))}));
