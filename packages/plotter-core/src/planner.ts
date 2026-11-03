/**
 * Triangle/trapezoid construction adapted from Michael Fogleman's MIT axi
 * planner (2017), pinned a5a12f01633076232be84a4e3321c80c7b9656b5.
 * See ../reference/AXI-LICENSE and MOTION-PROVENANCE.md. The bounded passes,
 * validation and sampling contract are Plot-it adaptations; no axi throttler.
 */
import { checked, PlotterError, type Point } from './types.js';
import { motionSegments, junctionSpeed } from './junction.js';
export interface Phase { from:Point; to:Point; duration:number; initialSpeed:number; acceleration:number; restBefore:boolean }

/** Constant means target cruise: starts, corners and exits still obey the limits. */
export function planStroke(points:readonly Point[],speed:number,acceleration:number,cornering:number,_constant=false,entry=0,exit=0,sourceDirections?:readonly Point[]):Phase[] {
  checked(speed,1e-6,100000,'speed');checked(acceleration,1e-6,100000,'acceleration');checked(cornering,0,100000,'cornering');
  checked(entry,0,speed,'entry speed');checked(exit,0,speed,'exit speed');
  const segments=motionSegments(points,sourceDirections);
  if(!segments.length){if(entry!==exit)throw new PlotterError('invalid-plan','Unreachable boundary speeds on an empty stroke.');return[];}
  const velocities=new Array<number>(segments.length+1).fill(speed);
  velocities[0]=entry;velocities[segments.length]=exit;
  for(let i=1;i<segments.length;i++)velocities[i]=junctionSpeed(segments[i-1]!,segments[i]!,speed,acceleration,cornering);
  // v² <= u² + 2as. Both fixed endpoints must survive both reachability passes.
  for(let i=1;i<velocities.length;i++)velocities[i]=Math.min(velocities[i]!,Math.sqrt(velocities[i-1]!**2+2*acceleration*segments[i-1]!.length));
  for(let i=velocities.length-2;i>=0;i--)velocities[i]=Math.min(velocities[i]!,Math.sqrt(velocities[i+1]!**2+2*acceleration*segments[i]!.length));
  if(entry-velocities[0]!>1e-9||exit-velocities.at(-1)!>1e-9)throw new PlotterError('invalid-plan','Unreachable requested boundary speed.');
  velocities[0]=entry;velocities[segments.length]=exit;
  const result:Phase[]=[];
  for(let i=0;i<segments.length;i++) {
    const {from,to,length}=segments[i]!,initial=velocities[i]!,final=velocities[i+1]!;
    const peakSquared=acceleration*length+(initial**2+final**2)/2,triangular=peakSquared<=speed**2;
    const peak=triangular?Math.sqrt(peakSquared):speed;
    const rise=Math.max(0,(peak-initial)/acceleration),fall=Math.max(0,(peak-final)/acceleration);
    const riseDistance=(initial+peak)*rise/2,fallDistance=(final+peak)*fall/2;
    let travelled=0,cursor={...from};
    const append=(duration:number,velocity:number,a:number,distance:number)=>{
      if(duration<=0)return;
      travelled+=distance;
      const fraction=Math.min(1,travelled/length),end={x:from.x+(to.x-from.x)*fraction,y:from.y+(to.y-from.y)*fraction};
      result.push({from:cursor,to:end,duration,initialSpeed:velocity,acceleration:a,restBefore:velocity<1e-9});cursor=end;
    };
    append(rise,initial,acceleration,riseDistance);
    // A triangle has exactly zero cruise. Subtracting its independently rounded
    // ramp distances would otherwise invent tiny positive phases and 1 ms waits.
    const cruise=triangular?0:Math.max(0,length-riseDistance-fallDistance);
    append(cruise/peak,peak,0,cruise);
    append(fall,peak,-acceleration,fallDistance);
    result.at(-1)!.to={...to};
  }
  return result;
}
/** Sample the nominal scalar equation; integer motor rounding belongs to compilation. */
export function samplePhase(phase:Phase,t:number):Point {
  checked(t,-Number.MAX_VALUE,Number.MAX_VALUE,'sample time');
  const time=Math.max(0,Math.min(phase.duration,t));
  if(time===phase.duration)return{...phase.to};
  const length=Math.hypot(phase.to.x-phase.from.x,phase.to.y-phase.from.y);
  const fraction=length?Math.max(0,Math.min(1,(phase.initialSpeed*time+phase.acceleration*time*time/2)/length)):0;
  return{x:phase.from.x+(phase.to.x-phase.from.x)*fraction,y:phase.from.y+(phase.to.y-phase.from.y)*fraction};
}
