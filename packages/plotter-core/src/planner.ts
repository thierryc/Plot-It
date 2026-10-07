import { checked, type Point } from './types.js';
export interface Phase { from:Point; to:Point; duration:number; initialSpeed:number; acceleration:number; restBefore:boolean }
const distance=(a:Point,b:Point)=>Math.hypot(b.x-a.x,b.y-a.y);
/** Full-stroke forward/backward reachability, followed by acceleration/cruise ramps. */
export function planStroke(points:readonly Point[],speed:number,acceleration:number,cornering:number,constant=false,entry=0,exit=0,sourceDirections?:readonly Point[]):Phase[] {
  checked(speed,1e-6,100000,'speed');checked(acceleration,1e-6,100000,'acceleration');checked(cornering,0,100000,'cornering');
  for(const p of points){checked(p.x,-1e6,1e6,'trajectory coordinate');checked(p.y,-1e6,1e6,'trajectory coordinate');}
  checked(entry,0,speed,'entry speed');checked(exit,0,speed,'exit speed');
  const clean=points.filter((p,i)=>i===0||distance(p,points[i-1]!)>1e-12);
  if(clean.length<2)return[];
  const lengths=clean.slice(1).map((p,i)=>distance(clean[i]!,p)),velocities=new Array<number>(clean.length).fill(speed);
  velocities[0]=entry;velocities[clean.length-1]=exit;
  for(let i=1;i<clean.length-1;i++) {
    const a=clean[i-1]!,b=clean[i]!,c=clean[i+1]!;
    const incoming=sourceDirections?.[i-1]??{x:b.x-a.x,y:b.y-a.y},outgoing=sourceDirections?.[i]??{x:c.x-b.x,y:c.y-b.y};
    const cosine=Math.max(-1,Math.min(1,(incoming.x*outgoing.x+incoming.y*outgoing.y)/(Math.hypot(incoming.x,incoming.y)*Math.hypot(outgoing.x,outgoing.y))));
    const half=Math.sqrt((1+cosine)/2);
    velocities[i]=half>1-1e-9?speed:Math.min(speed,Math.sqrt(acceleration*cornering*half/Math.max(1e-12,1-half)));
  }
  for(let i=1;i<velocities.length;i++)velocities[i]=Math.min(velocities[i]!,Math.sqrt(velocities[i-1]!**2+2*acceleration*lengths[i-1]!));
  for(let i=velocities.length-2;i>=0;i--)velocities[i]=Math.min(velocities[i]!,Math.sqrt(velocities[i+1]!**2+2*acceleration*lengths[i]!));
  const result:Phase[]=[];
  for(let i=0;i<lengths.length;i++) {
    const a=clean[i]!,b=clean[i+1]!,length=lengths[i]!,entry=velocities[i]!,exit=velocities[i+1]!;
    if(constant){result.push({from:{...a},to:{...b},duration:length/speed,initialSpeed:speed,acceleration:0,restBefore:i===0});continue;}
    const fullDistance=(2*speed**2-entry**2-exit**2)/(2*acceleration);
    const local=length<fullDistance&&length>=.9*fullDistance?.9*fullDistance/length*acceleration:acceleration;
    const peak=Math.min(speed,Math.sqrt(local*length+(entry**2+exit**2)/2));
    const up=Math.max(0,(peak**2-entry**2)/(2*local)),down=Math.max(0,(peak**2-exit**2)/(2*local));
    if(Math.floor((peak-entry)/local/.025)+Math.floor((peak-exit)/local/.025)<=4){
      // Declared AxiDraw short-segment policy: boosted entry, linear interpolation;
      // under two slices, one constant-rate interval. Native duration policy stays
      // explicit in the compiler (ceil + preserved empty time), not hidden here.
      const boosted=(entry+peak)/2,linear=Math.max(-acceleration,Math.min(acceleration,(exit**2-boosted**2)/(2*length))),duration=linear?(exit-boosted)/linear:0;
      if(duration>0&&Math.floor(duration/.025)>1)result.push({from:{...a},to:{...b},duration,initialSpeed:boosted,acceleration:linear,restBefore:entry<1e-9});
      else {const rate=Math.max(peak,exit,1e-6);result.push({from:{...a},to:{...b},duration:length/rate,initialSpeed:rate,acceleration:0,restBefore:entry<1e-9});}
      continue;
    }
    let travelled=0,cursor={...a};
    const append=(len:number,v:number,acc:number,time:number)=> {
      if(time<1e-12||len<1e-12)return;
      travelled+=len; const t=Math.min(1,travelled/length),to={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
      result.push({from:cursor,to,duration:time,initialSpeed:v,acceleration:acc,restBefore:v<1e-9});cursor=to;
    };
    append(up,entry,local,(peak-entry)/local);
    const cruise=Math.max(0,length-up-down);append(cruise,peak,0,cruise/peak);
    append(down,peak,-local,(peak-exit)/local);
    if(result.length)result.at(-1)!.to={...b};
  }
  return result;
}
export function samplePhase(phase:Phase,t:number):Point {
  const len=distance(phase.from,phase.to),time=Math.max(0,Math.min(phase.duration,t)),d=phase.initialSpeed*time+.5*phase.acceleration*time*time;
  const f=len?Math.max(0,Math.min(1,d/len)):0;
  return{x:phase.from.x+(phase.to.x-phase.from.x)*f,y:phase.from.y+(phase.to.y-phase.from.y)*f};
}
