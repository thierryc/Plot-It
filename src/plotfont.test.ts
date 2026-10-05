import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultTextOptions, fontTextOptions, findFont, initializeTypography, registerPlotFont, typographyToItem, editTypography } from './typography';
import { optimizePlotPaths } from './svg';
import { parsePath } from './editor';
import regression from './test-fonts/plotfont/app-regression.json';
const source = (name: string) => readFileSync(new URL(`./test-fonts/plotfont/${name}.plotfont.json`, import.meta.url), 'utf8');
beforeAll(async () => {
  await initializeTypography();
  for (const name of ['layout-demo', 'minimal', 'mixed', 'script']) await registerPlotFont(source(name), name);
});
describe('PlotFont app adapter', () => {
  it.each(regression)('preserves pre-extraction geometry and physical sizing: $fontId', test => {
    const options = { ...fontTextOptions(findFont(test.fontId)!, defaultTextOptions), ...test.options };
    const item = typographyToItem(test.text, 7, options as typeof defaultTextOptions);
    expect({markup:item.markup,viewBox:item.viewBox,width:item.width,height:item.height}).toEqual(test.expected);
  });
  it('preserves glyph order and direction during travel optimization', () => {
    const points = (a:number,b:number) => [{x:a,y:0},{x:b,y:0}];
    const paths = [{points:points(20,10),tool:'black',orderGroup:'text'}, {points:points(2,1),tool:'black',orderGroup:'text'}, {points:points(1,0),tool:'black'}];
    const result = optimizePlotPaths(paths,true);
    expect(result.filter(p=>p.orderGroup).map(p=>p.points)).toEqual([points(20,10),points(2,1)]);
    expect(paths[0]!.points).toEqual(points(20,10));
  });
  it('keeps curves, independent strokes, copy, and transforms through edits', () => {
    const item = typographyToItem('un', 7, { ...defaultTextOptions, fontId: 'script' });
    expect(item.markup).toMatch(/[QC]/);
    item.width *= 2; item.x = 34; item.rotation = 15;
    const sx = item.width / item.viewBox[2], sy = item.height / item.viewBox[3];
    editTypography(item, 'nu');
    expect(item.width / item.viewBox[2]).toBeCloseTo(sx); expect(item.height / item.viewBox[3]).toBeCloseTo(sy);
    expect([item.x, item.rotation, item.text?.content]).toEqual([34,15,'nu']);
    expect(item.markup.match(/<path/g)).toHaveLength(2);
  });
  it('preserves compound-fill metadata for plot toolpath generation', () => {
    const item = typographyToItem('i', 7, {...defaultTextOptions,fontId:'mixed'});
    expect(item.markup).toContain('data-plotfont-kind="stroke"');
    expect(item.markup).toContain('data-plotfont-kind="fill"');
    expect(item.markup).toContain('fill-rule="evenodd"');
    expect([...item.markup.matchAll(/ d="([^"]+)"/g)].flatMap(m => parsePath(m[1]!)).filter(c => c.type === 'Z')).toHaveLength(2);
  });
  it('rejects failed edits atomically and keeps variable axes unsupported', () => {
    const item = typographyToItem('A', 7, {...defaultTextOptions,fontId:'layout-demo'}), before = structuredClone(item);
    expect(() => editTypography(item, '☃')).toThrow(/missing/); expect(item).toEqual(before);
    expect(() => editTypography(item, 'A', 7, {...defaultTextOptions,fontId:'layout-demo',variations:'wght=800'})).toThrow(/static/);
  });
});
