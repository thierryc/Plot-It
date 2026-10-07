import {checked, type Point} from './types.js';
export interface JerkPhase {from:Point;to:Point;duration:number;initialSpeed:number;acceleration:number;jerk:number;restBefore:boolean}
const distance=(a:Point,b:Point)=>Math.hypot(b.x-a.x,b.y-a.y);
export function transitionTime(v0:number,v1:number,acceleration:number,jerk:number):number {
  const dv=Math.abs(v1-v0);return dv<=acceleration*acceleration/jerk?2*Math.sqrt(dv/jerk):dv/acceleration+acceleration/jerk;
}
export function transitionDistance(v0:number,v1:number,acceleration:number,jerk:number):number{return(v0+v1)*transitionTime(v0,v1,acceleration,jerk)/2;}
function reachable(entry:number,limit:number,length:number,a:number,j:number):number {
  let low=entry,high=Math.max(entry,limit);for(let n=0;n<48;n++){const mid=(low+high)/2;if(transitionDistance(entry,mid,a,j)<=length)low=mid;else high=mid;}return Math.min(limit,low);
}
/** Whole-path zero-acceleration junctions and jerk/acceleration-limited reachability. */
export function planSCurve(points:readonly Point[],speed:number,acceleration:number,jerk:number,cornering:number,constant=false,sourceDirections?:readonly Point[]):JerkPhase[] {
  for(const [name,value]of Object.entries({speed,acceleration,jerk}))checked(value,1e-6,1e9,name);
  checked(cornering,0,1e6,'cornering');for(const p of points){checked(p.x,-1e6,1e6,'x');checked(p.y,-1e6,1e6,'y');}
  const clean=points.filter((p,i)=>!i||distance(p,points[i-1]!)>1e-12);if(clean.length<2)return[];
  const lengths=clean.slice(1).map((p,i)=>distance(clean[i]!,p)),v=new Array<number>(clean.length).fill(speed);v[0]=v[v.length-1]=0;
  for(let i=1;i<v.length-1;i++){
    const a=clean[i-1]!,b=clean[i]!,c=clean[i+1]!;
    const incoming=sourceDirections?.[i-1]??{x:b.x-a.x,y:b.y-a.y},outgoing=sourceDirections?.[i]??{x:c.x-b.x,y:c.y-b.y};
    const cosine=Math.max(-1,Math.min(1,(incoming.x*outgoing.x+incoming.y*outgoing.y)/(Math.hypot(incoming.x,incoming.y)*Math.hypot(outgoing.x,outgoing.y))));
    const half=Math.sqrt((1+cosine)/2);v[i]=half>1-1e-9?speed:Math.min(speed,Math.sqrt(acceleration*cornering*half/Math.max(1e-12,1-half)));
  }
  for(let i=1;i<v.length;i++)if(v[i]!>v[i-1]!)v[i]=reachable(v[i-1]!,v[i]!,lengths[i-1]!,acceleration,jerk);
  for(let i=v.length-2;i>=0;i--)if(v[i]!>v[i+1]!)v[i]=reachable(v[i+1]!,v[i]!,lengths[i]!,acceleration,jerk);
  const phases:JerkPhase[]=[];
  for(let i=0;i<lengths.length;i++){
    const from=clean[i]!,to=clean[i+1]!,length=lengths[i]!;
    if(constant){phases.push({from:{...from},to:{...to},duration:length/speed,initialSpeed:speed,acceleration:0,jerk:0,restBefore:i===0});continue;}
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
      const dv=target-velocity;if(Math.abs(dv)<1e-10)return;
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
