// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {propertyField} from './property-field';

describe('compact native property fields',()=>{
  it('retains a complete accessible name, native validation and escaped hooks behind abbreviated labels',()=>{
    const host=document.createElement('div');
    host.innerHTML=propertyField({label:'Width',prefix:'W',unit:'mm',value:122.88,attributes:{min:'.1',step:'.1','data-item-prop':'width',title:'Width "quoted"'}});
    const input=host.querySelector('input')!;
    expect(input.type).toBe('number'); expect(input.getAttribute('aria-label')).toBe('Width mm');
    expect(input.min).toBe('.1'); expect(input.step).toBe('.1'); expect(input.dataset.itemProp).toBe('width');
    expect(input.title).toBe('Width "quoted"'); expect(input.labels?.[0]).toBe(host.querySelector('label'));
    input.value='-1'; expect(input.validity.rangeUnderflow).toBe(true);
  });
  it('preserves exactly the requested select value and disabled choices without interpreting labels as markup',()=>{
    const host=document.createElement('div');
    host.innerHTML=propertyField({label:'Machine profile',prefix:'Profile',type:'select',value:'b',attributes:{disabled:true},options:[{value:'a',label:'First'},{value:'b',label:'<img src=x>',disabled:true},{value:'c',label:'Last'}]});
    const select=host.querySelector('select')!;
    expect(select.value).toBe('b'); expect(select.disabled).toBe(true);
    expect([...select.options].filter(option=>option.selected)).toHaveLength(1);
    expect(select.options[1]?.disabled).toBe(true); expect(host.querySelector('img')).toBeNull();
  });
});
