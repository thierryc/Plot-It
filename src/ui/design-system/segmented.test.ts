// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { segmentedControl, SegmentedControl } from './segmented';
const mounted: SegmentedControl[] = [];
afterEach(() => { mounted.splice(0).forEach(control => control.destroy()); document.body.replaceChildren(); });
function setup() {
  const host = document.createElement('div');
  host.innerHTML = segmentedControl('Output', [
    {label:'First', selected:true, attributes:{}},
    {label:'Disabled', selected:false, attributes:{disabled:true}},
    {label:'Last', selected:false, attributes:{}}
  ]);
  document.body.append(host);
  const group = host.querySelector<HTMLElement>('[role=radiogroup]')!;
  const control = new SegmentedControl(group); mounted.push(control);
  return {host, group, control, buttons:[...group.querySelectorAll('button')]};
}
function key(button: HTMLButtonElement, name: string) {
  button.focus(); button.dispatchEvent(new KeyboardEvent('keydown', {key:name, bubbles:true, cancelable:true}));
}
describe('accessible segmented control', () => {
  it('exposes a named single-choice group with one Tab stop and escaped labels', () => {
    const {host, group, buttons} = setup();
    expect(group.getAttribute('aria-label')).toBe('Output');
    expect(buttons.map(button=>button.tabIndex)).toEqual([0,-1,-1]);
    expect(buttons.filter(button=>button.getAttribute('aria-checked')==='true')).toHaveLength(1);
    host.innerHTML=segmentedControl('<Output>',[{label:'<img src=x>',selected:true,attributes:{}}]);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('[role=radiogroup]')?.getAttribute('aria-label')).toBe('<Output>');
  });
  it('selects with arrows, skips disabled options and wraps without swallowing Tab', () => {
    const {buttons} = setup(); const click = vi.fn(); buttons[2]!.addEventListener('click',click);
    key(buttons[0]!, 'ArrowRight');
    expect(click).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(buttons[2]);
    expect(buttons.map(button=>button.tabIndex)).toEqual([-1,-1,0]);
    key(buttons[2]!, 'ArrowDown'); expect(document.activeElement).toBe(buttons[0]);
    key(buttons[0]!, 'End'); expect(document.activeElement).toBe(buttons[2]);
    key(buttons[2]!, 'Home'); expect(document.activeElement).toBe(buttons[0]);
    const tab = new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});
    buttons[0]!.dispatchEvent(tab); expect(tab.defaultPrevented).toBe(false);
  });
  it('supports RTL arrow direction and native click activation', () => {
    const {group,buttons} = setup(); group.style.direction='rtl';
    key(buttons[0]!, 'ArrowLeft'); expect(document.activeElement).toBe(buttons[2]);
    buttons[0]!.click(); expect(buttons[0]!.getAttribute('aria-checked')).toBe('true');
    expect(buttons[2]!.getAttribute('aria-checked')).toBe('false');
  });
  it('resynchronizes dynamic disabled states without leaving an unusable Tab stop', async () => {
    const {buttons} = setup(); buttons[0]!.disabled=true;
    await new Promise<void>(resolve=>queueMicrotask(resolve));
    expect(buttons.map(button=>button.tabIndex)).toEqual([-1,-1,0]);
    expect(buttons[2]!.getAttribute('aria-checked')).toBe('true');
  });
  it('isolates independent groups and releases behavior on destruction', () => {
    const first = setup(), second = setup();
    first.buttons[2]!.click(); expect(second.buttons[0]!.getAttribute('aria-checked')).toBe('true');
    first.control.destroy(); first.buttons[0]!.click();
    expect(first.buttons[2]!.getAttribute('aria-checked')).toBe('true');
  });
  it('handles all-disabled and invalid initial selections', () => {
    const host = document.createElement('div');
    host.innerHTML=segmentedControl('Disabled',[{label:'A',selected:true,attributes:{disabled:true}}]);
    expect(host.querySelector('button')?.tabIndex).toBe(-1);
    expect(host.querySelector('button')?.getAttribute('aria-checked')).toBe('false');
  });
});
