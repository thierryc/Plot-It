import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkSlice } from './cooperative';
import { fillDocumentKey } from './fill-dom';
import { defaultFillSettings, type ArtworkItem } from './model';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe('cooperative fill work',()=>{
 it('yields after its time budget and checks cancellation after resuming',async()=>{
  vi.useFakeTimers();let now=0,cancelled=false;vi.spyOn(performance,'now').mockImplementation(()=>now);
  const work=new WorkSlice(()=>cancelled);
  expect(work.checkpoint()).toBeUndefined();now=9;
  const pause=work.checkpoint()!;expect(pause).toBeInstanceOf(Promise);
  const rejected=expect(pause).rejects.toThrow('cancelled');cancelled=true;await vi.runAllTimersAsync();await rejected;
 });
 it('rejects cancelled work before scheduling another slice',()=>{
  const work=new WorkSlice(()=>true);expect(()=>work.checkpoint()).toThrow('cancelled');
 });
 it('defaults new fills to 1 mm and preserves explicit saved widths',()=>{
  expect(defaultFillSettings.width).toBe(1);
  expect({...defaultFillSettings,width:.5}.width).toBe(.5);
 });
 it('excludes names from fill invalidation but includes geometry, physical transforms and settings',()=>{
  const item:ArtworkItem={id:'a',name:'Original',markup:'<rect width="10" height="10"/>',viewBox:[0,0,10,10],x:0,y:0,width:10,height:10,rotation:0,stroke:'black',fillSettings:{...defaultFillSettings,mode:'solid'}};
  const key=fillDocumentKey([item]);expect(fillDocumentKey([{...item,name:'Renamed'}])).toBe(key);
  for(const change of [{x:1},{width:20},{rotation:45},{markup:'<circle r="5"/>'},{stroke:'red'},{fillSettings:{...item.fillSettings!,width:.5}}]) expect(fillDocumentKey([{...item,...change}])).not.toBe(key);
 });
});
