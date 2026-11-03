import {checked,PlotterError,type Point,type MotorRecord,type WorkloadCheckpointLimits,type ExecutablePlan,type WorkloadChunkIdentity} from './types.js';
export const DEFAULT_WORKLOAD_CHECKPOINTS:Readonly<WorkloadCheckpointLimits>=Object.freeze({maxDrawingRecords:2000,maxDrawingMs:10000,maxDrawingMm:250});
export function validateWorkloadLimits(limits:WorkloadCheckpointLimits):void {
 if(!limits||typeof limits!=='object')throw new PlotterError('invalid-plan','Invalid workload checkpoint budgets.');
 checked(limits.maxDrawingRecords,1,1000000,'workload drawing record budget');
 if(!Number.isInteger(limits.maxDrawingRecords))throw new PlotterError('invalid-plan','Workload record budget must be an integer.');
 checked(limits.maxDrawingMs,.04,1e9,'workload drawing time budget');checked(limits.maxDrawingMm,.000001,1e9,'workload drawing distance budget');
}
const distance=(a:Point,b:Point)=>Math.hypot(b.x-a.x,b.y-a.y);
export function drawingFits(records:readonly MotorRecord[],limits:WorkloadCheckpointLimits):boolean {
 return records.length<=limits.maxDrawingRecords&&records.reduce((sum,r)=>sum+r.durationMs,0)<=limits.maxDrawingMs+1e-7&&records.reduce((sum,r)=>sum+distance(r.from,r.to),0)<=limits.maxDrawingMm+1e-7;
}
/** Cut source geometry, never native commands. Each trial is replanned rest-to-rest.
 * Binary search is conservative: it keeps only actually compiled, verified prefixes.
 * Non-monotone quantization can leave a shorter chunk; it cannot exceed a budget. */
export function splitForWorkload(points:readonly Point[],limits:WorkloadCheckpointLimits,compile:(points:readonly Point[])=>readonly MotorRecord[],resolution:number):{points:Point[];fromMm:number;toMm:number}[] {
 const cumulative=[0];for(let i=1;i<points.length;i++)cumulative.push(cumulative[i-1]!+distance(points[i-1]!,points[i]!));
 const total=cumulative.at(-1)!,chunks:{points:Point[];fromMm:number;toMm:number}[]=[];
 const pointAt=(s:number):Point=>{if(s<=0)return{...points[0]!};if(s>=total)return{...points.at(-1)!};let lo=1,hi=cumulative.length-1;while(lo<hi){const mid=(lo+hi)>>>1;if(cumulative[mid]!<s)lo=mid+1;else hi=mid;}const a=points[lo-1]!,b=points[lo]!,f=(s-cumulative[lo-1]!)/(cumulative[lo]!-cumulative[lo-1]!);return{x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f};};
 const slice=(start:number,end:number)=>{const result=[pointAt(start)];for(let i=1;i<points.length-1;i++)if(cumulative[i]!>start&&cumulative[i]!<end)result.push({...points[i]!});result.push(pointAt(end));return result;};
 let start=0;
 while(start<total-1e-10){
  // A geometrical upper bound keeps dense-path trials local. Native distance is
  // checked separately, including any quantization zigzags.
  let hi=Math.min(total,start+limits.maxDrawingMm),lo=start,best:Point[]|undefined;
  const candidate=slice(start,hi),records=compile(candidate);
  if(records.some(r=>distance(r.from,r.to)>0)&&drawingFits(records,limits)){best=candidate;lo=hi;}
  else for(let iteration=0;iteration<24&&hi-lo>resolution/16;iteration++){
   const mid=(lo+hi)/2,prefix=slice(start,mid),trial=compile(prefix);
   if(trial.some(r=>distance(r.from,r.to)>0)&&drawingFits(trial,limits)){
    lo=mid;best=prefix;
    const utilization=Math.max(trial.length/limits.maxDrawingRecords,trial.reduce((sum,r)=>sum+r.durationMs,0)/limits.maxDrawingMs,trial.reduce((sum,r)=>sum+distance(r.from,r.to),0)/limits.maxDrawingMm);
    // Near-threshold work is sufficient; chasing sub-step binary precision
    // would repeatedly recompile thousands of native records without a useful
    // physical improvement. The retained prefix still passes all exact limits.
    if(utilization>=.96)break;
   }else hi=mid;
  }
  // Prefer a source vertex with the smallest turn in the final 15% of the
  // verified span. This avoids an arbitrary seam on dense smooth curves while
  // limiting the sacrificed workload. Ties choose the later vertex.
  if(best&&lo<total-1e-10){
   const candidates:number[]=[];for(let i=1;i<points.length-1;i++)if(cumulative[i]!>=start+.85*(lo-start)&&cumulative[i]!<=lo)candidates.push(i);
   const turn=(i:number)=>{const a=points[i-1]!,b=points[i]!,c=points[i+1]!,ux=b.x-a.x,uy=b.y-a.y,vx=c.x-b.x,vy=c.y-b.y;return Math.abs(Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy));};
   candidates.sort((a,b)=>turn(a)-turn(b)||b-a);
   for(const i of candidates.slice(0,4)){const end=cumulative[i]!,candidate=slice(start,end),trial=compile(candidate);if(trial.some(r=>distance(r.from,r.to)>0)&&drawingFits(trial,limits)){best=candidate;lo=end;break;}}
  }
  if(!best||lo<=start+1e-10)throw new PlotterError('invalid-plan','Workload budgets cannot fit a rest-to-rest move at this motor resolution. Increase the checkpoint budgets.');
  // Absorb a final sub-step source tail when it compiles to the same endpoint;
  // never leave a residual chunk that cannot move on the motor lattice.
  if(total-lo>0&&total-lo<=resolution){const complete=slice(start,total),trial=compile(complete);if(drawingFits(trial,limits)){best=complete;lo=total;}}
  chunks.push({points:best,fromMm:start,toMm:lo});start=lo;
  if(chunks.length>100000)throw new PlotterError('invalid-plan','Workload checkpoint count exceeds the supported limit.');
 }
 return chunks;
}
export function validateWorkloadProgram(plan:ExecutablePlan):void {
 let limits=plan.options.workloadCheckpoints,records:MotorRecord[]=[];
 const check=()=>{if(limits&&!drawingFits(records,limits))throw new PlotterError('invalid-plan','Compiled stroke exceeds a workload checkpoint budget.');records=[];};
 const identity=(value:WorkloadChunkIdentity)=>{if(!value||typeof value.sourceId!=='string'||value.sourceId.length>1024||![value.strokeIndex,value.reloadIndex,value.chunkIndex].every(n=>Number.isSafeInteger(n)&&n>=0)||!Number.isFinite(value.sourceFromMm)||!Number.isFinite(value.sourceToMm)||value.sourceFromMm<0||value.sourceToMm<=value.sourceFromMm)throw new PlotterError('invalid-plan','Invalid workload source identity.');};
 for(const r of plan.records){if(r.kind==='motor'&&r.workloadChunk)identity(r.workloadChunk);if(r.kind==='pen'&&r.workloadCheckpoint){identity(r.workloadCheckpoint);if(!limits||r.penDown||r.reload)throw new PlotterError('invalid-plan','Invalid physical checkpoint intent.');}if(r.settings){check();limits=r.settings.workloadCheckpoints;}if(r.kind==='motor'&&r.penDown)records.push(r);if(r.kind==='pen'&&!r.penDown)check();}check();
}
