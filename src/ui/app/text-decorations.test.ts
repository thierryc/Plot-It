// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindTextDecorations, decorationIntervals, type TextSelection } from './text-decorations';

let frames: Map<number, FrameRequestCallback>, nextFrame: number;
beforeEach(() => {
  frames = new Map(); nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { frames.set(++nextFrame, callback); return nextFrame; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn(id => frames.delete(id)));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
function flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); }
function setup() {
  document.body.innerHTML = '<label>Text<textarea aria-describedby="error"></textarea></label><small hidden>Underline: local settings</small><span id="help" hidden>Underlined text has local settings.</span><button>Setting</button>';
  const input = document.querySelector('textarea')!, legend = document.querySelector('small')!, description = document.querySelector<HTMLElement>('#help')!;
  input.value = 'ABCD\nEFGH\n';
  Object.defineProperties(input, {clientWidth: {value: 200}, clientHeight: {value: 100}, clientLeft: {value: 1}, clientTop: {value: 1}});
  const createRange = document.createRange.bind(document);
  const measure = vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = createRange();
    Object.defineProperty(range, 'getClientRects', {value: () => [{left: 8 + range.startOffset * 7, top: 6, width: (range.endOffset - range.startOffset) * 7, height: 17}]});
    return range;
  });
  const decorations = bindTextDecorations(input, legend, description);
  const layer = document.querySelector<HTMLElement>('[data-text-decorations]')!;
  const selection: TextSelection = {start: 1, end: 3, direction: 'backward'};
  const state = {selection, scope: 'selection' as 'selection'|'block', overrides: [{start: 1, end: 2}, {start: 2, end: 4}], composing: false};
  return {input, legend, decorations, layer, state, measure};
}

describe('native textarea decoration layer', () => {
  it('merges feature and axis display intervals without changing their source ranges', () => {
    const ranges = [{start: 2, end: 4}, {start: 1, end: 3}, {start: 4, end: 6}, {start: 8, end: 12}, {start: -1, end: 0}];
    expect(decorationIntervals(ranges, 10)).toEqual([{start: 1, end: 6}, {start: 8, end: 10}]);
    expect(ranges[0]).toEqual({start: 2, end: 4});
  });
  it('paints a blurred selection and overrides while leaving text and selection native', () => {
    const {input, legend, decorations, layer, state} = setup();
    input.focus(); input.setSelectionRange(1, 3, 'backward'); decorations.update(state); flush();
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.querySelectorAll('[data-text-decoration=selection]')).toHaveLength(0);
    expect(layer.querySelectorAll('[data-text-decoration=override]')).toHaveLength(1);
    expect(legend.hidden).toBe(false); expect(input.getAttribute('aria-describedby')).toBe('error help');
    document.querySelector('button')!.focus(); flush();
    const mark = layer.querySelector<HTMLElement>('[data-text-decoration=selection]')!;
    expect(mark.style.left).toBe('15px'); expect(mark.style.width).toBe('14px');
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([1, 3, 'backward']);
    expect(input.value).toBe('ABCD\nEFGH\n');
    expect(layer.firstElementChild!.textContent).toBe(input.value + '\u200b');
    input.focus(); flush(); expect(layer.querySelector('[data-text-decoration=selection]')).toBeNull();
    decorations.destroy();
  });
  it('changes scope and removes collapsed selections and reset markers without remeasuring text', () => {
    const {decorations, layer, state, legend, measure, input} = setup();
    decorations.update(state); flush(); const measurements = measure.mock.calls.length;
    decorations.update({...state, scope: 'block'}); flush();
    expect(layer.lastElementChild!.getAttribute('data-decoration-scope')).toBe('block'); expect(measure).toHaveBeenCalledTimes(measurements);
    decorations.update({...state, selection: {start: 2, end: 2, direction: 'none'}, overrides: []}); flush();
    expect(layer.querySelector('[data-text-decoration]')).toBeNull(); expect(legend.hidden).toBe(true);
    expect(input.getAttribute('aria-describedby')).toBe('error'); decorations.destroy();
  });
  it('batches updates, reuses rectangles on both scroll axes, and releases observers and frames', () => {
    const {decorations, layer, state, measure, input} = setup();
    decorations.update(state); decorations.update({...state, scope: 'block'}); expect(frames.size).toBe(1); flush();
    const measurements = measure.mock.calls.length;
    input.scrollLeft = 20; input.scrollTop = 40; input.dispatchEvent(new Event('scroll'));
    expect((layer.lastElementChild as HTMLElement).style.transform).toBe('translate(-20px, -40px)');
    expect(measure).toHaveBeenCalledTimes(measurements); expect(frames.size).toBe(0);
    decorations.invalidate(); expect(frames.size).toBe(1); decorations.destroy();
    expect(frames.size).toBe(0); expect(input.parentElement!.tagName).toBe('LABEL');
    input.dispatchEvent(new Event('scroll')); expect(document.querySelector('[data-text-decorations]')).toBeNull();
  });
  it('suppresses stale decorations during composition and resumes against the new source', () => {
    const {decorations, layer, state, input} = setup(); decorations.update(state); flush();
    input.value = 'á👩‍💻'; decorations.update({...state, composing: true}); flush(); expect(layer.hidden).toBe(true);
    decorations.update({...state, selection: {start: 0, end: 2, direction: 'forward'}, overrides: [{start: 2, end: 7}]}); flush();
    expect(layer.hidden).toBe(false); expect(layer.firstElementChild!.textContent).toBe(input.value);
    expect(layer.querySelector('[data-text-decoration=selection]')).not.toBeNull(); decorations.destroy();
  });
});
