// Numerical acceptance only. Pure core + virtual exports; no USB, SerialPort,
// network adapter, device discovery, or hardware command transport is imported.
import assert from 'node:assert/strict';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import * as core from '@thierryc/plotter-core';
import {VirtualClock, VirtualEbb} from '@thierryc/plotter-core/virtual';
import {inspectExecutable, inspectTrace} from './permissive-motion-oracle.mjs';

const outputIndex=process.argv.indexOf('--out');
if(outputIndex>=0&&(!process.argv[outputIndex+1]||process.argv[outputIndex+1].startsWith('--')))throw new Error('--out requires a destination');
const destination=resolve(outputIndex>=0?process.argv[outputIndex+1]:'output/value-validation-2026-10-31');
const groups={}, failures=[], rows=[];
let seed=0x504c4f54;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const logValue=(lo,hi)=>10**(lo+(hi-lo)*random());
const near=(actual,expected,label,tolerance=2e-9+Math.abs(expected)*2e-9)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance,`${label}: ${actual} vs ${expected} (tol ${tolerance})`);
function check(group,input,fn){
 const stats=groups[group]??={cases:0,passed:0,failed:0};stats.cases++;
 try{fn();stats.passed++;}catch(error){stats.failed++;if(failures.length<40)failures.push({group,input,error:String(error),stack:error.stack});}
}
async function checkAsync(group,input,fn){
 const stats=groups[group]??={cases:0,passed:0,failed:0};stats.cases++;
 try{await fn();stats.passed++;}catch(error){stats.failed++;if(failures.length<40)failures.push({group,input,error:String(error),stack:error.stack});}
}
let worstDistanceErrorMm=0,worstVelocityContinuity=0,minimumPwmMarginMs=Infinity;
function inspectNominal(phases,points,speed,acceleration,entry=0,exit=0,jerk){
 assert.ok(phases.length>0,'missing phases');let velocity=entry,accel=0,position=points[0];
 for(const p of phases){
  assert.ok(Number.isFinite(p.duration)&&p.duration>0,'nonpositive/nonfinite phase');
  near(p.from.x,position.x,'x continuity');near(p.from.y,position.y,'y continuity');
  worstVelocityContinuity=Math.max(worstVelocityContinuity,Math.abs(p.initialSpeed-velocity));
  near(p.initialSpeed,velocity,'speed continuity');
  const j=p.jerk??0,t=p.duration;
  if(jerk!==undefined){near(p.acceleration,accel,'acceleration continuity',2e-7);assert.ok(Math.abs(j)<=jerk+1e-7,'jerk cap');}
  const length=Math.hypot(p.to.x-p.from.x,p.to.y-p.from.y),integral=p.initialSpeed*t+p.acceleration*t*t/2+j*t**3/6;
  worstDistanceErrorMm=Math.max(worstDistanceErrorMm,Math.abs(length-integral));near(integral,length,'distance integral');
  const samples=[0,t];if(j){const critical=-p.acceleration/j;if(critical>0&&critical<t)samples.push(critical);}
  for(const s of samples){const v=p.initialSpeed+p.acceleration*s+j*s*s/2;assert.ok(v>=-2e-7&&v<=speed+2e-7,`speed envelope ${v}/${speed}`);assert.ok(Math.abs(p.acceleration+j*s)<=acceleration+2e-7,'acceleration envelope');}
  velocity=p.initialSpeed+p.acceleration*t+j*t*t/2;accel=p.acceleration+j*t;position=p.to;
 }
 near(velocity,exit,'final speed');near(position.x,points.at(-1).x,'final x');near(position.y,points.at(-1).y,'final y');
 if(jerk!==undefined)near(accel,0,'final acceleration',2e-7);
}

