import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parsePlotFont } from '@thierryc/plotfont';
import catalog from './fonts/catalog.json';
import { bundledFontCatalog, defaultTextOptions, ensureFontLoaded, findFont, fontTextOptions, loadedFonts, typographyToItem } from './typography';

const assetBytes = (url: string) => readFileSync(`public${url.split('?')[0]}`);
const serveAssets = () => vi.fn(async (url: string) => new Response(assetBytes(url)));
afterEach(() => vi.unstubAllGlobals());

describe('complete font menu and lazy assets', () => {
  it('lists the complete stroke library and outline families before downloading them', () => {
    expect(bundledFontCatalog).toHaveLength(90);
    expect(new Set(loadedFonts().map(font => font.id)).size).toBe(91);
    expect(catalog.filter(font => font.group === 'EMS')).toHaveLength(29);
    expect(findFont('pf-ems-readability')?.prepared).toBeUndefined();
    expect(findFont('inter')?.face).toBeUndefined();
    expect(findFont('square-bot-sans')?.bundled).toBe(true);
  });

  it('ships valid fonts, digest-matched assets, notices, and source licenses for every entry', () => {
    for (const entry of catalog) {
      const bytes = assetBytes(entry.url);
      expect(createHash('sha256').update(bytes).digest('hex'), entry.id).toBe(entry.sha256);
      expect(existsSync(`public${entry.noticeUrl}`), entry.id).toBe(true);
      if (entry.kind === 'plotfont') {
        const font = parsePlotFont(bytes.toString('utf8'));
        for (const notice of font.metadata?.licenseFiles as string[] ?? []) {
          expect(existsSync(`public/fonts/library/${entry.id}/${notice}`), `${entry.id}: ${notice}`).toBe(true);
        }
      }
    }
  });

  it('shares concurrent requests and uses the prepared font again without fetching', async () => {
    const fetcher = serveAssets(); vi.stubGlobal('fetch', fetcher);
    const [first, second] = await Promise.all([ensureFontLoaded('pf-ems-delight'), ensureFontLoaded('pf-ems-delight')]);
    expect(first).toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await ensureFontLoaded('pf-ems-delight')).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps failed selections retryable without replacing the catalog entry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unavailable', {status: 503})));
    await expect(ensureFontLoaded('pf-ems-osmotron')).rejects.toThrow(/select the font again/);
    expect(findFont('pf-ems-osmotron')?.prepared).toBeUndefined();
    vi.stubGlobal('fetch', serveAssets());
    expect((await ensureFontLoaded('pf-ems-osmotron'))?.prepared).toBeDefined();
  });

  it('loads and renders every stroke entry, including temporary private-use repertoires', async () => {
    vi.stubGlobal('fetch', serveAssets());
    for (const entry of catalog.filter(font => font.kind === 'plotfont')) {
      const font = (await ensureFontLoaded(entry.id))!;
      const glyph = font.plotfont!.glyphs.find(glyph => glyph.unicodes.length && glyph.strokes.length);
      expect(glyph, entry.id).toBeDefined();
      const item = typographyToItem(String.fromCodePoint(parseInt(glyph!.unicodes[0]!, 16)), 8, fontTextOptions(font, defaultTextOptions));
      expect(item.text?.format, entry.id).toBe('plotfont');
      expect(item.width, entry.id).toBeGreaterThan(0);
      expect(item.markup, entry.id).toContain('<path');
      expect(font.bundled, entry.id).toBe(true);
    }
  }, 30000);

  it('uses original Inter and Square Bot Sans outlines and variable axes', async () => {
    vi.stubGlobal('fetch', serveAssets());
    for (const id of ['inter', 'inter-italic', 'square-bot-sans']) {
      const font = (await ensureFontLoaded(id))!;
      expect(font.face, id).toBeDefined();
      expect(font.plotfont, id).toBeUndefined();
      expect(font.axes.wght, id).toBeDefined();
      const options = fontTextOptions(font, defaultTextOptions);
      const light = typographyToItem('Abc fi 123 é', 8, {...options, variations: 'wght=300'});
      const bold = typographyToItem('Abc fi 123 é', 8, {...options, variations: 'wght=700'});
      expect(light.markup, id).not.toEqual(bold.markup);
      expect(light.text?.options?.fontId).toBe(id);
      expect(light.markup).toContain('Z');
    }
    expect(findFont('square-bot-sans')!.axes.wdth?.default).toBe(100);
    expect(findFont('square-bot-sans')!.axes.ital).toBeDefined();
  });
});
