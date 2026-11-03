// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bindTextNumericInputs, textNumericAttributes } from './text-numeric-input';
import { propertyField } from '../design-system';

afterEach(()=>{document.body.innerHTML='';});
describe('shared typography numeric behavior',()=>{
  it('uses the same small and Shift steps in sidebar property fields',()=>{
    document.body.innerHTML=propertyField({label:'Letter spacing',prefix:'Track',unit:'em',value:0,attributes:textNumericAttributes('letterSpacing')});
    bindTextNumericInputs(document);bindTextNumericInputs(document);
    const input=document.querySelector('input')!;input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));expect(input.value).toBe('0.01');
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',shiftKey:true,bubbles:true,cancelable:true}));expect(input.value).toBe('0.11');
    expect(document.activeElement).toBe(input);
  });
});