for(const length of [1e-6,.0001,.001,.01,.025,.1,1,10,100,300])for(const speed of [.1,1,5,35,100,300])for(const acceleration of [1,10,200,1000,10000]){
 const points=[{x:0,y:0},{x:length,y:0}],input={length,speed,acceleration};
 check('analytical-rest-to-rest',input,()=>{
  const p=core.planStroke(points,speed,acceleration,.127);inspectNominal(p,points,speed,acceleration);
  const expected=length<=speed*speed/acceleration?2*Math.sqrt(length/acceleration):length/speed+speed/acceleration;
  near(p.reduce((n,p)=>n+p.duration,0),expected,'analytical duration');
  if(length<speed*speed/acceleration)assert.ok(p.every(p=>p.acceleration!==0),'phantom triangular cruise');
 });
 for(const entry of [0,speed/2,speed])for(const exit of [0,speed/2,speed])check('fixed-boundary-grid',{...input,entry,exit},()=>{
  const feasible=Math.abs(entry*entry-exit*exit)<=2*acceleration*length;
  if(!feasible){assert.throws(()=>core.planStroke(points,speed,acceleration,.127,false,entry,exit),/boundary/);return;}
  inspectNominal(core.planStroke(points,speed,acceleration,.127,false,entry,exit),points,speed,acceleration,entry,exit);
 });
}
for(let i=0;i<5000;i++){
 const length=logValue(-5,2.5),speed=logValue(-1,2.5),acceleration=logValue(0,3.7),entry=random()*speed;
 const exit=Math.sqrt(Math.max(0,Math.min(speed*speed,entry*entry+(random()*2-1)*1.9*acceleration*length)));
 const points=[{x:0,y:0},{x:length,y:0}];
 check('seeded-feasible-boundaries',{i,length,speed,acceleration,entry,exit},()=>inspectNominal(core.planStroke(points,speed,acceleration,.127,false,entry,exit),points,speed,acceleration,entry,exit));
}
for(let i=0;i<20000;i++){
 const speed=logValue(-1,2.3),acceleration=logValue(1,3.7),jerk=logValue(2,6.7),cornering=[0,.01,.05,.127,.5][i%5];
 const points=[{x:0,y:0},{x:logValue(-4,1.3),y:0},{x:2+random()*20,y:1+random()*20}];
 if(i%3===0)points.push({...points[0]});if(i%7===0)points.splice(1,0,{...points[0]});
 check('jerk-polylines',{i,speed,acceleration,jerk,cornering,points},()=>inspectNominal(core.planSCurve(points,speed,acceleration,jerk,cornering,i%2===0),points,speed,acceleration,0,0,jerk));
}

// Genuine near-cap corner transitions must not be reserved then omitted.
for(const speed of [.1,1,17.72,35,199])for(const jerk of [100,774.78,500000])for(const delta of [1e-12,5e-12,1e-11,5e-11,9e-11]){
 const acceleration=200,target=speed-delta,half=Math.SQRT1_2,cornering=target*target*(1-half)/(acceleration*half),points=[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000}];
 check('near-cap-real-transitions',{speed,jerk,delta},()=>inspectNominal(core.planSCurve(points,speed,acceleration,jerk,cornering),points,speed,acceleration,0,0,jerk));
}

