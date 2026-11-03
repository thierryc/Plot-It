import { fromNative, nativeEqual, roundEven, toNative } from './profiles.js';
import { planStroke, samplePhase, type Phase } from './planner.js';
import {planPenTransition,penRecordReload,validatePen,validateServoProfile} from './pen.js';
import {planningModelFor,PEN_TIMING_MODEL} from './version.js';
import { checked, PlotterError, type ExecutablePlan, type ExecutionRecord, type MachineProfile, type MotorRecord, type NativePoint, type Path, type PlotOptions, type Point } from './types.js';
import {firmwareFromReply} from './protocol.js';
import {encodeT3,encodeTD,predictT3Axis,maximumRate} from './ebb-math.js';
import {planSCurve} from './scurve.js';
import {planDynamicSCurve} from './dynamic.js';
import {compileJerkPhases} from './modern-compiler.js';
import {smBounds,smRate,smExactCorridor,type SMProofBudget} from './sm-bounds.js';
import {rememberSMCompilation,smCompilation} from './sm-compilation.js';
import {splitForWorkload,validateWorkloadLimits,validateWorkloadProgram} from './workload-checkpoints.js';
import type {WorkloadChunkIdentity} from './types.js';
export const MAX_RATE=24995, MIN_RATE=2, SAMPLE_MS=25;
export function motorCommand(record:MotorRecord):string {
  if(record.native){if(!Array.isArray(record.native.halves)||record.native.command!=='T3'&&record.native.command!=='TD'||record.native.halves.length!==(record.native.command==='T3'?1:2))throw new PlotterError('invalid-plan','Invalid T3 record shape.');const [a,b]=record.native.halves;if(!a)throw new PlotterError('invalid-plan','Missing T3 parameters.');return record.native.command==='TD'&&b?encodeTD(a,b):encodeT3(a);}
  const ms=record.durationMs,m1=record.toSteps.m1-record.fromSteps.m1,m2=record.toSteps.m2-record.fromSteps.m2;
  for(const value of [ms,m1,m2])if(!Number.isSafeInteger(value))throw new PlotterError('invalid-plan','Invalid native motor integer.');
  checked(ms,1,65535,'motion duration');
  for(const count of [m1,m2]) {
    checked(count,-2147483648,2147483647,'motor steps');
    if(count&&Math.abs(count)*1000/ms<MIN_RATE-1e-9||Math.abs(count)*1000/ms>MAX_RATE+1e-9)throw new PlotterError('invalid-plan','Native motor rate outside supported range.');
  }
  return `SM,${ms},${m1},${m2}`;
}
/** Compile rounded native endpoints and integer durations before preview or serial I/O. */
export function compilePhases(phases:readonly Phase[],profile:MachineProfile,tool:string,penDown:boolean,current:NativePoint,startMs=0,width?:number,maxSpeed=Infinity,firmware?:string):MotorRecord[] {
  return compileSMPhases(phases,profile,tool,penDown,current,startMs,width,maxSpeed,firmware).records;
}
type PhaseRecords={phase:Phase;records:MotorRecord[]};
function compileSMPhases(phases:readonly Phase[],profile:MachineProfile,tool:string,penDown:boolean,current:NativePoint,startMs:number,width:number|undefined,maxSpeed:number,firmware?:string,sourceError=0,budget:SMProofBudget={remaining:200000}):{records:MotorRecord[];original:MotorRecord[];certified:boolean} {
  const groups:PhaseRecords[]=[],originalRecords=compileSampledPhases(phases,profile,tool,penDown,current,startMs,width,maxSpeed,undefined,firmware==='3.1.7'?groups:undefined);
  const tolerance=Math.SQRT2/profile.stepsPerMm-sourceError;
  if(firmware!=='3.1.7'||!groups.every(group=>group.records.every(r=>smBounds(r,group.phase,profile).distance<=tolerance||smExactCorridor(r,group.phase,profile,tolerance,budget))))return{records:originalRecords,original:originalRecords,certified:false};
  const records:MotorRecord[]=[];let previous=current,time=startMs;
  for(const {phase,records:original} of groups){
    let selected=original;
    const originalDuration=original.reduce((sum,r)=>sum+r.durationMs,0);
    const originalDistance=original.reduce((sum,r)=>sum+length(r.from,r.to),0);
    if(phase.acceleration===0&&phase.initialSpeed>0&&length(phase.from,phase.to)>0&&original.length>1&&!original.some(r=>nativeEqual(r.fromSteps,r.toSteps))){
      let count=Math.max(1,Math.ceil(phase.duration*1000/100));
      // Endpoint retiming and float32 rounding can make a nominal 100 ms move
      // finish later. At most three bounded resamplings seek a <=2500-tick move.
      for(let attempt=0;attempt<3;attempt++){
        let candidate:MotorRecord[];
        try{candidate=compileSampledPhases([phase],profile,tool,penDown,previous,time,width,maxSpeed,count);}
        catch(error){if(error instanceof PlotterError&&error.code==='invalid-plan')break;throw error;}
        const bounds=candidate.map(r=>smBounds(r,phase,profile)),longest=bounds.reduce((maximum,b)=>Math.max(maximum,b.ticks),0);
        if(longest>2500){count=Math.max(count+1,Math.ceil(count*longest/2499));continue;}
        if(candidate.length<=original.length&&candidate.reduce((sum,r)=>sum+r.durationMs,0)<=originalDuration&&candidate.reduce((sum,r)=>sum+length(r.from,r.to),0)<=originalDistance&&bounds.every((b,i)=>b.speed<=maxSpeed&&b.axisRate<=MAX_RATE&&(b.distance<=tolerance||smExactCorridor(candidate[i]!,phase,profile,tolerance,budget))))selected=candidate;
        break;
      }
    }
    for(const record of selected){records.push({...record,startMs:time});time+=record.durationMs;previous=record.toSteps;}
  }
  return budget.remaining<0?{records:originalRecords,original:originalRecords,certified:false}:{records,original:originalRecords,certified:true};
}
function compileSampledPhases(phases:readonly Phase[],profile:MachineProfile,tool:string,penDown:boolean,current:NativePoint,startMs:number,width:number|undefined,maxSpeed:number,sampleCount?:number,groups?:PhaseRecords[]):MotorRecord[] {
  const records:MotorRecord[]=[];let previous={...current},time=startMs;
  const emit=(target:NativePoint,ms:number,restBefore:boolean)=> {
    while(ms>65535){append(previous,65535,restBefore);ms-=65535;restBefore=false;}
    append(target,ms,restBefore);
  };
  const append=(target:NativePoint,ms:number,restBefore:boolean)=> {
    if(!ms)return;
    const record:MotorRecord={id:0,kind:'motor',startMs:time,durationMs:ms,tool,penDown,
      from:fromNative(previous,profile),to:fromNative(target,profile),fromSteps:{...previous},toSteps:{...target},restBefore,width};
    motorCommand(record);records.push(record);time+=ms;previous={...target};
    if(records.length>1e6)throw new PlotterError('invalid-plan','Compiled job exceeds command limit.');
  };
  for(const phase of phases) {
    const firstRecord=records.length;
    const count=sampleCount??Math.max(1,Math.ceil(phase.duration*1000/SAMPLE_MS)),total=Math.max(count,Math.ceil(phase.duration*1000-1e-9));
    if(count>1e6)throw new PlotterError('invalid-plan','Compiled job exceeds command limit.');
    let elapsed=0,pending=0,first=true;
    for(let i=1;i<=count;i++) {
      const target=toNative(i===count?phase.to:samplePhase(phase,phase.duration*i/count),profile);
      const until=roundEven(total*i/count);pending+=until-elapsed;elapsed=until;
      if(nativeEqual(target,previous))continue;
      const steps=[Math.abs(target.m1-previous.m1),Math.abs(target.m2-previous.m2)],maxMs=Math.floor(Math.min(...steps.filter(Boolean))*1000/MIN_RATE);
      if(pending>maxMs){emit(previous,pending-maxMs,first&&phase.restBefore);pending=maxMs;first=false;}
      // Rounding an endpoint can increase scalar XY speed even below both axis caps.
      const minimumMs=Math.max(1,Math.ceil(Math.hypot(...steps)*1000/(Math.SQRT2*profile.stepsPerMm*maxSpeed)-1e-9),Math.ceil(Math.max(...steps)*1000/MAX_RATE));
      if(minimumMs>maxMs)throw new PlotterError('invalid-plan','Requested speed is below the supported discrete motor rate.');
      let ms=Math.max(pending,minimumMs);
      if(sampleCount!==undefined){
        const rates=steps.map(n=>smRate(n,ms)),factor=25000/2147483648;
        if(Math.hypot(...rates)*factor/(Math.SQRT2*profile.stepsPerMm)>maxSpeed||Math.max(...rates)*factor>MAX_RATE)ms++;
        if(ms>maxMs)throw new PlotterError('invalid-plan','Requested speed is below the supported discrete motor rate.');
      }
      emit(target,ms,first&&phase.restBefore);pending=0;first=false;
    }
    if(pending)emit(previous,pending,first&&phase.restBefore);
    if(groups)groups.push({phase,records:records.slice(firstRecord)});
  }
  return records;
}
export function validateOptions(o:PlotOptions):void {
  validatePen(o.pen);
  if(o.workloadCheckpoints!==undefined)validateWorkloadLimits(o.workloadCheckpoints);
  if(o.pen.synchronizedB3&&!o.profile.toolOutputB3)throw new PlotterError('invalid-plan','This profile does not support synchronized B3 output.');
  const p=o.profile;if(typeof p.id!=='string'||p.id.length>256)throw new PlotterError('invalid-plan','Invalid machine identity.');if(p.bounds){checked(p.bounds.width,.01,1e6,'machine width');checked(p.bounds.height,.01,1e6,'machine height');}if(o.firmware!==undefined){const firmware=firmwareFromReply(`EBB Firmware Version ${o.firmware}`);if(p.id.startsWith('nextdraw-')&&(!firmware.modern||firmware.minor===0&&firmware.patch<2))throw new PlotterError('unsupported-firmware','NextDraw requires 3.0.2 or newer.');}
  checked(p.stepsPerMm,1,10000,'motor scale');
  validateServoProfile(p);
  if(![0,90,180,270].includes(p.rotation)||![1,2].includes(p.motorMode))throw new PlotterError('invalid-plan','Invalid machine profile.');
  if(typeof o.returnToOrigin!=='boolean')throw new PlotterError('invalid-plan','Invalid return preference.');
  for(const [name,value] of Object.entries({speed:o.speed,travelSpeed:o.travelSpeed,acceleration:o.acceleration,travelAcceleration:o.travelAcceleration}))checked(value,1e-6,100000,name);
  checked(o.maxPenDownMm,0,1e6,'reload distance');checked(o.cornering,0,1e6,'cornering');
  if(!['profiled','constant'].includes(o.drawingMode))throw new PlotterError('invalid-plan','Invalid drawing mode.');
  if(o.motionStrategy!==undefined&&!['standard','dynamic'].includes(o.motionStrategy))throw new PlotterError('invalid-plan','Invalid motion strategy.');
  if(o.dynamicCurveAcceleration!==undefined)checked(o.dynamicCurveAcceleration,1e-9,100000,'Dynamic curve acceleration');
  if(o.dynamicAnticipationMm!==undefined)checked(o.dynamicAnticipationMm,0,20,'Dynamic anticipation');
  if(o.motionStrategy==='dynamic'&&(o.backend!=='t3'||o.firmware!=='3.1.7'||o.drawingMode!=='profiled'))throw new PlotterError('invalid-plan','Dynamic requires profiled T3 motion on EBB 3.1.7.');
  if(o.backend!==undefined&&!['sm','t3'].includes(o.backend))throw new PlotterError('invalid-plan','Invalid backend.');
  if(o.backend==='t3'){if(o.firmware!=='3.1.7')throw new PlotterError('unsupported-firmware','T3 preparation requires the validated EBB 3.1.7 target.');checked(o.drawingJerk??500000,1,1e9,'drawing jerk');checked(o.travelJerk??330200,1,1e9,'travel jerk');}
}
const length=(a:Point,b:Point)=>Math.hypot(b.x-a.x,b.y-a.y);
/** Split quantized geometry; do not silently exceed the mechanical reload budget. */
export function splitForReload(points:readonly Point[],budget:number,profile:MachineProfile):Point[][] {
  if(!budget)return[points.map(p=>({...p}))];
  const resolution=Math.SQRT2/profile.stepsPerMm;
  if(budget<=resolution)throw new PlotterError('invalid-plan','Reload distance is below supported move resolution.');
  const chunks:Point[][]=[];let chunk:Point[]=[{...points[0]!}],used=0,cursor={...points[0]!};
  for(const endpoint of points.slice(1)) {
    while(length(cursor,endpoint)>budget-used+1e-9) {
      const len=length(cursor,endpoint),remaining=Math.max(0,budget-used-resolution),fraction=remaining/len;
      const p=fromNative(toNative({x:cursor.x+(endpoint.x-cursor.x)*fraction,y:cursor.y+(endpoint.y-cursor.y)*fraction},profile),profile);
      if(length(cursor,p)>1e-12){chunk.push(p);cursor=p;}
      if(chunk.length<2)throw new PlotterError('invalid-plan','Unable to split reload distance on the motor lattice.');
      chunks.push(chunk);chunk=[{...cursor}];used=0;
    }
    used+=length(cursor,endpoint);chunk.push({...endpoint});cursor={...endpoint};
  }
  if(chunk.length>1)chunks.push(chunk);return chunks;
}
export function compileJob(paths:readonly Path[],options:PlotOptions,intent:'drawing'|'bounds'|'stationary'='drawing',splitBudget=options.maxPenDownMm,proofBudget:SMProofBudget={remaining:200000}):ExecutablePlan {
  validateOptions(options);
  if(!Array.isArray(paths)||paths.some((p:Path)=>!p||typeof p.tool!=='string'||p.tool.length>256||!Array.isArray(p.points)||p.points.some((q:Point)=>!q||!Number.isFinite(q.x)||!Number.isFinite(q.y)))||paths.length>100000||paths.reduce((sum,p)=>sum+p.points.length,0)>1000000)throw new PlotterError('invalid-plan','Source geometry exceeds the supported limit.');
  const bounds=options.profile.bounds,swapped=options.profile.rotation===90||options.profile.rotation===270;if(bounds&&paths.some(p=>p.points.some((q:Point)=>q.x<0||q.y<0||q.x>(swapped?bounds.height:bounds.width)||q.y>(swapped?bounds.width:bounds.height))))throw new PlotterError('invalid-plan','Clip source geometry to the selected machine bounds before compilation.');
  for(const path of paths)if(path.width!==undefined)checked(path.width,0,10000,'pen width');
  const o=JSON.parse(JSON.stringify(options)) as PlotOptions,profile=o.profile,records:ExecutionRecord[]=[],originalRecords:ExecutionRecord[]=[],modernSM=o.backend!=='t3'&&o.firmware==='3.1.7';
  let allCarrySafe=!o.workloadCheckpoints;
  let current:NativePoint={m1:0,m2:0},time=0,tool='',pulse:number|null=null,drawingMm=0,travelMm=0;
  const add=(record:ExecutionRecord,stable=true)=>{if(records.length>=1e6)throw new PlotterError('invalid-plan','Compiled job exceeds command limit.');record.id=records.length;record.startMs=time;time+=record.durationMs;records.push(record);if(modernSM&&stable)originalRecords.push(record);};
  const pen=(down:boolean,reload=false,workloadCheckpoint?:WorkloadChunkIdentity)=> {
    const target=down?o.pen.down:o.pen.up,position=fromNative(current,profile);
    const transition=planPenTransition(pulse,target,!down,o.pen,profile,reload);
    add({id:0,kind:'pen',startMs:time,durationMs:transition.durationMs,from:position,to:position,penDown:down,tool,reload,...(workloadCheckpoint?{workloadCheckpoint}:{})});pulse=transition.targetPulse;
  };
  const move=(points:readonly Point[],down:boolean,width?:number,sourceId?:string,workloadChunk?:WorkloadChunkIdentity)=> {
    const quantized=points.map(p=>fromNative(toNative(p,profile),profile));
    const speed=Math.min(down?o.speed:o.travelSpeed,MAX_RATE/(Math.SQRT2*profile.stepsPerMm));
    const directions=points.slice(1).map((p,i)=>({x:p.x-points[i]!.x,y:p.y-points[i]!.y}));
    let compiled:MotorRecord[];
    if(o.backend==='t3')compiled=compileJerkPhases(down&&o.motionStrategy==='dynamic'?planDynamicSCurve(quantized,{speed,acceleration:o.acceleration,jerk:o.drawingJerk??500000,cornering:o.cornering,curveAcceleration:o.dynamicCurveAcceleration,anticipationMm:o.dynamicAnticipationMm},points):planSCurve(quantized,speed,down?o.acceleration:o.travelAcceleration,down?o.drawingJerk??500000:o.travelJerk??330200,down?o.cornering:0,down&&o.drawingMode==='constant',directions),profile,tool,down,current,time,width,speed);
    else{
      const sourceError=points.reduce((maximum,p,i)=>Math.max(maximum,length(p,quantized[i]!)),0);
      const result=compileSMPhases(planStroke(quantized,speed,down?o.acceleration:o.travelAcceleration,down?o.cornering:0,down&&o.drawingMode==='constant',0,0,directions),profile,tool,down,current,time,width,speed,o.firmware,sourceError,proofBudget);
      compiled=result.records;allCarrySafe&&=result.certified;
      if(modernSM)for(const record of result.original){if(sourceId)record.sourceId=sourceId;if(workloadChunk)record.workloadChunk=workloadChunk;originalRecords.push(record);}
    }
    for(const record of compiled){if(workloadChunk)record.workloadChunk=workloadChunk;if(sourceId)record.sourceId=sourceId;const d=length(record.from,record.to);if(down)drawingMm+=d;else travelMm+=d;add(record,false);current={...record.toSteps};}
  };
  const eligible=paths.filter(p=>p.points.length>1);
  if(!eligible.length&&intent!=='stationary')throw new PlotterError('invalid-plan','There are no paths to plot.');
  pen(false);
  for(const [pathIndex,path] of eligible.entries()) {
    if(path.tool!==tool) {
      if(tool) {move([fromNative(current,profile),{x:0,y:0}],false);const p=fromNative(current,profile);add({id:0,kind:'tool',startMs:time,durationMs:0,from:p,to:p,penDown:false,tool:path.tool});}
      tool=path.tool;
    }
    // Collinear source samples are redundant when cornering is enabled. Keep
    // every vertex when cornering=0, since each one then requests a stop.
    const points:Point[]=[];
    for(const point of path.points as readonly Point[]){
      if(points.length&&length(points.at(-1)!,point)<1e-12)continue;
      if(o.cornering>0)while(points.length>1){const a=points.at(-2)!,b=points.at(-1)!,ux=b.x-a.x,uy=b.y-a.y,vx=point.x-b.x,vy=point.y-b.y;if(ux*vx+uy*vy<=0||Math.abs(ux*vy-uy*vx)>1e-10*Math.hypot(ux,uy)*Math.hypot(vx,vy))break;points.pop();}
      points.push({...point});
    }
    if(points.length<2||!points.some(p=>!nativeEqual(toNative(p,profile),toNative(points[0]!,profile))))continue;
    const reloadChunks=intent==='drawing'?splitForReload(points,splitBudget,profile):[points];
    let sourceOffset=0;
    const chunks=reloadChunks.flatMap((reloadChunk,reloadIndex)=>{
      const sourceId=path.sourceId??`${path.layerId??'path'}:${pathIndex}`;
      const {workloadCheckpoints:limits,...continuous}=o;
      const pieces=limits&&intent==='drawing'?splitForWorkload(reloadChunk,limits,candidate=>{
        const trial=compileJob([{...path,points:candidate}],{...continuous,maxPenDownMm:0,returnToOrigin:false});
        // Main SM composition uses the conservative baseline too, so a later
        // uncertified travel/layer cannot invalidate an accepted chunk budget.
        return (modernSM?smCompilation(trial)?.baseline??trial:trial).records.filter((r):r is MotorRecord=>r.kind==='motor'&&r.penDown);
      },Math.SQRT2/profile.stepsPerMm):[{points:reloadChunk,fromMm:0,toMm:reloadChunk.slice(1).reduce((sum,p,i)=>sum+length(reloadChunk[i]!,p),0)}];
      const result=pieces.map((piece,chunkIndex)=>({points:piece.points,reloadEnd:chunkIndex===pieces.length-1,checkpoint:chunkIndex<pieces.length-1,identity:limits?{sourceId,strokeIndex:pathIndex,reloadIndex,chunkIndex,sourceFromMm:sourceOffset+piece.fromMm,sourceToMm:sourceOffset+piece.toMm}:undefined}));
      sourceOffset+=pieces.at(-1)?.toMm??0;return result;
    });
    for(const [i,item] of chunks.entries()) {
      const chunk=item.points;
      const travel=length(fromNative(current,profile),chunk[0]!);move([fromNative(current,profile),chunk[0]!],false);
      if(travel>=50){const p=fromNative(current,profile);add({id:0,kind:'motor',startMs:time,durationMs:100,from:p,to:p,fromSteps:{...current},toSteps:{...current},penDown:false,tool,restBefore:true});}
      if(intent==='drawing')pen(true);
      move(chunk,intent==='drawing',path.width,path.sourceId??`${path.layerId??'path'}:${pathIndex}`,item.identity);
      const next=eligible[pathIndex+1],nextStartsHere=next?.tool===tool&&!!next.points[0]&&nativeEqual(current,toNative(next.points[0],profile));
      if(intent==='drawing')pen(false,item.reloadEnd&&(i<chunks.length-1||!!o.maxPenDownMm&&!!nextStartsHere),item.checkpoint?item.identity:undefined);
    }
  }
  if(o.returnToOrigin||intent==='bounds')move([fromNative(current,profile),{x:0,y:0}],false);
  const assemble=(program:ExecutionRecord[]):ExecutablePlan=>{
    let elapsed=0,drawn=0,travel=0;
    for(const [i,r]of program.entries()){r.id=i;r.startMs=elapsed;elapsed+=r.durationMs;if(r.kind==='motor'){const d=length(r.from,r.to);if(r.penDown)drawn+=d;else travel+=d;}}
    return{version:1,planningModel:planningModelFor(o.backend,o.firmware,o.motionStrategy),timingModel:PEN_TIMING_MODEL,backend:o.backend??'sm',options:o,records:program,durationMs:elapsed,drawingMm:drawn,travelMm:travel};
  };
  const plan:ExecutablePlan=modernSM?assemble(!allCarrySafe?originalRecords:records):{version:1 as const,planningModel:planningModelFor(o.backend,o.firmware,o.motionStrategy),timingModel:PEN_TIMING_MODEL,backend:o.backend??'sm',options:o,records,durationMs:time,drawingMm,travelMm};
  if(o.maxPenDownMm&&intent==='drawing'){
    // Reload split decisions remain those of the original program, even if a
    // longer straight command removes some harmless native-lattice zigzags.
    let stroke=0,maximum=0;for(const record of modernSM?originalRecords:records){if(record.kind==='motor'&&record.penDown)stroke+=length(record.from,record.to);if(record.kind==='pen'&&!record.penDown){maximum=Math.max(maximum,stroke);stroke=0;}}
    if(maximum>o.maxPenDownMm+1e-6)return compileJob(paths,options,intent,splitBudget*.9,proofBudget);
  }
  if(o.workloadCheckpoints&&intent==='drawing'){
    const {workloadCheckpoints:_limits,...continuous}=options;
    const baseline=compileJob(paths,continuous,intent,splitBudget);
    plan.workloadCheckpoints={cuts:plan.records.flatMap(r=>r.kind==='pen'&&r.workloadCheckpoint?[{point:{...r.to},identity:r.workloadCheckpoint}]:[]),chunkCount:new Set(plan.records.flatMap(r=>r.kind==='motor'&&r.workloadChunk?[JSON.stringify(r.workloadChunk)]:[])).size,addedDurationMs:plan.durationMs-baseline.durationMs};
  }
  validatePlan(plan);
  if(modernSM)rememberSMCompilation(plan,allCarrySafe,allCarrySafe?assemble(originalRecords.map(r=>({...r}))):plan);
  return plan;
}
export function sampleExecution(plan:ExecutablePlan,ms:number):{position:Point;penDown:boolean;recordId:number;tool:string;speed:number} {
  let lo=0,hi=plan.records.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(plan.records[mid]!.startMs<=ms)lo=mid+1;else hi=mid;}
  const record=plan.records[Math.max(0,lo-1)]!;
  const f=record.durationMs?Math.max(0,Math.min(1,(ms-record.startMs)/record.durationMs)):1;
  let position={...record.to},nativeSpeed=0;
  if(record.kind==='motor'){
    if(record.native){let elapsed=Math.max(0,Math.min(record.durationMs,ms-record.startMs)),steps={...record.fromSteps},acc={...record.native.accumulatorsBefore};
      for(const p of record.native.halves){const ticks=Math.min(p.ticks,Math.floor(elapsed*25+1e-8));const a=predictT3Axis(ticks,p.axis1,p.clear&1?'clear':acc.m1),b=predictT3Axis(ticks,p.axis2,p.clear&2?'clear':acc.m2);const velocity=fromNative({m1:a.rate*25000/2147483648,m2:b.rate*25000/2147483648},plan.options.profile);nativeSpeed=Math.hypot(velocity.x,velocity.y);steps={m1:steps.m1+a.steps,m2:steps.m2+b.steps};acc={m1:a.accumulator,m2:b.accumulator};elapsed-=ticks/25;if(ticks<p.ticks)break;}position=fromNative(steps,plan.options.profile);
    }else position=fromNative({m1:record.fromSteps.m1+roundEven((record.toSteps.m1-record.fromSteps.m1)*f),m2:record.fromSteps.m2+roundEven((record.toSteps.m2-record.fromSteps.m2)*f)},plan.options.profile);
  }
  return {position,penDown:record.penDown,recordId:record.id,tool:record.tool,speed:record.kind==='motor'&&f<1?(record.native?nativeSpeed:length(record.from,record.to)*1000/record.durationMs):0};
}
export function validatePlan(plan:ExecutablePlan):void {
  if(plan.planningModel!==planningModelFor(plan.backend,plan.options?.firmware,plan.options?.motionStrategy)||plan.timingModel!==PEN_TIMING_MODEL)throw new PlotterError('invalid-plan','Unsupported executable motion/timing model; prepare again.');
  if(plan.version!==1||!['sm','t3'].includes(plan.backend)||!plan.records.length||plan.records.length>1e6)throw new PlotterError('invalid-plan','Invalid executable plan.');
  validateOptions(plan.options);if((plan.options.backend??'sm')!==plan.backend)throw new PlotterError('invalid-plan','Backend metadata does not match the program.');let settings=plan.options,time=0,down=false,steps:NativePoint={m1:0,m2:0},pulse:number|null=null,drawn=0,accumulator:NativePoint|null=null;
  if(plan.durationMs>7*86400000)throw new PlotterError('invalid-plan','A single compiled copy exceeds seven days.');
  for(const value of [plan.durationMs,plan.drawingMm,plan.travelMm])checked(value,0,1e12,'plan totals');
  for(const [i,r]of plan.records.entries()) {
    if(r.settings){validateOptions(r.settings);if((r.settings.motionStrategy??'standard')!==(plan.options.motionStrategy??'standard'))throw new PlotterError('invalid-plan','Layer motion strategy must match the job target.');if(r.settings.firmware!==undefined&&r.settings.firmware!==plan.options.firmware)throw new PlotterError('invalid-plan','Layer firmware must match the job target.');if(r.kind!=='pen'||r.penDown||JSON.stringify(r.settings.profile)!==JSON.stringify(plan.options.profile)||(r.settings.backend??'sm')!==plan.backend)throw new PlotterError('invalid-plan','Layer settings can change only raised at rest with the same profile/backend.');settings=r.settings;}
    if(!r.from||!r.to||![r.from.x,r.from.y,r.to.x,r.to.y].every(value=>typeof value==='number'&&Number.isFinite(value))||typeof r.penDown!=='boolean'||typeof r.tool!=='string'||r.tool.length>256)throw new PlotterError('invalid-plan','Invalid executable geometry or pen state.');
    if(r.kind==='motor'&&r.sourceId!==undefined&&(typeof r.sourceId!=='string'||r.sourceId.length>4096))throw new PlotterError('invalid-plan','Invalid source identity.');
    if(r.kind==='motor'&&r.motionReason!==undefined&&(!['curve','junction','stop','acceleration'].includes(r.motionReason)||settings.motionStrategy!=='dynamic'||!r.penDown))throw new PlotterError('invalid-plan','Invalid Dynamic motion explanation.');
    if(plan.options.profile.bounds){const b=plan.options.profile.bounds,p=plan.options.profile,swapped=p.rotation===90||p.rotation===270,tolerance=1/p.stepsPerMm;for(const q of [r.from,r.to])if(q.x< -tolerance||q.y< -tolerance||q.x>(swapped?b.height:b.width)+tolerance||q.y>(swapped?b.width:b.height)+tolerance)throw new PlotterError('invalid-plan','Executable position exceeds machine bounds.');}
    if(r.label!==undefined&&(typeof r.label!=='string'||r.label.length>4096))throw new PlotterError('invalid-plan','Invalid execution label.');
    if(r.kind==='motor'&&r.width!==undefined)checked(r.width,0,10000,'pen width');
    if(r.id!==i||Math.abs(r.startMs-time)>1e-7||!Number.isFinite(r.durationMs)||r.durationMs<0||(!Number.isSafeInteger(r.durationMs)&&!(r.kind==='motor'&&r.native)))throw new PlotterError('invalid-plan','Invalid executable timeline.');
    if(i===0&&(r.kind!=='pen'||r.penDown))throw new PlotterError('invalid-plan','The plot must start by raising the pen at the origin.');
    if(r.kind==='motor'){
      if(!r.fromSteps||!r.toSteps||![r.fromSteps.m1,r.fromSteps.m2,r.toSteps.m1,r.toSteps.m2].every(value=>Number.isSafeInteger(value)&&value>=-2147483648&&value<=2147483647))throw new PlotterError('invalid-plan','Invalid native position.');
      if(r.penDown!==down||!nativeEqual(r.fromSteps,steps)||length(r.from,fromNative(r.fromSteps,plan.options.profile))>1e-9||length(r.to,fromNative(r.toSteps,plan.options.profile))>1e-9)throw new PlotterError('invalid-plan','Inconsistent native motion state.');
      motorCommand(r);
      if(r.native){let predicted={...r.fromSteps},acc={...r.native.accumulatorsBefore},ticks=0;
        if(r.native.halves.some(p=>p.ticks>12500))throw new PlotterError('invalid-plan','Native command exceeds the bounded feeding horizon.');
        if(![acc.m1,acc.m2,r.native.accumulatorsAfter.m1,r.native.accumulatorsAfter.m2].every(n=>Number.isInteger(n)&&n>=0&&n<=2147483647))throw new PlotterError('invalid-plan','Invalid accumulator state.');
        const clear=r.native.halves[0]!.clear;
        if((!accumulator&&clear!==3)||accumulator&&(!(clear&1)&&acc.m1!==accumulator.m1||!(clear&2)&&acc.m2!==accumulator.m2))throw new PlotterError('invalid-plan','Discontinuous native accumulator state.');
        for(const p of r.native.halves){const actualSpeed=Math.hypot(maximumRate(p.ticks,p.axis1),maximumRate(p.ticks,p.axis2))*25000/2147483648/(Math.SQRT2*settings.profile.stepsPerMm);if(actualSpeed>(r.penDown?settings.speed:settings.travelSpeed)+1e-7)throw new PlotterError('invalid-plan','Native speed exceeds the prepared limit.');const a=predictT3Axis(p.ticks,p.axis1,p.clear&1?'clear':acc.m1),b=predictT3Axis(p.ticks,p.axis2,p.clear&2?'clear':acc.m2);predicted={m1:predicted.m1+a.steps,m2:predicted.m2+b.steps};acc={m1:a.accumulator,m2:b.accumulator};ticks+=p.ticks;}
        if(plan.backend!=='t3'||Math.abs(ticks/25-r.durationMs)>1e-7||!nativeEqual(predicted,r.toSteps)||!nativeEqual(acc,r.native.accumulatorsAfter))throw new PlotterError('invalid-plan','T3 predictions do not match the executable record.');
        accumulator=acc;
      }else{const scalar=length(r.from,r.to)*1000/r.durationMs;if(scalar>(r.penDown?settings.speed:settings.travelSpeed)+1e-7)throw new PlotterError('invalid-plan','SM speed exceeds the prepared limit.');accumulator=null;if(plan.backend==='t3'&&(!nativeEqual(r.fromSteps,r.toSteps)||!r.restBefore))throw new PlotterError('invalid-plan','Modern program contains an unplanned SM move.');}
      steps={...r.toSteps};if(down)drawn+=length(r.from,r.to);
    } else {
      if(r.kind==='pen'){
        const target=r.penDown?settings.pen.down:settings.pen.up;
        if(r.reload!==undefined&&typeof r.reload!=='boolean'||r.penDown&&r.reload)throw new PlotterError('invalid-plan','Invalid pen reload intent.');
        const transition=planPenTransition(pulse,target,!r.penDown,settings.pen,settings.profile,penRecordReload(plan,i));
        if(r.durationMs<transition.durationMs||r.durationMs>65535)throw new PlotterError('invalid-plan','Invalid pen settling time.');
        if(!r.penDown&&plan.options.maxPenDownMm&&drawn>plan.options.maxPenDownMm+1e-6)throw new PlotterError('invalid-plan','Compiled stroke exceeds mechanical reload distance.');
        if(!r.penDown)drawn=0;down=r.penDown;pulse=transition.targetPulse;
      } else if(r.kind==='delay'){if(down||r.penDown||r.durationMs>86400000)throw new PlotterError('invalid-plan','Invalid stationary layer wait.');}
      else if(!['tool','pause'].includes(r.kind)||down||r.penDown||r.durationMs||!nativeEqual(steps,{m1:0,m2:0}))throw new PlotterError('invalid-plan','Invalid stationary record.');
      if(length(r.from,r.to)>1e-9||length(r.from,fromNative(steps,plan.options.profile))>1e-9)throw new PlotterError('invalid-plan','A pen transition must be stationary.');
    }
    time+=r.durationMs;
  }
  validateWorkloadProgram(plan);
  if(down||Math.abs(time-plan.durationMs)>1e-7)throw new PlotterError('invalid-plan','The plot must finish with the pen raised and a valid duration.');
  if(plan.options.returnToOrigin&&!nativeEqual(steps,{m1:0,m2:0}))throw new PlotterError('invalid-plan','The plot must finish at the origin when return to origin is enabled.');
}

