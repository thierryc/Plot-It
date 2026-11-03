// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openCanvasTextEditor } from './canvas-text-editor';
import { textToItem } from '../../plot-font';
import * as typography from '../../typography';
import { defaultFillSettings } from '../../model';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { vi.restoreAllMocks();vi.useRealTimers(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });
function setup(preview = vi.fn<(text: string) => void>()) {
  const host = document.createElement('div'); document.body.append(host);
  const finish = vi.fn();
  const editor = openCanvasTextEditor({host, item:textToItem('ORIGINAL',12), project:point=>point,preview,finish});
  const input = host.querySelector('textarea')!;
  const type = (value: string, composing = false) => { input.value = value; input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:composing})); };
  return {host, editor, input, preview, finish, type};
}
describe('native canvas text editing', () => {
  it('previews multiline source, finishes as one session, and releases outside listeners', () => {
    const {editor,input,preview,finish,type,host} = setup();
    expect(document.activeElement).toBe(input);
    type('NEW\nLINE'); expect(preview).toHaveBeenLastCalledWith('NEW\nLINE');
    // Native Enter/Shift+Enter must remain unhandled so the browser inserts a newline.
    expect(input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true}))).toBe(true);
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));
    expect(finish).toHaveBeenCalledExactlyOnceWith(false); expect(host.children.length).toBe(0);
    document.body.dispatchEvent(new Event('pointerdown',{bubbles:true})); editor.finish();
    expect(finish).toHaveBeenCalledOnce();
  });
  it('cancels without applying an invalid draft or allowing Escape to deselect artwork', () => {
    const {input,finish,type} = setup(vi.fn(() => { throw new Error('Enter some text.'); }));
    const parentKeydown = vi.fn(); document.body.addEventListener('keydown',parentKeydown,{once:true});
    type(''); expect(input.getAttribute('aria-invalid')).toBe('true');
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    expect(finish).toHaveBeenCalledExactlyOnceWith(true); expect(parentKeydown).not.toHaveBeenCalled();
    document.body.removeEventListener('keydown', parentKeydown);
  });
  it('blocks invalid commits, keeps the nonmodal editor open outside, and recovers', () => {
    const {input,host,finish,type,editor} = setup(vi.fn((content: string) => { if (!content.trim()) throw new Error('Enter some text.'); }));
    type('');
    const outside = new Event('pointerdown',{bubbles:true,cancelable:true}); document.body.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(false); expect(editor.finish()).toBe(false); expect(finish).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('Enter some text.');
    type('RECOVERED'); expect(input.hasAttribute('aria-invalid')).toBe(false);
    document.body.dispatchEvent(new Event('pointerdown',{bubbles:true}));
    expect(finish).not.toHaveBeenCalled();editor.finish();expect(finish).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('retains selection while changing tabs and provides a keyboard adjustable text area',()=>{
    const {host,input,editor,finish}=setup();
    input.setSelectionRange(0,3);input.dispatchEvent(new Event('select'));
    const details=host.querySelector<HTMLButtonElement>('[data-tab="details"]')!;details.click();
    expect(host.querySelector('[data-scope="selection"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(input.selectionStart).toBe(0);expect(input.selectionEnd).toBe(3);
    const split=host.querySelector<HTMLElement>('[role="separator"]')!;const before=Number(split.getAttribute('aria-valuenow'));
    Object.defineProperty(host,'clientHeight',{value:800});
    split.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
    expect(Number(split.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
    const after=Number(split.getAttribute('aria-valuenow'));split.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',shiftKey:true,bubbles:true}));expect(Number(split.getAttribute('aria-valuenow'))).toBe(after+1);
    host.querySelector<HTMLButtonElement>('[data-text-close]')!.click();expect(finish).toHaveBeenCalledExactlyOnceWith(true);editor.finish();
  });
  it('steps typography values precisely, supports Shift and retains focused inputs',()=>{
    const {host,editor}=setup();
    const spacing=host.querySelector<HTMLInputElement>('[data-option="letterSpacing"]')!;
    const key=(input:HTMLInputElement,key:string,shiftKey=false)=>input.dispatchEvent(new KeyboardEvent('keydown',{key,shiftKey,bubbles:true,cancelable:true}));
    spacing.focus();key(spacing,'ArrowUp');expect(spacing.value).toBe('0.01');
    key(spacing,'ArrowUp',true);expect(spacing.value).toBe('0.11');
    key(spacing,'ArrowDown');expect(spacing.value).toBe('0.1');expect(document.activeElement).toBe(spacing);
    spacing.value='0.005';key(spacing,'ArrowUp');expect(spacing.value).toBe('0.015');
    const cap=host.querySelector<HTMLInputElement>('[data-option="capHeight"]')!;
    expect(cap.value).toBe('12');key(cap,'ArrowUp');expect(cap.value).toBe('12.1');key(cap,'ArrowDown',true);expect(cap.value).toBe('11.1');
    cap.value='0.1';key(cap,'ArrowDown');expect(cap.value).toBe('0.1');
    for(const name of ['lineHeight','wordSpacing']){
      const field=host.querySelector<HTMLInputElement>(`[data-option="${name}"]`)!;
      expect(field.step).toBe('0.01');field.value='1';key(field,'ArrowDown',true);expect(field.value).toBe('0.9');
    }
    editor.finish(true);
  });
  it('coalesces repeated numeric changes and immediately commits the latest pending value',()=>{
    vi.useFakeTimers();
    const host=document.createElement('div');document.body.append(host);
    const previewDraft=vi.fn(),finish=vi.fn();
    const editor=openCanvasTextEditor({host,item:textToItem('TEXT',12),project:p=>p,preview:vi.fn(),previewDraft,finish});
    const field=host.querySelector<HTMLInputElement>('[data-option="letterSpacing"]')!;
    const change=(value:string)=>{field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}));};
    change('0.01');vi.advanceTimersByTime(100);change('0.02');vi.advanceTimersByTime(100);
    expect(previewDraft).not.toHaveBeenCalled();vi.advanceTimersByTime(50);
    expect(previewDraft).toHaveBeenCalledTimes(1);expect(previewDraft.mock.calls[0]![0].options.letterSpacing).toBe(.02);
    change('0.03');expect(editor.finish()).toBe(true);
    expect(previewDraft).toHaveBeenCalledTimes(2);expect(previewDraft.mock.calls[1]![0].options.letterSpacing).toBe(.03);
    vi.runAllTimers();expect(previewDraft).toHaveBeenCalledTimes(2);expect(finish).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('discards pending numeric previews when cancelled',()=>{
    vi.useFakeTimers();const {host,editor,preview}=setup();
    const field=host.querySelector<HTMLInputElement>('[data-option="wordSpacing"]')!;
    field.value='0.5';field.dispatchEvent(new Event('change',{bubbles:true}));editor.finish(true);
    vi.runAllTimers();expect(preview).not.toHaveBeenCalled();
  });
  it('waits for composition before regenerating geometry or handling finish shortcuts', () => {
    const {input,preview,finish,type,editor} = setup();
    type('a',true); expect(preview).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true}));
    expect(finish).not.toHaveBeenCalled();
    input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));
    expect(preview).toHaveBeenLastCalledWith('a'); editor.finish(true);
  });
  it('opens beside projected text and follows the camera until moved by the user', () => {
    const host=document.createElement('div');document.body.append(host);
    Object.defineProperties(host,{clientWidth:{value:800},clientHeight:{value:600}});
    const item=textToItem('OFF PAPER',12);item.x=200;item.y=200;item.width=100;item.height=30;
    let offset=0;
    const editor=openCanvasTextEditor({host,item,project:p=>({x:p.x+offset,y:p.y}),preview:()=>{},finish:()=>{}});
    const panel=host.querySelector<HTMLElement>('[data-canvas-text-editor]')!, input=panel.querySelector('textarea')!;
    Object.defineProperties(panel,{offsetWidth:{get:()=>340},offsetHeight:{get:()=>260}});
    host.dispatchEvent(new Event('viewportchange'));
    expect(panel.style.left).toBe('316px');expect(panel.style.top).toBe('200px');
    offset=50;host.dispatchEvent(new Event('viewportchange'));expect(panel.style.left).toBe('366px');
    const handle=panel.querySelector<HTMLElement>('[data-text-drag]')!;
    handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
    expect(panel.style.top).toBe('210px');
    offset=-200;host.dispatchEvent(new Event('viewportchange'));
    expect(panel.style.left).toBe('366px');expect(panel.style.top).toBe('210px');
    expect(input.value).toBe('OFF PAPER');editor.finish(true);
  });
  it('drags with pointer capture, clamps to the host and leaves text input intact', () => {
    const {host,editor,input,preview}=setup();
    Object.defineProperties(host,{clientWidth:{value:800},clientHeight:{value:600}});
    const panel=host.querySelector<HTMLElement>('[data-canvas-text-editor]')!;
    Object.defineProperties(panel,{offsetWidth:{value:340},offsetHeight:{value:260}});
    host.dispatchEvent(new Event('viewportchange'));
    const handle=panel.querySelector<HTMLElement>('[data-text-drag]')!;
    handle.setPointerCapture=vi.fn();
    const pointer=(type:string,x:number,y:number) => {
      const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0});
      Object.defineProperty(event,'pointerId',{value:1});handle.dispatchEvent(event);
    };
    pointer('pointerdown',100,100);pointer('pointermove',2000,2000);
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
    expect(panel.style.left).toBe('452px');expect(panel.style.top).toBe('332px');
    pointer('pointerup',2000,2000);pointer('pointermove',0,0);
    expect(panel.style.left).toBe('452px');
    expect(input.value).toBe('ORIGINAL');expect(preview).not.toHaveBeenCalled();editor.finish(true);
  });
  it('tries the left side when there is no room on the right', () => {
    const host=document.createElement('div');document.body.append(host);
    Object.defineProperties(host,{clientWidth:{value:800},clientHeight:{value:600}});
    const item=textToItem('TEXT',12);Object.assign(item,{x:600,y:100,width:100,height:30});
    const editor=openCanvasTextEditor({host,item,project:p=>p,preview:()=>{},finish:()=>{}});
    const panel=host.querySelector<HTMLElement>('[data-canvas-text-editor]')!;
    Object.defineProperties(panel,{offsetWidth:{value:340},offsetHeight:{value:260}});
    host.dispatchEvent(new Event('viewportchange'));
    expect(panel.style.left).toBe('244px');expect(panel.style.top).toBe('100px');editor.finish(true);
  });
});