const profiles=[['axidraw','standard'],['axidraw-a3','standard'],['xylodraw','standard'],...['nextdraw-8511','nextdraw-1117','nextdraw-2234'].flatMap(id=>[[''+id,'standard'],[''+id,'brushless']])];
const heights=[0,.001,.01,.1,1,10,20,30,33.333,42,50,52,60,75,99.9,100];
function pulseIndependent(height,p){return Math.round(p.servoMin+(p.servoMax-p.servoMin)*height/100);}
function discreteCompletion(from,target,rate,period,phase){
 if(from===target)return 0;let pulse=from??target,time=phase;
 for(let n=0;n<40000;n++,time+=period){pulse=from===null||rate===0?target:pulse+Math.sign(target-pulse)*Math.min(rate,Math.abs(target-pulse));if(pulse===target)return time+target/12000;}
 throw new Error('independent pulse simulation did not converge');
}
function inspectPen(p,from,target,rate,up){
 const pen={...core.defaultPen,raiseRate:rate,lowerRate:rate},pulse=from===null?null:pulseIndependent(from,p),targetPulse=pulseIndependent(target,p),actualRate=Math.round(p.servoRateScale*rate);
 const t=core.planPenTransition(pulse,target,up,pen,p);
 assert.equal(t.targetPulse,targetPulse);assert.equal(t.rate,actualRate);assert.equal(t.initialize,from===null);
 assert.ok(Number.isInteger(t.durationMs)&&t.durationMs>=1&&t.durationMs<=65535,'queue range');
 for(const phase of [0,.000001,t.refreshMs/2,t.refreshMs-.000001]){
  const end=discreteCompletion(pulse,targetPulse,actualRate,t.refreshMs,phase),margin=t.electricalMs-end;
  assert.ok(margin>=-1e-7,`pulse deadline violated by ${-margin}ms`);if(pulse!==targetPulse)minimumPwmMarginMs=Math.min(minimumPwmMarginMs,margin);
 }
 const allowance=up?p.servoSettleUpMs+pen.upDelayMs:p.servoSettleDownMs+pen.downDelayMs;
 assert.ok(t.durationMs>=t.electricalMs+allowance+(from===null?p.servoStartupMs:0),'allowance lost');
 const extended=core.planPenTransition(pulse,target,up,{...pen,reloadWaitMs:1000,upDelayMs:pen.upDelayMs+17,downDelayMs:pen.downDelayMs+17},p,true);
 assert.equal(extended.rate,t.rate);assert.equal(extended.electricalMs,t.electricalMs);assert.equal(extended.durationMs,t.durationMs+1017);
 const minimum=core.planPenTransition(pulse,target,up,pen,p,false,t.durationMs+400);assert.equal(minimum.durationMs,t.durationMs+400);
 return t;
}
for(const [id,servo] of profiles){
 const p=core.machineProfile(id,0,8,servo);
 for(const rate of [1,2,5,10,25,50,75,99,100])for(const from of [null,...heights])for(const target of heights)for(const up of [false,true])check('pen-value-grid',{id,servo,rate,from,target,up},()=>inspectPen(p,from,target,rate,up));
 for(const up of [false,true])for(const [from,target] of [[30,52],[52,30],[50,50],[null,30]]){
  const t=inspectPen(p,from,target,up?75:50,up);rows.push({profile:id,servo,fromPercent:from,toPercent:target,direction:up?'up':'down',pulse:t.targetPulse,rate:t.rate,electricalMs:t.electricalMs,settlingMs:t.settlingMs,startupMs:t.startupMs,totalMs:t.durationMs});
 }
}
for(let rate=1;rate<=100;rate++)for(const from of [0,30,52,100])for(const target of [0,30,52,100])for(const up of [false,true])check('all-standard-rate-values',{rate,from,target,up},()=>inspectPen(core.machineProfile('xylodraw'),from,target,rate,up));
for(const [id,servo] of profiles)for(const up of [false,true])check('rate-monotonicity',{id,servo,up},()=>{
 const p=core.machineProfile(id,0,8,servo),from=pulseIndependent(30,p);let previous=Infinity;
 for(let rate=1;rate<=100;rate++){const pen={...core.defaultPen,raiseRate:rate,lowerRate:rate},t=core.planPenTransition(from,52,up,pen,p);assert.ok(t.durationMs<=previous,'higher electrical rate increased dwell');previous=t.durationMs;}
});
for(const from of [null,0,50,100])for(const target of [0,50,100])for(const up of [false,true])check('zero-electrical-rate',{from,target,up},()=>inspectPen({...core.machineProfile('xylodraw'),servoRateScale:0},from,target,1,up));
check('queue-duration-boundaries',{},()=>{
 const p=core.machineProfile('xylodraw');assert.equal(core.planPenTransition(null,50,true,core.defaultPen,p,false,65535).durationMs,65535);
 assert.throws(()=>core.planPenTransition(null,50,true,core.defaultPen,p,false,65536));
 assert.throws(()=>core.planPenTransition(pulseIndependent(0,p),100,true,{...core.defaultPen,raiseRate:1},{...p,servoRateScale:1}));
});
for(const value of [-1,101,NaN,Infinity])check('invalid-pen-values',{value:String(value)},()=>assert.throws(()=>core.planPenTransition(null,value,true,core.defaultPen,core.machineProfile('xylodraw'))));
for(const override of [{servoPeriod:0},{servoPeriod:7},{servoChannels:0},{servoMax:36001},{servoRateScale:-1},{servoStartupMs:-1}])check('invalid-profile-values',override,()=>assert.throws(()=>core.validateServoProfile({...core.machineProfile('xylodraw'),...override})));

