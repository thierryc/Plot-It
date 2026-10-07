import { fromNative, nativeEqual, roundEven, toNative } from './profiles.js';
import { planStroke, samplePhase, type Phase } from './planner.js';
import { penDuration, validatePen } from './pen.js';
import { checked, PlotterError, type ExecutablePlan, type ExecutionRecord, type MachineProfile, type MotorRecord, type NativePoint, type Path, type PlotOptions, type Point } from './types.js';
import {firmwareFromReply} from './protocol.js';
import {encodeT3,encodeTD,predictT3Axis,maximumRate} from './ebb-math.js';
import {planSCurve} from './scurve.js';
import {compileJerkPhases} from './modern-compiler.js';
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
export function compilePhases(phases:readonly Phase[],profile:MachineProfile,tool:string,penDown:boolean,current:NativePoint,startMs=0,width?:number):MotorRecord[] {
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
    const count=Math.max(1,Math.ceil(phase.duration*1000/SAMPLE_MS)),total=Math.max(count,Math.ceil(phase.duration*1000-1e-9));
    if(count>1e6)throw new PlotterError('invalid-plan','Compiled job exceeds command limit.');
    let elapsed=0,pending=0,first=true;
    for(let i=1;i<=count;i++) {
      const target=toNative(i===count?phase.to:samplePhase(phase,phase.duration*i/count),profile);
      const until=roundEven(total*i/count);pending+=until-elapsed;elapsed=until;
      if(nativeEqual(target,previous))continue;
      const steps=[Math.abs(target.m1-previous.m1),Math.abs(target.m2-previous.m2)],maxMs=Math.floor(Math.min(...steps.filter(Boolean))*1000/MIN_RATE);
      if(pending>maxMs){emit(previous,pending-maxMs,first&&phase.restBefore);pending=maxMs;first=false;}
      const ms=Math.max(pending,Math.ceil(Math.max(...steps)*1000/MAX_RATE));
      emit(target,ms,first&&phase.restBefore);pending=0;first=false;
    }
    if(pending)emit(previous,pending,first&&phase.restBefore);
  }
  return records;
}
export function validateOptions(o:PlotOptions):void {
  validatePen(o.pen);
  if(o.pen.synchronizedB3&&!o.profile.toolOutputB3)throw new PlotterError('invalid-plan','This profile does not support synchronized B3 output.');
  const p=o.profile;if(typeof p.id!=='string'||p.id.length>256)throw new PlotterError('invalid-plan','Invalid machine identity.');if(p.bounds){checked(p.bounds.width,.01,1e6,'machine width');checked(p.bounds.height,.01,1e6,'machine height');}if(o.firmware!==undefined){const firmware=firmwareFromReply(`EBB Firmware Version ${o.firmware}`);if(p.id.startsWith('nextdraw-')&&(!firmware.modern||firmware.minor===0&&firmware.patch<2))throw new PlotterError('unsupported-firmware','NextDraw requires 3.0.2 or newer.');}
  checked(p.stepsPerMm,1,10000,'motor scale');
  for(const value of [p.servoMin,p.servoMax])checked(value,1,65535,'servo calibration');
  if(![0,90,180,270].includes(p.rotation)||![1,2].includes(p.motorMode)||![1,2].includes(p.servoPin)||![1,8].includes(p.servoChannels)||!Number.isInteger(p.servoPeriod)||p.servoPeriod<1||p.servoPeriod>25)throw new PlotterError('invalid-plan','Invalid machine profile.');
  if(typeof o.returnToOrigin!=='boolean')throw new PlotterError('invalid-plan','Invalid return preference.');
  for(const [name,value] of Object.entries({speed:o.speed,travelSpeed:o.travelSpeed,acceleration:o.acceleration,travelAcceleration:o.travelAcceleration}))checked(value,1e-6,100000,name);
  checked(o.maxPenDownMm,0,1e6,'reload distance');checked(o.cornering,0,1e6,'cornering');
  if(!['profiled','constant'].includes(o.drawingMode))throw new PlotterError('invalid-plan','Invalid drawing mode.');
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
export function compileJob(paths:readonly Path[],options:PlotOptions,intent:'drawing'|'bounds'|'stationary'='drawing',splitBudget=options.maxPenDownMm):ExecutablePlan {
  validateOptions(options);
  if(!Array.isArray(paths)||paths.some((p:Path)=>!p||typeof p.tool!=='string'||p.tool.length>256||!Array.isArray(p.points)||p.points.some((q:Point)=>!q||!Number.isFinite(q.x)||!Number.isFinite(q.y)))||paths.length>100000||paths.reduce((sum,p)=>sum+p.points.length,0)>1000000)throw new PlotterError('invalid-plan','Source geometry exceeds the supported limit.');
  const bounds=options.profile.bounds,swapped=options.profile.rotation===90||options.profile.rotation===270;if(bounds&&paths.some(p=>p.points.some((q:Point)=>q.x<0||q.y<0||q.x>(swapped?bounds.height:bounds.width)||q.y>(swapped?bounds.width:bounds.height))))throw new PlotterError('invalid-plan','Clip source geometry to the selected machine bounds before compilation.');
  for(const path of paths)if(path.width!==undefined)checked(path.width,0,10000,'pen width');
  const o=JSON.parse(JSON.stringify(options)) as PlotOptions,profile=o.profile,records:ExecutionRecord[]=[];
  let current:NativePoint={m1:0,m2:0},time=0,tool='',height:number|null=null,drawingMm=0,travelMm=0;
  const add=(record:ExecutionRecord)=>{if(records.length>=1e6)throw new PlotterError('invalid-plan','Compiled job exceeds command limit.');record.id=records.length;record.startMs=time;time+=record.durationMs;records.push(record);};
  const pen=(down:boolean,reload=false)=> {
    const target=down?o.pen.down:o.pen.up,position=fromNative(current,profile);
    add({id:0,kind:'pen',startMs:time,durationMs:penDuration(height,target,!down,o.pen,reload,profile),from:position,to:position,penDown:down,tool});height=target;
  };
  const move=(points:readonly Point[],down:boolean,width?:number,sourceId?:string)=> {
    const quantized=points.map(p=>fromNative(toNative(p,profile),profile));
    const speed=Math.min(down?o.speed:o.travelSpeed,MAX_RATE/(Math.SQRT2*profile.stepsPerMm));
    const directions=points.slice(1).map((p,i)=>({x:p.x-points[i]!.x,y:p.y-points[i]!.y}));
    const phases=planStroke(quantized,speed,down?o.acceleration:o.travelAcceleration,down?o.cornering:0,down&&o.drawingMode==='constant',0,0,directions);
    const compiled=o.backend==='t3'?compileJerkPhases(planSCurve(quantized,speed,down?o.acceleration:o.travelAcceleration,down?o.drawingJerk??500000:o.travelJerk??330200,down?o.cornering:0,down&&o.drawingMode==='constant',directions),profile,tool,down,current,time,width,speed):compilePhases(phases,profile,tool,down,current,time,width);
    for(const record of compiled){if(sourceId)record.sourceId=sourceId;const d=length(record.from,record.to);if(down)drawingMm+=d;else travelMm+=d;add(record);current={...record.toSteps};}
  };
  const eligible=paths.filter(p=>p.points.length>1);
  if(!eligible.length&&intent!=='stationary')throw new PlotterError('invalid-plan','There are no paths to plot.');
  pen(false);
  for(const [pathIndex,path] of eligible.entries()) {
    if(path.tool!==tool) {
      if(tool) {move([fromNative(current,profile),{x:0,y:0}],false);const p=fromNative(current,profile);add({id:0,kind:'tool',startMs:time,durationMs:0,from:p,to:p,penDown:false,tool:path.tool});}
      tool=path.tool;
    }
    const source:Point[]=[];
    for(const point of path.points){
      if(source.length&&length(source.at(-1)!,point)<1e-12)continue;
      while(source.length>1){const a=source.at(-2)!,b=source.at(-1)!,ux=b.x-a.x,uy=b.y-a.y,vx=point.x-b.x,vy=point.y-b.y;if(ux*vx+uy*vy<=0||Math.abs(ux*vy-uy*vx)>1e-10*Math.hypot(ux,uy)*Math.hypot(vx,vy))break;source.pop();}
      source.push({...point});
    }
    const points=source.filter((p,i,all)=>!i||!nativeEqual(toNative(p,profile),toNative(all[i-1]!,profile)));
    if(points.length<2)continue;
    const chunks=intent==='drawing'?splitForReload(points,splitBudget,profile):[points];
    for(const [i,chunk] of chunks.entries()) {
      const travel=length(fromNative(current,profile),chunk[0]!);move([fromNative(current,profile),chunk[0]!],false);
      if(travel>=50){const p=fromNative(current,profile);add({id:0,kind:'motor',startMs:time,durationMs:100,from:p,to:p,fromSteps:{...current},toSteps:{...current},penDown:false,tool,restBefore:true});}
      if(intent==='drawing')pen(true);
      move(chunk,intent==='drawing',path.width,path.sourceId??`${path.layerId??'path'}:${pathIndex}`);
      const next=eligible[pathIndex+1],nextStartsHere=next?.tool===tool&&!!next.points[0]&&nativeEqual(current,toNative(next.points[0],profile));
      if(intent==='drawing')pen(false,i<chunks.length-1||!!o.maxPenDownMm&&!!nextStartsHere);
    }
  }
  if(o.returnToOrigin||intent==='bounds')move([fromNative(current,profile),{x:0,y:0}],false);
  const plan:ExecutablePlan={version:1,backend:o.backend??'sm',options:o,records,durationMs:time,drawingMm,travelMm};
  if(o.maxPenDownMm&&intent==='drawing'){
    let stroke=0,maximum=0;for(const record of records){if(record.kind==='motor'&&record.penDown)stroke+=length(record.from,record.to);if(record.kind==='pen'&&!record.penDown){maximum=Math.max(maximum,stroke);stroke=0;}}
    if(maximum>o.maxPenDownMm+1e-6)return compileJob(paths,options,intent,splitBudget*.9);
  }
  validatePlan(plan);return plan;
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
  if(plan.version!==1||!['sm','t3'].includes(plan.backend)||!plan.records.length||plan.records.length>1e6)throw new PlotterError('invalid-plan','Invalid executable plan.');
  validateOptions(plan.options);if((plan.options.backend??'sm')!==plan.backend)throw new PlotterError('invalid-plan','Backend metadata does not match the program.');let settings=plan.options,time=0,down=false,steps:NativePoint={m1:0,m2:0},height:number|null=null,drawn=0,accumulator:NativePoint|null=null;
  if(plan.durationMs>7*86400000)throw new PlotterError('invalid-plan','A single compiled copy exceeds seven days.');
  for(const value of [plan.durationMs,plan.drawingMm,plan.travelMm])checked(value,0,1e12,'plan totals');
  for(const [i,r]of plan.records.entries()) {
    if(r.settings){validateOptions(r.settings);if(r.kind!=='pen'||r.penDown||JSON.stringify(r.settings.profile)!==JSON.stringify(plan.options.profile)||(r.settings.backend??'sm')!==plan.backend)throw new PlotterError('invalid-plan','Layer settings can change only raised at rest with the same profile/backend.');settings=r.settings;}
    if(!r.from||!r.to||![r.from.x,r.from.y,r.to.x,r.to.y].every(value=>typeof value==='number'&&Number.isFinite(value))||typeof r.penDown!=='boolean'||typeof r.tool!=='string'||r.tool.length>256)throw new PlotterError('invalid-plan','Invalid executable geometry or pen state.');
    if(r.kind==='motor'&&r.sourceId!==undefined&&(typeof r.sourceId!=='string'||r.sourceId.length>4096))throw new PlotterError('invalid-plan','Invalid source identity.');
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
      }else{accumulator=null;if(plan.backend==='t3'&&(!nativeEqual(r.fromSteps,r.toSteps)||!r.restBefore))throw new PlotterError('invalid-plan','Modern program contains an unplanned SM move.');}
      steps={...r.toSteps};if(down)drawn+=length(r.from,r.to);
    } else {
      if(r.kind==='pen'){
        const target=r.penDown?settings.pen.down:settings.pen.up;
        const reload=!r.penDown&&plan.options.maxPenDownMm>0&&plan.records[i+1]?.kind==='pen'&&plan.records[i+1]?.penDown;
        if(r.durationMs<penDuration(height,target,!r.penDown,settings.pen,!!reload,settings.profile)||r.durationMs>65535)throw new PlotterError('invalid-plan','Invalid pen settling time.');
        if(!r.penDown&&plan.options.maxPenDownMm&&drawn>plan.options.maxPenDownMm+1e-6)throw new PlotterError('invalid-plan','Compiled stroke exceeds mechanical reload distance.');
        if(!r.penDown)drawn=0;down=r.penDown;height=target;
      } else if(r.kind==='delay'){if(down||r.penDown||r.durationMs>86400000)throw new PlotterError('invalid-plan','Invalid stationary layer wait.');}
      else if(!['tool','pause'].includes(r.kind)||down||r.penDown||r.durationMs||!nativeEqual(steps,{m1:0,m2:0}))throw new PlotterError('invalid-plan','Invalid stationary record.');
      if(length(r.from,r.to)>1e-9||length(r.from,fromNative(steps,plan.options.profile))>1e-9)throw new PlotterError('invalid-plan','A pen transition must be stationary.');
    }
    time+=r.durationMs;
  }
  if(down||Math.abs(time-plan.durationMs)>1e-7)throw new PlotterError('invalid-plan','The plot must finish with the pen raised and a valid duration.');
  if(plan.options.returnToOrigin&&!nativeEqual(steps,{m1:0,m2:0}))throw new PlotterError('invalid-plan','The plot must finish at the origin when return to origin is enabled.');
}

