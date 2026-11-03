// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {afterEach,describe,it,expect} from 'vitest';
import {parseSvg,renderItem,flattenPlotPathsAsync} from './svg';
import {WorkSlice} from './cooperative';
import {initialState,type PlotSettings} from './model';
import {preparePenPaths,defaultPens} from './pens';
import {buildMotionPlan} from './motion-plan';
import {validateNativePreview} from './native-preview';
import {inspectExecutable} from '../scripts/permissive-motion-oracle.mjs';
import type {AxisParameters,ExecutablePlan,ExecutionRecord,NativePoint} from '@thierryc/plotter-core';

const directory=resolve('docs/validation/dynamic-acceptance');
interface Fixture{file:string;sha256:string;sizeMm:number[];viewBox:number[];pathCount:number;boundsMm:number[];paths:{id:string;startMm:number[];endMm:number[];boundsMm:number[];sourceLengthMm:number}[]}
const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
afterEach(()=>document.body.replaceChildren());

async function importFixture(fixture:Fixture){
 const source=readFileSync(join(directory,fixture.file),'utf8');
 expect(createHash('sha256').update(source).digest('hex')).toBe(fixture.sha256);
 const item=parseSvg(source,fixture.file);expect(item.viewBox).toEqual(fixture.viewBox);expect(fixture.sizeMm).toEqual([80,80]);
 Object.assign(item,{x:0,y:0,width:80,height:80});
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 80 80');svg.innerHTML=`<g id="artwork-layer">${renderItem(item)}</g>`;document.body.append(svg);
 expect(svg.querySelectorAll('path')).toHaveLength(fixture.pathCount);expect(svg.querySelector('text,image,use')).toBeNull();
 expect([...svg.querySelectorAll('[transform]')]).toHaveLength(1);expect(svg.querySelector('[transform]')!.getAttribute('transform')).toBe('translate(0 0) rotate(0 40 40) scale(1 1) translate(0 0)');
 // jsdom omits screen matrices. Supply only the asserted identity placement;
 // parsing, arc/cubic flattening, pen preparation and compilation remain real.
 const identity={a:1,b:0,c:0,d:1,e:0,f:0};Object.assign(svg,{getScreenCTM:()=>({inverse:()=>({multiply:(matrix:typeof identity)=>matrix})})});
 svg.querySelectorAll('path').forEach(path=>Object.assign(path,{getScreenCTM:()=>identity}));
 return flattenPlotPathsAsync(svg,new WorkSlice(),[],.01);
}

// A TD record can pair two different source directions. Expand its literal
// halves before the independent chord-coverage walk, so its outer endpoint chord
// cannot be mistaken for the actual two-part native trajectory. Integer sums here
// are independent of production predictors and do not change the tested program.
function axisEndpoint(ticks:number,axis:AxisParameters,carry:number,clear:boolean){
 const t=BigInt(ticks),a=BigInt(axis.acceleration),j=BigInt(axis.jerk),base=BigInt(axis.rate-Math.trunc(axis.acceleration/2)+Math.trunc(axis.jerk/6)),b=2147483648n;
 const first=Number(base)+axis.acceleration;
 const initial=clear?(first<0||first===0&&(axis.acceleration+axis.jerk<0||axis.acceleration+axis.jerk===0&&axis.jerk<0)?2147483647:0):carry;
 const sum=BigInt(initial)+t*base+a*t*(t+1n)/2n+j*t*(t*t-1n)/6n,steps=sum>=0n?sum/b:-((-sum+b-1n)/b);
 return{steps:Number(steps),carry:Number(sum-steps*b)};
}
function expandedDualRecords(plan:ExecutablePlan):ExecutablePlan{
 expect(plan.options.profile.rotation).toBe(0);const scale=plan.options.profile.stepsPerMm;
 const point=(p:NativePoint)=>({x:(p.m1+p.m2)/(2*scale),y:(p.m1-p.m2)/(2*scale)});
 const records:ExecutionRecord[]=[];let elapsed=0;
 const append=(r:ExecutionRecord)=>{records.push({...r,id:records.length,startMs:elapsed});elapsed+=r.durationMs;};
 for(const r of plan.records){
  if(r.kind!=='motor'||r.native?.command!=='TD'){append(r);continue;}
  let previous={...r.fromSteps},carry={...r.native.accumulatorsBefore};
  for(const [index,half]of r.native.halves.entries()){
   const x=axisEndpoint(half.ticks,half.axis1,carry.m1,!!(half.clear&1)),y=axisEndpoint(half.ticks,half.axis2,carry.m2,!!(half.clear&2));
   const target={m1:previous.m1+x.steps,m2:previous.m2+y.steps},after={m1:x.carry,m2:y.carry};
   append({...r,from:point(previous),to:point(target),fromSteps:previous,toSteps:target,durationMs:half.ticks/25,restBefore:index===0&&r.restBefore,native:{command:'T3',halves:[half],accumulatorsBefore:carry,accumulatorsAfter:after}});
   previous=target;carry=after;
  }
  expect(previous).toEqual(r.toSteps);expect(carry).toEqual(r.native.accumulatorsAfter);
 }
 expect(elapsed).toBeCloseTo(plan.durationMs,7);let drawingMm=0,travelMm=0;for(const r of records)if(r.kind==='motor'){const distance=Math.hypot(r.to.x-r.from.x,r.to.y-r.from.y);if(r.penDown)drawingMm+=distance;else travelMm+=distance;}return{...plan,records,drawingMm,travelMm};
}