/** Add the mandatory inter-copy raised return without changing any drawing record. */
export function withRaisedReturn(input:ExecutablePlan):ExecutablePlan {
 validatePlan(input);if(input.options.returnToOrigin)return JSON.parse(JSON.stringify(input)) as ExecutablePlan;
 const plan=JSON.parse(JSON.stringify(input)) as ExecutablePlan,options={...plan.options,returnToOrigin:true},records=[...plan.records];
 const last=records.filter((r):r is MotorRecord=>r.kind==='motor').at(-1),current=last?.toSteps??{m1:0,m2:0},from=fromNative(current,options.profile);
 // A deserialized prefix has no ephemeral compilation certificate. Preserve
 // its exact bytes and keep the added return on the original 25 ms sampler.
 const moves=options.backend==='t3'?compileJerkPhases(planSCurve([from,{x:0,y:0}],options.travelSpeed,options.travelAcceleration,options.travelJerk??330200,0),options.profile,last?.tool??'',false,current,plan.durationMs,undefined,options.travelSpeed):compilePhases(planStroke([from,{x:0,y:0}],options.travelSpeed,options.travelAcceleration,0),options.profile,last?.tool??'',false,current,plan.durationMs,undefined,options.travelSpeed);
 if(options.backend!=='t3'&&options.firmware==='3.1.7'){
   const source:Phase={from,to:{x:0,y:0},duration:0,initialSpeed:0,acceleration:0,restBefore:true},tolerance=Math.SQRT2/options.profile.stepsPerMm,budget={remaining:200000};
   if(moves.some(r=>smBounds(r,source,options.profile).distance>tolerance&&!smExactCorridor(r,source,options.profile,tolerance,budget)))throw new PlotterError('invalid-plan','Cannot certify the inter-copy return; prepare the complete job with return to origin enabled.');
 }
 let time=plan.durationMs,travel=plan.travelMm;for(const r of moves){r.id=records.length;r.startMs=time;time+=r.durationMs;travel+=length(r.from,r.to);records.push(r);}
 const result={...plan,options,records,durationMs:time,travelMm:travel};validatePlan(result);return result;
}