describe('text editor control continuity',()=>{
  it('retains feature-control focus, source selection and settings scroll after a toggle',()=>{
    const font={id:'focus-test',name:'Focus test',features:['kern','ss01'],axes:{}};vi.spyOn(typography,'findFont').mockReturnValue(font);
    const host=document.createElement('div');document.body.append(host);
    const item=textToItem('SELECTED TEXT',12);item.text!.options={...typography.defaultTextOptions,fontId:font.id};
    const editor=openCanvasTextEditor({host,item,project:p=>p,preview:vi.fn(),finish:vi.fn()});
    const input=host.querySelector('textarea')!;input.focus();input.setSelectionRange(0,8);input.dispatchEvent(new Event('select'));
    host.querySelector<HTMLButtonElement>('[data-tab="details"]')!.click();
    const settings=host.querySelector<HTMLElement>('[data-text-settings]')!;settings.scrollTop=85;
    const button=host.querySelector<HTMLButtonElement>('[data-feature="kern"][data-value="0"]')!;button.focus();button.click();
    expect((document.activeElement as HTMLElement).dataset.feature).toBe('kern');
    expect((document.activeElement as HTMLElement).dataset.value).toBe('0');expect(settings.scrollTop).toBe(85);
    expect([input.selectionStart,input.selectionEnd]).toEqual([0,8]);editor.finish(true);
  });
  it('offers a keyboard panel resize grip and reports effective splitter limits',()=>{
    const {host,editor}=setup();Object.defineProperties(host,{clientWidth:{value:800},clientHeight:{value:800}});
    const panel=host.querySelector<HTMLElement>('[data-canvas-text-editor]')!;
    panel.style.width='400px';panel.style.height='700px';
    Object.defineProperties(panel,{offsetWidth:{get:()=>parseFloat(panel.style.width)},offsetHeight:{get:()=>parseFloat(panel.style.height)}});
    const grip=host.querySelector<HTMLElement>('[data-text-resize]')!;const original=parseFloat(panel.style.width);
    grip.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));expect(parseFloat(panel.style.width)).toBe(original+10);
    const height=parseFloat(panel.style.height);grip.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',shiftKey:true,bubbles:true,cancelable:true}));expect(parseFloat(panel.style.height)).toBe(height+1);
    grip.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(parseFloat(panel.style.width)).toBe(original);
    const split=host.querySelector('[data-text-split]')!;expect(Number(split.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(Number(split.getAttribute('aria-valuemin')));
    editor.finish(true);
  });
});


