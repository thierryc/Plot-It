// Pure compiler/constraint measurement. Never opens a physical transport.
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {motionCorpus,corpusOptions} from './permissive-motion-corpus.mjs';
import {inspectExecutable} from './permissive-motion-oracle.mjs';
const args=process.argv.slice(2),get=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const core=await import(pathToFileURL(resolve(get('--core','packages/plotter-core/dist/index.js'))));
const math=await import(new URL('./ebb-math.js',pathToFileURL(resolve(get('--core','packages/plotter-core/dist/index.js')))));
const variants=[...['xylodraw','axidraw','axidraw-a3'].map(id=>({id,servo:'standard'})),...['nextdraw-8511','nextdraw-1117','nextdraw-2234'].flatMap(id=>['standard','brushless'].map(servo=>({id,servo})))];
const dense=motionCorpus().find(c=>c.id==='dense-18000'),rows=[];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
for(const variant of variants)for(const resolution of [8,16])for(const rotation of [0,90,180,270]){
 const options={...corpusOptions(core,dense,'t3'),profile:core.machineProfile(variant.id,rotation,resolution,variant.servo),firmware:'3.1.7'},start=performance.now();
 try{
  const plan=core.compileJob(dense.paths,options),compileMs=performance.now()-start;
  core.validatePlan(plan);inspectExecutable(plan,dense.paths);
  let ticks=0,halves=0,maxNativeSpeed=0,maxNativeAcceleration=0,maxNativeJerk=0;
  for(const r of plan.records)if(r.kind==='motor'&&r.native)for(const p of r.native.halves){
   ticks+=p.ticks;halves++;
   const s=options.profile.stepsPerMm,den=Math.SQRT2*s*2147483648,axes=[p.axis1,p.axis2];
   const speed=Math.hypot(...axes.map(a=>math.maximumRate(p.ticks,a)))*25000/den;
   const acceleration=Math.hypot(...axes.map(a=>Math.max(Math.abs(a.acceleration),Math.abs(a.acceleration+(p.ticks-1)*a.jerk))))*25000**2/den;
   const jerk=Math.hypot(...axes.map(a=>a.jerk))*25000**3/den;
   const speedLimit=r.penDown?options.speed:options.travelSpeed,accelerationLimit=r.penDown?options.acceleration:options.travelAcceleration,jerkLimit=r.penDown?options.drawingJerk??500000:options.travelJerk??330200;
   if(speed>speedLimit+1e-7||acceleration>accelerationLimit+1e-7||jerk>jerkLimit+1e-7)throw new Error('Native parameter envelope exceeds requested limits');
   maxNativeSpeed=Math.max(maxNativeSpeed,speed);maxNativeAcceleration=Math.max(maxNativeAcceleration,acceleration);maxNativeJerk=Math.max(maxNativeJerk,jerk);
  }
  rows.push({...variant,resolution,rotation,status:'accepted',compileMs,planSha256:hash(plan),recordCount:plan.records.length,durationMs:plan.durationMs,totalTicks:ticks,halves,drawingMm:plan.drawingMm,travelMm:plan.travelMm,penDurationsMs:plan.records.filter(r=>r.kind==='pen').map(r=>r.durationMs),serializedBytes:Buffer.byteLength(JSON.stringify(plan)),maxNativeSpeed,maxNativeAcceleration,maxNativeJerk});
 }catch(error){rows.push({...variant,resolution,rotation,status:'rejected',elapsedMs:performance.now()-start,error:String(error)});}
}
const output=resolve(get('--out','output/modern-driver-p2/dense-matrix.json'));mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify({format:'dense-t3-matrix-v1',firmware:'3.1.7',hardwareOpened:false,node:process.version,geometrySha256:hash(dense.paths),inputPoints:dense.paths[0].points.length,limitations:['Native per-command parameter envelopes do not measure hardware tracking or contact.','One compiler timing sample per row is descriptive, not a portable speed guarantee.'],rows},null,2)+'\n');
console.log(JSON.stringify({output,cases:rows.length,accepted:rows.filter(r=>r.status==='accepted').length,rejected:rows.filter(r=>r.status==='rejected').length,errors:[...new Set(rows.filter(r=>r.status==='rejected').map(r=>r.error))]}));
