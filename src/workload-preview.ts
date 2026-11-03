import type {WorkloadCheckpointPreview} from '@thierryc/plotter-core';
const NS='http://www.w3.org/2000/svg';
/** Static preparation evidence: never updated by live record telemetry. */
export function workloadPreview(preview:WorkloadCheckpointPreview|undefined):SVGGElement|null {
 if(!preview?.cuts.length)return null;
 const group=document.createElementNS(NS,'g');group.setAttribute('class','workload-checkpoint-preview');group.setAttribute('aria-label','Planned physical checkpoint cuts');
 for(const [index,cut]of preview.cuts.entries()){
  const circle=document.createElementNS(NS,'circle');circle.setAttribute('cx',String(cut.point.x));circle.setAttribute('cy',String(cut.point.y));circle.setAttribute('r','1.25');circle.setAttribute('fill','none');circle.setAttribute('stroke','#d97706');circle.setAttribute('stroke-width','.35');
  const title=document.createElementNS(NS,'title');title.textContent=`Checkpoint ${index+1}: ${cut.identity.sourceId}, stroke ${cut.identity.strokeIndex+1}, chunk ${cut.identity.chunkIndex+1}; lift and lower at ${cut.point.x.toFixed(2)}, ${cut.point.y.toFixed(2)} mm`;
  circle.append(title);group.append(circle);
 }
 return group;
}