it('shows readable cap-height precision without changing an untouched draft',()=>{
  const host=document.createElement('div');document.body.append(host);const item=textToItem('TEXT',12);item.height*=12.345678/12;
  const previewDraft=vi.fn();const editor=openCanvasTextEditor({host,item,project:p=>p,preview:vi.fn(),previewDraft,finish:vi.fn()});
  expect(host.querySelector<HTMLInputElement>('[data-option="capHeight"]')!.value).toBe('12.346');
  editor.finish();expect(previewDraft).not.toHaveBeenCalled();
});

describe('transactional text fill tab',()=>{
  function setupFill() {
    vi.spyOn(typography,'findFont').mockReturnValue({id:'outline',name:'Outline',kind:'outline',features:[],axes:{wght:{min:100,max:900,default:400,axisIndex:0,tag:'wght',nameId:256,flags:0}}} as typography.LoadedFont);
    const host=document.createElement('div');document.body.append(host);
    const item=textToItem('TEXT',12);item.text!.options={...typography.defaultTextOptions,fontId:'outline'};
    const previewDraft=vi.fn(),finish=vi.fn();
    const editor=openCanvasTextEditor({host,item,project:p=>p,preview:vi.fn(),previewDraft,finish});
    return {host,item,previewDraft,finish,editor};
  }
  it('puts a separated Fill tab after Variable and retains source selection',()=>{
    const {host,editor}=setupFill(),input=host.querySelector('textarea')!;
    input.focus();input.setSelectionRange(0,2);input.dispatchEvent(new Event('select'));
    const fill=host.querySelector<HTMLButtonElement>('[data-tab="fill"]')!;
    expect(fill.previousElementSibling?.hasAttribute('data-text-tab-divider')).toBe(true);
    expect((fill.previousElementSibling?.previousElementSibling as HTMLElement).dataset.tab).toBe('variable');
    fill.click();expect(host.querySelector('[data-text-settings]')!.textContent).toContain('whole block');
    expect([input.selectionStart,input.selectionEnd]).toEqual([0,2]);editor.finish(true);
    vi.restoreAllMocks();const stroke=setup();expect(stroke.host.querySelector('[data-tab="fill"]')).toBeNull();stroke.editor.finish(true);
  });
  it('previews fill changes in the draft, flushes pending values on Done, and leaves the source item untouched',()=>{
    vi.useFakeTimers();const {host,item,editor,previewDraft}=setupFill();
    host.querySelector<HTMLButtonElement>('[data-tab="fill"]')!.click();
    const mode=host.querySelector<HTMLSelectElement>('[data-text-fill-setting="mode"]')!;mode.value='hatch';mode.dispatchEvent(new Event('change',{bubbles:true}));
    expect(previewDraft.mock.lastCall![0].fillSettings).toEqual({...defaultFillSettings,mode:'hatch',connect:false});
    const width=host.querySelector<HTMLInputElement>('[data-text-fill-setting="width"]')!;width.value='.25';width.dispatchEvent(new Event('change',{bubbles:true}));
    expect(previewDraft).toHaveBeenCalledTimes(1);expect(editor.finish()).toBe(true);
    expect(previewDraft.mock.lastCall![0].fillSettings.width).toBe(.25);expect(item.fillSettings).toBeUndefined();
    vi.runAllTimers();expect(previewDraft).toHaveBeenCalledTimes(2);
  });
  it('blocks invalid fill commits and discards a pending fill change on Cancel',()=>{
    vi.useFakeTimers();const {host,editor,previewDraft,finish}=setupFill();
    host.querySelector<HTMLButtonElement>('[data-tab="fill"]')!.click();
    const width=host.querySelector<HTMLInputElement>('[data-text-fill-setting="width"]')!;width.value='0';width.dispatchEvent(new Event('change',{bubbles:true}));
    expect(editor.finish()).toBe(false);expect(previewDraft).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')!.textContent).toContain('Drawn width');
    width.value='.5';width.dispatchEvent(new Event('change',{bubbles:true}));editor.finish(true);vi.runAllTimers();
    expect(previewDraft).not.toHaveBeenCalled();expect(finish).toHaveBeenCalledExactlyOnceWith(true);
  });
});

