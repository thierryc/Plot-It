// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { bindPlotEvents, captureCheckboxFocus, captureSettingSelectFocus, bindTextAlignment, captureAlignmentFocus, bindTypographyToggles } from './events';

describe('app view event lifecycle',()=>{
  it('applies explicit font feature choices once and respects disabled inputs',()=>{
    const root=document.createElement('div');root.innerHTML='<div data-typography-choice><input type="checkbox" hidden checked data-typography="kerning"><button data-typography-value="false"></button><button data-typography-value="true"></button></div>';
    bindTypographyToggles(root);const input=root.querySelector('input')!,change=vi.fn();input.addEventListener('change',change);
    const off=root.querySelector<HTMLButtonElement>('[data-typography-value="false"]')!;
    off.click();off.click();expect(input.checked).toBe(false);expect(change).toHaveBeenCalledTimes(1);expect(off.getAttribute('aria-pressed')).toBe('true');
    input.disabled=true;root.querySelector<HTMLButtonElement>('[data-typography-value="true"]')!.click();expect(input.checked).toBe(false);
  });
  it('updates a stylistic set without losing unrelated expert feature settings',()=>{
    const root=document.createElement('div');root.innerHTML='<div data-typography-choice><input type="checkbox" hidden data-typography-feature="ss01"><button data-typography-value="false"></button><button data-typography-value="true"></button></div><input data-typography="features" value="liga=0, -ss01, ss01[0:2]=1, ss02=1">';
    bindTypographyToggles(root);const features=root.querySelector<HTMLInputElement>('[data-typography=features]')!,change=vi.fn();features.addEventListener('change',change);
    root.querySelector<HTMLButtonElement>('[data-typography-value=true]')!.click();
    expect(features.value).toBe('liga=0, ss02=1, ss01=1');expect(change.mock.calls[0]![0].detail.featureTag).toBe('ss01');
    root.querySelector<HTMLButtonElement>('[data-typography-value=false]')!.click();expect(features.value).toBe('liga=0, ss02=1, ss01=0');
  });
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
