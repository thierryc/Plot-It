import {checked,PlotterError,type Path,type Point} from './types.js';
export interface ClipRegion {contours:readonly (readonly Point[])[];rule:'evenodd'|'nonzero'}
export interface SceneItem {id:string;paths:readonly Path[];fill?:ClipRegion;clip?:ClipRegion;clips?:readonly ClipRegion[];opaque?:boolean;layer?:string}
const cross=(a:Point,b:Point)=>a.x*b.y-a.y*b.x;
function extent(points:readonly Point[]){let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}return{minX,minY,maxX,maxY};}
export function contains(region:ClipRegion,p:Point):boolean {
 let winding=0,crossings=0;
 for(const contour of region.contours)for(let i=0;i<contour.length;i++){
  const a=contour[i]!,b=contour[(i+1)%contour.length]!;
  const dx=b.x-a.x,dy=b.y-a.y;if(Math.abs((p.x-a.x)*dy-(p.y-a.y)*dx)<1e-9&&p.x>=Math.min(a.x,b.x)-1e-9&&p.x<=Math.max(a.x,b.x)+1e-9&&p.y>=Math.min(a.y,b.y)-1e-9&&p.y<=Math.max(a.y,b.y)+1e-9)return true;
  if((a.y>p.y)!==(b.y>p.y)){const x=a.x+(b.x-a.x)*(p.y-a.y)/(b.y-a.y);if(x>p.x){crossings++;winding+=b.y>a.y?1:-1;}}
 }
 return region.rule==='evenodd'?crossings%2===1:winding!==0;
}
function cuts(a:Point,b:Point,regions:readonly ClipRegion[]):number[]{
 const direction={x:b.x-a.x,y:b.y-a.y},values=[0,1];
 for(const region of regions)for(const contour of region.contours)for(let i=0;i<contour.length;i++){
  const p=contour[i]!,q=contour[(i+1)%contour.length]!,edge={x:q.x-p.x,y:q.y-p.y},den=cross(direction,edge);if(Math.abs(den)<1e-12)continue;
  const relative={x:p.x-a.x,y:p.y-a.y},t=cross(relative,edge)/den,u=cross(relative,direction)/den;if(t>0&&t<1&&u>=0&&u<=1)values.push(t);
 }
 return values.sort((x,y)=>x-y).filter((t,i,all)=>!i||Math.abs(t-all[i-1]!)>1e-10);
}
/** Keeps discontinuous visible pieces separate; never draws a clipped connector. */
export function clipPolyline(path:Path,regions:readonly ClipRegion[],visible:(point:Point)=>boolean):Path[]{
 const edges=regions.reduce((n,r)=>n+r.contours.reduce((s,c)=>s+c.length,0),0);if((path.points.length-1)*edges>20000000)throw new PlotterError('invalid-plan','Clipping exceeds geometry limits.');
 const result:Path[]=[];let current:Point[]|null=null;
 for(let i=1;i<path.points.length;i++){
  const a=path.points[i-1]!,b=path.points[i]!,factors=cuts(a,b,regions),point=(t:number)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  for(let k=1;k<factors.length;k++){const from=point(factors[k-1]!),to=point(factors[k]!);if(!visible(point((factors[k-1]!+factors[k]!)/2))){current=null;continue;}
   if(current&&Math.hypot(current.at(-1)!.x-from.x,current.at(-1)!.y-from.y)<1e-8)current.push(to);else{current=[from,to];result.push({...path,points:current});}
  }
 }
 return result;
}
export function rectangle(width:number,height:number,margin=0):ClipRegion {
 checked(width,0,1e6,'width');checked(height,0,1e6,'height');checked(margin,0,Math.min(width,height)/2,'margin');return{rule:'nonzero',contours:[[{x:margin,y:margin},{x:width-margin,y:margin},{x:width-margin,y:height-margin},{x:margin,y:height-margin}]]};
}
export function prepareScene(items:readonly SceneItem[],settings:{machine?:ClipRegion;page?:ClipRegion;hiddenLineRemoval?:boolean}={}):Path[]{
 if(items.length>100000)throw new PlotterError('invalid-plan','Scene exceeds item limit.');const segments=items.reduce((n,item)=>n+item.paths.reduce((s,p)=>s+Math.max(0,p.points.length-1),0),0);const edges=(r:ClipRegion|undefined)=>r?.contours.reduce((n,c)=>n+c.length,0)??0;const complexity=edges(settings.machine)+edges(settings.page)+items.reduce((n,item)=>n+edges(item.clip)+(item.clips??[]).reduce((s,c)=>s+edges(c),0)+(settings.hiddenLineRemoval?edges(item.fill):0),0);if(segments>1000000||segments*complexity>20000000)throw new PlotterError('invalid-plan','Clipping/occlusion exceeds geometry limits; simplify the scene.');const output:Path[]=[];
 for(const [index,item]of items.entries()){
  const later=settings.hiddenLineRemoval?items.slice(index+1).filter(l=>l.opaque&&l.fill):[],regions=[settings.machine,settings.page,item.clip,...(item.clips??[]),...later.flatMap(l=>[l.fill,l.clip,...(l.clips??[])])].filter((r):r is ClipRegion=>!!r);
  const visible=(p:Point)=>(!settings.machine||contains(settings.machine,p))&&(!settings.page||contains(settings.page,p))&&(!item.clip||contains(item.clip,p))&&(item.clips??[]).every(c=>contains(c,p))&&!later.some(l=>contains(l.fill!,p)&&(!l.clip||contains(l.clip,p))&&(l.clips??[]).every(c=>contains(c,p)));
  for(const path of item.paths)output.push(...(regions.length?clipPolyline(path,regions,visible):[{...path,points:path.points.map(p=>({...p}))}]));
 }
 return output;
}
export function automaticPlacement(paths:readonly Path[],width:number,height:number,margin=0):{paths:Path[];rotation:0|90;offset:Point}{
 const points=paths.flatMap(p=>p.points);if(!points.length)return{paths:[],rotation:0,offset:{x:0,y:0}};
 const {minX,minY,maxX,maxY}=extent(points),w=maxX-minX,h=maxY-minY;
 const availableX=width-2*margin,availableY=height-2*margin,score=(a:number,b:number)=>Math.min(availableX/Math.max(a,1e-9),availableY/Math.max(b,1e-9));
 const rotation:0|90=score(h,w)>score(w,h)?90:0,offset={x:margin,y:margin};
 return{rotation,offset,paths:paths.map(path=>({...path,points:path.points.map(p=>rotation?{x:margin+h-(p.y-minY),y:margin+p.x-minX}:{x:margin+p.x-minX,y:margin+p.y-minY})}))};
}
export function executionSvg(plan:import('./types.js').ExecutablePlan,filter:'draw'|'travel'|'all'='all'):string {
 const records=plan.records.filter(r=>r.kind==='motor'&&(filter==='all'||r.penDown===(filter==='draw'))),points=records.flatMap(r=>[r.from,r.to]);
 const bounds=points.length?extent(points):{minX:1,minY:1,maxX:0,maxY:0},minX=bounds.minX-1,minY=bounds.minY-1,maxX=bounds.maxX+1,maxY=bounds.maxY+1;
 return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX-minX} ${maxY-minY}">${records.map(r=>`<path d="M${r.from.x} ${r.from.y}L${r.to.x} ${r.to.y}" fill="none" stroke="${r.penDown?'#1657b8':'#ca738f'}" stroke-width="${r.kind==='motor'?r.width??.2:.2}"${r.penDown?'':' stroke-dasharray="1 .6"'}/>`).join('')}</svg>`;
}
