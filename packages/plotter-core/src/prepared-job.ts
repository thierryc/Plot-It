import {compileJob,validatePlan,validateOptions} from './compiler.js';
import {digest,clone} from './identity.js';
import {validateRepeat,singleCopy,type RepeatSettings,type Layer,type SequenceSegment} from './sequence.js';
import {checked,PlotterError,type ExecutablePlan,type Path,type PlotOptions} from './types.js';
import {resumeAtDistance} from './resume.js';
import {compileLayerProgram} from './layer-program.js';
import {COMPILER_VERSION} from './version.js';
export {COMPILER_VERSION} from './version.js';
export interface PreparedJob {version:2;compiler:string;target:{firmware:string;profile:string;backend:'sm'|'t3';resolution:1|2};paths:readonly Path[];options:PlotOptions;repeat:RepeatSettings;program:ExecutablePlan;digest:string;layers?:readonly Layer[];segments?:readonly SequenceSegment[];startAtMm?:number}
export function preparePaths(paths:readonly Path[],options:PlotOptions,repeat:RepeatSettings=singleCopy,startAtMm=0):PreparedJob {
 options={...options,handling:options.handling??'custom'};checked(startAtMm,0,1e12,'drawing offset');validateRepeat(repeat);const snapshot=clone(paths),base=compileJob(snapshot,options),program=startAtMm?resumeAtDistance(base,startAtMm):base;
 const job={version:2 as const,compiler:COMPILER_VERSION,target:{firmware:options.firmware??'2.8.1',profile:options.profile.id,backend:program.backend,resolution:options.profile.motorMode},paths:snapshot,options:clone(options),repeat:clone(repeat),program,...(startAtMm?{startAtMm}:{})};
 return clone({...job,digest:digest(job)});
}
/** Recompile admission from normalized geometry; raw serialized commands are never trusted. */
export function validatePreparedJob(value:unknown):PreparedJob {
 if(!value||typeof value!=='object')throw new PlotterError('invalid-plan','Missing prepared job.');
 const job=value as PreparedJob;if(job.version!==2||job.compiler!==COMPILER_VERSION||!Array.isArray(job.paths)||job.paths.length>100000||typeof job.digest!=='string'||!/^[a-f0-9]{64}$/.test(job.digest))throw new PlotterError('invalid-plan','Invalid prepared job identity.');
 validateOptions(job.options);validateRepeat(job.repeat);validatePlan(job.program);
 const recomputed=job.layers?prepareLayerJob(job.layers,job.options,job.repeat,job.startAtMm):preparePaths(job.paths,job.options,job.repeat,job.startAtMm);
 if(recomputed.digest!==job.digest||digest({...job,digest:undefined})!==job.digest)throw new PlotterError('invalid-plan','Prepared job does not match the shared compiler.');return clone(recomputed);
}
export function exportPrepared(job:PreparedJob):string {validatePreparedJob(job);return JSON.stringify(job);}
export function importPrepared(text:string):PreparedJob {if(text.length>32*1024*1024)throw new PlotterError('invalid-plan','Prepared file exceeds 32 MiB.');return validatePreparedJob(JSON.parse(text));}
export function prepareLayerJob(layers:readonly Layer[],options:PlotOptions,repeat:RepeatSettings=singleCopy,startAtMm=0):PreparedJob {
 if(!Array.isArray(layers)||layers.length>100000)throw new PlotterError('invalid-plan','Invalid layers.');
 options={...options,handling:options.handling??'custom'};const snapshot=clone(layers),paths=snapshot.filter(l=>l.included!==false&&!l.hidden&&!l.documentation).flatMap(l=>l.paths);
 options={...options,handling:options.handling??'custom'};checked(startAtMm,0,1e12,'drawing offset');validateRepeat(repeat);const base=compileLayerProgram(snapshot,options),program=startAtMm?resumeAtDistance(base,startAtMm):base;
 const fields={version:2 as const,compiler:COMPILER_VERSION,target:{firmware:options.firmware??'2.8.1',profile:options.profile.id,backend:program.backend,resolution:options.profile.motorMode},paths,options:clone(options),repeat:clone(repeat),program};
 const job={...fields,layers:snapshot,...(startAtMm?{startAtMm}:{})};return clone({...job,digest:digest(job)});
}
