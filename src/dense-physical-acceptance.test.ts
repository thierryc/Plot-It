// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {afterEach,expect,it} from 'vitest';
import {parseSvg,renderItem,flattenPlotPathsAsync} from './svg';
import {WorkSlice} from './cooperative';
import {initialState} from './model';
import {preparePenPaths,defaultPens} from './pens';
import {buildMotionPlan} from './motion-plan';
import {validateNativePreview} from './native-preview';
afterEach(()=>document.body.replaceChildren());
it('imports the exact dense fixture at 1:1 mm and prepares 16× T3 through the editor',async()=>{
 const directory='docs/validation/dense-t3-acceptance',manifest=JSON.parse(readFileSync(`${directory}/manifest.json`,'utf8'));
 const source=readFileSync(`${directory}/${manifest.file}`,'utf8');expect(createHash('sha256').update(source).digest('hex')).toBe(manifest.sha256);
 const item=parseSvg(source,manifest.file);expect(item.viewBox).toEqual([0,0,200,80]);Object.assign(item,{x:0,y:0,width:200,height:80});
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 200 80');svg.innerHTML=`<g id="artwork-layer">${renderItem(item)}</g>`;document.body.append(svg);
 expect(svg.querySelectorAll('path')).toHaveLength(1);expect(svg.querySelector('[data-item-id]')!.getAttribute('transform')).toBe('translate(0 0) rotate(0 100 40) scale(1 1) translate(0 0)');expect([...svg.querySelectorAll('[transform]')]).toHaveLength(1);
 // jsdom lacks screen CTMs. This only supplies the asserted identity placement;
 // geometry, SVG parsing, flattening, pen preparation and compiler remain real.
 const identity={a:1,b:0,c:0,d:1,e:0,f:0};Object.assign(svg,{getScreenCTM:()=>({inverse:()=>({multiply:(matrix:typeof identity)=>matrix})})});svg.querySelectorAll('path').forEach(p=>Object.assign(p,{getScreenCTM:()=>identity}));
 const paths=await flattenPlotPathsAsync(svg,new WorkSlice(),[],.05),recipe=JSON.parse(readFileSync('scripts/fixtures/permissive-motion-corpus.json','utf8')).dense;
 const points=Array.from({length:recipe.count},(_,i)=>({x:recipe.offsetX+i*recipe.stepX,y:recipe.offsetY+recipe.amplitude*Math.sin(i*recipe.radiansPerPoint)}));
 expect(paths).toHaveLength(1);const maximumDeviation=paths[0]!.points.reduce((error,p,i)=>Math.max(error,Math.abs(p.x-points[i]!.x),Math.abs(p.y-points[i]!.y)),0);expect(maximumDeviation).toBeLessThan(1e-12);expect(paths[0]!.points).toHaveLength(18000);
 expect(createHash('sha256').update(JSON.stringify(paths[0]!.points)).digest('hex')).toBe(manifest.pointsSha256);
 const settings={...initialState.settings,profile:'xylodraw' as const,machineRotation:0 as const,resolution:16 as const,handling:'custom' as const,motionPreference:'scurve' as const,motionFirmware:'3.1.7',speed:35,travelSpeed:60,drawAcceleration:200,travelAcceleration:300,cornering:.127,penUp:30,penDown:52,penRateRaise:75,penRateLower:50,penDelayUpMs:200,penDelayDownMs:200,penReloadWaitMs:0,reorderMode:'preserve' as const,strictOrder:true,maxPenDownMm:0,pathJoinToleranceMm:0,pathSimplifyToleranceMm:0,returnToOrigin:true};
 const prepared=preparePenPaths(paths,settings,defaultPens()).paths;expect(prepared[0]!.points).toEqual(paths[0]!.points);
 const plan=buildMotionPlan(prepared,settings);expect(()=>validateNativePreview(plan)).not.toThrow();expect(plan.executable!.backend).toBe('t3');
 expect(plan.executable!.records.filter(r=>r.kind==='pen').map(r=>r.durationMs)).toEqual([598,420,396]);expect(plan.events.at(-1)!.to).toEqual({x:0,y:0});
},20000);
