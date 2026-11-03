// Independent executable constraints. No compiler/planner/pen/validator imports.
const near=(a,b,t=1e-7)=>Math.abs(a-b)<=t;
const same=(a,b)=>a.m1===b.m1&&a.m2===b.m2;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function requireThat(condition,message){if(!condition)throw new Error(message);}
function roundEven(value){const n=Math.floor(value);return value-n===.5?n%2===0?n:n+1:Math.round(value);}
export function quantizeIndependent(p,profile){
 const {x,y}=p,r=profile.rotation,q=r===0?{x,y}:r===90?{x:-y,y:x}:r===180?{x:-x,y:-y}:{x:y,y:-x};
 return {m1:roundEven((q.x+q.y)*profile.stepsPerMm),m2:roundEven((q.x-q.y)*profile.stepsPerMm)};
}
function pointSegment(p,a,b){const x=b.x-a.x,y=b.y-a.y,d=x*x+y*y,t=d?Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/d)):0;return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);}
// A monotone walk in each direction proves source/executable order and catches
// drawn shortcuts. Vertices plus edge interiors disallow 'visit every vertex'
// tests from accepting reordered/reversed edges. Each walk is O(vertices+records).
function orderedCoverage(points,segments,tolerance){
 let cursor=0,progress=0;
 for(let i=0;i<points.length;i++){
  const targets=i?[{x:(points[i-1].x+points[i].x)/2,y:(points[i-1].y+points[i].y)/2},points[i]]:[points[i]];
  for(const p of targets){
   while(cursor<segments.length){const {from:a,to:b}=segments[cursor],x=b.x-a.x,y=b.y-a.y,length=Math.hypot(x,y),t=length?Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/(length*length))):0;
    if(pointSegment(p,a,b)<=tolerance&&t+tolerance/Math.max(length,tolerance)>=progress){progress=Math.max(progress,t);break;}
    cursor++;progress=0;
   }
   requireThat(cursor<segments.length,'ordered interior geometry coverage');
  }
 }
}
export function inspectExecutable(plan,paths,{minimumPenDwellMs=0,checkCoverage=true}={}){
 let time=0,position={m1:0,m2:0},penDown=false,drawn=0,travel=0;
 const strokes=new Map(),toolOrder=[];let lastSource='';
 for(const [i,r] of plan.records.entries()){
  requireThat(r.id===i&&near(r.startMs,time),'timeline continuity');
  requireThat(Number.isFinite(r.durationMs)&&r.durationMs>=0,'finite duration');time+=r.durationMs;
  if(r.kind==='pen'){requireThat(r.durationMs>=minimumPenDwellMs,'pen wait ends early');penDown=r.penDown;}
  if(r.kind==='tool')requireThat(!penDown&&!r.penDown,'tool change while down');
  if(r.kind!=='motor')continue;
  requireThat(same(position,r.fromSteps),'missing or discontinuous motor record');
  requireThat(same(quantizeIndependent(r.from,plan.options.profile),r.fromSteps)&&same(quantizeIndependent(r.to,plan.options.profile),r.toSteps),'wrong motor endpoint');
  requireThat(penDown===r.penDown,'motor precedes pen transition');
  requireThat(r.durationMs>0&&r.durationMs<=65535,'motor duration range');
  if(!r.native){requireThat(Number.isInteger(r.durationMs),'SM integer duration');for(const key of ['m1','m2']){const steps=r.toSteps[key]-r.fromSteps[key],rate=Math.abs(steps)*1000/r.durationMs;requireThat(Number.isSafeInteger(steps)&&(!steps||rate>=2-1e-9)&&rate<=24995+1e-9,'SM native rate range');}}
  position={...r.toSteps};
  const length=distance(r.from,r.to);if(r.penDown){drawn+=length;const id=r.sourceId??'';if(id!==lastSource){toolOrder.push(r.tool);lastSource=id;}const segments=strokes.get(id)??[];segments.push(r);strokes.set(id,segments);}else travel+=length;
 }
 requireThat(near(time,plan.durationMs),'duration total');requireThat(near(drawn,plan.drawingMm)&&near(travel,plan.travelMm),'distance totals');requireThat(!penDown,'final pen is down');
 if(plan.options.returnToOrigin)requireThat(same(position,{m1:0,m2:0}),'final return endpoint');
 if(checkCoverage)for(const p of paths){
  const distinct=p.points.some(q=>!same(quantizeIndependent(q,plan.options.profile),quantizeIndependent(p.points[0],plan.options.profile)));
  if(!distinct)continue;
  const segments=strokes.get(p.sourceId);requireThat(segments?.length,'missing drawing record');
  requireThat(same(segments[0].fromSteps,quantizeIndependent(p.points[0],plan.options.profile))&&same(segments.at(-1).toSteps,quantizeIndependent(p.points.at(-1),plan.options.profile)),'source endpoint changed');
  const tolerance=Math.SQRT2/plan.options.profile.stepsPerMm+1e-7;
  const expected=p.points.map(q=>({from:q,to:q}));
  orderedCoverage(p.points,segments,tolerance);
  const expectedEdges=expected.slice(1).map((q,i)=>({from:expected[i].to,to:q.to}));
  orderedCoverage([segments[0].from,...segments.map(s=>s.to)],expectedEdges,tolerance);
 }
 return {durationMs:time,drawingMm:drawn,travelMm:travel,endpoint:position,toolOrder,records:plan.records.length};
}
export function inspectCheckpoint(checkpoint,plan){
 requireThat(Number.isInteger(checkpoint.record)&&checkpoint.record>=0&&checkpoint.record<plan.records.length&&checkpoint.origin==='verified','invalid resume cursor');
 let drawing=0,position={m1:0,m2:0};for(const r of plan.records.slice(0,checkpoint.record+1)){if(r.kind==='motor'){position=r.toSteps;if(r.penDown)drawing+=distance(r.from,r.to);}}
 requireThat(near(drawing,checkpoint.drawingMm)&&same(position,checkpoint.position),'resume corruption');
}
export function inspectTrace(trace){
 let blockingUntil=0;
 for(const t of trace)if(t.phase==='started'){
  if(/^(SM|T3|TD),/.test(t.command))requireThat(t.timeMs>=blockingUntil,'motor starts before queued pen wait ends');
  if(t.command.startsWith('SP,'))blockingUntil=t.timeMs+Number(t.command.split(',')[2]);
 }
}
