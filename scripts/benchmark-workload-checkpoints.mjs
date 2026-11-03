// Offline only. Imports normalized source; never constructs a hardware adapter.
import * as core from '../packages/plotter-core/dist/index.js';
import {readFileSync,writeFileSync} from 'node:fs';
const paths=JSON.parse(readFileSync('output/dense-wave-fix-2026-11-02/runs/R07-dense-periodic-standard.paths.json','utf8')),rows=[];
for(const motionStrategy of ['standard','dynamic']){
 const options={profile:core.machineProfile('xylodraw',0,16),pen:{...core.defaultPen,up:30,down:60},speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:true,drawingMode:'profiled',backend:'t3',firmware:'3.1.7',motionStrategy,workloadCheckpoints:core.DEFAULT_WORKLOAD_CHECKPOINTS},start=performance.now();
 const plan=core.compileJob(paths,options);let count=0,ms=0,mm=0,maxRecords=0,maxMs=0,maxMm=0;
 for(const r of plan.records){if(r.kind==='motor'&&r.penDown){count++;ms+=r.durationMs;mm+=Math.hypot(r.to.x-r.from.x,r.to.y-r.from.y);}if(r.kind==='pen'&&!r.penDown){maxRecords=Math.max(maxRecords,count);maxMs=Math.max(maxMs,ms);maxMm=Math.max(maxMm,mm);count=ms=mm=0;}}
 rows.push({motionStrategy,compileMs:performance.now()-start,points:paths[0].points.length,records:plan.records.length,maxRecords,maxMs,maxMm,preview:plan.workloadCheckpoints});
 console.log(JSON.stringify({...rows.at(-1),preview:{...plan.workloadCheckpoints,cuts:plan.workloadCheckpoints.cuts.length}}));
}
writeFileSync('output/dense-wave-fix-2026-11-02/workload-checkpoint-benchmark.json',JSON.stringify({hardwareOpened:false,rows},null,2));
