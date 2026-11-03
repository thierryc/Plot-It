// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { angleStep, snappedAngle, DuplicationChain, cloneSvgElement, clonedMarkup } from './editor-modifiers';
import { elements, markupRoot, resizedItem } from './editor';
import { textToItem } from './plot-font';
import { DEFAULT_EDITOR_PREFERENCES, EDITOR_PREFERENCES_KEY, editorPreferences, nudgeValue, restoreEditorPreferences } from './editor-preferences';

describe('centered corner resizing', () => {
  for (const rotation of [0, 37, 90, 175, -45]) for (const corner of ['nw','ne','sw','se']) {
    it(`keeps the center at ${corner}, ${rotation} degrees, with and without proportions`, () => {
      const item = { ...textToItem('A',14), x:20,y:30,width:40,height:20,rotation };
      const a = rotation*Math.PI/180, dx = corner.includes('w') ? -6 : 6, dy = corner.includes('n') ? -3 : 3;
      const delta = { x:dx*Math.cos(a)-dy*Math.sin(a), y:dx*Math.sin(a)+dy*Math.cos(a) };
      for (const proportional of [false,true]) {
        const result = resizedItem(item,corner,delta,proportional,true);
        expect(result.x+result.width/2).toBeCloseTo(40); expect(result.y+result.height/2).toBeCloseTo(40);
        expect(result.width).toBeCloseTo(52); expect(result.height).toBeCloseTo(26);
      }
      const minimum = resizedItem(item,corner,{x:-delta.x*100,y:-delta.y*100},true,true);
      expect(minimum.width/minimum.height).toBeCloseTo(2); expect(minimum.height).toBeGreaterThanOrEqual(.1);
    });
  }
});
describe('rotation and repeat duplication', () => {
  it('unwraps seam crossings in both directions, retaining whole turns', () => {
    expect(angleStep(179,-179)).toBe(2); expect(angleStep(-179,179)).toBe(-2);
    let current = 170,total = 0;
    for (const next of [-170,-80,10,100,170]) { total += angleStep(current,next); current=next; }
    expect(total).toBe(360);
    expect(snappedAngle(22,true)).toBe(15); expect(snappedAngle(23,true)).toBe(30); expect(snappedAngle(-38,true)).toBe(-45);
    expect(snappedAngle(368,true)).toBe(375); expect(snappedAngle(23)).toBe(23);
  });
  it('keeps asymmetric rotation out of the repeated translation and tracks later nudges', () => {
    const chain = new DuplicationChain();
    chain.start('path',{center:{x:0,y:0},rotation:0},{center:{x:8,y:3},rotation:0});
    chain.update('path',{center:{x:10,y:5},rotation:45},true);
    expect(chain.next('path')).toEqual({x:8,y:3,rotation:45});
    chain.update('path',{center:{x:11,y:5},rotation:45});
    expect(chain.next('path')).toEqual({x:9,y:3,rotation:45});
    chain.start('copy',{center:{x:11,y:5},rotation:45},{center:{x:17,y:10},rotation:90},chain.next('path'));
    expect(chain.next('copy')).toEqual({x:9,y:3,rotation:45});
  });
  it('tracks full object turns and SVG seam crossings', () => {
    const chain = new DuplicationChain();
    chain.start('object',{center:{x:0,y:0},rotation:5},{center:{x:5,y:5},rotation:5});
    chain.update('object',{center:{x:5,y:5},rotation:405}); expect(chain.next('object').rotation).toBe(400);
    chain.start('svg',{center:{x:0,y:0},rotation:170,wrapped:true},{center:{x:5,y:5},rotation:-100,wrapped:true});
    expect(chain.next('svg').rotation).toBe(90);
    chain.update('svg',{center:{x:5,y:5},rotation:-85,wrapped:true}); expect(chain.next('svg').rotation).toBe(105);
  });
  it('uses the default offset until a chain starts and updates only the latest copy', () => {
    const chain = new DuplicationChain(), source = { center:{x:10,y:20},rotation:5 };
    expect(chain.next('a')).toEqual({x:5,y:5,rotation:0});
    chain.start('b',source,{center:{x:18,y:16},rotation:35});
    expect(chain.next('b')).toEqual({x:8,y:-4,rotation:30});
    chain.update('a',{center:{x:999,y:999},rotation:100});
    expect(chain.next('b')).toEqual({x:8,y:-4,rotation:30});
    chain.update('b',{center:{x:20,y:18},rotation:50});
    expect(chain.next('b')).toEqual({x:10,y:-2,rotation:45});
    chain.start('c',{center:{x:20,y:18},rotation:50},{center:{x:30,y:16},rotation:95});
    expect(chain.next('c')).toEqual({x:10,y:-2,rotation:45});
    expect(chain.next('b')).toEqual({x:5,y:5,rotation:0}); chain.clear(); expect(chain.next('c').rotation).toBe(0);
  });
});
describe('SVG cloning', () => {
  it('remaps internal paint, clip, href, accessibility and timing references without changing external defs', () => {
    const markup = `<g id="group" aria-labelledby="label outside"><defs><linearGradient id="paint"/><clipPath id="clip"><path id="curve" d="M0 0C1 2 3 4 5 6"/></clipPath></defs><title id="label">Art</title><path id="shape" fill="url('#paint')" clip-path="url(#clip)" stroke="url(#external)" d="M0 0L10 10"/><use href="#curve"/><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#shape"/><animate begin="shape.click; outside.end"/></g>`;
    const copy = markupRoot(clonedMarkup(markup,'copy'));
    expect([...copy.querySelectorAll('[id]')].map(e=>e.id)).toEqual(['copy-0','copy-1','copy-2','copy-3','copy-4','copy-5']);
    expect(copy.querySelector('#copy-5')?.getAttribute('fill')).toBe("url('#copy-1')");
    expect(copy.querySelector('#copy-5')?.getAttribute('clip-path')).toBe('url(#copy-2)');
    expect(copy.querySelector('#copy-5')?.getAttribute('stroke')).toBe('url(#external)');
    expect(copy.querySelector('g')?.getAttribute('aria-labelledby')).toBe('copy-4 outside');
    expect(copy.querySelector('animate')?.getAttribute('begin')).toBe('copy-5.click; outside.end');
    expect([...copy.querySelectorAll('use')].map(e=>e.getAttribute('href')??e.getAttribute('xlink:href'))).toEqual(['#copy-3','#copy-5']);
  });
  it('inserts an editable sibling in its inherited source parent, preserving metadata and element fill', () => {
    const markup = `<g transform="rotate(25)" stroke="red"><path id="a" data-plot-outline-version="2" data-plot-glyph="3" data-plot-fill='{"mode":"hatch"}' d="M0 0Q1 2 3 4"/><circle r="3"/></g>`;
    const copy = cloneSvgElement(markup,0,'fresh'), root = markupRoot(copy.markup), list = elements(root);
    expect(copy.index).toBe(1); expect(list).toHaveLength(3);
    expect(list[0]?.id).toBe('a'); expect(list[1]?.id).toBe('fresh-0');
    expect(list[1]?.parentElement).toBe(list[0]?.parentElement);
    expect(list[1]?.getAttribute('d')).toBe('M0 0Q1 2 3 4');
    expect(list[1]?.getAttribute('data-plot-fill')).toBe('{"mode":"hatch"}');
    expect(list[1]?.getAttribute('data-plot-glyph')).toBe('3');
    expect(list[1]?.parentElement?.getAttribute('transform')).toBe('rotate(25)');
    expect(() => cloneSvgElement(markup,99,'fresh')).toThrow();
  });
});
const storedPreferences = new Map<string,string>();
const testStorage = { getItem: (key:string) => storedPreferences.get(key) ?? null, setItem: (key:string,value:string) => { storedPreferences.set(key,value); }, clear: () => storedPreferences.clear() };
describe('browser-local nudge preferences', () => {
  it.each(['', ' ', 0,-1,NaN,Infinity,'no',null,true,{},[]])('rejects invalid input %s', value => expect(()=>nudgeValue(value)).toThrow());
  it('restores valid fields individually and never replaces a valid preference with invalid input', () => {
    expect(restoreEditorPreferences({nudgeMm:.25,shiftNudgeMm:-1})).toEqual({nudgeMm:.25,shiftNudgeMm:1});
    testStorage.clear(); const store = editorPreferences(testStorage);
    expect(store.value).toEqual(DEFAULT_EDITOR_PREFERENCES); store.set('nudgeMm','.2'); store.set('shiftNudgeMm',2);
    expect(()=>store.set('nudgeMm','')).toThrow(); expect(store.value.nudgeMm).toBe(.2);
    expect(editorPreferences(testStorage).value).toEqual({nudgeMm:.2,shiftNudgeMm:2});
    expect(JSON.parse(testStorage.getItem(EDITOR_PREFERENCES_KEY)!)).toEqual({nudgeMm:.2,shiftNudgeMm:2});
    store.reset(); expect(store.value).toEqual(DEFAULT_EDITOR_PREFERENCES);
  });
  it('handles malformed or unavailable storage', () => {
    testStorage.setItem(EDITOR_PREFERENCES_KEY,'bad'); expect(editorPreferences(testStorage).value).toEqual(DEFAULT_EDITOR_PREFERENCES);
    const store = editorPreferences({getItem:()=>{throw Error();},setItem:()=>{throw Error();}});
    store.set('nudgeMm',.5); expect(store.value.nudgeMm).toBe(.5);
  });
});
