import {compileJob,validatePlan} from './compiler.js';
import {smCompilation} from './sm-compilation.js';
import {planningModelFor,PEN_TIMING_MODEL} from './version.js';
import {clone} from './identity.js';
import {compileLayers,type Layer} from './sequence.js';
import  {PlotterError,type ExecutablePlan,type ExecutionRecord,type PlotOptions,type Path} from './types.js';
/** Layer timers/gates remain semantic records; they are never stuffed into the FIFO. */
export function compileLayerProgram(layers:readonly Layer[],options:PlotOptions):ExecutablePlan {
 if(!Array.isArray(layers)||layers.length>100000||layers.reduce((sum:number,l:Layer)=>sum+l.paths.reduce((n:number,p:Path)=>n+p.points.length,0),0)>1000000)throw new PlotterError('invalid-plan','Layer geometry exceeds source limits.');const identities=new Set<string>();for(const layer of layers){if(!layer.id||identities.has(layer.id))throw new PlotterError('invalid-plan','Duplicate layer identity.');identities.add(layer.id);}
 const proofBudget={remaining:200000},visible=layers.filter(l=>l.included!==false&&!l.hidden&&!l.documentation),prepared=visible.map((layer,index)=>({layer,segments:compileLayers([layer],{...options,returnToOrigin:index<visible.length-1||options.returnToOrigin},proofBudget)}));
 // Layer boundaries preserve SM carry. If any layer lacks an all-carry source
 // certificate, keep the entire composition on its original command stream.
 const originalSM=options.backend!=='t3'&&options.firmware==='3.1.7'&&prepared.some(({segments})=>segments.some(s=>s.plan&&!smCompilation(s.plan)?.certified));
 const initial=compileJob([],options,'stationary').records[0]!,records:ExecutionRecord[]=[clone(initial)];let time=initial.durationMs,drawingMm=0,travelMm=0,tool='';
 const append=(r:ExecutionRecord)=>{if(records.length>=1000000)throw new PlotterError('invalid-plan','Layer command limit exceeded.');r.id=records.length;r.startMs=time;time+=r.durationMs;records.push(r);};
 const barrier=(kind:'pause'|'delay'|'tool',durationMs:number,label:string,color=tool)=>append({id:0,kind,startMs:0,durationMs,from:{x:0,y:0},to:{x:0,y:0},tool:color,penDown:false,label});
 for(const {layer,segments}of prepared){const selected=segments.find(s=>s.plan)?.plan,program=selected&&originalSM?(smCompilation(selected)?.baseline??selected):selected,nextTool=program?.records.find(r=>r.penDown)?.tool??tool;
  if(layer.pause)barrier('pause',0,layer.name,tool||nextTool);
  if(layer.delayMs)barrier('delay',layer.delayMs,layer.name,tool||nextTool);
  if(!program)continue;
  if(tool&&nextTool!==tool)barrier('tool',0,layer.name,nextTool);tool=nextTool;
  for(const source of program.records){const r=clone(source);if(r.id===0){r.settings=clone(program.options);r.tool=tool;r.label=layer.name;}if(r.tool)tool=r.tool;append(r);}
  drawingMm+=program.drawingMm;travelMm+=program.travelMm;
 }
 // Restore the original pen settings after a temporary layer override at origin.
 if(records.length>1){const r=clone(initial);r.from=r.to={...records.at(-1)!.to};r.settings=clone(options);r.tool=tool;append(r);}
 const result:ExecutablePlan={version:1,planningModel:planningModelFor(options.backend,options.firmware,options.motionStrategy),timingModel:PEN_TIMING_MODEL,backend:options.backend??'sm',options:clone(options),records,durationMs:time,drawingMm,travelMm};if(options.workloadCheckpoints){const previews=prepared.flatMap(({segments})=>segments.flatMap(s=>s.plan?.workloadCheckpoints?[s.plan.workloadCheckpoints]:[]));result.workloadCheckpoints={cuts:previews.flatMap(p=>p.cuts),chunkCount:previews.reduce((sum,p)=>sum+p.chunkCount,0),addedDurationMs:previews.reduce((sum,p)=>sum+p.addedDurationMs,0)};}validatePlan(result);return result;
}
