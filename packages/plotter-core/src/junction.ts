/** Junction equation adapted from axi corner_velocity, Michael Fogleman (MIT).
 * See ../reference/AXI-LICENSE and MOTION-PROVENANCE.md. */
import {checked,type Point} from './types.js';
export interface MotionSegment {from:Point;to:Point;length:number;direction:Point}
/** Retain the original edge index while compacting coincident motor vertices. */
export function motionSegments(points:readonly Point[],directions?:readonly Point[]):MotionSegment[] {
  for(const p of points){checked(p.x,-1e6,1e6,'trajectory coordinate');checked(p.y,-1e6,1e6,'trajectory coordinate');}
  if(directions)for(const d of directions){checked(d.x,-2e6,2e6,'source direction');checked(d.y,-2e6,2e6,'source direction');}
  const result:MotionSegment[]=[];
  for(let i=1;i<points.length;i++){
    const from=points[i-1]!,to=points[i]!,vector={x:to.x-from.x,y:to.y-from.y},length=Math.hypot(vector.x,vector.y);
    if(length<=1e-12)continue;
    const supplied=directions?.[i-1],direction=supplied&&Math.hypot(supplied.x,supplied.y)>1e-12?supplied:vector;
    result.push({from:{...from},to:{...to},length,direction:{...direction}});
  }
  return result;
}
/** Nonzero junction velocity is a polyline corner approximation, not a bound on
 * instantaneous vector acceleration. Native reversals always stop. */
export function junctionSpeed(incoming:MotionSegment,outgoing:MotionSegment,limit:number,acceleration:number,cornering:number):number {
  if(cornering===0)return 0;
  const nativeCosine=((incoming.to.x-incoming.from.x)*(outgoing.to.x-outgoing.from.x)+(incoming.to.y-incoming.from.y)*(outgoing.to.y-outgoing.from.y))/(incoming.length*outgoing.length);
  if(nativeCosine<=-1+1e-12)return 0;
  const a=incoming.direction,b=outgoing.direction;
  const cosine=Math.max(-1,Math.min(1,(a.x*b.x+a.y*b.y)/(Math.hypot(a.x,a.y)*Math.hypot(b.x,b.y))));
  if(cosine<=-1+1e-12)return 0;
  if(cosine>=1-1e-12)return limit;
  const half=Math.sqrt((1+cosine)/2);
  return Math.min(limit,Math.sqrt(acceleration*cornering*half/(1-half)));
}
