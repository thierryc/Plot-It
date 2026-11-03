import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateFill, type FillRegion } from './fill';
import { defaultFillSettings, initialState } from './model';
import { optimizePlotPaths } from './svg';
import { buildMotionPlan } from './motion-plan';
import { progressReporter, type TaskProgress } from './task-progress';
afterEach(()=>vi.restoreAllMocks());
const region: FillRegion = {key:'test',tool:'black',rule:'nonzero',contours:[[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}]],settings:{...defaultFillSettings,mode:'crosshatch',connect:false}};
describe('heavy-task progress',()=>{
 it('reports real scan progress across both crosshatch passes without changing paths',()=>{
  const updates:TaskProgress[]=[];
  const result=generateFill(region,p=>updates.push(p));
  expect(result).toEqual(generateFill(region));
  expect(updates[0]?.fraction).toBeUndefined();
  const fractions=updates.filter(p=>p.fraction!==undefined).map(p=>p.fraction!);
  expect(fractions[0]).toBe(0);expect(fractions.at(-1)).toBe(1);
  expect(fractions.some(v=>v>0&&v<.5)).toBe(true);
  expect(fractions.some(v=>v>.5&&v<1)).toBe(true);
  expect(fractions.every((f,i)=>f>=0&&f<=1&&(i===0||f>=fractions[i-1]!))).toBe(true);
 });
 it('reports completion across color groups and motion planning',()=>{
  const paths=[{tool:'red',points:[{x:1,y:1},{x:2,y:2}]},{tool:'blue',points:[{x:5,y:5},{x:6,y:6}]},{tool:'red',points:[{x:3,y:3},{x:4,y:4}]}];
  const ordering:number[]=[],motion:number[]=[];
  const ordered=optimizePlotPaths(paths,true,f=>ordering.push(f));
  expect(ordering).toEqual([1/3,2/3,1]);
  expect(buildMotionPlan(ordered,initialState.settings,f=>motion.push(f))).toEqual(buildMotionPlan(ordered,initialState.settings));
  expect(motion).toEqual([1/3,2/3,1]);
 });
 it('throttles worker messages while always delivering completion',()=>{
  let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);
  const sent:TaskProgress[]=[],report=progressReporter(p=>sent.push(p));
  report({label:'Preparing'});
  for(let i=1;i<=49;i++){now=i;report({label:'Generating',fraction:i/100});}
  now=50;report({label:'Generating',fraction:.5});
  now=51;report({label:'Generating',fraction:1});
  expect(sent).toEqual([{label:'Preparing'},{label:'Generating',fraction:.5},{label:'Generating',fraction:1}]);
 });
});
