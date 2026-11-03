import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultTextOptions as defaults, fontTextOptions, findFont, editTypography, initializeTypography, registerFont, resizeTextFrame, textOptions, typographyToItem } from './typography';
import { parsePath } from './editor';
import { serializeDocument } from './svg';
const bytes = (name: string): ArrayBuffer => {
  const data = readFileSync(new URL(`./test-fonts/${name}`, import.meta.url));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
};
const options = { ...defaults, fontId: 'roboto' };
const make = (text: string, changes = {}) => typographyToItem(text, 12, { ...options, ...changes });
beforeAll(async () => {
  await initializeTypography();
  registerFont(bytes('Roboto.ttf'), 'Roboto', 'roboto');
  registerFont(bytes('NotoSansArabic.ttf'), 'Arabic', 'arabic');
});
describe('OpenType plot typography', () => {
  it.each(['roboto', 'hershey-roman-simplex', 'plot-sans'])('reflows %s frames at a fixed font size while retaining editable source', fontId => {
    const settings = { ...defaults, fontId };
    const item = typographyToItem('ONE TWO THREE FOUR', 12, settings);
    const initial = structuredClone(item), sx = item.width / item.viewBox[2], sy = item.height / item.viewBox[3];
    resizeTextFrame(item, initial.width / 3, initial.height);
    expect(item.width / item.viewBox[2]).toBeCloseTo(sx);
    expect(item.height / item.viewBox[3]).toBeCloseTo(sy);
    expect(item.height).toBeGreaterThan(initial.height);
    expect(item.text!.content).toBe('ONE TWO THREE FOUR');
    expect(item.text!.frame).toBeDefined();
    const width = item.width;
    editTypography(item, 'ONE TWO THREE FOUR FIVE SIX');
    expect(item.width).toBeCloseTo(width);
    expect(item.height / item.viewBox[3]).toBeCloseTo(sy);
    resizeTextFrame(item, initial.width * 2, initial.height);
    expect(item.height).toBeCloseTo(initial.height);
    expect(item.text!.content).not.toContain('\n');
  });
  it('keeps a frame on font-size edits and preserves explicit breaks and minimum height', () => {
    const item = make('ONE\n\nTWO\n');
    resizeTextFrame(item, 90, 100);
    const width = item.width;
    editTypography(item, item.text!.content, 18);
    expect(item.width).toBeCloseTo(width);
    expect(item.height).toBeGreaterThanOrEqual(100);
    expect(item.text!.frame!.height * item.height / item.viewBox[3]).toBeCloseTo(100);
    expect(item.height / item.viewBox[3] * 1.4).toBeCloseTo(18);
    expect(item.text!.content).toBe('ONE\n\nTWO\n');
    const left = item.markup;
    editTypography(item, item.text!.content, undefined, {...textOptions(item), align:'right'});
    expect(item.markup).not.toBe(left);
    expect(item.width).toBeCloseTo(width);
  });
  it('uses real kerning advances and shapes ligatures', () => {
    expect([defaults.kerning,defaults.ligatures,defaults.contextual]).toEqual([true,true,true]);
    const selectedFont=fontTextOptions(findFont('roboto')!,{...options,kerning:false,ligatures:false,contextual:false,features:'kern=0, liga=0, calt=0',featureRanges:[{tag:'kern',value:0,start:0,end:2}],variations:'wght=700',variationRanges:[{tag:'wght',value:850,start:0,end:2}]});
    expect([selectedFont.kerning,selectedFont.ligatures,selectedFont.contextual]).toEqual([true,true,true]);expect(selectedFont.features).toBe('');expect(selectedFont.featureRanges).toEqual([]);
    expect(selectedFont.variations).toBe('');expect(selectedFont.variationRanges).toEqual([]);
    expect(typographyToItem('AV',12,selectedFont).width).toBeLessThan(make('AV',{kerning:false}).width);
    expect(make('AV').width).toBeLessThan(make('AV', { kerning: false }).width);
    expect(typographyToItem('ffi',12,selectedFont).markup).toBe(make('ffi').markup);
    expect(make('ffi').markup).not.toBe(make('ffi', { ligatures: false }).markup);
    expect(make('ffi', { features: 'liga=0' }).markup).toBe(make('ffi', { ligatures: false }).markup);
  });
  it('applies small caps, figure styles, fractions and ranged feature settings', () => {
    for (const [text, features] of [['Hello', 'smcp=1'], ['12345', 'onum=1'], ['1/2', 'frac=1']]) {
      expect(make(text!, { features }).markup).not.toBe(make(text!).markup);
    }
    expect(make('ffi ffi', { features: 'liga[0:3]=0' }).markup).not.toBe(make('ffi ffi').markup);
  });
  it('preserves contours and emits portable geometry', () => {
    const item = make('BO');
    const paths = [...item.markup.matchAll(/d="([^"]*)"/g)];
    expect(paths).toHaveLength(2);
    for (const [, d] of paths) expect(parsePath(d!).filter(c => c.type === 'M').length).toBeGreaterThan(1);
    expect(item.markup).toContain('data-opentype-outline="1"');
    expect(item.markup.match(/fill-rule="nonzero"/g)).toHaveLength(2);
    const svg = serializeDocument([item], 210, 297);
    expect(svg).not.toMatch(/<text|font-family|Roboto/);
    expect(svg).toContain(item.markup);
  });
  it('applies em spacing and keeps optional ligatures configurable with tracking', () => {
    expect(make('AB', { letterSpacing: .1 }).width).toBeGreaterThan(make('AB').width);
    expect(make('A B', { wordSpacing: .2 }).width).toBeGreaterThan(make('A B').width);
    expect(make('ffi', { letterSpacing: .1 }).markup).not.toBe(make('ffi', { letterSpacing: .1, features: 'liga=1' }).markup);
    expect(make('A\nB', { lineHeight: 2 }).height).toBeGreaterThan(make('A\nB').height);
    expect(make('AB\nA', { align: 'right' }).markup).not.toBe(make('AB\nA').markup);
  });
  it('applies variable coordinates to outlines and validates their bounds', () => {
    expect(make('Hello', { variations: 'wght=800' }).markup).not.toBe(make('Hello', { variations: 'wght=100' }).markup);
    expect(() => make('A', { variations: 'wght=2000' })).toThrow(/range/);
    expect(() => make('A', { variations: 'FAKE=2' })).toThrow(/unavailable/);
  });
  it('shapes combining marks and Arabic, keeping cursive tracking suppressed', () => {
    expect(make('a\u0301').markup).toBe(make('á').markup);
    const arabic = make('سلام', { fontId: 'arabic', direction: 'rtl', language: 'ar', script: 'Arab' });
    expect(arabic.markup.length).toBeGreaterThan(100);
    expect(make('سلام', { fontId: 'arabic', letterSpacing: .3 }).markup).toBe(arabic.markup);
  });
  it('retains placement, independent scaling, font settings and content on edits', () => {
    const item = make('AV', { features: 'liga=0' });
    item.width *= 2; item.x = 31; item.rotation = 27;
    const sx = item.width / item.viewBox[2], sy = item.height / item.viewBox[3];
    editTypography(item, 'New copy');
    expect(item.width / item.viewBox[2]).toBeCloseTo(sx);
    expect(item.height / item.viewBox[3]).toBeCloseTo(sy);
    expect(item.text?.content).toBe('New copy');
    expect(textOptions(item).features).toBe('liga=0');
    expect([item.x, item.rotation]).toEqual([31, 27]);
  });
  it('rejects invalid input and missing glyphs without changing original geometry', () => {
    const item = make('A'); const original = structuredClone(item);
    expect(() => editTypography(item, '🦄')).toThrow(/missing characters/);
    expect(item).toEqual(original);
    expect(() => make('A', { fontId: 'missing' })).toThrow(/unavailable/);
    expect(() => make('A', { features: 'bogus' })).toThrow(/Invalid feature/);
    expect(() => make('A', { lineHeight: 0 })).toThrow(/line height/);
    expect(() => registerFont(new ArrayBuffer(5), 'broken', 'bad')).toThrow(/invalid/);
  });
  it('keeps Plot Sans editable with spacing and alignment', () => {
    const plotSans = { ...defaults, fontId: 'plot-sans', lineHeight: 1.25 };
    const base = typographyToItem('A B\nA', 12, plotSans);
    const spaced = typographyToItem('A B\nA', 12, { ...plotSans, letterSpacing: .2, wordSpacing: .2, align: 'right' });
    expect(spaced.width).toBeGreaterThan(base.width);
    expect(spaced.markup).not.toBe(base.markup);
    const tight = typographyToItem('AAAA', 12, { ...plotSans, letterSpacing: -2 });
    expect(tight.viewBox[0]).toBeLessThan(0);
    expect(tight.width).toBeGreaterThan(0);
  });
});
