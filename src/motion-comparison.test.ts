// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState } from './model';
import { buildMotionPlan, samplePlan, type MotionPlan } from './motion-plan';
import { comparisonData, comparisonDisplayPoints, dynamicUnavailable, speedColor, timeAtDistance } from './motion-comparison-data';
import { MotionComparisonPreview } from './motion-comparison';
function linear(duration:number):MotionPlan{return {settings:{...initialState.settings},duration,passes:[],events:[{kind:'xy',start:0,duration,from:{x:0,y:0},to:{x:20,y:0},initialSpeed:20/duration,acceleration:0,penDown:true,tool:'#000000'}]};}
let preview:MotionComparisonPreview|undefined, frame:FrameRequestCallback;
beforeEach(()=>{vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frame=callback;return 1;});vi.stubGlobal('cancelAnimationFrame',vi.fn());});
afterEach(()=>{preview?.destroy();preview=undefined;vi.unstubAllGlobals();document.body.replaceChildren();});
describe('motion comparison',()=>{
  it('requires explicit T3, accepted firmware and accelerated drawing',()=>{
    expect(dynamicUnavailable(initialState.settings)).toContain('T3');
    const settings={...initialState.settings,motionPreference:'scurve' as const};
    expect(dynamicUnavailable(settings)).toBe('');
    expect(dynamicUnavailable(settings,'3.1.6')).toContain('3.1.7');
    expect(dynamicUnavailable({...settings,drawingMode:'constant'})).toContain('Accelerated');
  });
  it('indexes the same drawing distance at each plan’s own time',()=>{
    const slow=comparisonData(linear(4)),fast=comparisonData(linear(2));
    expect(slow.strokes[0]!.length).toBeCloseTo(20);
    expect(timeAtDistance(slow.strokes[0],10)).toBeCloseTo(2);
    expect(timeAtDistance(fast.strokes[0],10)).toBeCloseTo(1);
    expect(timeAtDistance(fast.strokes[0],100)).toBe(2);
    expect(speedColor(5,10)).toBe('hsl(120 75% 45%)');
  });
  it('bounds dense display work while retaining endpoints and full distance lookup',()=>{
    const points=Array.from({length:20000},(_,i)=>({distance:i,time:i/2,speed:2,x:i,y:0}));
    const display=comparisonDisplayPoints(points);expect(display).toHaveLength(4000);expect(display[0]).toBe(points[0]);expect(display.at(-1)).toBe(points.at(-1));
    expect(timeAtDistance({points,length:19999},12345.5)).toBe(6172.75);
  });
  it('renders a dense comparison with bounded paths and graph vertices',()=>{
    const plan=linear(3000),event=plan.events[0]!;
    plan.events=Array.from({length:3000},(_,i)=>({...event,start:i,duration:1,initialSpeed:1,from:{x:i,y:0},to:{x:i+1,y:0}}));
    preview=new MotionComparisonPreview(document.body,{standard:plan,dynamic:plan},vi.fn(),vi.fn());
    const paths=[...preview.element.querySelectorAll('[data-compare-map="standard"] path')];
    expect(paths.length).toBeLessThanOrEqual(32);
    expect(paths.reduce((count,path)=>count+(path.getAttribute('d')!.match(/M/g)?.length??0),0)).toBeLessThanOrEqual(4000);
    const graph=preview.element.querySelector('[data-compare-graph="standard"]')!;
    expect((graph.innerHTML.match(/L/g)??[]).length).toBeLessThanOrEqual(4000);
  });
  it('uses compiled samples for the trace rather than uniform segment interpolation',()=>{
    const plan=buildMotionPlan([{tool:'#000000',points:[{x:10,y:10},{x:30,y:10}]}],{...initialState.settings,motionPreference:'scurve',motionFirmware:'3.1.7',returnToOrigin:false});
    const data=comparisonData(plan);
    expect(data.strokes.length).toBeGreaterThan(0);
    for(const point of data.strokes.flatMap(stroke=>stroke.points).filter(point=>point.time<plan.duration).slice(0,20)){
      const sample=samplePlan(plan,point.time);
      expect(point.x).toBeCloseTo(sample.position.x,5);
      expect(point.y).toBeCloseTo(sample.position.y,5);
    }
    expect(data.peak).toBeGreaterThan(0);
  });
  it('fits translated artwork in both views without including empty origin space',()=>{
    const plan=linear(4);plan.events[0]!.from={x:120,y:90};plan.events[0]!.to={x:140,y:90};
    preview=new MotionComparisonPreview(document.body,{standard:plan,dynamic:plan},vi.fn(),vi.fn());
    const maps=[...preview.element.querySelectorAll('[data-compare-map]')];
    expect(maps.map(map=>map.getAttribute('viewBox'))).toEqual(['115 85 30 10','115 85 30 10']);
    preview.element.querySelector<HTMLButtonElement>('[data-compare-action="zoom-in"]')!.click();
    preview.element.querySelector<HTMLButtonElement>('[data-compare-action="fit"]')!.click();
    expect(maps.map(map=>map.getAttribute('viewBox'))).toEqual(['115 85 30 10','115 85 30 10']);
    expect(preview.element.textContent).toContain('Estimated total');expect(preview.element.textContent).toContain('Estimated drawing');
  });
  it('runs both markers on one seconds clock and holds a finished endpoint',()=>{
    preview=new MotionComparisonPreview(document.body,{standard:linear(4),dynamic:linear(2)},vi.fn(),vi.fn());
    preview.element.querySelector<HTMLButtonElement>('[data-compare-action="play"]')!.click();frame(0);frame(3000);
    const marker=(side:string)=>preview!.element.querySelector(`[data-compare-map="${side}"] circle`)!;
    expect(Number(marker('standard').getAttribute('cx'))).toBeCloseTo(15);
    expect(Number(marker('dynamic').getAttribute('cx'))).toBe(20);
    expect(preview.element.querySelector('[data-compare-readout="dynamic"]')!.textContent).toContain('Finished');
  });
  it('distance seeking aligns both markers and resumes by equal elapsed seconds',()=>{
    preview=new MotionComparisonPreview(document.body,{standard:linear(4),dynamic:linear(2)},vi.fn(),vi.fn());
    const distance=preview.element.querySelector<HTMLInputElement>('[data-compare-distance]')!;distance.value='10';distance.dispatchEvent(new Event('input',{bubbles:true}));
    expect(preview.element.querySelector('[data-compare-readout="standard"]')!.textContent).toContain('2.00 s');
    expect(preview.element.querySelector('[data-compare-readout="dynamic"]')!.textContent).toContain('1.00 s');
    preview.element.querySelector<HTMLButtonElement>('[data-compare-action="play"]')!.click();frame(0);frame(500);
    expect(preview.element.querySelector('[data-compare-readout="standard"]')!.textContent).toContain('2.50 s');
    expect(preview.element.querySelector('[data-compare-readout="dynamic"]')!.textContent).toContain('1.50 s');
  });
  it('keeps views synchronized for keyboard pan and zoom and only reports a strategy choice',()=>{
    const choose=vi.fn(),close=vi.fn();preview=new MotionComparisonPreview(document.body,{standard:linear(4),dynamic:linear(2)},choose,close);
    const maps=[...preview.element.querySelectorAll<SVGSVGElement>('[data-compare-map]')];const initial=maps[0]!.getAttribute('viewBox');
    maps[1]!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    expect(maps[0]!.getAttribute('viewBox')).not.toBe(initial);expect(maps[0]!.getAttribute('viewBox')).toBe(maps[1]!.getAttribute('viewBox'));
    preview.element.querySelector<HTMLButtonElement>('[data-compare-action="zoom-in"]')!.click();expect(maps[0]!.getAttribute('viewBox')).toBe(maps[1]!.getAttribute('viewBox'));
    preview.element.querySelector<HTMLButtonElement>('[data-compare-action="dynamic"]')!.click();expect(choose).toHaveBeenCalledExactlyOnceWith('dynamic');
    expect(preview.element.textContent).not.toContain('Start plot');
    preview.element.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(close).toHaveBeenCalledOnce();
  });
  it('cancels animation and restores focus when dismissed',()=>{
    const opener=document.createElement('button');document.body.append(opener);opener.focus();
    preview=new MotionComparisonPreview(document.body,{standard:linear(4),dynamic:linear(2)},vi.fn(),vi.fn());
    preview.element.querySelector<HTMLButtonElement>('[data-compare-action="play"]')!.click();preview.destroy();frame(1000);
    expect(document.querySelector('dialog')).toBeNull();expect(document.activeElement).toBe(opener);expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});
