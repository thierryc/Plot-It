import {checked, type Point, type MotionReason} from './types.js';
import {motionSegments,junctionSpeed} from './junction.js';
export interface JerkPhase {from:Point;to:Point;duration:number;initialSpeed:number;acceleration:number;jerk:number;restBefore:boolean;motionReason?:MotionReason}
const distance=(a:Point,b:Point)=>Math.hypot(b.x-a.x,b.y-a.y);
export function transitionTime(v0:number,v1:number,acceleration:number,jerk:number):number {
  const dv=Math.abs(v1-v0);return dv<=acceleration*acceleration/jerk?2*Math.sqrt(dv/jerk):dv/acceleration+acceleration/jerk;
}
export function transitionDistance(v0:number,v1:number,acceleration:number,jerk:number):number{return(v0+v1)*transitionTime(v0,v1,acceleration,jerk)/2;}
function reachable(entry:number,limit:number,length:number,a:number,j:number):number {
  if(transitionDistance(entry,limit,a,j)<=length)return limit;
  let low=entry,high=Math.max(entry,limit);for(let n=0;n<48;n++){const mid=(low+high)/2;if(transitionDistance(entry,mid,a,j)<=length)low=mid;else high=mid;}return Math.min(limit,low);
}
/** Whole-path zero-acceleration junctions and jerk/acceleration-limited reachability. */
export function planSCurve(points:readonly Point[],speed:number,acceleration:number,jerk:number,cornering:number,_constant=false,sourceDirections?:readonly Point[]):JerkPhase[] {
  for(const [name,value]of Object.entries({speed,acceleration,jerk}))checked(value,1e-6,1e9,name);
  checked(cornering,0,1e6,'cornering');for(const p of points){checked(p.x,-1e6,1e6,'x');checked(p.y,-1e6,1e6,'y');}
  const segments=motionSegments(points,sourceDirections);if(!segments.length)return[];
  const lengths=segments.map(s=>s.length),v=new Array<number>(segments.length+1).fill(speed);v[0]=v[v.length-1]=0;
  for(let i=1;i<segments.length;i++)v[i]=junctionSpeed(segments[i-1]!,segments[i]!,speed,acceleration,cornering);
  for(let i=1;i<v.length;i++)if(v[i]!>v[i-1]!)v[i]=reachable(v[i-1]!,v[i]!,lengths[i-1]!,acceleration,jerk);
  for(let i=v.length-2;i>=0;i--)if(v[i]!>v[i+1]!)v[i]=reachable(v[i+1]!,v[i]!,lengths[i]!,acceleration,jerk);
  const phases:JerkPhase[]=[];
  for(let i=0;i<lengths.length;i++){
    const {from,to,length}=segments[i]!;
    let low=Math.max(v[i]!,v[i+1]!),high=speed;
    for(let n=0;n<48;n++){const peak=(low+high)/2,d=transitionDistance(v[i]!,peak,acceleration,jerk)+transitionDistance(peak,v[i+1]!,acceleration,jerk);if(d<=length)low=peak;else high=peak;}
    const peak=low;let travelled=0,cursor={...from},velocity=v[i]!,accel=0;
    const append=(time:number,j:number)=>{
      if(time<1e-12)return;
      const d=velocity*time+accel*time*time/2+j*time**3/6;travelled+=d;
      const f=Math.max(0,Math.min(1,travelled/length)),end={x:from.x+(to.x-from.x)*f,y:from.y+(to.y-from.y)*f};
      phases.push({from:cursor,to:end,duration:time,initialSpeed:velocity,acceleration:accel,jerk:j,restBefore:velocity<1e-9&&Math.abs(accel)<1e-9});
      cursor=end;velocity+=accel*time+j*time*time/2;accel+=j*time;
    };
    const ramp=(target:number)=>{
      const dv=target-velocity;if(dv===0)return;
      const sign=Math.sign(dv),tj=Math.min(acceleration/jerk,Math.sqrt(Math.abs(dv)/jerk)),plateau=Math.max(0,Math.abs(dv)/(jerk*tj)-tj);
      append(tj,sign*jerk);append(plateau,0);append(tj,-sign*jerk);velocity=target;accel=0;
    };
    ramp(peak);const decelDistance=transitionDistance(peak,v[i+1]!,acceleration,jerk);append(Math.max(0,(length-travelled-decelDistance)/peak),0);ramp(v[i+1]!);
    if(phases.length)phases.at(-1)!.to={...to};
  }
  return phases;
}
export function sampleJerkPhase(p:JerkPhase,time:number):Point {
  const t=Math.min(p.duration,Math.max(0,time)),length=distance(p.from,p.to),f=length?Math.max(0,Math.min(1,(p.initialSpeed*t+p.acceleration*t*t/2+p.jerk*t**3/6)/length)):0;
  return{x:p.from.x+(p.to.x-p.from.x)*f,y:p.from.y+(p.to.y-p.from.y)*f};
}
