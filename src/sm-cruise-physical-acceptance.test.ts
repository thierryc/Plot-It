// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {afterEach,describe,it,expect} from 'vitest';
import {parseSvg,renderItem,flattenPlotPathsAsync} from './svg';
import {WorkSlice} from './cooperative';
import {initialState} from './model';
import {preparePenPaths,defaultPens} from './pens';
import {buildMotionPlan} from './motion-plan';
import {validateNativePreview} from './native-preview';
import {inspectExecutable} from '../scripts/permissive-motion-oracle.mjs';
const directory=resolve('docs/validation/sm-cruise-acceptance');
interface Fixture{file:string;sha256:string;sizeMm:number[];pathCount:number;paths:{id:string;pointsMm:number[][];sourceLengthMm:number}[]}
const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
afterEach(()=>document.body.replaceChildren());
describe('SM cruise physical fixtures through actual import/preparation',()=>{
 it.each(manifest.files as Fixture[])('imports exact80mm source geometry and prepares $file',async fixture=>{
  const source=readFileSync(join(directory,fixture.file),'utf8');expect(createHash('sha256').update(source).digest('hex')).toBe(fixture.sha256);
  const item=parseSvg(source,fixture.file);expect(item.viewBox).toEqual([0,0,80,80]);expect(fixture.sizeMm).toEqual([80,80]);
  Object.assign(item,{x:0,y:0,width:80,height:80});
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.innerHTML=`<g id="artwork-layer">${renderItem(item)}</g>`;document.body.append(svg);
  expect(svg.querySelectorAll('path')).toHaveLength(fixture.pathCount);expect(svg.querySelector('text,image,use')).toBeNull();
  expect([...svg.querySelectorAll('[transform]')]).toHaveLength(1);expect(svg.querySelector('[transform]')!.getAttribute('transform')).toBe('translate(0 0) rotate(0 40 40) scale(1 1) translate(0 0)');
  // The asserted 1:1 editor setup has identity screen matrices. jsdom lacks
  // this layout primitive; no path geometry, parser or compiler is mocked.
  const identity={a:1,b:0,c:0,d:1,e:0,f:0};Object.assign(svg,{getScreenCTM:()=>({inverse:()=>({multiply:(matrix:typeof identity)=>matrix})})});
  svg.querySelectorAll('path').forEach(path=>Object.assign(path,{getScreenCTM:()=>identity}));
  const paths=await flattenPlotPathsAsync(svg,new WorkSlice(),[],.05);expect(paths).toHaveLength(fixture.pathCount);
  for(const [index,path] of paths.entries()){
   expect(path.points.map(p=>[p.x,p.y])).toEqual(fixture.paths[index]!.pointsMm);
   const length=path.points.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-path.points[i]!.x,p.y-path.points[i]!.y),0);expect(length).toBeCloseTo(fixture.paths[index]!.sourceLengthMm,8);
   for(const point of path.points){expect([point.x,point.y].every(Number.isFinite)).toBe(true);expect(Math.min(point.x,point.y)).toBeGreaterThanOrEqual(10);expect(Math.max(point.x,point.y)).toBeLessThanOrEqual(70);}
  }
  // Software-only XyloDraw configuration. A user's calibration is never applied
  // or changed; 3.1.7 is the P3 target and 2.8.1 checks legacy preparation only.
  const counts:number[]=[],durations:number[]=[];
  for(const firmware of ['3.1.7','2.8.1']){
   const settings={...initialState.settings,profile:'xylodraw' as const,machineRotation:0 as const,resolution:16 as const,handling:'custom' as const,motionPreference:'compatibility' as const,motionFirmware:firmware,reorderMode:'preserve' as const,strictOrder:true,maxPenDownMm:0,returnToOrigin:true};
   const prepared=preparePenPaths(paths,settings,defaultPens()).paths,plan=buildMotionPlan(prepared,settings);expect(()=>validateNativePreview(plan)).not.toThrow();
   expect(()=>inspectExecutable(plan.executable!,prepared)).not.toThrow();expect(plan.executable!.backend).toBe('sm');
   expect(plan.events.filter(e=>e.kind==='pen'&&e.penDown)).toHaveLength(fixture.pathCount);expect(plan.events.at(-1)!.penDown).toBe(false);expect(plan.events.at(-1)!.to).toEqual({x:0,y:0});
   counts.push(plan.executable!.records.length);durations.push(plan.executable!.durationMs);
  }
  // These are exercise fixtures, not just files that happen to import: at this
  // explicit software configuration they must execute an optimized cruise.
  expect(counts[0]).toBeLessThan(counts[1]!);expect(durations[0]).toBeLessThanOrEqual(durations[1]!);
 });
 it('retains the six linked reuse fixtures without duplicating their geometry',()=>{
  expect(manifest.reusedFixtures).toHaveLength(6);for(const fixture of manifest.reusedFixtures){const content=readFileSync(join(directory,fixture.file),'utf8');expect(()=>parseSvg(content,fixture.file)).not.toThrow();}
 });
});
