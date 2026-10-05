import { describe, expect, it } from 'vitest';
import { bundledFontCatalog, DEFAULT_FONT_ID, defaultTextOptions, findFont, fontTextOptions, initializeTypography, loadedFonts, textOptions, typographyToItem } from './typography';
import { textToItem } from './plot-font';
import { parsePath } from './editor';

describe('bundled default PlotFont', () => {
  it('is available without browser storage or asynchronous initialization', () => {
    const font = findFont(defaultTextOptions.fontId)!;
    expect(defaultTextOptions.fontId).toBe(DEFAULT_FONT_ID);
    expect(loadedFonts()).toContain(font);
    expect(font.name).toBe('Hershey Roman Simplex Regular');
    expect(font.plotfont?.version).toBe('0.3');
    expect(font.plotfont?.glyphs.flatMap(g => g.unicodes).map(u => parseInt(u, 16)).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 95 }, (_, i) => i + 32));
    expect(typographyToItem('Hello, Plot-it!\n0123456789', 12, defaultTextOptions).text?.format).toBe('plotfont');
  });

  it('preserves lowercase, open trajectories, advances, and metric line spacing', () => {
    const make = (text: string) => typographyToItem(text, 10.5, defaultTextOptions);
    expect(make('a').markup).not.toBe(make('A').markup);
    const font = findFont(DEFAULT_FONT_ID)!.plotfont!;
    const a = font.glyphs.find(g => g.unicodes.includes('0041'))!;
    const b = font.glyphs.find(g => g.unicodes.includes('0042'))!;
    expect(make('AB').width).toBeCloseTo((a.advanceWidth + b.advanceWidth) / 100);
    const paths = [...make('A\nA').markup.matchAll(/ d="([^"]+)"/g)].map(m => parsePath(m[1]!));
    expect(paths).toHaveLength(a.strokes.length * 2);
    expect(paths[a.strokes.length]![0]!.values[1]! - paths[0]![0]!.values[1]!)
      .toBeCloseTo(defaultTextOptions.lineHeight * 1.4);
    expect(paths.every(p => p.every(c => c.type !== 'Z'))).toBe(true);
    expect(() => make('é')).toThrow(/missing character/);
  });

  it('keeps legacy Plot Sans text editable in its original font', () => {
    const item = textToItem('Old text', 12);
    expect(textOptions(item).fontId).toBe('plot-sans');
    expect(textOptions(item).lineHeight).toBe(1.25);
    expect(textOptions().fontId).toBe(DEFAULT_FONT_ID);
    item.text!.options = { ...defaultTextOptions, fontId: 'saved-custom-font' };
    expect(textOptions(item).fontId).toBe('saved-custom-font');
  });

  it('bundles all four Hershey faces with distinct trajectories and complete ASCII', () => {
    const ids = ['hershey-roman-simplex', 'hershey-roman-duplex', 'hershey-roman-triplex', 'hershey-script-simplex'];
    const drawings = ids.map(id => {
      const font = findFont(id)!;
      expect(font.bundled).toBe(true);
      expect(font.plotfont?.version).toBe('0.3');
      expect(font.plotfont!.glyphs.flatMap(g => g.unicodes)).toHaveLength(95);
      return typographyToItem('Abc 123\nPlot!', 12, fontTextOptions(font, defaultTextOptions)).markup;
    });
    expect(new Set(drawings).size).toBe(4);
    expect(fontTextOptions(findFont('hershey-script-simplex')!, defaultTextOptions).lineHeight).toBeCloseTo(2070 / 1050);
    expect(loadedFonts().filter(f => f.bundled)).toHaveLength(bundledFontCatalog.length + 1);
  });

  it('bundles SpaceRocks with ASCII coverage, original pen lifts, and metric line spacing', () => {
    const font = findFont('pf-ems-spacerocks')!;
    expect(font.name).toBe('PF EMS SpaceRocks Regular');
    expect(font.bundled).toBe(true);
    expect(font.noticeUrl).toBe('/fonts/ems-spacerocks/ATTRIBUTION.txt');
    const data = font.plotfont!;
    expect(data.glyphs.flatMap(g => g.unicodes).map(u => parseInt(u, 16)).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 95 }, (_, i) => i + 32));
    const options = fontTextOptions(font, defaultTextOptions);
    expect(options.lineHeight).toBe(2);
    const a = data.glyphs.find(g => g.unicodes.includes('0041'))!;
    const item = typographyToItem('A\nA', 12, options);
    const paths = [...item.markup.matchAll(/ d="([^"]+)"/g)].map(m => parsePath(m[1]!));
    expect(paths).toHaveLength(a.strokes.length * 2);
    expect(paths[a.strokes.length]![0]!.values[1]! - paths[0]![0]!.values[1]!).toBeCloseTo(2.8);
    expect(item.width).toBeCloseTo(a.advanceWidth / data.metrics.capHeight * 12);
    expect(item.text?.options?.fontId).toBe(font.id);
    expect(typographyToItem('SpaceRocks\n0123456789', 12, options).text?.format).toBe('plotfont');
  });

  it('initializes the bundled native demo with validated OpenType substitutions and positioning', async () => {
    await initializeTypography();
    const font = findFont('plotfont-layout-demo')!;
    expect(font.prepared?.hasOpenTypeLayout).toBe(true);
    expect(font.features).toEqual(['calt', 'kern', 'liga', 'locl', 'mark', 'mkmk', 'salt', 'ss01', 'tnum']);
    const options = fontTextOptions(font, defaultTextOptions);
    const make = (text: string, changes = {}) => typographyToItem(text, 7, { ...options, ...changes });
    expect(make('fi').markup.match(/<path/g)).toHaveLength(1);
    expect(make('fi', { ligatures: false }).markup.match(/<path/g)).toHaveLength(2);
    expect(make('A').markup).not.toBe(make('A', { features: 'ss01=1' }).markup);
    expect(make('A\u0301\nfi AA').text?.format).toBe('plotfont');
    expect(() => make('A', { features: 'curs=1' })).toThrow(/unavailable/);
  });
});