describe('selected-letter variable axes',()=>{
  function setupAxes() {
    vi.spyOn(typography,'findFont').mockReturnValue({id:'outline',name:'Variable outline',kind:'outline',features:['kern'],axes:{wght:{min:100,max:900,default:400,axisIndex:0,tag:'wght',nameId:256,flags:0},opsz:{min:8,max:72,default:14,axisIndex:1,tag:'opsz',nameId:257,flags:0}}});
    const host=document.createElement('div');document.body.append(host);
    const item=textToItem('ABCD',12);item.text!.options={...typography.defaultTextOptions,fontId:'outline',variations:'wght=400',featureRanges:[{start:0,end:4,tag:'kern',value:0}]};
    const previewDraft=vi.fn(),finish=vi.fn();
    const editor=openCanvasTextEditor({host,item,project:p=>p,preview:vi.fn(),previewDraft,finish});
    const input=host.querySelector('textarea')!;
    const select=(start:number,end:number)=>{input.focus();input.setSelectionRange(start,end);input.dispatchEvent(new Event('select'));};
    const change=(tag:string,value:string)=>{const field=host.querySelector<HTMLInputElement>(`input[type=number][data-axis="${tag}"]`)!;field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}));};
    select(1,3);host.querySelector<HTMLButtonElement>('[data-tab="variable"]')!.click();
    return {host,editor,input,select,change,previewDraft,finish};
  }
  it('changes only the retained selection and preserves block axes and feature overrides',()=>{
    vi.useFakeTimers();const {host,editor,change,previewDraft,input}=setupAxes();
    expect(host.querySelector('[data-scope="selection"]')!.getAttribute('aria-pressed')).toBe('true');
    change('wght','800');change('opsz','16.5');expect(previewDraft).not.toHaveBeenCalled();editor.finish();
    const draft=previewDraft.mock.lastCall![0];expect(draft.options.variations).toBe('wght=400');
    expect(draft.options.variationRanges).toEqual([{start:1,end:3,tag:'opsz',value:16.5},{start:1,end:3,tag:'wght',value:800}]);
    expect(draft.options.featureRanges).toEqual([{start:0,end:4,tag:'kern',value:0}]);expect([input.selectionStart,input.selectionEnd]).toEqual([1,3]);
    vi.runAllTimers();expect(previewDraft).toHaveBeenCalledOnce();
  });
  it('updates the displayed axis value during sliding while debouncing selected-range geometry',()=>{
    vi.useFakeTimers();const {host,editor,input,previewDraft}=setupAxes();
    const slider=host.querySelector<HTMLInputElement>('input[type=range][data-axis="wght"]')!;
    const number=host.querySelector<HTMLInputElement>('input[type=number][data-axis="wght"]')!;
    slider.focus();
    for(const value of ['500','650','775']){
      slider.value=value;slider.dispatchEvent(new Event('input',{bubbles:true}));
      expect(number.value).toBe(value);vi.advanceTimersByTime(40);
      expect(previewDraft).not.toHaveBeenCalled();
    }
    expect(document.activeElement).toBe(slider);expect([input.selectionStart,input.selectionEnd]).toEqual([1,3]);
    vi.advanceTimersByTime(110);expect(previewDraft).toHaveBeenCalledOnce();
    expect(previewDraft.mock.lastCall![0].options.variationRanges).toEqual([{start:1,end:3,tag:'wght',value:775}]);
    slider.dispatchEvent(new Event('change',{bubbles:true}));editor.finish();vi.runAllTimers();
    expect(previewDraft).toHaveBeenCalledOnce();
  });
  it('captures a backward range on blur and restores keyboard focus without defeating a pointer click',()=>{
    vi.useFakeTimers();const {host,editor,input,change,previewDraft}=setupAxes();
    input.focus();input.setSelectionRange(0,2,'backward');
    // The native select event can still be queued when focus moves to a setting.
    host.querySelector<HTMLInputElement>('input[type=number][data-axis="wght"]')!.focus();
    expect(host.querySelector('[data-scope="selection"]')!.textContent).toBe('Selection · 2');
    change('wght','700');
    input.setSelectionRange(3,3);input.focus();
    expect([input.selectionStart,input.selectionEnd,input.selectionDirection]).toEqual([0,2,'backward']);
    host.querySelector<HTMLButtonElement>('[data-tab="variable"]')!.focus();
    input.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0}));input.setSelectionRange(3,3);input.focus();input.dispatchEvent(new MouseEvent('pointerup',{bubbles:true}));
    expect([input.selectionStart,input.selectionEnd]).toEqual([3,3]);
    expect(host.querySelector('[data-scope="block"]')!.getAttribute('aria-pressed')).toBe('true');
    editor.finish();expect(previewDraft.mock.lastCall![0].options.variationRanges).toEqual([{start:0,end:2,tag:'wght',value:700}]);
  });
  it('updates only decorations for selection and tabs, and derives the legend from structured overrides',()=>{
    vi.useFakeTimers();const {host,editor,input,select,change,previewDraft}=setupAxes();
    vi.advanceTimersByTime(20);
    // The initial feature override also gets an underline; expert expressions do not create markers.
    const legend=host.querySelector<HTMLElement>('[data-text-label] small')!;
    expect(legend.hidden).toBe(false);expect(input.getAttribute('aria-describedby')).toContain('canvas-text-decoration-help');
    select(0,2);host.querySelector<HTMLButtonElement>('[data-tab="basics"]')!.click();vi.advanceTimersByTime(20);
    expect(host.querySelector('[data-decoration-scope]')!.getAttribute('data-decoration-scope')).toBe('block');
    host.querySelector<HTMLButtonElement>('[data-tab="variable"]')!.click();vi.advanceTimersByTime(20);
    expect(host.querySelector('[data-decoration-scope]')!.getAttribute('data-decoration-scope')).toBe('selection');
    expect(host.querySelectorAll('[data-scope]')).toHaveLength(2);expect(previewDraft).not.toHaveBeenCalled();
    change('wght','700');vi.advanceTimersByTime(20);expect(legend.hidden).toBe(false);
    input.focus();input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));vi.advanceTimersByTime(20);
    expect(host.querySelector<HTMLElement>('[data-text-decorations]')!.hidden).toBe(true);
    input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));vi.advanceTimersByTime(20);
    expect(host.querySelector<HTMLElement>('[data-text-decorations]')!.hidden).toBe(false);
    editor.finish(true);
  });
  it('shows mixed values and lets a keyboard step make the whole selected range consistent',()=>{
    vi.useFakeTimers();const {host,editor,change,select,previewDraft}=setupAxes();change('wght','800');select(0,4);
    const field=host.querySelector<HTMLInputElement>('input[type=number][data-axis="wght"]')!;
    expect(field.value).toBe('');expect(field.placeholder).toBe('Mixed');
    expect(host.querySelector('[data-axis-mixed="wght"]')).not.toBeNull();
    field.focus();field.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',shiftKey:true,bubbles:true,cancelable:true}));
    expect(field.value).toBe('410');expect(host.querySelector('[data-axis-mixed="wght"]')).toBeNull();
    expect(document.activeElement).toBe(field);editor.finish();
    expect(previewDraft.mock.lastCall![0].options.variationRanges).toEqual([{start:0,end:4,tag:'wght',value:410}]);
  });
  it('block actions remove only that axis’s overrides, and reset restores inheritance',()=>{
    const {host,editor,change,previewDraft}=setupAxes();change('wght','800');change('opsz','16.5');
    host.querySelector<HTMLButtonElement>('[data-scope="block"]')!.click();change('wght','600');
    host.querySelector<HTMLButtonElement>('[data-scope="selection"]')!.click();
    expect(host.querySelector<HTMLInputElement>('input[type=number][data-axis="wght"]')!.value).toBe('600');
    host.querySelector<HTMLButtonElement>('[data-reset]')!.click();editor.finish();
    expect(previewDraft.mock.lastCall![0].options.variationRanges).toEqual([]);expect(previewDraft.mock.lastCall![0].options.variations).toBe('wght=600');
  });
  it('inherits axis formatting across insertion and composition, then cancels pending previews',()=>{
    vi.useFakeTimers();const {host,editor,input,select,change,previewDraft,finish}=setupAxes();change('wght','800');
    input.focus();input.value='ABxyCD';input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));expect(previewDraft).not.toHaveBeenCalled();
    input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));
    expect(previewDraft.mock.lastCall![0].options.variationRanges).toEqual([{start:1,end:5,tag:'wght',value:800}]);
    select(0,1);host.querySelector<HTMLButtonElement>('[data-tab="variable"]')!.click();change('wght','500');editor.finish(true);vi.runAllTimers();
    expect(previewDraft).toHaveBeenCalledOnce();expect(finish).toHaveBeenCalledExactlyOnceWith(true);
  });
});
