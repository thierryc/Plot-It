import { buildMotionPlan, type MotionPlan } from './motion-plan';
export interface DrawingBounds { minX: number; minY: number; maxX: number; maxY: number }
export function drawingBounds(plan: MotionPlan): DrawingBounds | null {
  let bounds: DrawingBounds | null = null;
  for (const event of plan.events) {
    if (event.kind !== 'xy' || !event.penDown) continue;
    for (const point of [event.from,event.to]) {
      if (!bounds) bounds = { minX: point.x, maxX: point.x, minY: point.y, maxY: point.y };
      else { bounds.minX=Math.min(bounds.minX,point.x); bounds.maxX=Math.max(bounds.maxX,point.x); bounds.minY=Math.min(bounds.minY,point.y); bounds.maxY=Math.max(bounds.maxY,point.y); }
    }
  }
  return bounds;
}
/** Use the same motion compiler and origin/stop controls, always with the pen raised. */
export function buildBoundsPreview(plan: MotionPlan): MotionPlan {
  const bounds = drawingBounds(plan);
  if (!bounds) throw new Error('There are no drawing paths to preview.');
  const { minX:x, minY:y, maxX:right, maxY:bottom } = bounds;
  const tool = plan.passes[0]?.tool ?? '#000000';
  const preview = buildMotionPlan([{tool, points:[{x,y},{x:right,y},{x:right,y:bottom},{x,y:bottom},{x,y}]}],
    {...plan.settings,maxPenDownMm:0,returnToOrigin:true,copies:1,repeatIntervalMs:0,repeatRequireContinue:false,startAtMm:0,varyClosedStarts:false},undefined,'bounds');
  if (preview.events.length<2) throw new Error('The drawing bounds are below the machine resolution.');
  preview.pens=[{color:tool,name:'Bounding box · pen up',sources:[tool],included:true}];
  return preview;
}
