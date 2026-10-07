import {withRaisedReturn} from './compiler.js';
import type {ExecutablePlan} from './types.js';
import type {RepeatSettings,SequenceSegment} from './sequence.js';
export function programStatistics(plan:ExecutablePlan,completedRecord=-1){
 let drawingMm=0,travelMm=0,completedDrawingMm=0,completedTravelMm=0,motionMs=0,penMs=0,lifts=0,lowers=0,reloads=0;
 for(const r of plan.records){if(r.kind==='motor'){const d=Math.hypot(r.to.x-r.from.x,r.to.y-r.from.y);if(r.penDown){drawingMm+=d;if(r.id<=completedRecord)completedDrawingMm+=d;}else{travelMm+=d;if(r.id<=completedRecord)completedTravelMm+=d;}motionMs+=r.durationMs;}
  else if(r.kind==='pen'){penMs+=r.durationMs;if(r.penDown)lowers++;else{lifts++;const next=plan.records[r.id+1];if(r.id>0&&next?.kind==='pen'&&next.penDown)reloads++;}}}
 return{drawingMm,travelMm,completedDrawingMm,completedTravelMm,remainingDrawingMm:Math.max(0,drawingMm-completedDrawingMm),motionMs,penMs,lifts,lowers,reloads,totalMs:plan.durationMs};
}
export function sequenceEstimate(segments:readonly SequenceSegment[],repeat:RepeatSettings){
 let copyMs=0,externalWait=0,layerWaitMs=0,drawingMm=0,travelMm=0,raisedExtraMs=0,raisedExtraMm=0,requiresContinue=repeat.requireContinue;
 for(const s of segments){if(s.plan){copyMs+=s.plan.durationMs;drawingMm+=s.plan.drawingMm;travelMm+=s.plan.travelMm;for(const r of s.plan.records){if(r.kind==='delay')layerWaitMs+=r.durationMs;if(r.kind==='tool'||r.kind==='pause')requiresContinue=true;}if(!s.plan.options.returnToOrigin){const raised=withRaisedReturn(s.plan);raisedExtraMs+=raised.durationMs-s.plan.durationMs;raisedExtraMm+=raised.travelMm-s.plan.travelMm;}}externalWait+=s.delayMs??0;layerWaitMs+=s.delayMs??0;requiresContinue||=!!s.pause;}
 const count=repeat.copies,more=count==='continuous'?null:Math.max(0,count-1);return{perCopyMs:copyMs+externalWait,totalMs:count==='continuous'||requiresContinue?null:count*(copyMs+externalWait)+more!*(repeat.intervalMs+raisedExtraMs),drawingMm:count==='continuous'?null:drawingMm*count,travelMm:count==='continuous'?null:travelMm*count+more!*raisedExtraMm,layerWaitMs:count==='continuous'?null:layerWaitMs*count,interCopyWaitMs:count==='continuous'?null:more!*repeat.intervalMs};
}
