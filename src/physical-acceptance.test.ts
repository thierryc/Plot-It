// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {afterEach,describe,it,expect} from 'vitest';
import {parseSvg,renderItem,flattenPlotPathsAsync,type PlotPath} from './svg';
import {WorkSlice} from './cooperative';
import {initialState} from './model';
import {buildMotionPlan} from './motion-plan';
import {validateNativePreview} from './native-preview';
import {preparePenPaths,defaultPens} from './pens';
import {readSvgScene,svgScenePaths} from './svg-scene';

const directory=resolve('docs/validation/plotter-acceptance');
interface Fixture {file:string;sha256:string;pathCount:number;paths:{id:string;startMm:number[];endMm:number[];sourceLengthMm:number}[]}
const fixtures=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8')).files as Fixture[];
afterEach(()=>document.body.replaceChildren());

async function imported(f:Fixture):Promise<PlotPath[]> {
 const source=readFileSync(join(directory,f.file),'utf8');
 expect(createHash('sha256').update(source).digest('hex')).toBe(f.sha256);
 const item=parseSvg(source,f.file);
 expect(item.viewBox).toEqual([0,0,80,80]);
 // This is the documented editor resize/placement, not parseSvg's display default.
 Object.assign(item,{x:0,y:0,width:80,height:80});
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 80 80');svg.innerHTML=`<g id="artwork-layer">${renderItem(item)}</g>`;
 document.body.append(svg);
 expect(svg.querySelectorAll('path')).toHaveLength(f.pathCount);
 expect(svg.querySelector('text,image,use')).toBeNull();
 expect(svg.querySelector('[data-item-id]')!.getAttribute('transform')).toBe('translate(0 0) rotate(0 40 40) scale(1 1) translate(0 0)');
 expect([...svg.querySelectorAll('[transform]')]).toHaveLength(1);
 // jsdom omits screen CTMs. Identity is exact for this asserted 1:1 mm setup.
 // No geometry, path parsing, curve flattening, lengths or planner are mocked.
 const identity={a:1,b:0,c:0,d:1,e:0,f:0};
 Object.assign(svg,{getScreenCTM:()=>({inverse:()=>({multiply:(matrix:typeof identity)=>matrix})})});
 svg.querySelectorAll('path').forEach(path=>Object.assign(path,{getScreenCTM:()=>identity}));
 return flattenPlotPathsAsync(svg,new WorkSlice(),[],.05);
}

describe('physical acceptance files through real import and preparation',()=>{
 it.each(fixtures)('imports and prepares $file at its documented 80 mm size',async f=>{
  const paths=await imported(f);expect(paths).toHaveLength(f.pathCount);
  const original=new DOMParser().parseFromString(readFileSync(join(directory,f.file),'utf8'),'image/svg+xml');
  const scene=readSvgScene(original.documentElement,.05);expect([scene.width,scene.height]).toEqual([80,80]);
  // The browser extraction and independent Node/shared scene entry point agree.
  const shared=svgScenePaths(scene);expect(paths.map(p=>p.points)).toEqual(shared.map(p=>p.points));
  paths.forEach((path,index)=>{
   const expected=f.paths[index]!;expect(path.points[0]!.x).toBeCloseTo(expected.startMm[0]!,9);expect(path.points[0]!.y).toBeCloseTo(expected.startMm[1]!,9);
   expect(path.points.at(-1)!.x).toBeCloseTo(expected.endMm[0]!,9);expect(path.points.at(-1)!.y).toBeCloseTo(expected.endMm[1]!,9);
   for(const point of path.points){expect(Number.isFinite(point.x)&&Number.isFinite(point.y)).toBe(true);expect(point.x).toBeGreaterThanOrEqual(10-1e-9);expect(point.x).toBeLessThanOrEqual(70+1e-9);expect(point.y).toBeGreaterThanOrEqual(10-1e-9);expect(point.y).toBeLessThanOrEqual(70+1e-9);}
   const length=path.points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-path.points[i]!.x,p.y-path.points[i]!.y),0);
   expect(Math.abs(length-expected.sourceLengthMm)).toBeLessThan(f.file.startsWith('04')?.1:1e-7);
  });
  for(const backend of ['scurve','compatibility'] as const){
   // Explicit software-only configuration; no claim about a user's actual device.
   const settings={...initialState.settings,profile:'xylodraw' as const,machineRotation:0 as const,resolution:16 as const,handling:'custom' as const,motionPreference:backend,motionFirmware:'3.1.7',reorderMode:'preserve' as const,strictOrder:true,maxPenDownMm:f.file.startsWith('05')?20:0,returnToOrigin:true};
   const prepared=preparePenPaths(paths,settings,defaultPens()).paths,plan=buildMotionPlan(prepared,settings);
   expect(plan.executable).toBeDefined();expect(()=>validateNativePreview(plan)).not.toThrow();
   expect(plan.executable!.drawingMm).toBeGreaterThan(0);expect(plan.events.at(-1)!.penDown).toBe(false);expect(plan.events.at(-1)!.to).toEqual({x:0,y:0});
   if(f.file.startsWith('02')){const gaps=paths.slice(1).map((p,i)=>Math.hypot(p.points[0]!.x-paths[i]!.points.at(-1)!.x,p.points[0]!.y-paths[i]!.points.at(-1)!.y));expect(gaps.every(g=>g>=50)).toBe(true);expect(plan.events.filter(e=>e.kind==='pen'&&e.penDown)).toHaveLength(4);}
   if(f.file.startsWith('05'))expect(plan.events.filter(e=>e.kind==='pen'&&e.penDown).length).toBeGreaterThanOrEqual(6);
   if(f.file.startsWith('06'))expect(plan.events.filter(e=>e.kind==='pen'&&e.penDown)).toHaveLength(8);
  }
 });
});
