import type { Point, PlotSettings } from './model';
import type { PlotPath } from './svg';
import {toNative,sampleExecution,type ExecutablePlan,type Path,type Layer} from '@thierryc/plotter-core';
import type { PlotPen } from './pens';
import {compileJob,compilePhases,motorCommand,SAMPLE_MS,validateOptions,toNative as nativePoint} from '@thierryc/plotter-core';
import {coreOptions} from './core-settings';

export interface MotionEvent {
  kind: 'xy' | 'pen' | 'tool'; start: number; duration: number;
  from: Point; to: Point; initialSpeed: number; acceleration: number;
  penDown: boolean; tool: string; width?: number;
  /** Required rest boundary, including simplified short moves that start above zero. */
  stopBefore?: boolean;
  penHeight?:number; label?:string;
}
export interface PenPass { tool: string; start: number; end: number; startEvent: number; endEvent: number }
export interface MotionPlan { events: MotionEvent[]; duration: number; settings: PlotSettings; passes: PenPass[]; pens?: PlotPen[]; executable?:ExecutablePlan; sourcePaths?:readonly Path[];layers?:readonly Layer[] }
export interface MotionSample { position: Point; speed: number; penDown: boolean; tool: string; index: number; progress: number }
/** Editor adapter. Fresh core compilation is the single source for preview and hardware. */
export function buildMotionPlan(paths: PlotPath[], settings: PlotSettings, onProgress?: (fraction: number) => void,intent:'drawing'|'bounds'='drawing'): MotionPlan {
  const options=coreOptions(settings);validateOptions(options);
  const eligible:PlotPath[]=[];
  for(const path of paths){
    if(!path.points.some(point=>{const first=nativePoint(path.points[0]!,options.profile),next=nativePoint(point,options.profile);return first.m1!==next.m1||first.m2!==next.m2;}))continue;
    const previous=eligible.at(-1);
    if(!settings.maxPenDownMm&&previous&&!previous.orderGroup&&!path.orderGroup&&previous.tool===path.tool&&previous.width===path.width&&Math.hypot(previous.points.at(-1)!.x-path.points[0]!.x,previous.points.at(-1)!.y-path.points[0]!.y)<1e-9)previous.points.push(...path.points.slice(1).map(p=>({...p})));
    else eligible.push({...path,points:path.points.map(p=>({...p}))});
  }
  if(!eligible.length)return {events:[],duration:0,settings:{...settings},passes:[]};
  const program=compileJob(eligible,options,intent);for(let i=0;i<eligible.length;i++)onProgress?.((i+1)/eligible.length);
  return motionPlanFromProgram(program,settings,eligible.map(p=>({...p,points:p.points.map(point=>({...point}))})));
}
/** The editor renders semantic layer waits/gates; the native program remains authoritative. */
export function motionPlanFromProgram(program:ExecutablePlan,settings:PlotSettings,sourcePaths?:readonly Path[],layers?:readonly Layer[]):MotionPlan {
  let duration=0,resolved=program.options;
  const events:MotionEvent[]=program.records.map(record=>{if(record.settings)resolved=record.settings;const start=duration;duration+=record.durationMs/1000;return({
    kind:record.kind==='motor'||record.kind==='delay'?'xy':record.kind==='pause'?'tool':record.kind,start,duration:record.durationMs/1000,
    from:{...record.from},to:{...record.to},initialSpeed:record.kind==='motor'?Math.hypot(record.to.x-record.from.x,record.to.y-record.from.y)*1000/record.durationMs:0,
    acceleration:0,penDown:record.penDown,tool:record.tool,penHeight:record.penDown?resolved.pen.down:resolved.pen.up,label:record.label,
    ...(record.kind==='motor'?{stopBefore:record.restBefore,width:record.width}:{}),
  });});
  const passes:PenPass[]=[];
  for(let i=1;i<events.length;i++) {
    const event=events[i]!;
    if(!passes.length||event.kind==='tool') {
      if(passes.length){passes.at(-1)!.end=event.start;passes.at(-1)!.endEvent=i;}
      passes.push({tool:event.tool,start:event.start,end:duration,startEvent:i,endEvent:events.length});
    }
  }
  return {events,duration,settings:{...structuredClone(settings),pauseOnToolChange:true},passes,executable:program,sourcePaths:sourcePaths??[],...(layers?{layers}:{})};
}
export function sampleEvent(event: MotionEvent, seconds: number): { position: Point; speed: number } {
  const t = Math.max(0, Math.min(event.duration, seconds));
  if(t===event.duration)return {position:{...event.to},speed:0};
  const length = Math.hypot(event.to.x-event.from.x, event.to.y-event.from.y);
  const distance = Math.max(0, Math.min(length, event.initialSpeed*t + event.acceleration*t*t/2));
  const f = length ? distance/length : 0;
  return { position: { x: event.from.x+(event.to.x-event.from.x)*f, y: event.from.y+(event.to.y-event.from.y)*f }, speed: event.kind === 'xy' ? Math.max(0,event.initialSpeed+event.acceleration*t) : 0 };
}
export function samplePlan(plan: MotionPlan, time: number): MotionSample {
  const t = Math.max(0,Math.min(plan.duration,time));
  let lo=0, hi=plan.events.length;
  while(lo<hi) { const mid=(lo+hi)>>>1; if(plan.events[mid]!.start<=t) lo=mid+1; else hi=mid; }
  const index=Math.max(0,lo-1), event=plan.events[index];
  if(!event) return {position:{x:0,y:0},speed:0,penDown:false,tool:'',index:0,progress:1};
  if(plan.executable){const sampled=sampleExecution(plan.executable,t*1000);return{position:sampled.position,speed:sampled.speed,penDown:sampled.penDown,tool:sampled.tool,index:sampled.recordId,progress:plan.duration?t/plan.duration:1};}
  if(t>=plan.duration)return {position:{...event.to},speed:0,penDown:event.penDown,tool:event.tool,index,progress:1};
  return {...sampleEvent(event,t-event.start),penDown:event.penDown,tool:event.tool,index,progress:plan.duration?t/plan.duration:1};
}
export interface CompiledMotion { command: string; targetSteps: Point; durationMs: number }
export const MOTION_INTERVAL_MS = SAMPLE_MS;

