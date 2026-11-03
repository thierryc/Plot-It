import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createOpenPlotFont, layoutText, toSVGPaths, type OpenPlotFontData, type PlotContour } from '@thierryc/openplotfont';
import { defaultTextOptions, registerOpenPlotFont, typographyToItem, type LoadedFont } from './typography';
import { fontChoices } from './font-choices';
import { openPlotFontToItem } from './openplotfont-layout';

// Opt in locally. Never copy private font geometry or licence text into test fixtures.
const directory = process.env.PLOT_PRIVATE_FONT_DIR;
describe.skipIf(!directory)('private Bryan alpha.2 import integrity', () => {
  let font: LoadedFont, raw: OpenPlotFontData;
  beforeAll(async () => {
    const read = (name: string) => readFileSync(join(directory!,name));
    const manifest = JSON.parse(read('MANIFEST.json').toString('utf8'));
    for (const name of ['Bryan-Stroke-DRAFT.opf.json','UPSTREAM-LICENCE.txt']) {
      expect(createHash('sha256').update(read(name)).digest('hex')).toBe(manifest.files[name]);
    }
    const source = read('Bryan-Stroke-DRAFT.opf.json').toString('utf8');
    raw = JSON.parse(source);
    font = await registerOpenPlotFont(source,`openplotfont-${manifest.export.SHA256}`,{
      displayName:'Bryan Stroke — private alpha.2',attribution:manifest.attribution,
      license:{name:'UPSTREAM-LICENCE.txt',text:read('UPSTREAM-LICENCE.txt').toString('utf8')}
    });
  });
  it('keeps every record, mapping, advance, operation, start, closure, annotation and kerning pair unchanged', () => {
    expect(font.openplotfont).toEqual(raw);
    expect(raw.version).toBe('0.3');
    expect(raw.glyphs).toHaveLength(515);
    expect(raw.kerning).toHaveLength(205);
    const operations = raw.glyphs.flatMap(g=>g.strokes);
    expect(operations).toHaveLength(936);
    expect(operations.flatMap(op=>op.kind==='fill'?op.contours:[op]).flatMap(c=>c.commands).filter(c=>c[0]==='C')).toHaveLength(2215);
    expect(font.prepared?.hasOpenTypeLayout).toBe(false);
    expect(font.features).toEqual([]);
    expect(font.bundled).toBeUndefined();
    expect(fontChoices().find(choice=>choice.id===font.id)).toMatchObject({name:'Bryan Stroke — private alpha.2',collection:'Your fonts',drawing:'mixed'});
  });
  it('renders the requested specimen with stored spacing and kerning, without automatic alternates', () => {
    const text = 'hull lull hello usually 0123456789 Café';
    const item = typographyToItem(text,8,{...defaultTextOptions,fontId:font.id});
    const geometry = layoutText(font.prepared!,text,{...defaultTextOptions,capHeight:1.4});
    expect([...item.markup.matchAll(/ d="([^"]+)"/g)].map(m=>m[1])).toEqual(toSVGPaths(geometry).map(p=>p.d));
    expect(raw.glyphs.find(g=>g.unicodes.includes('0033'))?.name).toBe('three');
    const three = raw.glyphs.find(g=>g.name==='three.osf')!;
    expect(three.unicodes).toEqual([]);
    expect(three.advanceWidth).toBe(628);
    expect(three.strokes).toHaveLength(1);
    expect(three.strokes[0]).toMatchObject({kind:'stroke',closed:false});
    expect(()=>layoutText(font.prepared!,'3',{features:'onum=1'})).toThrow('no OpenType layout');
    const pair = raw.kerning![0]!;
    const glyph = (name:string)=>raw.glyphs.find(g=>g.name===name)!;
    const pairText = [pair.left,pair.right].map(name=>String.fromCodePoint(parseInt(glyph(name).unicodes[0]!,16))).join('');
    expect(layoutText(font.prepared!,pairText,{capHeight:raw.metrics.capHeight}).lineAdvances[0]).toBe(glyph(pair.left).advanceWidth+glyph(pair.right).advanceWidth+pair.value);
  });
  it('renders every independent stroke and explicit closure in source order, including unencoded glyphs in isolated proofs', () => {
    // Only temporary proof fixtures assign a test character; the imported font stays untouched.
    const transform = (c:PlotContour)=>[...c.commands.map(([type,...values])=>({type,values:values.map((v,i)=>i%2?-v:v)})),...(c.closed?[{type:'Z',values:[]}]:[])];
    for (const glyph of raw.glyphs.filter(g=>g.strokes.length)) {
      const proof = createOpenPlotFont({...raw,kerning:[],missingGlyph:glyph.name,glyphs:[{...glyph,unicodes:['0041']}]});
      const geometry = layoutText(proof,'A',{capHeight:raw.metrics.capHeight});
      expect(geometry.operations,glyph.name).toEqual(glyph.strokes.map(op=>op.kind==='fill'
        ? {kind:'fill',fillRule:op.fillRule,contours:op.contours.map(c=>({closed:c.closed,commands:transform(c)}))}
        : {kind:'stroke',contour:{closed:op.closed,commands:transform(op)}}));
    }
    const missing = raw.glyphs.find(g=>g.name==='.notdef')!, h = raw.glyphs.find(g=>g.name==='h')!;
    const proof = createOpenPlotFont({...raw,kerning:[],glyphs:[{...missing,unicodes:['0058']},{...h,unicodes:['0041']}]});
    const item = openPlotFontToItem(proof,'XA',8,defaultTextOptions);
    expect(item.markup).toContain('data-openplotfont-kind="stroke"');
    expect(item.markup).toContain('fill-rule="nonzero"');
    expect(item.markup.match(/data-openplotfont-kind="fill"/g)).toHaveLength(1);
    expect(item.markup.match(/Z/g)).toHaveLength(10);
    expect(font.openplotfont).toEqual(raw);
  });
});
