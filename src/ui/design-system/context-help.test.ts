// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contextualHelp, mountContextualHelp } from './context-help';

afterEach(()=>{document.body.replaceChildren();vi.unstubAllGlobals();});
const toggle = (node: HTMLElement, state: 'open'|'closed') => {
  const event = new Event('toggle'); Object.defineProperty(event,'newState',{value:state}); node.dispatchEvent(event);
};
describe('contextual help',()=>{
  it('labels the native trigger and its described dialog without injecting label markup',()=>{
    const host=document.createElement('div');host.innerHTML=contextualHelp('help','<Fill>','<p>Useful explanation</p>');
    expect(host.querySelector('[data-context-help]')!.getAttribute('aria-label')).toBe('<Fill> information');
    expect(host.querySelector('h3')!.textContent).toBe('<Fill>');
    expect(host.querySelector('[role=dialog]')!.getAttribute('aria-describedby')).toBe('help-body');
    expect(host.querySelector('#help-body')!.textContent).toBe('Useful explanation');
  });
  it('handles dynamically rendered help, focuses its close control and restores the invoker',()=>{
    vi.stubGlobal('CSS',{escape:(text:string)=>text});
    const root=document.createElement('div');document.body.append(root);
    const release=mountContextualHelp(root);
    root.innerHTML=contextualHelp('dynamic-help','Fill','<p>Context changes with the selection.</p>');
    const overlay=root.querySelector<HTMLElement>('[role=dialog]')!, trigger=root.querySelector<HTMLElement>('[data-context-help]')!;
    toggle(overlay,'open');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(overlay.querySelector('button'));
    toggle(overlay,'closed');
    expect(document.activeElement).toBe(trigger); expect(trigger.getAttribute('aria-expanded')).toBe('false');
    release(); toggle(overlay,'open'); expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
  it('returns focus to the summary if its section closes',()=>{
    vi.stubGlobal('CSS',{escape:(text:string)=>text});
    const root=document.createElement('div');document.body.append(root);
    root.innerHTML=`<details><summary>Fill</summary>${contextualHelp('closed-help','Fill','<p>Explanation</p>')}</details>`;
    const release=mountContextualHelp(root), overlay=root.querySelector<HTMLElement>('[role=dialog]')!;
    overlay.querySelector<HTMLElement>('button')!.focus();toggle(overlay,'closed');
    expect(document.activeElement).toBe(root.querySelector('summary'));release();
  });
});