// Independently sum controller integer polynomial ticks; never use the production
// predictor or maximum-rate helper as the expected answer.
function axisAt(t,a,initial){
 const T=BigInt(t),r=BigInt(a.rate),A=BigInt(a.acceleration),J=BigInt(a.jerk),base=r-A/2n+J/6n,B=2147483648n;
 const sum=BigInt(initial)+T*base+A*T*(T+1n)/2n+J*T*(T*T-1n)/6n;
 const steps=sum>=0n?sum/B:-((-sum+B-1n)/B);
 return{steps:Number(steps),carry:Number(sum-steps*B),rate:Number(base+A*T+J*T*(T-1n)/2n)};
}
function clearCarry(a){const b=a.rate-Math.trunc(a.acceleration/2)+Math.trunc(a.jerk/6)+a.acceleration;return b<0||b===0&&(a.acceleration+a.jerk<0||a.acceleration+a.jerk===0&&a.jerk<0)?2147483647:0;}
const shapes=[[{x:10,y:10},{x:40,y:10}],[{x:10,y:10},{x:10.01,y:10.01},{x:10.03,y:10.01},{x:11,y:11}],[{x:10,y:10},{x:30,y:10},{x:30,y:30},{x:10,y:30},{x:10,y:10}],[{x:10,y:10},{x:20,y:10},{x:10,y:10},{x:10,y:20}],[{x:10,y:10},{x:10,y:10},{x:12,y:11},{x:14,y:14},{x:16,y:15},{x:20,y:15}]];
for(const [id,servo] of profiles)for(const rotation of [0,90,180,270])for(const resolution of [8,16])for(const backend of ['sm','t3'])for(const [shape,points] of shapes.entries()){
 const profile=core.machineProfile(id,rotation,resolution,servo),options={profile,pen:{...core.defaultPen,up:30,down:52},speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:true,drawingMode:shape%2?'constant':'profiled',backend,firmware:backend==='t3'?'3.1.7':id.startsWith('nextdraw')?'3.0.2':'2.8.1'},paths=[{tool:'black',sourceId:'values:0',points}];
 check('compiled-profile-matrix',{id,servo,rotation,resolution,backend,shape},()=>{
  const plan=core.compileJob(paths,options);inspectExecutable(plan,paths);
  for(const r of plan.records)if(r.kind==='motor'){
   const limit=r.penDown?options.speed:options.travelSpeed;
   if(!r.native){const speed=Math.hypot(r.toSteps.m1-r.fromSteps.m1,r.toSteps.m2-r.fromSteps.m2)*1000/(Math.SQRT2*profile.stepsPerMm*r.durationMs);assert.ok(speed<=limit+1e-7,'SM scalar limit');continue;}
   let position={...r.fromSteps},carry={...r.native.accumulatorsBefore};
   for(const half of r.native.halves){
    const starts=[half.clear&1?clearCarry(half.axis1):carry.m1,half.clear&2?clearCarry(half.axis2):carry.m2],axes=[half.axis1,half.axis2];
    const ticks=new Set([0,half.ticks,...Array.from({length:15},(_,i)=>Math.floor(half.ticks*(i+1)/16))]);
    for(const a of axes)if(a.jerk){const critical=.5-a.acceleration/a.jerk;for(const k of [Math.floor(critical),Math.ceil(critical)])if(k>=0&&k<=half.ticks)ticks.add(k);}
    for(const t of ticks){const rates=axes.map((a,i)=>axisAt(t,a,starts[i]).rate),speed=Math.hypot(...rates)*25000/(2147483648*Math.SQRT2*profile.stepsPerMm);assert.ok(speed<=limit+1e-7,`T3 sampled speed ${speed}/${limit}`);}
    const a=axisAt(half.ticks,half.axis1,starts[0]),b=axisAt(half.ticks,half.axis2,starts[1]);position={m1:position.m1+a.steps,m2:position.m2+b.steps};carry={m1:a.carry,m2:b.carry};
   }
   assert.deepEqual(position,r.toSteps);assert.deepEqual(carry,r.native.accumulatorsAfter);
  }
 });
}
for(const [id,servo] of [['xylodraw','standard'],['axidraw','standard'],['nextdraw-8511','standard'],['nextdraw-8511','brushless']])for(const backend of ['sm','t3'])for(const timeout of [1,60000])await checkAsync('virtual-end-to-end',{id,servo,backend,timeout},async()=>{
 const profile=core.machineProfile(id,0,8,servo),firmware=backend==='t3'?'3.1.7':id.startsWith('nextdraw')?'3.0.2':'2.8.1',options={profile,pen:{...core.defaultPen,up:30,down:52,servoTimeoutMs:timeout,reloadWaitMs:100},speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:8,returnToOrigin:true,drawingMode:'profiled',backend,firmware};
 const paths=[{tool:'black',points:shapes[2],sourceId:'virtual:0'}],plan=core.compileJob(paths,options),clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware}),session=new core.PlotterSession(board.createTransport(),clock,profile);
 await session.connect();try{assert.equal(await session.run(plan),'finished');assert.equal(board.penUp,true);assert.deepEqual(board.position,{m1:0,m2:0});inspectTrace(board.trace);}finally{if(session.connected&&!session.busy)await session.disconnect();}
});

