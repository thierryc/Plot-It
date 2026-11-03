// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {animateSurface,stopSurfaceAnimation,SustainedIndicator} from './motion';

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();document.body.innerHTML='';});
describe('steady background progress',()=>{
  it('does not flash for a short task',()=>{
    vi.useFakeTimers();const paint=vi.fn(),indicator=new SustainedIndicator<string>(paint);
    indicator.update('Reading');vi.advanceTimersByTime(120);indicator.update();vi.advanceTimersByTime(1000);
    expect(paint).not.toHaveBeenCalled();expect(indicator.value).toBeUndefined();indicator.destroy();
  });
  it('bridges the fill-to-estimate gap without hiding or enabling stale cancellation',()=>{
    vi.useFakeTimers();const paint=vi.fn(),indicator=new SustainedIndicator<string>(paint);
    indicator.update('Fill');vi.advanceTimersByTime(180);expect(paint).toHaveBeenLastCalledWith('Fill',true);
    indicator.update();expect(paint).toHaveBeenLastCalledWith('Fill',false);
    vi.advanceTimersByTime(200);indicator.update('Estimate');expect(indicator.value).toBe('Estimate');
    expect(paint.mock.calls.some(([value])=>value===undefined)).toBe(false);
    indicator.update();vi.advanceTimersByTime(200);indicator.update();vi.advanceTimersByTime(60);
    expect(paint).toHaveBeenLastCalledWith(undefined,false);indicator.destroy();
  });
  it('keeps a visible task readable for its minimum time and cancels scheduled work on destruction',()=>{
    vi.useFakeTimers();const paint=vi.fn(),indicator=new SustainedIndicator<number>(paint);
    indicator.update(1);vi.advanceTimersByTime(180);indicator.update();vi.advanceTimersByTime(300);
    expect(indicator.value).toBe(1);vi.advanceTimersByTime(20);expect(indicator.value).toBeUndefined();
    paint.mockClear();indicator.update(2);indicator.destroy();vi.runAllTimers();expect(paint).not.toHaveBeenCalled();
  });
});
describe('surface transitions',()=>{
  it('honors reduced motion and works without animation support',()=>{
    const node=document.createElement('div'),complete=vi.fn();node.animate=vi.fn();
    vi.stubGlobal('matchMedia',()=>({matches:true}));animateSurface(node,false,complete);
    expect(node.animate).not.toHaveBeenCalled();expect(complete).toHaveBeenCalledOnce();
    delete (node as Partial<HTMLElement>).animate;animateSurface(node,false,complete);expect(complete).toHaveBeenCalledTimes(2);
  });
  it('does not run an obsolete exit callback after an immediate focus handoff',async()=>{
    const node=document.createElement('div');document.body.append(node);
    let resolve!:()=>void;const finished=new Promise<void>(done=>{resolve=done;});
    const cancel=vi.fn();node.animate=vi.fn(()=>({finished,cancel}) as unknown as Animation);
    const close=vi.fn();animateSurface(node,false,close);stopSurfaceAnimation(node);resolve();await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();expect(close).not.toHaveBeenCalled();
  });
});
