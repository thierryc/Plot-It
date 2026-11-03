// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindResizeHandle, resizeHandleMarkup } from './resize-controls';

afterEach(()=>{document.body.innerHTML='';vi.unstubAllGlobals();});
describe('panel resize interactions',()=>{
  it('clamps keyboard sizes, supports fine adjustments, cancels and releases listeners',()=>{
    document.body.innerHTML=resizeHandleMarkup('Sidebar','horizontal','data-resize');
    const handle=document.querySelector<HTMLElement>('[data-resize]')!;let size={width:288,height:0};
    const reset=vi.fn(()=>{size={width:288,height:0};});
    const binding=bindResizeHandle(handle,{axis:'horizontal',get:()=>size,limits:()=>({min:{width:260,height:0},max:{width:300,height:0}}),set:next=>{size=next;},reset});
    const key=(key:string,shiftKey=false)=>handle.dispatchEvent(new KeyboardEvent('keydown',{key,shiftKey,bubbles:true,cancelable:true}));
    key('ArrowRight');key('ArrowRight');expect(size.width).toBe(300);
    key('ArrowLeft',true);expect(size.width).toBe(299);expect(handle.getAttribute('aria-valuenow')).toBe('299');
    key('Escape');expect(size.width).toBe(288);
    handle.dispatchEvent(new MouseEvent('dblclick'));expect(reset).toHaveBeenCalledOnce();
    binding.destroy();key('ArrowLeft');expect(size.width).toBe(288);
  });
  it('uses pointer capture, reverse sidebar dragging, and pointer cancellation rollback',()=>{
    document.body.innerHTML=resizeHandleMarkup('Sidebar','horizontal','data-resize');
    const handle=document.querySelector<HTMLElement>('[data-resize]')!;let size={width:288,height:0};
    handle.setPointerCapture=vi.fn();
    const binding=bindResizeHandle(handle,{axis:'horizontal',reverseX:true,get:()=>size,limits:()=>({min:{width:260,height:0},max:{width:420,height:0}}),set:next=>{size=next;}});
    const pointer=(type:string,x:number)=>{const event=new MouseEvent(type,{button:0,clientX:x,bubbles:true,cancelable:true});Object.defineProperty(event,'pointerId',{value:7});handle.dispatchEvent(event);};
    pointer('pointerdown',500);pointer('pointermove',450);expect(size.width).toBe(338);expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
    pointer('pointercancel',450);expect(size.width).toBe(288);
    pointer('pointermove',400);expect(size.width).toBe(288);binding.destroy();
  });
});
