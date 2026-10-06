// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { bindPlotEvents, captureCheckboxFocus } from './events';

describe('app view event lifecycle',()=>{
  it('releases delegated plot listeners when the view exits',()=>{
    const root=document.createElement('div'), click=vi.fn(), noop=()=>{};
    const release=bindPlotEvents(root,{click,change:noop,input:noop,focusout:noop,keydown:noop});
    root.dispatchEvent(new Event('click'));expect(click).toHaveBeenCalledOnce();
    release();root.dispatchEvent(new Event('click'));expect(click).toHaveBeenCalledOnce();
  });
  it('restores the same setting focus after checkbox markup is replaced',()=>{
    const root=document.createElement('div');document.body.append(root);
    root.innerHTML='<input type="checkbox" data-fill-setting="outline">';root.querySelector('input')!.focus();
    const restore=captureCheckboxFocus(root);
    root.innerHTML='<input type="checkbox" data-fill-setting="outline" checked>';
    const control=root.querySelector('input')!;
    vi.spyOn(control,'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    restore();expect(document.activeElement).toBe(control);expect(control.checked).toBe(true);
    control.blur();control.disabled=true;restore();expect(document.activeElement).not.toBe(control);
    root.remove();
  });
});