/** Add the mandatory inter-copy raised return without changing any drawing record. */
export function withRaisedReturn(input:ExecutablePlan):ExecutablePlan {
 validatePlan(input);if(input.options.returnToOrigin)return JSON.parse(JSON.stringify(input)) as ExecutablePlan;
 const plan=JSON.parse(JSON.stringify(input)) as ExecutablePlan,options={...plan.options,returnToOrigin:true},records=[...plan.records];
 const last=records.filter((r):r is MotorRecord=>r.kind==='motor').at(-1),current=last?.toSteps??{m1:0,m2:0},from=fromNative(current,options.profile);
 const moves=options.backend==='t3'?compileJerkPhases(planSCurve([from,{x:0,y:0}],options.travelSpeed,options.travelAcceleration,options.travelJerk??330200,0),options.profile,last?.tool??'',false,current,plan.durationMs,undefined,options.travelSpeed):compilePhases(planStroke([from,{x:0,y:0}],options.travelSpeed,options.travelAcceleration,0),options.profile,last?.tool??'',false,current,plan.durationMs);
 let time=plan.durationMs,travel=plan.travelMm;for(const r of moves){r.id=records.length;r.startMs=time;time+=r.durationMs;travel+=length(r.from,r.to);records.push(r);}
 const result={...plan,options,records,durationMs:time,travelMm:travel};validatePlan(result);return result;
}
