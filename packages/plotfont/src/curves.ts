import type { Point } from './types.js';
const midpoint = (a: Point, b: Point): Point => ({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
function distanceToSegment(p:Point,a:Point,b:Point):number {
  const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
/** Commands are in caller-chosen output units. Convex-hull subdivision bounds curve error. */
export function flattenContour(commands:readonly { type: string; values: readonly number[] }[],tolerance=.005):Point[] {
  if(!Number.isFinite(tolerance) || tolerance<=0) throw new Error('Curve tolerance must be positive.');
  const points:Point[]=[]; let current:Point={x:0,y:0},start:Point={x:0,y:0};
  const add=(p:Point)=>{if(!Number.isFinite(p.x)||!Number.isFinite(p.y))throw new Error('PlotFont coordinates overflow.');points.push(p);current=p;if(points.length>100000)throw new Error('PlotFont stroke is too complex to plot.');};
  const curve=(a:Point,b:Point,c:Point,d:Point,depth:number)=>{
    if(Math.max(distanceToSegment(b,a,d),distanceToSegment(c,a,d))<=tolerance){add(d);return;}
    if(depth>=24)throw new Error('PlotFont curve exceeds the accuracy limit.');
    const ab=midpoint(a,b),bc=midpoint(b,c),cd=midpoint(c,d),abc=midpoint(ab,bc),bcd=midpoint(bc,cd),mid=midpoint(abc,bcd);
    curve(a,ab,abc,mid,depth+1);curve(mid,bcd,cd,d,depth+1);
  };
  for(const [index,{type,values:v}] of commands.entries()) {
    const arities:Record<string,number>={M:2,L:2,Q:4,C:6,Z:0};
    if(!Object.hasOwn(arities,type))throw new Error(`Unsupported PlotFont command ${type}.`);
    if(v.length!==arities[type] || !v.every(Number.isFinite))throw new Error('PlotFont: invalid contour command.');
    if(index===0 && type!=='M')throw new Error('PlotFont: a contour must start with M.');
    if(type==='Z' && index!==commands.length-1)throw new Error('PlotFont: closure must be the last contour command.');
    if(type==='M'){if(points.length)throw new Error('One PlotFont stroke cannot contain multiple moves.');start={x:v[0]!,y:v[1]!};add(start);}
    else if(type==='L')add({x:v[0]!,y:v[1]!});
    else if(type==='Q'){
      const q={x:v[0]!,y:v[1]!},d={x:v[2]!,y:v[3]!},a=current;
      curve(a,{x:a.x+2*(q.x-a.x)/3,y:a.y+2*(q.y-a.y)/3},{x:d.x+2*(q.x-d.x)/3,y:d.y+2*(q.y-d.y)/3},d,0);
    } else if(type==='C')curve(current,{x:v[0]!,y:v[1]!},{x:v[2]!,y:v[3]!},{x:v[4]!,y:v[5]!},0);
    else if(type==='Z') {if(current.x!==start.x||current.y!==start.y)add({...start});}
    else throw new Error(`Unsupported PlotFont command ${type}.`);
  }
  return points;
}
