import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createPlotFont, loadPlotFont, layoutText, parsePlotFont, toSVGPaths, toSVG, flattenContour, type PlotFont, type PathCommand } from '../src/index.js';
import { toCanvasPaths } from '../src/canvas.js';
const source = (name: string) => readFileSync(new URL(`./fixtures/${name}.plotfont.json`, import.meta.url), 'utf8');
let demo: PlotFont, minimal: PlotFont, mixed: PlotFont, script: PlotFont;
const make = (text: string, options = {}) => layoutText(demo, text, {capHeight:1.4,...options});
beforeAll(async () => {
  demo = await loadPlotFont(source('layout-demo'));
  minimal = createPlotFont(parsePlotFont(source('minimal')));
  mixed = await loadPlotFont(source('mixed'));
  script = await loadPlotFont(source('script'));
});
describe('portable font loading', () => {
  it('rejects malformed JSON, duplicates, wrong versions, invalid commands and references', () => {
    expect(() => parsePlotFont('{')).toThrow();
    expect(() => parsePlotFont(source('minimal').replace('"version": "0.3"','"version": "0.2"'))).toThrow(/0.3 only/);
    expect(() => parsePlotFont('{"name":1,"na\\u006de":2}')).toThrow(/duplicate/);
    expect(() => parsePlotFont('{"n":1e400}')).toThrow(/finite/);
    expect(() => parsePlotFont('['.repeat(66) + '0' + ']'.repeat(66))).toThrow(/nesting/);
    const original = JSON.parse(source('minimal'));
    for (const mutate of [
      (f: typeof original) => f.version = '9',
      (f: typeof original) => f.glyphs[2].strokes[0].commands.push(['M',0,0]),
      (f: typeof original) => f.glyphs[2].unicodes = ['D800'],
      (f: typeof original) => f.missingGlyph = 'missing',
      (f: typeof original) => f.kerning = [{left:'A',right:'missing',value:-20}],
    ]) { const data = structuredClone(original); mutate(data); expect(() => parsePlotFont(JSON.stringify(data))).toThrow(/PlotFont/); }
  });
  it('validates every embedded payload binding before shaping', async () => {
    const original = JSON.parse(source('layout-demo'));
    for (const mutate of [
      (f: typeof original) => f.layout.font.sha256 = '0'.repeat(64),
      (f: typeof original) => f.glyphs[0].advanceWidth++,
      (f: typeof original) => f.layout.features.pop(),
      (f: typeof original) => f.layout.source.sha256 = '0'.repeat(64),
      (f: typeof original) => f.layout.glyphOrder.reverse(),
    ]) { const data = structuredClone(original); mutate(data); await expect(loadPlotFont(JSON.stringify(data))).rejects.toThrow(/PlotFont/); }
    expect(() => createPlotFont(parsePlotFont(source('layout-demo')))).toThrow(/loadPlotFont/);
  });
  it('accepts UTF-8 byte views and snapshots caller-owned data', async () => {
    const bytes = new TextEncoder().encode(source('minimal'));
    const padded = new Uint8Array(bytes.length + 4); padded.set(bytes,2);
    expect((await loadPlotFont(padded.subarray(2,-2))).data.id).toBe(minimal.data.id);
    expect((await loadPlotFont(bytes.buffer)).data.id).toBe(minimal.data.id);
    await expect(loadPlotFont(new Uint8Array([0xff]))).rejects.toThrow();
    const data = parsePlotFont(source('minimal')), prepared = createPlotFont(data);
    data.glyphs[2]!.advanceWidth = 999;
    expect(prepared.data.glyphs[2]!.advanceWidth).not.toBe(999);
    expect(() => prepared.data.glyphs[2]!.advanceWidth++).toThrow();
    expect(() => layoutText({data,features:[],hasOpenTypeLayout:false},'A')).toThrow(/createPlotFont/);
  });
});
describe('portable text geometry', () => {
  it('uses caller units, font metrics, baseline zero, multiline alignment and spacing', () => {
    const small = layoutText(minimal,'A'), large = layoutText(minimal,'A',{capHeight:7});
    expect(large.viewBox[2]).toBeCloseTo(small.viewBox[2]*7);
    expect(large.bounds.minY).toBeCloseTo(-minimal.data.metrics.ascender/minimal.data.metrics.capHeight*7);
    const multiline = layoutText(minimal,'A\n\nA',{capHeight:1.4});
    expect(multiline.viewBox[3]*7/1.4).toBeCloseTo(34);
    expect(multiline.lineAdvances[1]).toBe(0);
    expect(toSVGPaths(layoutText(minimal,'AA\nA',{align:'right'}))).not.toEqual(toSVGPaths(layoutText(minimal,'AA\nA')));
    expect(layoutText(minimal,'A A',{letterSpacing:.1,wordSpacing:.2}).lineAdvances[0]).toBeGreaterThan(layoutText(minimal,'A A').lineAdvances[0]!);
  });
  it('shapes ligatures, unencoded alternates, contextual and localized forms', () => {
    expect(make('fi').operations).toHaveLength(1);
    expect(make('fi',{ligatures:false}).operations).toHaveLength(2);
    expect(make('A',{features:'ss01=1'}).operations).not.toEqual(make('A').operations);
    expect(make('AA').operations).not.toEqual(make('AA',{contextual:false}).operations);
    expect(make('i',{language:'tr'}).operations).not.toEqual(make('i',{language:'en'}).operations);
    expect(make('00',{features:'tnum=1'}).lineAdvances[0]).toBeGreaterThan(make('00').lineAdvances[0]!);
    expect(make('fi',{letterSpacing:.1}).operations).toHaveLength(2);
    expect(make('fi',{letterSpacing:.1,features:'liga=1'}).operations).toHaveLength(1);
  });
  it('applies kerning exactly once', () => {
    expect(make('AA',{contextual:false}).viewBox[2]*7/1.4).toBeCloseTo(11.2);
    expect(make('AA',{contextual:false,kerning:false}).viewBox[2]*7/1.4).toBeCloseTo(12);
  });
  it('applies mark and cursive offsets without connecting separate strokes', () => {
    const mark = make('A\u0301').operations[1]!;
    expect(mark.kind).toBe('stroke');
    if (mark.kind === 'stroke') {
      expect(mark.contour.commands[0]!.values[0]).toBeCloseTo(.6);
      expect(mark.contour.commands[0]!.values[1]).toBeCloseTo(-1.4);
    }
    const joined = make('un',{features:'curs=1'});
    expect(joined.operations).toHaveLength(2);
    const n = joined.operations[1]!;
    if (n.kind === 'stroke') {
      expect(n.contour.commands[0]!.values[0]).toBeCloseTo(.8);
      expect(n.contour.commands[0]!.values[1]).toBeCloseTo(-.2);
    }
  });
  it('preserves curves, closure, compound fills, holes and drawing order', () => {
    const geometry = layoutText(mixed,'i');
    expect(geometry.operations.map(op=>op.kind)).toEqual(['stroke','fill']);
    const fill = geometry.operations[1]!;
    if (fill.kind === 'fill') { expect(fill.fillRule).toBe('evenodd'); expect(fill.contours).toHaveLength(2); }
    const paths = toSVGPaths(geometry);
    expect(paths[0]!.d).not.toContain('Z'); expect(paths[1]!.d.match(/Z/g)).toHaveLength(2);
    expect(toSVGPaths(layoutText(script,'un')).map(p=>p.d).join('')).toMatch(/[QC]/);
    const data = parsePlotFont(source('minimal')); data.glyphs[2]!.strokes[0]!.kind = 'stroke';
    const op = data.glyphs[2]!.strokes[0]!;
    if (op.kind === 'stroke') op.closed = true;
    expect(toSVGPaths(layoutText(createPlotFont(data),'A'))[0]!.d).toContain('Z');
  });
  it('renders explicitly mapped private-use drawings while retaining script and missing-glyph checks', () => {
    const data = parsePlotFont(source('minimal'));
    const glyph = data.glyphs.find(glyph => glyph.unicodes.includes('0041'))!;
    glyph.unicodes = ['E000', 'F0000', '100000'];
    const symbols = createPlotFont(data);
    for (const codepoint of [0xE000, 0xF0000, 0x100000]) {
      expect(toSVGPaths(layoutText(symbols, String.fromCodePoint(codepoint))))
        .toEqual(toSVGPaths(layoutText(minimal, 'A')));
    }
    expect(() => layoutText(symbols, '\uE001')).toThrow(/missing character/);
    expect(() => layoutText(symbols, 'α')).toThrow(/OpenType layout/);
  });
  it('rejects invalid text, unsupported settings, excessive input and overflowing coordinates', async () => {
    for (const text of ['','   ','A\tA','\ud800','☃']) expect(() => make(text)).toThrow();
    expect(() => make('A',{features:'xxxx=1'})).toThrow(/unavailable/);
    expect(() => layoutText(minimal,'A',{features:'ss01=1'})).toThrow(/no OpenType/);
    expect(() => layoutText(minimal,'A',{direction:'rtl'})).toThrow(/no OpenType/);
    for (const options of [{capHeight:0},{capHeight:NaN},{letterSpacing:Infinity},{lineHeight:0},{script:'bad'},{language:'x y'}]) expect(() => make('A',options)).toThrow();
    expect(() => make('A'.repeat(100001))).toThrow(/Unicode scalars/);
    expect(() => layoutText(minimal,'A',{capHeight:Number.MAX_VALUE,letterSpacing:Number.MAX_VALUE})).toThrow(/overflow/);
    await expect(loadPlotFont(new ArrayBuffer(32*1024*1024+1))).rejects.toThrow(/32 MB/);
  });
});
describe('SVG and Canvas adapters', () => {
  it('serializes paint intent and escapes caller appearance without app metadata', () => {
    const geometry = layoutText(mixed,'i'), svg = toSVG(geometry,{color:'blue" onload="x'});
    expect(svg).toContain('fill-rule="evenodd"'); expect(svg).toContain('fill="none" stroke="currentColor"');
    expect(svg).toContain('blue&quot; onload=&quot;x'); expect(svg).not.toContain('data-plotfont');
    expect(toSVG(geometry,{unit:'mm'})).toMatch(/width="[\d.]+mm"/);
    expect(() => toSVG(geometry,{strokeWidth:-1})).toThrow(/invalid SVG/);
    expect(() => toSVG(geometry,{width:0})).toThrow(/invalid SVG/);
    expect(() => toCanvasPaths(geometry)).toThrow(/Path2D/);
  });
});
describe('curve flattening', () => {
  const commands = (type: 'Q'|'C', values:number[]):PathCommand[] => [{type:'M',values:[0,0]},{type,values}];
  it('preserves tiny strokes, loops, reversals, order, and explicit closure', () => {
    expect(flattenContour([{type:'M',values:[0,0]},{type:'L',values:[.001,0]}])).toHaveLength(2);
    const loop = flattenContour(commands('C',[10,10,-10,10,0,0]));
    expect(loop.length).toBeGreaterThan(20); expect(loop.at(-1)).toEqual({x:0,y:0});
    const reverse = flattenContour(commands('C',[10,0,-10,0,.001,0]));
    expect(Math.max(...reverse.map(p=>p.x))).toBeGreaterThan(2); expect(Math.min(...reverse.map(p=>p.x))).toBeLessThan(-2);
    expect(flattenContour([{type:'M',values:[0,0]},{type:'L',values:[1,1]},{type:'Z',values:[]}]).at(-1)).toEqual({x:0,y:0});
    expect(flattenContour(commands('Q',[1,1,2,0]),.001).length).toBeGreaterThan(flattenContour(commands('Q',[1,1,2,0]),.1).length);
  });
  it('rejects unsupported commands, multiple moves, bad tolerance and complexity', () => {
    expect(() => flattenContour([{type:'A',values:[]}])).toThrow(/Unsupported/);
    expect(() => flattenContour([{type:'M',values:[0,0]},{type:'M',values:[1,1]}])).toThrow(/multiple moves/);
    expect(() => flattenContour([],0)).toThrow(/positive/);
    expect(() => flattenContour(commands('C',[1,1,-1,1,0,0]),Number.MIN_VALUE)).toThrow(/accuracy/);
  });
});
