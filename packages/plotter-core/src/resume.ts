import {validatePlan} from './compiler.js';
import {compileLayerProgram} from './layer-program.js';
import type {Layer} from './sequence.js';
import {digest} from './identity.js';
import {PlotterError,type ExecutablePlan,type Path,type NativePoint,type PlotOptions} from './types.js';
export interface Checkpoint {version:1;programDigest:string;record:number;drawingMm:number;position:NativePoint;copy:number;layer:string;seed:number;origin:'verified'|'uncertain';sourcePath?:string;settings?:PlotOptions}
/** Called only for settled execution evidence, never for command ACKs. */
export function checkpointAt(plan:ExecutablePlan,settledRecord:number,copy=1,layer='',seed=0):Checkpoint {
 validatePlan(plan);if(!Number.isInteger(settledRecord)||settledRecord<0||settledRecord>=plan.records.length)throw new PlotterError('invalid-plan','Invalid settled cursor.');
 let drawingMm=0,position:NativePoint={m1:0,m2:0},settings=plan.options,sourcePath='';for(const r of plan.records.slice(0,settledRecord+1)){if(r.settings)settings=r.settings;if(r.kind==='motor'){sourcePath=r.sourceId??sourcePath;position={...r.toSteps};if(r.penDown)drawingMm+=Math.hypot(r.to.x-r.from.x,r.to.y-r.from.y);}}
 return{version:1,programDigest:digest(plan),record:settledRecord,drawingMm,position,copy,layer,seed,origin:'verified',sourcePath,settings:JSON.parse(JSON.stringify(settings))};
}
export function validateCheckpoint(checkpoint:Checkpoint,plan:ExecutablePlan):void {
 if(checkpoint.version!==1||checkpoint.programDigest!==digest(plan)||checkpoint.origin!=='verified'||!Number.isInteger(checkpoint.copy)||checkpoint.copy<1||!Number.isInteger(checkpoint.seed)||checkpoint.seed<0)throw new PlotterError('invalid-plan','Stale or incompatible resume checkpoint.');
 const expected=checkpointAt(plan,checkpoint.record,checkpoint.copy,checkpoint.layer,checkpoint.seed);
 if(Math.abs(expected.drawingMm-checkpoint.drawingMm)>1e-8||expected.position.m1!==checkpoint.position.m1||expected.position.m2!==checkpoint.position.m2||checkpoint.sourcePath!==undefined&&checkpoint.sourcePath!==expected.sourcePath||checkpoint.settings!==undefined&&digest(checkpoint.settings)!==digest(expected.settings))throw new PlotterError('invalid-plan','Corrupted resume checkpoint.');
}
/** Resume offsets are drawing distances, not XY translations. Replans from rest. */
export function resumeAtDistance(plan:ExecutablePlan,distance:number):ExecutablePlan {
 validatePlan(plan);if(!Number.isFinite(distance))throw new PlotterError('invalid-plan','Invalid resume distance.');
 if(distance<=0)return JSON.parse(JSON.stringify(plan)) as ExecutablePlan;
 let remaining=Math.max(0,distance),stroke:Path|null=null,options=plan.options,label='Resume',started=false;
 const layers:Layer[]=[];let layer:Layer|null=null;
 const block=()=>{if(!layer){layer={id:`resume-${layers.length}`,name:label,paths:[],options};layers.push(layer);}return layer;};
 for(const r of plan.records){
  if(r.settings){options=r.settings;label=r.label??label;stroke=null;layer=null;}
  if(r.kind==='motor'&&r.penDown){const length=Math.hypot(r.to.x-r.from.x,r.to.y-r.from.y);
   if(remaining>=length-1e-12){remaining=Math.max(0,remaining-length);continue;}
   started=true;const current=block();
   if(!stroke){const f=length?remaining/length:0;stroke={tool:r.tool,width:r.width,points:[{x:r.from.x+(r.to.x-r.from.x)*f,y:r.from.y+(r.to.y-r.from.y)*f}]};current.paths=[...current.paths,stroke];remaining=0;}
   stroke.points=[...stroke.points,{...r.to}];
  }else if(r.kind==='pen'&&!r.penDown)stroke=null;
  else if(started&&(r.kind==='pause'||r.kind==='delay')){layer=null;stroke=null;const current=block();current.name=r.label??label;if(r.kind==='pause')current.pause=true;else current.delayMs=r.durationMs;layer=null;}
 }
 if(!layers.some(l=>l.paths.length))throw new PlotterError('invalid-plan','Resume distance is at or beyond the end of drawing.');return compileLayerProgram(layers,plan.options);
}
export function resumeCheckpoint(plan:ExecutablePlan,checkpoint:Checkpoint,adjustMm=0):ExecutablePlan {validateCheckpoint(checkpoint,plan);return resumeAtDistance(plan,checkpoint.drawingMm+adjustMm);}

/** O(n) once at preparation, O(1) at settlement; safe for large signal journals. */
export class CheckpointIndex {
 private identity:string;private distances:number[]=[];private positions:NativePoint[]=[];private settings:PlotOptions[]=[];private sources:string[]=[];
 constructor(plan:ExecutablePlan){validatePlan(plan);this.identity=digest(plan);let distance=0,position:NativePoint={m1:0,m2:0},settings=plan.options,source='';for(const r of plan.records){if(r.settings)settings=r.settings;if(r.kind==='motor')source=r.sourceId??source;if(r.kind==='motor'){position={...r.toSteps};if(r.penDown)distance+=Math.hypot(r.to.x-r.from.x,r.to.y-r.from.y);}this.distances.push(distance);this.positions.push({...position});this.settings.push(settings);this.sources.push(source);}}
 at(record:number,copy=1,layer='',seed=0):Checkpoint{if(!Number.isInteger(record)||record<0||record>=this.distances.length)throw new PlotterError('invalid-plan','Invalid settled cursor.');return{version:1,programDigest:this.identity,record,drawingMm:this.distances[record]!,position:{...this.positions[record]!},copy,layer,seed,origin:'verified',sourcePath:this.sources[record],settings:JSON.parse(JSON.stringify(this.settings[record]))};}
}
