import {checked,PlotterError,type Point,type MotionReason} from './types.js';
import {junctionSpeed,motionSegments,type MotionSegment} from './junction.js';
import {transitionDistance,type JerkPhase} from './scurve.js';

/** Physical-distance policy constants are part of dynamic-scurve-flow-v1. */
export const DYNAMIC_GRID_MM=1,DYNAMIC_CURVATURE_HALF_WINDOW_MM=1;
const LIMIT=1000000,MERGE_RATIO=1.01;
export interface DynamicMotionOptions {
  speed:number;acceleration:number;jerk:number;cornering:number;
  curveAcceleration?:number;anticipationMm?:number;
}
export interface DynamicSpan {
  fromMm:number;toMm:number;speedLimit:number;initialSpeed:number;finalSpeed:number;peakSpeed:number;reason:MotionReason;
}
export interface DynamicMotion {phases:JerkPhase[];spans:DynamicSpan[];stops:number[]}
interface LocatedSegment extends MotionSegment {start:number;end:number}
interface Knot {s:number;value:number}
interface Cell {fromMm:number;toMm:number;speedLimit:number;maximumCap:number;reason:MotionReason}
interface ScalarPhase {fromMm:number;toMm:number;duration:number;initialSpeed:number;acceleration:number;jerk:number;restBefore:boolean;motionReason:MotionReason}
const length=(a:Point,b:Point)=>Math.hypot(b.x-a.x,b.y-a.y);
const lower=(points:readonly Knot[],s:number)=>{let lo=0,hi=points.length;while(lo<hi){const mid=(lo+hi)>>>1;if(points[mid]!.s<s)lo=mid+1;else hi=mid;}return lo;};
const upper=(points:readonly Knot[],s:number)=>{let lo=0,hi=points.length;while(lo<hi){const mid=(lo+hi)>>>1;if(points[mid]!.s<=s)lo=mid+1;else hi=mid;}return lo;};

/** Inclusive range maxima in O(log n); inputs and allocations are source-bounded. */
class RangeMaximum {
  private size=1;private tree:Float64Array;
  constructor(private readonly knots:readonly Knot[]){
    while(this.size<knots.length)this.size*=2;
    this.tree=new Float64Array(2*this.size);this.tree.fill(-Infinity);
    for(let i=0;i<knots.length;i++)this.tree[this.size+i]=knots[i]!.value;
    for(let i=this.size-1;i;i--)this.tree[i]=Math.max(this.tree[i*2]!,this.tree[i*2+1]!);
  }
  at(s:number):number {
    if(!this.knots.length)return 0;
    const i=upper(this.knots,s);
    if(i===0||i===this.knots.length)return 0;
    const a=this.knots[i-1]!,b=this.knots[i]!;
    return a.value+(b.value-a.value)*(s-a.s)/(b.s-a.s);
  }
  points(a:number,b:number):number {
    let lo=lower(this.knots,a)+this.size,hi=upper(this.knots,b)+this.size,result=-Infinity;
    while(lo<hi){if(lo&1)result=Math.max(result,this.tree[lo++]!);if(hi&1)result=Math.max(result,this.tree[--hi]!);lo>>=1;hi>>=1;}
    return result;
  }
  continuous(a:number,b:number):number{return Math.max(0,this.at(a),this.at(b),this.points(a,b));}
}

/** Absolute source turning convolved with a unit-area triangular spatial kernel.
 * Source angles are located on the retained native chain; native stair-step
 * headings never masquerade as source curvature. This is an estimate, not a
 * normal-acceleration certificate for a polyline. */
