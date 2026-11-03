// Full dense jobs on the independent virtual board. No physical adapter import.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as core from '../packages/plotter-core/dist/index.js';
import {VirtualClock,VirtualEbb} from '../packages/plotter-core/dist/virtual/index.js';
import {motionCorpus,corpusOptions} from './permissive-motion-corpus.mjs';
const dense=motionCorpus().find(c=>c.id==='dense-18000');
const cases=[['xylodraw','standard',0],['axidraw','standard',90],['axidraw-a3','standard',180],['nextdraw-8511','standard',270],['nextdraw-1117','brushless',0],['nextdraw-2234','brushless',180]],rows=[];
for(const [id,servo,rotation] of cases){
 const options={...corpusOptions(core,dense,'t3'),profile:core.machineProfile(id,rotation,16,servo),firmware:'3.1.7'},plan=core.compileJob(dense.paths,options),planDigest=core.digest(plan);
 const clock=new VirtualClock(),hash=createHash('sha256'),counts={},board=new VirtualEbb(clock,{firmware:'3.1.7',onCommand:command=>{const name=command.split(',')[0];counts[name]=(counts[name]??0)+1;hash.update(command+'\n');}}),session=new core.PlotterSession(board.createTransport(),clock,options.profile);
 const pens=[],penObservations=[],extensions=[];let settled=0,writtenPen=null;
 session.subscribe(event=>{
  if(event.kind==='record'&&event.phase==='settled')settled++;
  if(event.kind==='timing-extension')extensions.push(event);
  if(event.kind==='exchange'&&event.command?.startsWith('SP,')&&event.phase==='written')writtenPen={command:event.command,at:event.timeMs};
  if(event.kind==='exchange'&&event.command?.startsWith('SP,')&&event.phase==='settled'){
   penObservations.push({command:event.command,writtenCommand:writtenPen?.command,elapsedMs:writtenPen?event.timeMs-writtenPen.at:-1,requiredMs:Number(event.command.split(',')[2])});
   pens.push(event.command);
  }
 });
 await session.connect();const start=clock.now();assert.equal(await session.run(plan),'finished');
 assert.equal(settled,plan.records.length);assert.deepEqual(board.position,{m1:0,m2:0});assert.equal(board.penUp,true);
 assert.equal(core.digest(plan),planDigest);assert.deepEqual(extensions,[]);
 for(const observation of penObservations){assert.equal(observation.writtenCommand,observation.command);assert.ok(observation.elapsedMs>=observation.requiredMs-1e-7);}
 assert.deepEqual(pens,plan.records.filter(r=>r.kind==='pen').map(r=>`SP,${r.penDown?0:1},${r.durationMs},${options.profile.servoPin}`));
 assert.equal(counts.SM??0,plan.records.filter(r=>r.kind==='motor'&&!r.native).length);
 rows.push({id,servo,rotation,resolution:16,inputPoints:dense.paths[0].points.length,records:plan.records.length,plannedMs:plan.durationMs,virtualElapsedMs:clock.now()-start,settledRecords:settled,penCommands:pens,endpoint:{...board.position},commandCounts:counts,completeCommandStreamSha256:hash.digest('hex'),boundedBoardTraceDropped:board.droppedTraceEntries});
 await session.disconnect();
}
mkdirSync('output/modern-driver-p2',{recursive:true});const output='output/modern-driver-p2/dense-virtual.json';
writeFileSync(output,JSON.stringify({format:'dense-t3-virtual-v1',hardwareOpened:false,firmware:'3.1.7',limitations:['Board executes a literal native integer tick recurrence, but servo interpolation is not a physical PWM/contact model.','The board retains a bounded trace. Complete commands are streamed into the digest; settled record counts cover the full run.','Listener assertions cover the nominal successful run, not hardware fault recovery.'],rows},null,2)+'\n');
console.log(JSON.stringify({output,completed:rows.length,records:rows.reduce((s,r)=>s+r.records,0)}));
