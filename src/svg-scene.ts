import {flattenContour} from '@thierryc/openplotfont';
import {parsePath,type PathCommand} from './editor';
import {parseLayerControls,prepareScene,type Point,type Path,type SceneItem,type Layer,type ClipRegion} from '@thierryc/plotter-core';
export interface SvgNode {localName:string;getAttribute(name:string):string|null;children:ArrayLike<SvgNode>;getAttributeNS?(namespace:string,name:string):string|null}
type Matrix=[number,number,number,number,number,number];const ID:Matrix=[1,0,0,1,0,0];
const numbers=(value:string|null)=>value?.trim().split(/[\s,]+/).filter(Boolean).map(Number)??[];
const multiply=(a:Matrix,b:Matrix):Matrix=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const point=(m:Matrix,x:number,y:number):Point=>({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]});
function transform(source:string|null):Matrix {
 let result=ID;if(!source)return result;let consumed='';for(const match of source.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)){
  consumed+=match[0];const v=numbers(match[2]!),angle=(v[0]??0)*Math.PI/180;let m:Matrix;
  switch(match[1]){case'matrix':if(v.length!==6)throw new Error('Invalid SVG matrix');m=v as Matrix;break;case'translate':m=[1,0,0,1,v[0]??0,v[1]??0];break;case'scale':m=[v[0]!,0,0,v[1]??v[0]!,0,0];break;case'rotate':{const r:Matrix=[Math.cos(angle),Math.sin(angle),-Math.sin(angle),Math.cos(angle),0,0];m=v.length===3?multiply(multiply([1,0,0,1,v[1]!,v[2]!],r),[1,0,0,1,-v[1]!,-v[2]!]):r;break;}case'skewX':m=[1,0,Math.tan(angle),1,0,0];break;case'skewY':m=[1,Math.tan(angle),0,1,0,0];break;default:throw new Error('Unsupported SVG transform');}
  if(!m.every(Number.isFinite))throw new Error('Invalid SVG transform');result=multiply(result,m);
 }if(consumed.replace(/[\s,]/g,'')!==source.replace(/[\s,]/g,''))throw new Error('Invalid SVG transform syntax');return result;
}
function arc(from:Point,v:readonly number[],matrix:Matrix,tolerance:number):Point[]{
 let [rx,ry,rotation,large,sweep,x,y]=v as [number,number,number,number,number,number,number];rx=Math.abs(rx);ry=Math.abs(ry);if(Math.hypot(from.x-x,from.y-y)<1e-12)return[];if(!rx||!ry)return[point(matrix,x,y)];
 const phi=rotation*Math.PI/180,c=Math.cos(phi),s=Math.sin(phi),dx=(from.x-x)/2,dy=(from.y-y)/2,xp=c*dx+s*dy,yp=-s*dx+c*dy;
 const lambda=xp*xp/(rx*rx)+yp*yp/(ry*ry);if(lambda>1){rx*=Math.sqrt(lambda);ry*=Math.sqrt(lambda);}
 const factor=(large===sweep?-1:1)*Math.sqrt(Math.max(0,(rx*rx*ry*ry-rx*rx*yp*yp-ry*ry*xp*xp)/(rx*rx*yp*yp+ry*ry*xp*xp||1))),cxp=factor*rx*yp/ry,cyp=-factor*ry*xp/rx,cx=c*cxp-s*cyp+(from.x+x)/2,cy=s*cxp+c*cyp+(from.y+y)/2;
 const start=Math.atan2((yp-cyp)/ry,(xp-cxp)/rx),end=Math.atan2((-yp-cyp)/ry,(-xp-cxp)/rx);let delta=end-start;if(sweep&&delta<0)delta+=2*Math.PI;if(!sweep&&delta>0)delta-=2*Math.PI;
 const radius=Math.max(rx,ry)*Math.hypot(matrix[0],matrix[1],matrix[2],matrix[3]),step=Math.max(1e-4,2*Math.acos(Math.max(-1,1-tolerance/Math.max(radius,tolerance)))),count=Math.max(1,Math.ceil(Math.abs(delta)/step));if(count>100000)throw new Error('Arc exceeds sampling limit');
 return Array.from({length:count},(_,i)=>{const theta=start+delta*(i+1)/count;return point(matrix,cx+c*rx*Math.cos(theta)-s*ry*Math.sin(theta),cy+s*rx*Math.cos(theta)+c*ry*Math.sin(theta));});
}
export function flattenSvgGeometry(node:SvgNode,matrix:Matrix,tolerance:number):Point[][]{
 const n=(key:string,defaultValue=0)=>{const value=Number(node.getAttribute(key)??defaultValue);if(!Number.isFinite(value))throw new Error('Invalid SVG coordinate');return value;};
 let commands:PathCommand[]=[];switch(node.localName){
  case'path':commands=parsePath(node.getAttribute('d')??'');break;
  case'line':commands=[{type:'M',values:[n('x1'),n('y1')]},{type:'L',values:[n('x2'),n('y2')]}];break;
  case'polyline':case'polygon':{const v=numbers(node.getAttribute('points'));if(v.length%2||!v.every(Number.isFinite))throw new Error('Invalid SVG polygon');for(let i=0;i<v.length;i+=2)commands.push({type:i?'L':'M',values:[v[i]!,v[i+1]!]});if(node.localName==='polygon')commands.push({type:'Z',values:[]});break;}
  case'rect':{if(n('rx')||n('ry'))throw new Error('Convert rounded rectangles to paths before CLI plotting.');const x=n('x'),y=n('y'),w=n('width'),h=n('height');commands=[{type:'M',values:[x,y]},{type:'L',values:[x+w,y]},{type:'L',values:[x+w,y+h]},{type:'L',values:[x,y+h]},{type:'Z',values:[]}];break;}
  case'circle':case'ellipse':{const cx=n('cx'),cy=n('cy'),rx=node.localName==='circle'?n('r'):n('rx'),ry=node.localName==='circle'?n('r'):n('ry');if(rx<=0||ry<=0)return[];commands=[{type:'M',values:[cx+rx,cy]},{type:'A',values:[rx,ry,0,1,1,cx-rx,cy]},{type:'A',values:[rx,ry,0,1,1,cx+rx,cy]},{type:'Z',values:[]}];break;}
  default:return[];
 }
 const contours:Point[][]=[];let normalized:{type:string;values:number[]}[]=[],cursor:Point={x:0,y:0},start=cursor;
 const flush=()=>{if(normalized.length){contours.push(flattenContour(normalized,tolerance));normalized=[];}};
 for(const command of commands){if(command.type==='M'){flush();cursor={x:command.values[0]!,y:command.values[1]!};start={...cursor};normalized.push({type:'M',values:Object.values(point(matrix,cursor.x,cursor.y))});}
  else if(command.type==='A'){for(const p of arc(cursor,command.values,matrix,tolerance))normalized.push({type:'L',values:[p.x,p.y]});cursor={x:command.values[5]!,y:command.values[6]!};}
  else {normalized.push({type:command.type,values:command.values.flatMap((_,i,v)=>i%2?[]:Object.values(point(matrix,v[i]!,v[i+1]!)))});if(command.type==='Z')cursor=start;else cursor={x:command.values.at(-2)!,y:command.values.at(-1)!};}}
 flush();return contours;
}
export interface SvgScene {items:SceneItem[];layers:Layer[];width:number;height:number;toleranceMm:number}
/** Shared browser/Node geometry reader. XML parsing and external resources stay outside. */
export function readSvgScene(root:SvgNode,toleranceMm=.05):SvgScene {
 if(!Number.isFinite(toleranceMm)||toleranceMm<.001||toleranceMm>10)throw new Error('Invalid curve accuracy');
 const dimensions=(key:string,fallback:number)=>{const text=root.getAttribute(key);if(!text)return fallback;const m=text.match(/^([\d.]+)(mm|cm|in|px|pt)?$/);if(!m)throw new Error('SVG dimensions must use explicit physical units');return Number(m[1])*({mm:1,cm:10,in:25.4,pt:25.4/72,px:25.4/96}[m[2] as 'mm']??25.4/96);};
 const view=numbers(root.getAttribute('viewBox'));if(view.length!==4||!view.every(Number.isFinite)||view[2]!<=0||view[3]!<=0)throw new Error('SVG import requires a positive viewBox');const width=dimensions('width',view[2]!),height=dimensions('height',view[3]!),scale=Math.min(width/view[2]!,height/view[3]!);
 const base:Matrix=[scale,0,0,scale,-view[0]!*scale+(width-view[2]!*scale)/2,-view[1]!*scale+(height-view[3]!*scale)/2],items:SceneItem[]=[],layers:Layer[]=[],ids=new Map<string,SvgNode>();let ordinal=0;
 const index=(node:SvgNode)=>{const id=node.getAttribute('id');if(id)ids.set(id,node);for(const child of Array.from(node.children))index(child);};index(root);
 const ink=(node:SvgNode,key:string)=>node.getAttributeNS?.('http://www.inkscape.org/namespaces/inkscape',key)??node.getAttribute(`inkscape:${key}`);
 const walk=(node:SvgNode,parent:Matrix,inherited:Record<string,string>,layerId='default',inheritedClips:ClipRegion[]=[])=>{
  const styles={...inherited};delete styles.opacity;delete styles['clip-path'];if(node.getAttribute('filter')||node.getAttribute('mask'))throw new Error('SVG filters and masks are unsupported');for(const entry of (node.getAttribute('style')??'').split(';')){const [key,value]=entry.split(':');if(key&&value)styles[key.trim()]=value.trim();}
  for(const key of ['stroke','fill','fill-rule','clip-rule','display','visibility','opacity','fill-opacity','clip-path']){const value=node.getAttribute(key);if(value!==null)styles[key]=value;}
  if(styles.display==='none'||styles.visibility==='hidden')return;
  const effectiveOpacity=Number(inherited._effectiveOpacity??1)*Number(styles.opacity??1);styles._effectiveOpacity=String(effectiveOpacity);
  const tag=node.localName;if(tag==='svg'&&node!==root)throw new Error('Flatten nested SVG viewports before CLI plotting.');if(['script','foreignObject','image','text','use','mask','filter','style'].includes(tag))throw new Error(`Unsupported SVG ${tag}; convert to explicit paths before plotting.`);
  if(['defs','clipPath','metadata','title','desc'].includes(tag))return;
  const matrix=multiply(parent,transform(node.getAttribute('transform'))),layerLabel=ink(node,'label');
  if(ink(node,'groupmode')==='layer'||layerLabel){const controls=parseLayerControls(layerLabel??''),id=node.getAttribute('id')??`layer-${layers.length}`;if(controls.documentation)return;layerId=id;layers.push({id,sourceOrder:ordinal,name:controls.label,paths:[],delayMs:controls.delayMs,pause:controls.pause,speedPercent:controls.speedPercent,controls,overrides:{...(controls.penDown!==undefined?{penDown:controls.penDown}:{})}});}
  const clips=[...inheritedClips];if(styles['clip-path']){const match=styles['clip-path'].match(/^url\(#([^)]*)\)$/),definition=match?ids.get(match[1]!):null;if(!definition||definition.getAttribute('clipPathUnits')==='objectBoundingBox')throw new Error('Unsupported or missing SVG clip path');const collect=(child:SvgNode,parent:Matrix):Point[][]=>{if(['use','text','image','mask','filter'].includes(child.localName))throw new Error('Unsupported clip-path content');const local=multiply(parent,transform(child.getAttribute('transform')));return [...flattenSvgGeometry(child,local,toleranceMm),...Array.from(child.children).flatMap(grandchild=>collect(grandchild,local))];};const local=multiply(matrix,transform(definition.getAttribute('transform')));clips.push({rule:definition.getAttribute('clip-rule')==='evenodd'?'evenodd':'nonzero',contours:Array.from(definition.children).flatMap(child=>collect(child,local))});}
  const contours=flattenSvgGeometry(node,matrix,toleranceMm);if(contours.length){const sourceOrder=ordinal++,id=node.getAttribute('id')??`source-${sourceOrder}`,stroke=styles.stroke??'black',fill=styles.fill??'black',paths=stroke==='none'?[]:contours.filter(c=>c.length>1).map(points=>({tool:stroke,points,sourceId:id,sourceOrder,layerId}));
   if((styles.fill??'').startsWith('url(')||(styles.stroke??'').startsWith('url('))throw new Error('SVG paint resources must be converted to paths');
   items.push({id,paths,layer:layerId,...(fill!=='none'?{fill:{rule:styles['fill-rule']==='evenodd'?'evenodd':'nonzero',contours}}:{}),clips,opaque:effectiveOpacity===1&&Number(styles['fill-opacity']??1)===1&&fill!=='transparent'&&!/^rgba\([^)]*,\s*(?:0|0\.\d+)\s*\)$/.test(fill)});
   let layer=layers.find(l=>l.id===layerId);if(!layer){layer={id:layerId,name:'Drawing',paths:[]};layers.push(layer);}layer.paths=[...layer.paths,...paths];
  }
  for(const child of Array.from(node.children))walk(child,matrix,styles,layerId,clips);
 };
 walk(root,base,{});return{items,layers,width,height,toleranceMm};
}
export function svgScenePaths(scene:SvgScene,hiddenLineRemoval=false):Path[]{return prepareScene(scene.items,{hiddenLineRemoval});}