function curvatureField(turns:readonly Knot[]):RangeMaximum {
  const h=DYNAMIC_CURVATURE_HALF_WINDOW_MM,events:Knot[]=[];
  for(const {s,value}of turns){if(!value)continue;const slope=value/(h*h);events.push({s:s-h,value:slope},{s,value:-2*slope},{s:s+h,value:slope});}
  events.sort((a,b)=>a.s-b.s);
  const knots:Knot[]=[];let previous=events[0]?.s??0,value=0,slope=0;
  for(let i=0;i<events.length;){const s=events[i]!.s;value+=slope*(s-previous);let change=0;do{change+=events[i++]!.value;}while(i<events.length&&events[i]!.s===s);knots.push({s,value:Math.max(0,value)});slope+=change;previous=s;}
  // The compact-support kernel is exactly zero beyond its final event. Cancel
  // accumulated floating point residue there instead of inventing a long tail.
  if(knots.length)knots.at(-1)!.value=0;
  return new RangeMaximum(knots);
}

function angle(a:Point,b:Point):number{return Math.abs(Math.atan2(a.x*b.y-a.y*b.x,a.x*b.x+a.y*b.y));}
function reachable(entry:number,limit:number,d:number,a:number,j:number):number {
  if(limit<=entry||transitionDistance(entry,limit,a,j)<=d)return limit;
  let lo=entry,hi=limit;for(let n=0;n<48;n++){const v=(lo+hi)/2;if(transitionDistance(entry,v,a,j)<=d)lo=v;else hi=v;}return lo;
}

/** Stops partition anticipation before minima are taken: a point stop must never
 * become an impossible positive-length region whose speed ceiling is zero. */
function cellsForSection(start:number,end:number,curvature:RangeMaximum,junctions:RangeMaximum,o:Required<DynamicMotionOptions>):Cell[] {
  const cells:Cell[]=[];
  if(Math.ceil((end-start)/DYNAMIC_GRID_MM)>LIMIT)throw new PlotterError('invalid-plan','Dynamic spatial grid exceeds the supported limit.');
  for(let from=start;from<end;){
    const to=Math.min(end,from+DYNAMIC_GRID_MM),look=Math.min(end,to+o.anticipationMm);
    const k=curvature.continuous(from,look),curveCap=k>0?Math.sqrt(o.curveAcceleration/k):o.speed;
    const junctionCap=-junctions.points(from,look);
    const cap=Math.min(o.speed,curveCap,junctionCap),reason:MotionReason=junctionCap<Math.min(o.speed,curveCap)?'junction':curveCap<o.speed?'curve':'acceleration';
    if(!(cap>0)||!Number.isFinite(cap))throw new PlotterError('invalid-plan','Invalid Dynamic speed ceiling.');
    const previous=cells.at(-1),min=previous?Math.min(previous.speedLimit,cap):cap,max=previous?Math.max(previous.maximumCap,cap):cap;
    // Deterministic left-to-right grouping checks the entire group's spread,
    // not just adjacent differences, and always retains the lower ceiling.
    if(previous&&max/min<=MERGE_RATIO){previous.toMm=to;previous.maximumCap=max;if(cap<previous.speedLimit){previous.speedLimit=cap;previous.reason=reason;}}
    else cells.push({fromMm:from,toMm:to,speedLimit:cap,maximumCap:cap,reason});
    from=to;
  }
  return cells;
}

