// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { attributes, button, checkbox, colorField, input, select, textarea } from './index';

describe('native UI contracts',()=>{
  it('escapes labels and attributes without introducing executable markup',()=>{
    const host=document.createElement('div');
    host.innerHTML=button({label:'<img src=x onerror=alert(1)>',attributes:{'data-action':'" onclick="bad','aria-pressed':false,disabled:false}});
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('button')?.getAttribute('data-action')).toBe('" onclick="bad');
    expect(host.querySelector('button')?.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector('button')?.disabled).toBe(false);
    expect(attributes({checked:false,hidden:true})).toBe('hidden');
  });
  it('keeps checkboxes associated with wrapping labels and native keyboard semantics',()=>{
    const host=document.createElement('div');host.innerHTML=checkbox('A long wrapping label',true,{'data-setting':'outline'});document.body.append(host);
    const control=host.querySelector('input')!;
    expect(control.type).toBe('checkbox');expect(control.checked).toBe(true);
    expect(control.labels?.[0]?.textContent).toContain('A long wrapping label');
    host.querySelector('label')!.click();expect(control.checked).toBe(false);
    control.disabled=true;host.querySelector('label')!.click();expect(control.checked).toBe(false);
    host.remove();
  });
  it('preserves control values, options, and accessible color hooks',()=>{
    const host=document.createElement('div');host.innerHTML=input('A"B')+select([{value:'x',label:'<One>'},{value:'y',label:'Two'}],'y')+textarea('</textarea><script>bad</script>')+colorField('Pen','#0B99FF',{'data-setting':'stroke'});
    expect(host.querySelector('input')?.value).toBe('A"B');expect(host.querySelector('select')?.value).toBe('y');
    expect(host.querySelector('textarea')?.value).toBe('</textarea><script>bad</script>');expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('[data-setting=stroke]')?.getAttribute('aria-label')).toBe('Pen picker');
    expect(host.querySelector('[data-color-hex]')).not.toBeNull();expect(host.querySelector('[data-color-error]')?.hasAttribute('hidden')).toBe(true);
  });
});
