import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadOpenPlotFont, layoutText, toSVG } from '@thierryc/openplotfont';
// @ts-ignore Offline migration script has no TypeScript declaration.
import { migrateOpenPlotFont } from '../scripts/migrate-openplotfont.mjs';
const fixture = readFileSync(new URL('./test-fonts/openplotfont/mixed.opf.json', import.meta.url), 'utf8');
const legacy = () => {
  const data = JSON.parse(fixture); data.format = 'PlotFont'; data.version = '0.2';
  data.glyphs[0].userData = {'org.plotfont.authoring': {note: 'preserve this note'}};
  return data;
};
describe('explicit offline identity migration', () => {
  it('preserves draft version, all drawing operations, metadata values, layout, scaling and SVG output', async () => {
    const old = legacy();
    const bytes = await migrateOpenPlotFont(JSON.stringify(old));
    const migrated = await loadOpenPlotFont(bytes);
    expect(migrated.data.version).toBe('0.2');
    expect(migrated.data.glyphs.map(g => g.strokes)).toEqual(old.glyphs.map((g: {strokes: unknown}) => g.strokes));
    expect(JSON.parse(bytes.toString()).glyphs[0].userData).toEqual({'org.openplotfont.authoring': {note: 'preserve this note'}});
    const current = await loadOpenPlotFont(fixture);
    for (const capHeight of [1, 8, 20]) expect(toSVG(layoutText(migrated, 'ii\ni', {capHeight})))
      .toBe(toSVG(layoutText(current, 'ii\ni', {capHeight})));
  });
  it('rejects namespace collisions rather than losing metadata', async () => {
    const old = legacy(); old.glyphs[0].userData['org.openplotfont.authoring'] = {note: 'another note'};
    await expect(migrateOpenPlotFont(JSON.stringify(old))).rejects.toThrow(/Conflicting/);
  });
  it('rewrites embedded font hashes and document references without changing stored geometry or copy', async () => {
    const old = Buffer.from(JSON.stringify(legacy()));
    const id = 'plotfont-' + createHash('sha256').update(old).digest('hex');
    const markup = '<path data-plotfont-kind="stroke" d="M0 0 C1 2 3 4 5 6"/>';
    const doc = {format: 'plot-it', version: 1, document: {items: [
      {markup, width: 28, height: 14, rotation: 30, text: {content: 'ii', format: 'plotfont', options: {fontId: id}}}
    ]}, fonts: [{id, name: 'mixed.plotfont.json', format: 'plotfont', encoding: 'base64', data: old.toString('base64')}]};
    const result = JSON.parse((await migrateOpenPlotFont(JSON.stringify(doc))).toString());
    const font = result.fonts[0], item = result.document.items[0];
    expect(font.id).toBe('openplotfont-' + createHash('sha256').update(Buffer.from(font.data, 'base64')).digest('hex'));
    expect(item.text.options.fontId).toBe(font.id); expect(item.text.content).toBe('ii');
    expect(item.text.format).toBe('openplotfont'); expect(font.name).toBe('mixed.opf.json');
    expect(item.markup).toBe(markup.replace('data-plotfont-kind', 'data-openplotfont-kind'));
    expect([item.width, item.height, item.rotation]).toEqual([28, 14, 30]);
    doc.fonts[0]!.id = 'plotfont-' + '0'.repeat(64);
    await expect(migrateOpenPlotFont(JSON.stringify(doc))).rejects.toThrow(/identity/);
  });
});