function scalarProfile(cells:readonly Cell[],o:Required<DynamicMotionOptions>,spans:DynamicSpan[]):ScalarPhase[] {
  const v=new Array<number>(cells.length+1).fill(o.speed);v[0]=v[cells.length]=0;
  for(let i=1;i<cells.length;i++)v[i]=Math.min(cells[i-1]!.speedLimit,cells[i]!.speedLimit);
  for(let i=1;i<v.length;i++)v[i]=reachable(v[i-1]!,v[i]!,cells[i-1]!.toMm-cells[i-1]!.fromMm,o.acceleration,o.jerk);
  for(let i=v.length-2;i>=0;i--)v[i]=reachable(v[i+1]!,v[i]!,cells[i]!.toMm-cells[i]!.fromMm,o.acceleration,o.jerk);
  const phases:ScalarPhase[]=[];
  for(let i=0;i<cells.length;i++){
    const cell=cells[i]!,d=cell.toMm-cell.fromMm,initial=v[i]!,final=v[i+1]!;
    let lo=Math.max(initial,final),hi=cell.speedLimit;
    for(let n=0;n<48;n++){const peak=(lo+hi)/2;if(transitionDistance(initial,peak,o.acceleration,o.jerk)+transitionDistance(peak,final,o.acceleration,o.jerk)<=d)lo=peak;else hi=peak;}
    const peak=lo;spans.push({...cell,initialSpeed:initial,finalSpeed:final,peakSpeed:peak});
    let travelled=0,velocity=initial,acceleration=0;
    const append=(duration:number,jerk:number,reason:MotionReason)=>{
      if(duration<=0)return;
      const distance=velocity*duration+acceleration*duration**2/2+jerk*duration**3/6;
      phases.push({fromMm:cell.fromMm+travelled,toMm:cell.fromMm+travelled+distance,duration,initialSpeed:velocity,acceleration,jerk,restBefore:velocity===0&&acceleration===0,motionReason:reason});
      travelled+=distance;velocity+=acceleration*duration+jerk*duration**2/2;acceleration+=jerk*duration;
    };
    const ramp=(target:number)=>{
      const dv=target-velocity;if(dv===0)return;
      const sign=Math.sign(dv),tj=Math.min(o.acceleration/o.jerk,Math.sqrt(Math.abs(dv)/o.jerk)),hold=Math.max(0,Math.abs(dv)/(o.jerk*tj)-tj),reason:MotionReason=velocity===0||target===0?'stop':cell.reason;
      append(tj,sign*o.jerk,reason);append(hold,0,reason);append(tj,-sign*o.jerk,reason);velocity=target;acceleration=0;
    };
    ramp(peak);
    append(Math.max(0,(d-travelled-transitionDistance(peak,final,o.acceleration,o.jerk))/peak),0,cell.reason);
    ramp(final);
    if(!phases.length||!(peak>0))throw new PlotterError('invalid-plan','Unreachable Dynamic interval.');
    phases.at(-1)!.toMm=cell.toMm;
  }
  return phases;
}

function splitAtGeometry(scalar:readonly ScalarPhase[],segments:readonly LocatedSegment[]):JerkPhase[] {
  const result:JerkPhase[]=[];let segmentIndex=0,cursor={...segments[0]!.from};
  for(const p of scalar){
    while(segmentIndex<segments.length-1&&segments[segmentIndex]!.end<=p.fromMm)segmentIndex++;
    let s=p.fromMm,time=0;
    while(s<p.toMm){
      const segment=segments[segmentIndex]!,end=Math.min(p.toMm,segment.end);
      let until=p.duration;
      if(end<p.toMm){let lo=time,hi=p.duration;for(let n=0;n<48;n++){const t=(lo+hi)/2,d=p.initialSpeed*t+p.acceleration*t*t/2+p.jerk*t**3/6;if(d<end-p.fromMm)lo=t;else hi=t;}until=(lo+hi)/2;}
      const fraction=(end-segment.start)/segment.length,to=end===segment.end?{...segment.to}:{x:segment.from.x+(segment.to.x-segment.from.x)*fraction,y:segment.from.y+(segment.to.y-segment.from.y)*fraction};
      if(until>time)result.push({from:cursor,to,duration:until-time,initialSpeed:p.initialSpeed+p.acceleration*time+p.jerk*time*time/2,acceleration:p.acceleration+p.jerk*time,jerk:p.jerk,restBefore:p.restBefore&&time===0,motionReason:p.motionReason});
      else if(end>s)throw new PlotterError('invalid-plan','Dynamic geometry split is below numerical time resolution.');
      cursor=to;s=end;time=until;
      if(end===segment.end&&segmentIndex<segments.length-1)segmentIndex++;
      if(result.length>LIMIT)throw new PlotterError('invalid-plan','Dynamic phase limit exceeded.');
    }
  }
  return result;
}

