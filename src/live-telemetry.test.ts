// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {LivePlot} from './live-plot';
import {initialState} from './model';
import type {MotionPlan} from './motion-plan';
import {eventSignal,indexPenCounts} from './plot-signals';

const plan:MotionPlan={passes:[],settings:initialState.settings,duration:36000,events:Array.from({length:36000},(_,i)=>({kind:'xy' as const,start:i,duration:1,from:{x:i,y:0},to:{x:i+1,y:0},initialSpeed:1,acceleration:0,penDown:true,tool:'#111'}))};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('bounded live telemetry',()=>{
  it('coalesces 36k settled endpoints into one frame and throttles sidebar updates',()=>{
    vi.useFakeTimers();let next=0;const callbacks=new Map<number,FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{callbacks.set(++next,cb);return next;});
    vi.stubGlobal('cancelAnimationFrame',(id:number)=>callbacks.delete(id));
    const frame=(time:number)=>{const pending=[...callbacks.values()];callbacks.clear();pending.forEach(cb=>cb(time));};
    const paper=document.createElementNS('http://www.w3.org/2000/svg','svg'),sidebar=vi.fn(),visual=vi.fn();paper.addEventListener('plotter-position',visual);
    const live=new LivePlot(plan,paper,sidebar),counts=indexPenCounts(plan);
    live.update({state:'plotting',completed:36000,total:36000});
    for(let i=0;i<36000;i++)live.observeSignal(eventSignal(plan,counts,i,'settled',0));
    expect(callbacks.size).toBe(1);expect(sidebar).not.toHaveBeenCalled();expect(visual).not.toHaveBeenCalled();
    frame(0);expect(visual).toHaveBeenCalledTimes(1);expect(sidebar).toHaveBeenCalledTimes(1);expect(sidebar.mock.calls[0]![0]).toMatchObject({time:36000,penState:'down'});
    live.observePosition({x:36000,y:0});frame(16);expect(visual).toHaveBeenCalledTimes(2);expect(sidebar).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(84);frame(100);expect(sidebar).toHaveBeenCalledTimes(2);
    live.destroy();expect(callbacks.size).toBe(0);
  });
  it('does not show requested Up as confirmed and loses confirmation on cancellation',()=>{
    let callback!:FrameRequestCallback;vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{callback=cb;return 1;});vi.stubGlobal('cancelAnimationFrame',()=>{});
    const paper=document.createElementNS('http://www.w3.org/2000/svg','svg'),sidebar=vi.fn(),live=new LivePlot(plan,paper,sidebar),signal=eventSignal(plan,indexPenCounts(plan),0,'settled',0);
    live.observeSignal(signal);callback(0);expect(sidebar.mock.lastCall![0].penDown).toBe(true);
    live.observeSignal({...signal,kind:'pen',phase:'started',penDown:false});callback(100);
    expect(sidebar.mock.lastCall![0]).toMatchObject({penDown:true,penState:'down',requestedPenDown:false});expect(sidebar.mock.lastCall![0].status).toContain('awaiting confirmation');
    live.update({state:'cancelled',completed:1,total:36000});callback(200);expect(sidebar.mock.lastCall![0].penState).toBe('unknown');
    live.finish();callback(216);expect(sidebar.mock.lastCall![0].exitDisabled).toBe(false);live.destroy();
  });
  it('uses independent confirmed state on an existing motion signal without changing progress or counts',()=>{
    let callback!:FrameRequestCallback;vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{callback=cb;return 1;});vi.stubGlobal('cancelAnimationFrame',()=>{});
    const paper=document.createElementNS('http://www.w3.org/2000/svg','svg'),sidebar=vi.fn(),live=new LivePlot(plan,paper,sidebar),signal=eventSignal(plan,indexPenCounts(plan),0,'started',0);
    live.observeSignal({...signal,penState:'down'});callback(0);expect(sidebar.mock.lastCall![0].penState).toBe('down');
    live.observeSignal({...signal,penState:'up'});live.update({state:'paused',completed:1,total:36000});callback(100);
    expect(sidebar.mock.lastCall![0]).toMatchObject({penState:'up',penDown:false,time:0});
    live.observeSignal({...signal,penState:'down'});live.update({state:'plotting',completed:1,total:36000});callback(200);expect(sidebar.mock.lastCall![0].penState).toBe('down');
    live.observeSignal({...signal,phase:'settled',penState:'up'});callback(300);expect(sidebar.mock.lastCall![0]).toMatchObject({penState:'up',penDown:false});
    live.destroy();
  });

});