await mkdir(destination,{recursive:true});
const total=Object.values(groups).reduce((a,g)=>({cases:a.cases+g.cases,passed:a.passed+g.passed,failed:a.failed+g.failed}),{cases:0,passed:0,failed:0});
const result={format:'plot-it-offline-values-v1',createdAt:new Date().toISOString(),seed:'0x504c4f54',node:process.version,hardwareOpened:false,groups,total,worstDistanceErrorMm,worstVelocityContinuity,minimumPwmMarginMs,representativePenValues:rows,failures,sourceHashes:{}};
for(const path of ['packages/plotter-core/src/planner.ts','packages/plotter-core/src/scurve.ts','packages/plotter-core/src/junction.ts','packages/plotter-core/src/profiles.ts','packages/plotter-core/dist/scurve.js','packages/plotter-core/dist/planner.js','packages/plotter-core/dist/pen.js','packages/plotter-core/src/pen.ts','packages/plotter-core/src/feeder.ts','packages/plotter-core/src/compiler.ts','packages/plotter-core/src/version.ts','scripts/test-motion-values.mjs'])result.sourceHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
await writeFile(join(destination,'results.json'),JSON.stringify(result,null,2)+'\n');
const report=['# Offline value validation','',`Cases: **${total.passed}/${total.cases} passed**, ${total.failed} failed. Seed: \`0x504c4f54\`. No hardware opened.`, '', '| Group | Cases | Passed | Failed |','| --- | ---: | ---: | ---: |',...Object.entries(groups).map(([k,v])=>`| ${k} | ${v.cases} | ${v.passed} | ${v.failed} |`),'',`Worst nominal distance-integral error: ${worstDistanceErrorMm} mm. Minimum electrical guard margin observed: ${minimumPwmMarginMs} ms.`,'','## Representative pen values','', 'Existing user defaults, including 150 ms extra raise wait. Mechanical allowances are provisional, not measurements.','', '| Profile | Servo | From → to % | Direction | Electrical ms | Settle ms | Startup ms | Total ms |','| --- | --- | --- | --- | ---: | ---: | ---: | ---: |',...rows.map(r=>`| ${r.profile} | ${r.servo} | ${r.fromPercent??'unknown'} → ${r.toPercent} | ${r.direction} | ${r.electricalMs} | ${r.settlingMs} | ${r.startupMs} | ${r.totalMs} |`),'','## Limits','', 'This validates the stated mathematical/protocol model and selected simulated executions. T3 matrix checks endpoints plus interior samples and axis-rate extrema candidates; they are not a proof of every possible trajectory. The existing motion contract separately checks every tick on fixed fixtures. The virtual servo is not a contact sensor. No test establishes mechanical settling, missed physical steps, paper contact, vibration, or ink quality. Profiles remain experimental where hardware acceptance is pending. The full numerical values, failures, source hashes and environment are in results.json.','',...(failures.length?['## Failures','',...failures.map(f=>`- ${f.group}: ${JSON.stringify(f.input)} — ${f.error}`)]:[])].join('\n')+'\n';
await writeFile(join(destination,'REPORT.md'),report);console.log(JSON.stringify({destination,...total,groups,worstDistanceErrorMm,minimumPwmMarginMs},null,2));if(total.failed)process.exitCode=1;
