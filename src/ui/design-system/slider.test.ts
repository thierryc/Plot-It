// @vitest-environment jsdom
import {describe,expect,it} from 'vitest';
import {sliderRow,axisLabel} from './slider';
import {feedback,decorateFeedback} from './feedback';

describe('lean native controls',()=>{
  it('pairs native ranges and editable values without changing their units or event hooks',()=>{
    const host=document.createElement('div');host.innerHTML=sliderRow({label:'Width',value:117.6,fallback:100,min:75,max:125,step:.1,rangeAttributes:{'data-axis':'wdth'},valueAttributes:{'data-axis':'wdth'}});
    const range=host.querySelector<HTMLInputElement>('input[type=range]')!,number=host.querySelector<HTMLInputElement>('input[type=number]')!;
    expect([range.value,number.value]).toEqual(['117.6','117.6']);expect(range.step).toBe('0.1');expect(number.min).toBe('75');
    expect(range.getAttribute('aria-label')).toBe('Width');expect(number.getAttribute('aria-label')).toBe('Width value');expect(number.dataset.axis).toBe('wdth');
    expect(axisLabel('wght')).toBe('Weight');expect(axisLabel('ABCD')).toBe('ABCD');
  });
  it('keeps mixed values empty and exposes a safe starting point for keyboard stepping',()=>{
    const host=document.createElement('div');host.innerHTML=sliderRow({label:'Weight',value:undefined,fallback:400,min:100,max:900,step:1,mixedAttributes:{'data-axis-mixed':'wght'}});
    expect(host.querySelector<HTMLInputElement>('input[type=range]')!.getAttribute('aria-valuetext')).toBe('Mixed');
    const number=host.querySelector<HTMLInputElement>('input[type=number]')!;expect(number.value).toBe('');expect(number.dataset.mixedBase).toBe('400');expect(host.querySelector('[data-axis-mixed]')!.textContent).toBe('Mixed');
  });
  it('keeps feedback icons and tone attached while controllers update plain text',()=>{
    const host=document.createElement('div');host.innerHTML=feedback('<unsafe>','warning',{hidden:true});const node=host.querySelector('p')!;
    expect(node.querySelector('unsafe')).toBeNull();expect(node.getAttribute('role')).toBe('status');
    decorateFeedback(node,'error');node.textContent='Enter a positive value';node.hidden=false;
    expect(node.dataset.feedback).toBe('error');expect(node.getAttribute('role')).toBe('alert');expect(node.className).not.toBe('');expect(node.textContent).toBe('Enter a positive value');
  });
});
