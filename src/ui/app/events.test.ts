// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { bindPlotEvents, captureCheckboxFocus, captureSettingSelectFocus, bindTextAlignment, captureAlignmentFocus } from './events';

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

// Native selects need to keep focus while profile-specific fields change.
describe('setting select focus', () => {
  it('retains native select focus after profile fields are rebuilt', () => {
    const root = document.createElement('div'); document.body.append(root);
    root.innerHTML = '<select data-setting="profile"><option>NextDraw</option></select>';
    root.querySelector<HTMLSelectElement>('select')!.focus();
    const restore = captureSettingSelectFocus(root);
    root.innerHTML = '<select data-setting="profile"><option>NextDraw</option></select><select data-setting="nextdrawModel"><option>8511</option></select>';
    restore(); expect(document.activeElement).toBe(root.querySelector('[data-setting="profile"]'));
    root.remove();
  });
});


describe('text alignment presentation adapter',()=>{
  it('updates the existing native option and restores keyboard focus after a rebuild',()=>{
    const root=document.createElement('div'); document.body.append(root);
    const markup=()=>'<div><input type="hidden" data-typography="align" value="left"><div><button data-alignment="right">Right</button></div></div>';
    root.innerHTML=markup(); bindTextAlignment(root);
    const changed=vi.fn(); root.addEventListener('change',changed);
    const button=root.querySelector('button')!; button.focus(); button.click();
    expect(root.querySelector('input')!.value).toBe('right'); expect(changed).toHaveBeenCalledOnce();
    const restore=captureAlignmentFocus(root); root.innerHTML=markup();
    const replacement=root.querySelector('button')!;
    vi.spyOn(replacement,'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    restore(); expect(document.activeElement).toBe(replacement);
    bindTextAlignment(root); root.querySelector('input')!.disabled=true;
    replacement.click(); expect(changed).toHaveBeenCalledOnce();
    root.remove();
  });
});
