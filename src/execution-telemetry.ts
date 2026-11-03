import type {SessionEvent} from '@thierryc/plotter-core';
/** Bounded pending telemetry, independent of serial ownership and execution state. */
export class ExecutionTelemetry {
 readonly limit=512;private pending:SessionEvent[]=[];droppedDiagnostics=0;
 get length(){return this.pending.length;}
 push(event:SessionEvent):void {
  if(event.kind==='record-range'){
   let previous:SessionEvent|undefined;for(let i=this.pending.length-1;i>=0;i--)if(this.pending[i]!.kind==='record-range'){previous=this.pending[i];break;}
   if(previous&&previous.recordEndId!+1===event.recordId){previous.recordEndId=event.recordEndId;previous.timeMs=event.timeMs;return;}
  }
  // A stalled renderer needs the latest state; exact record settlement survives
  // in ranges. Protocol diagnostics are explicitly lossy, never authoritative.
  const replace=this.pending.findIndex(e=>(event.kind==='position'||event.kind==='state'||event.kind==='queue-diagnostic'||event.kind==='pen-confirmation')?e.kind===event.kind:event.kind==='record'&&(event.phase==='started'||event.phase==='queued')?e.kind==='record'&&e.phase===event.phase:false);
  if(replace>=0){this.pending.splice(replace,1);if(event.kind!=='pen-confirmation')this.droppedDiagnostics++;}
  if(this.pending.length>=this.limit){
   const diagnostic=this.pending.findIndex(e=>e.kind==='exchange'||e.kind==='record');
   if(diagnostic>=0){this.pending.splice(diagnostic,1);this.droppedDiagnostics++;}
   else if(event.kind==='exchange'||event.kind==='record'){this.droppedDiagnostics++;return;}
   else { // Timing extensions/ranges from very many tiny strokes stay bounded.
    const previous=this.pending.findIndex(e=>e.kind===event.kind);
    if(previous>=0){this.pending.splice(previous,1);this.droppedDiagnostics++;}
    else {const oldest=this.pending.findIndex(e=>e.kind!=='pen-confirmation');this.pending.splice(oldest,1);this.droppedDiagnostics++;}
   }
  }
  this.pending.push(event);
 }
 take():SessionEvent[]{return this.pending.splice(0);}
}