/** Nominal scalar S-curve over fixed physical cells. Geometry only splits its
 * cubic phases; it never resets acceleration. This does not bound vector jerk
 * at polyline direction changes or native compiler command boundaries. */
export function planDynamicMotion(points:readonly Point[],options:DynamicMotionOptions,sourcePoints:readonly Point[]=points):DynamicMotion {
  const o:Required<DynamicMotionOptions>={...options,curveAcceleration:options.curveAcceleration??Math.min(100,options.acceleration/2),anticipationMm:options.anticipationMm??3};
  for(const key of ['speed','acceleration','jerk']as const)checked(o[key],1e-6,1e9,key);
  checked(o.cornering,0,1e6,'cornering');checked(o.curveAcceleration,1e-9,100000,'Dynamic curve acceleration');checked(o.anticipationMm,0,20,'Dynamic anticipation');
  if(points.length>LIMIT||points.length!==sourcePoints.length)throw new PlotterError('invalid-plan','Invalid Dynamic source correspondence.');
  const directions=sourcePoints.slice(1).map((p,i)=>({x:p.x-sourcePoints[i]!.x,y:p.y-sourcePoints[i]!.y}));
  const compact=motionSegments(points,directions);motionSegments(sourcePoints);
  if(!compact.length)return{phases:[],spans:[],stops:[]};
  let total=0;const segments:LocatedSegment[]=compact.map(segment=>{const start=total;total+=segment.length;return{...segment,start,end:total};});
  const stops=new Set<number>([0,total]),turns:Knot[]=[],positions=[0];
  for(let i=1;i<points.length;i++){const d=length(points[i-1]!,points[i]!);positions.push(positions[i-1]!+(d>1e-12?d:0));}
  let incoming:Point|undefined;
  for(let i=0;i<directions.length;i++){
    const outgoing=directions[i]!;if(Math.hypot(outgoing.x,outgoing.y)<=1e-12)continue;
    if(incoming){const theta=angle(incoming,outgoing),s=positions[i]!;if(theta)turns.push({s,value:theta});if(theta>=Math.PI/3-1e-12)stops.add(s);}
    incoming=outgoing;
  }
  const constraints:Knot[]=[];
  for(let i=1;i<segments.length;i++){
    const before=segments[i-1]!,after=segments[i]!,cap=junctionSpeed(before,after,o.speed,o.acceleration,o.cornering);
    if(cap===0)stops.add(after.start);else if(cap<o.speed)constraints.push({s:after.start,value:-cap});
  }
  const sortedStops=[...stops].sort((a,b)=>a-b),curvature=curvatureField(turns),junctions=new RangeMaximum(constraints.filter(p=>!stops.has(p.s)));
  const scalar:ScalarPhase[]=[],spans:DynamicSpan[]=[];
  let gridCount=0;
  for(let i=1;i<sortedStops.length;i++){
    const start=sortedStops[i-1]!,end=sortedStops[i]!;if(end<=start)continue;
    gridCount+=Math.ceil((end-start)/DYNAMIC_GRID_MM);if(gridCount>LIMIT)throw new PlotterError('invalid-plan','Dynamic spatial grid exceeds the supported limit.');
    const cells=cellsForSection(start,end,curvature,junctions,o);
    for(const phase of scalarProfile(cells,o,spans)){scalar.push(phase);if(scalar.length>LIMIT)throw new PlotterError('invalid-plan','Dynamic phase limit exceeded.');}
  }
  return{phases:splitAtGeometry(scalar,segments),spans,stops:sortedStops};
}
export function planDynamicSCurve(points:readonly Point[],options:DynamicMotionOptions,sourcePoints:readonly Point[]=points):JerkPhase[]{return planDynamicMotion(points,options,sourcePoints).phases;}