/** Put integer timing/rate corrections into the shared plan, including preview. */
export function normalizeMotionTiming(event: MotionEvent, settings: PlotSettings): MotionEvent {
  if (event.kind !== 'xy') return { ...event };
  let result = { ...event };
  for (let attempt = 0; attempt < 20; attempt++) {
    const duration = compileMotion(result, settings, (()=>{const p=toNative(event.from,coreOptions(settings).profile);return{x:(p.m1+p.m2)/2,y:(p.m1-p.m2)/2};})()).reduce((sum, move) => sum + move.durationMs, 0) / 1000;
    if (Math.abs(duration - result.duration) < 1e-12) return result;
    const ratio = result.duration / duration;
    result = { ...result, duration, initialSpeed: result.initialSpeed * ratio, acceleration: result.acceleration * ratio * ratio };
  }
  throw new Error('Unable to resolve integer motion timing.');
}
/** Documented timed mixed-axis moves; all firmware uses the same command path. */
export function compileMotion(event: MotionEvent, settings: PlotSettings, currentSteps: Point): CompiledMotion[] {
  if(event.kind!=='xy')return [];
  const profile=coreOptions(settings).profile;
  const current={m1:currentSteps.x+currentSteps.y,m2:currentSteps.x-currentSteps.y};
  const records=compilePhases([{from:event.from,to:event.to,duration:event.duration,initialSpeed:event.initialSpeed,acceleration:event.acceleration,restBefore:!!event.stopBefore}],profile,event.tool,event.penDown,current);
  return records.map(record=>({command:motorCommand(record),durationMs:record.durationMs,targetSteps:{x:(record.toSteps.m1+record.toSteps.m2)/2,y:(record.toSteps.m1-record.toSteps.m2)/2}}));
}
