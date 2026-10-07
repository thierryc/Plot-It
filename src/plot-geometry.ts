import {prepareScene,contains,clipPolyline,type SceneItem,type ClipRegion} from '@thierryc/plotter-core';
import {flattenSvgGeometry} from './svg-scene';
import type {PlotPath} from './svg';
/** Computed paint/CTMs from the editor; geometry algorithms are shared with Node. */
export function visiblePlotGeometry(svg:SVGSVGElement,paths:PlotPath[],tolerance:number,occlusion:boolean):PlotPath[]{
 const inverse=svg.getScreenCTM()?.inverse();if(!inverse)return paths;
 const scene:SceneItem[]=[],byId=new Map<string,PlotPath[]>();
 for(const path of paths){const id=path.sourceId??'';const list=byId.get(id)??[];list.push(path);byId.set(id,list);}
 for(const node of svg.querySelectorAll<SVGGeometryElement>('[data-plot-source-id]')){
  const id=node.getAttribute('data-plot-source-id')!,style=getComputedStyle(node),screen=node.getScreenCTM();if(!screen||style.display==='none'||style.visibility==='hidden'||node.closest('defs,[data-generated-fill]'))continue;
  const m=inverse.multiply(screen),contours=flattenSvgGeometry(node,[m.a,m.b,m.c,m.d,m.e,m.f],tolerance);
  let opacity=1;for(let ancestor:Element|null=node;ancestor&&ancestor!==svg;ancestor=ancestor.parentElement)opacity*=Number(getComputedStyle(ancestor).opacity||1);
  const clips:ClipRegion[]=[];
  for(let ancestor:Element|null=node;ancestor&&ancestor!==svg;ancestor=ancestor.parentElement){const value=getComputedStyle(ancestor).clipPath;if(!value||value==='none')continue;const match=value.match(/url\(["']?(?:[^#]*#)([^"')]+)["']?\)/),definition=match?svg.querySelector<SVGClipPathElement>(`#${CSS.escape(match[1]!)}`):null;
   if(!definition||definition.getAttribute('clipPathUnits')==='objectBoundingBox')throw new Error('Convert objectBoundingBox or unresolved clips to explicit paths before plotting.');
   const contours=Array.from(definition.querySelectorAll<SVGGeometryElement>('path,rect,circle,ellipse,polygon,polyline')).flatMap(child=>{const screen=child.getScreenCTM(),ownerScreen=(ancestor as SVGGraphicsElement).getScreenCTM?.(),owner=ownerScreen?inverse.multiply(ownerScreen):m;const d=screen?owner.multiply(inverse.multiply(screen)):owner;return flattenSvgGeometry(child,[d.a,d.b,d.c,d.d,d.e,d.f],tolerance);});clips.push({rule:getComputedStyle(definition).clipRule==='evenodd'?'evenodd':'nonzero',contours});
  }
  let visible=byId.get(id)??[];for(const clip of clips)visible=visible.flatMap(p=>clipPolyline(p,[clip],q=>contains(clip,q))) as PlotPath[];
  const fill:ClipRegion={rule:style.fillRule==='evenodd'?'evenodd':'nonzero',contours};
  // Occluding fills are clipped by the same source regions before masking earlier paths.
  scene.push({id,paths:visible,fill,clips,opaque:style.fill!=='none'&&style.fill!=='transparent'&&opacity===1&&Number(style.fillOpacity||1)===1&&!/^rgba\([^)]*,\s*(?:0|0\.\d+)\s*\)$/.test(style.fill)});byId.delete(id);
 }
 const prepared=prepareScene(scene,{hiddenLineRemoval:occlusion}) as PlotPath[];return [...prepared,...[...byId.values()].flat()];
}