describe('modern Dynamic physical test materials',()=>{
 it.each(manifest.files as Fixture[])('imports and prepares actual broad/tight/S-bend fixture $file',async fixture=>{
  const paths=await importFixture(fixture);expect(paths).toHaveLength(3);
  for(const [index,path] of paths.entries()){
   const expected=fixture.paths[index]!;expect([path.points[0]!.x,path.points[0]!.y]).toEqual(expected.startMm);expect([path.points.at(-1)!.x,path.points.at(-1)!.y]).toEqual(expected.endMm);
   const length=path.points.slice(1).reduce((sum,point,i)=>sum+Math.hypot(point.x-path.points[i]!.x,point.y-path.points[i]!.y),0);
   expect(Math.abs(length-expected.sourceLengthMm)).toBeLessThan(.04);
   for(const point of path.points){expect([point.x,point.y].every(Number.isFinite)).toBe(true);expect(point.x).toBeGreaterThanOrEqual(expected.boundsMm[0]!-1e-8);expect(point.y).toBeGreaterThanOrEqual(expected.boundsMm[1]!-1e-8);expect(point.x).toBeLessThanOrEqual(expected.boundsMm[2]!+1e-8);expect(point.y).toBeLessThanOrEqual(expected.boundsMm[3]!+1e-8);}
  }
  // Illustrative software inputs only; physical tests retain actual calibrated
  // heights/waits and known working motion settings from M00.
  const base:PlotSettings={...initialState.settings,profile:'xylodraw',machineRotation:0,resolution:16,handling:'custom',motionPreference:'scurve',motionFirmware:'3.1.7',drawingMode:'profiled',speed:35,travelSpeed:60,drawAcceleration:200,travelAcceleration:300,drawingJerk:500000,travelJerk:330200,cornering:.127,reorderMode:'preserve',strictOrder:true,pathJoinToleranceMm:0,pathSimplifyToleranceMm:0,closedPathStart:'preserve',maxPenDownMm:0,returnToOrigin:true};
  for(const motionStrategy of ['standard','dynamic'] as const){
   const settings:PlotSettings={...base,motionStrategy,...(motionStrategy==='dynamic'?{dynamicCurveAcceleration:100,dynamicAnticipationMm:3}:{})};
   const prepared=preparePenPaths(paths,settings,defaultPens()).paths;expect(prepared.map(p=>p.points)).toEqual(paths.map(p=>p.points));
   const plan=buildMotionPlan(prepared,settings);expect(()=>validateNativePreview(plan)).not.toThrow();expect(plan.executable!.backend).toBe('t3');
   expect(plan.executable!.options.firmware).toBe('3.1.7');expect(plan.executable!.planningModel).toBe(motionStrategy==='dynamic'?'dynamic-scurve-flow-v1':'axi-ca-junction-v1');
   expect(()=>inspectExecutable(plan.executable!,prepared,{checkCoverage:false})).not.toThrow();const expanded=expandedDualRecords(plan.executable!);for(const [pathIndex,path]of prepared.entries())expect(()=>inspectExecutable(expanded,[path]),`Independent native-half coverage for ${motionStrategy} path ${pathIndex}`).not.toThrow();
   expect(plan.events.filter(event=>event.kind==='pen'&&event.penDown)).toHaveLength(3);expect(plan.events.at(-1)!.penDown).toBe(false);expect(plan.events.at(-1)!.to).toEqual({x:0,y:0});
  }
 },20000);
 it('retains original linked fixture hashes and blank physical status',()=>{
  expect(manifest.status).toBe('prepared-unexecuted');expect(manifest.verification.physicalCommandsSent).toBe(false);expect(manifest.target).toMatchObject({firmware:'3.1.7',backend:'t3'});
  for(const fixture of manifest.reusedFixtures){const source=readFileSync(join(directory,fixture.file),'utf8');expect(createHash('sha256').update(source).digest('hex')).toBe(fixture.sha256);expect(()=>parseSvg(source,fixture.file)).not.toThrow();}
 });
});
