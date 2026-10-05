import type { ArtworkItem, TextOptions } from './model';
import { makeId } from './model';
import { markupRoot, parsePath, pathData, type PathCommand } from './editor';
import { isOutlineGlyph, OUTLINE_GLYPH_ATTRIBUTE, OUTLINE_VERSION_ATTRIBUTE } from './outline-source';
import { textToItem } from './plot-font';
import { createPlotFont, loadPlotFont, parsePlotFont, type PlotFontData, type PlotFont } from '@thierryc/plotfont';
import { plotFontToItem } from './plotfont-layout';
import type * as HB from 'harfbuzzjs';
import hersheySource from './fonts/hershey-roman-simplex.plotfont.json?raw';
import duplexSource from './fonts/hershey-roman-duplex.plotfont.json?raw';
import triplexSource from './fonts/hershey-roman-triplex.plotfont.json?raw';
import scriptSource from './fonts/hershey-script-simplex.plotfont.json?raw';
import layoutDemoSource from './fonts/plotfont-layout-demo.plotfont.json?raw';
import spaceRocksSource from './fonts/pf-ems-spacerocks.plotfont.json?raw';
import catalog from './fonts/catalog.json';
import type { EmbeddedFont } from './document-file';

let hb: typeof HB;
let initialization: Promise<void> | undefined;
export function initializeTypography(): Promise<void> {
  return initialization ??= import('harfbuzzjs').then(async module => {
    const prepared = await Promise.all([...fonts.values()].filter(f => f.bundled && f.plotfont?.layout).map(async font => ({
      font, prepared: await loadPlotFont(JSON.stringify(font.plotfont))
    })));
    hb = module;
    for (const result of prepared) result.font.prepared = result.prepared;
  }).catch(error => { initialization = undefined; throw error; });
}
export interface LoadedFont { id: string; name: string; features: string[]; axes: Record<string, HB.AxisInfo>; face?: HB.Face; plotfont?: PlotFontData; prepared?: PlotFont; bundled?: boolean; noticeUrl?: string; kind?: 'plotfont' | 'outline'; group?: string; coverageHint?: string }
interface BundledFontAsset { id: string; name: string; kind: 'plotfont' | 'outline'; group: string; url: string; noticeUrl: string; sha256: string; coverageHint: string }
export const bundledFontCatalog = catalog as BundledFontAsset[];
export const DEFAULT_FONT_ID = 'hershey-roman-simplex';
const bundledSources = [
  [DEFAULT_FONT_ID, hersheySource], ['hershey-roman-duplex', duplexSource],
  ['hershey-roman-triplex', triplexSource], ['hershey-script-simplex', scriptSource],
  ['plotfont-layout-demo', layoutDemoSource], ['pf-ems-spacerocks', spaceRocksSource]
] as const;
const fonts = new Map<string, LoadedFont>(bundledSources.map(([id, source]) => {
  const plotfont = parsePlotFont(source);
  return [id, { id, name: `${plotfont.familyName} ${plotfont.styleName}`, plotfont, prepared: plotfont.layout ? undefined : createPlotFont(plotfont),
    features: plotfont.layout?.features.map(f => f.tag).sort() ?? [], axes: {}, bundled: true, kind: 'plotfont',
    group: id.startsWith('hershey-') ? 'Hershey' : id.startsWith('pf-ems-') ? 'EMS' : 'Other stroke fonts',
    noticeUrl: id.startsWith('hershey-') ? '/fonts/HERSHEY_NOTICE.txt'
      : id === 'pf-ems-spacerocks' ? '/fonts/ems-spacerocks/ATTRIBUTION.txt' : '/fonts/PLOTFONT_LICENSE.txt' }];
}));
for (const asset of bundledFontCatalog) {
  if (!fonts.has(asset.id)) fonts.set(asset.id, { id: asset.id, name: asset.name, kind: asset.kind, group: asset.group,
    bundled: true, noticeUrl: asset.noticeUrl, coverageHint: asset.coverageHint, features: [], axes: {} });
}
const pendingFonts = new Map<string, Promise<LoadedFont>>();
/** Download only selected fonts; concurrent selections share one request and failures remain retryable. */
export async function ensureFontLoaded(id: string): Promise<LoadedFont | undefined> {
  const font = findFont(id);
  const asset = bundledFontCatalog.find(entry => entry.id === id);
  if (!font || !asset || font.face || font.prepared) return font;
  const pending = pendingFonts.get(id); if (pending) return pending;
  const request = (async () => {
    try {
      const response = await fetch(`${asset.url}?v=${asset.sha256.slice(0, 16)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      await initializeTypography();
      const loaded = asset.kind === 'plotfont'
        ? await registerPlotFont(new TextDecoder('utf-8', { fatal: true }).decode(bytes), id)
        : registerFont(bytes, asset.name, id);
      Object.assign(loaded, { bundled: true, kind: asset.kind, group: asset.group, noticeUrl: asset.noticeUrl, coverageHint: asset.coverageHint });
      return loaded;
    } catch {
      throw new Error(`Could not load ${asset.name}. Check your connection and select the font again to retry.`);
    } finally { pendingFonts.delete(id); }
  })();
  pendingFonts.set(id, request);
  return request;
}
const hershey = fonts.get(DEFAULT_FONT_ID)!.plotfont!;
export const loadedFonts = (): LoadedFont[] => [...fonts.values()];
export const findFont = (id?: string): LoadedFont | undefined => id ? fonts.get(id) : undefined;
export const defaultTextOptions: TextOptions = {
  fontId: DEFAULT_FONT_ID, letterSpacing: 0, wordSpacing: 0,
  lineHeight: (hershey.metrics.ascender - hershey.metrics.descender + hershey.metrics.lineGap) / hershey.metrics.capHeight,
  align: 'left', kerning: true, ligatures: true, contextual: true,
  features: '', variations: '', direction: 'auto', language: '', script: ''
};
export function textOptions(item?: ArtworkItem): TextOptions {
  // Text saved before font options existed was drawn with Plot Sans.
  const defaults = item?.text && !item.text.options
    ? { ...defaultTextOptions, fontId: 'plot-sans', lineHeight: 1.25 } : defaultTextOptions;
  return { ...defaults, ...item?.text?.options };
}

/** Font bytes live in IndexedDB, outside the document and undo snapshots. */
function fontDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('plot-it-fonts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('fonts', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
interface FontRecord { id: string; name: string; bytes: ArrayBuffer; format?: 'plotfont' }
async function saveFont(record: FontRecord): Promise<void> {
  const db = await fontDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('fonts', 'readwrite'); tx.objectStore('fonts').put(record);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
/** Embed only custom fonts referenced by this document, not the whole library. */
export async function exportDocumentFonts(ids: string[]): Promise<EmbeddedFont[]> {
  const custom = [...new Set(ids)].filter(id => id !== 'plot-sans' && !findFont(id)?.bundled);
  if (!custom.length) return [];
  const db = await fontDatabase();
  try {
    const records = await Promise.all(custom.map(id => new Promise<FontRecord>((resolve, reject) => {
      const request = db.transaction('fonts').objectStore('fonts').get(id);
      request.onsuccess = () => request.result ? resolve(request.result) : reject(new Error(`Load the missing font ${id} before saving this document.`));
      request.onerror = () => reject(request.error);
    })));
    return records.map(record => {
      const bytes = new Uint8Array(record.bytes); let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return {id: record.id, name: record.name, format: record.format ?? 'opentype', encoding: 'base64', data: btoa(binary)};
    });
  } finally { db.close(); }
}
export async function importDocumentFonts(records: EmbeddedFont[]): Promise<void> {
  if (!records.length) return;
  await initializeTypography();
  // Verify all identities before registration/storage, preserving existing fonts.
  const decoded = await Promise.all(records.map(async record => {
    const bytes = Uint8Array.from(atob(record.data), char => char.charCodeAt(0)).buffer;
    const id = `${record.format === 'plotfont' ? 'plotfont-' : ''}${await sha256(bytes)}`;
    if (id !== record.id) throw new Error(`Embedded font ${record.name} does not match its ID.`);
    return {...record, bytes};
  }));
  for (const record of decoded) {
    if (record.format === 'plotfont') await registerPlotFont(new TextDecoder('utf-8', {fatal: true}).decode(record.bytes), record.id);
    else registerFont(record.bytes, record.name, record.id);
    await saveFont({id: record.id, name: record.name, bytes: record.bytes, format: record.format === 'plotfont' ? 'plotfont' : undefined});
  }
}
export async function restoreFonts(usedFontIds: string[] = []): Promise<void> {
  await initializeTypography();
  const bundled = await Promise.allSettled([...new Set(usedFontIds)].map(ensureFontLoaded));
  const db = await fontDatabase();
  try {
    const records = await new Promise<FontRecord[]>((resolve, reject) => {
      const request = db.transaction('fonts').objectStore('fonts').getAll();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    for (const record of records) { try { if (record.format === 'plotfont') await registerPlotFont(new TextDecoder('utf-8', { fatal: true }).decode(record.bytes), record.id); else registerFont(record.bytes, record.name, record.id); } catch { /* Preserve other usable fonts. */ } }
  } finally { db.close(); }
  const failed = bundled.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
export function registerFont(bytes: ArrayBuffer, name: string, id: string): LoadedFont {
  if (!hb) throw new Error('The font engine is still loading.');
  if (bytes.byteLength < 12) throw new Error("This font file is invalid.");
  const signature = new DataView(bytes).getUint32(0);
  if (signature !== 0x00010000 && signature !== 0x4f54544f) throw new Error('Load an OpenType .otf or TrueType .ttf font. Web fonts and collections are not supported.');
  const face = new hb.Face(new hb.Blob(bytes));
  if (!face.referenceTable('cmap') || !face.referenceTable('head') || !(face.referenceTable('glyf') || face.referenceTable('CFF ') || face.referenceTable('CFF2'))) throw new Error('This font has no supported vector outlines.');
  const font = new hb.Font(face);
  const h = font.nominalGlyph(72);
  if (!h || !font.glyphToPath(h)) throw new Error('The font must contain an outline for capital H to set cap height.');
  const family = face.getName(16, 'en') || face.getName(1, 'en') || name;
  const style = face.getName(17, 'en') || face.getName(2, 'en');
  const result: LoadedFont = { id, name: style ? `${family} ${style}` : family, features: [...new Set([...face.getTableFeatureTags('GSUB'), ...face.getTableFeatureTags('GPOS')])].sort(), axes: face.getAxisInfos(), face, kind: 'outline' };
  fonts.set(id, result); return result;
}
export async function loadFontFile(file: File): Promise<LoadedFont> {
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a font smaller than 20 MB.');
  await initializeTypography();
  const bytes = await file.arrayBuffer();
  if (/\.json$/i.test(file.name)) {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const id = `plotfont-${await sha256(bytes)}`, font = await registerPlotFont(source, id);
    try { await saveFont({ id, name: file.name, bytes, format: 'plotfont' }); }
    catch { fonts.delete(id); throw new Error('Could not save the PlotFont in browser storage.'); }
    return font;
  }
  if (bytes.byteLength < 12) throw new Error('This font file is invalid.');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const id = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  const font = registerFont(bytes, file.name, id);
  try { await saveFont({ id, name: file.name, bytes }); }
  catch { fonts.delete(id); throw new Error('Could not save the font in browser storage. Check available storage and try again.'); }
  return font;
}

export async function registerPlotFont(source: string, id: string): Promise<LoadedFont> {
  const prepared = await loadPlotFont(source), plotfont = prepared.data;
  const result: LoadedFont = { id, name: `${plotfont.familyName} ${plotfont.styleName}`, axes: {},
    features: [...prepared.features], plotfont, prepared, kind: 'plotfont' };
  fonts.set(id, result); return result;
}
export function fontTextOptions(font: LoadedFont, options: TextOptions): TextOptions {
  const m = font.plotfont?.metrics;
  return { ...options, fontId: font.id, features: '', variations: '',
    lineHeight: m ? (m.ascender - m.descender + m.lineGap) / m.capHeight : options.lineHeight };
}

export function validateTextOptions(options: TextOptions): void {
  if (![options.letterSpacing, options.wordSpacing, options.lineHeight].every(Number.isFinite) || options.lineHeight <= 0) throw new Error('Spacing must be finite and line height must be positive.');
  if (!['left', 'center', 'right'].includes(options.align) || !['auto', 'ltr', 'rtl'].includes(options.direction)) throw new Error('Invalid text alignment or direction.');
  if (options.script && !/^[A-Za-z]{4}$/.test(options.script)) throw new Error('Use a four-letter script code, such as Latn or Arab.');
  if (options.language && !/^[a-zA-Z0-9-]+$/.test(options.language)) throw new Error('Use a language code, such as en or tr.');
}
export function splitContours(commands: PathCommand[]): PathCommand[][] {
  const contours: PathCommand[][] = [];
  for (const command of commands) {
    if (command.type === 'M') contours.push([]);
    contours.at(-1)?.push(command);
  }
  return contours;
}
export function typographyToItem(content: string, capHeightMm: number, options: TextOptions): ArtworkItem {
  return createTypographyItem(content, capHeightMm, options);
}
function createTypographyItem(content: string, capHeightMm: number, options: TextOptions, legacy = false): ArtworkItem {
  if (!content.trim()) throw new Error('Enter some text.');
  if (!Number.isFinite(capHeightMm) || capHeightMm <= 0) throw new Error('Cap height must be positive.');
  validateTextOptions(options);
  if (options.fontId === 'plot-sans') return textToItem(content, capHeightMm, options);
  const loaded = findFont(options.fontId);
  if (!loaded) throw new Error('This font is unavailable. Load the original font again to edit this text.');
  if (loaded.bundled && !loaded.plotfont && !loaded.face) throw new Error('This font is still loading. Try again in a moment.');
  if (loaded.plotfont && !loaded.prepared) throw new Error('The font engine is still loading. Try again in a moment.');
  if (loaded.plotfont) return plotFontToItem(loaded.prepared!, content, capHeightMm, options);
  if (!loaded.face) throw new Error('This font has no shaping data.');
  const face = loaded.face;
  const font = new hb.Font(face);
  const variations = options.variations.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const variation = hb.Variation.fromString(s);
    if (!variation || !Number.isFinite(variation.value)) throw new Error(`Invalid variation: ${s}. Use wght=700, wdth=100.`);
    const axis = loaded.axes[variation.tag];
    if (!axis || variation.value < axis.min || variation.value > axis.max) throw new Error(`Variation ${variation.tag} is unavailable or outside the font's range.`);
    return variation;
  });
  font.setVariations(variations);
  const cap = font.glyphExtents(font.nominalGlyph(72)!)?.yBearing || face.upem * .7;
  const scale = 1.4 / cap;
  const features = [new hb.Feature('kern', Number(options.kerning)), new hb.Feature('liga', Number(options.ligatures)), new hb.Feature('clig', Number(options.ligatures)), new hb.Feature('calt', Number(options.contextual))];
  // Tracking suppresses optional ligatures unless explicitly requested in Features.
  if (options.letterSpacing) features.push(new hb.Feature('liga', 0), new hb.Feature('clig', 0));
  for (const token of options.features.split(',').map(s => s.trim()).filter(Boolean)) {
    const feature = hb.Feature.fromString(token);
    if (!feature || !/^[\x20-\x7e]{4}$/.test(feature.tag)) throw new Error(`Invalid feature: ${token}. Use smcp=1, ss01=1, salt=2.`);
    features.push(feature);
  }
  const lines = content.replace(/\r\n?/g, '\n').split('\n').map(line => {
    const buffer = new hb.Buffer(); buffer.addText(line);
    if (options.direction !== 'auto') buffer.setDirection(options.direction === 'rtl' ? hb.Direction.RTL : hb.Direction.LTR);
    if (options.language) buffer.setLanguage(options.language);
    if (options.script) buffer.setScript(options.script);
    buffer.guessSegmentProperties(); hb.shape(font, buffer, features);
    const infos = buffer.getGlyphInfos(), positions = buffer.getGlyphPositions();
    if (infos.some(g => g.codepoint === 0)) throw new Error('The selected font is missing characters in this text. Choose another font.');
    let x = 0, y = 0;
    const paths: PathCommand[][][] = [];
    const cursive = /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Mongolian}]/u.test(line);
    infos.forEach((info, i) => {
      const pos = positions[i]!;
      const outline = font.glyphToPath(info.codepoint);
      const commands = parsePath(outline).map(command => ({ type: command.type, values: command.values.map((v, n) => n % 2 ? -(v + y + pos.yOffset) * scale : (v + x + pos.xOffset) * scale) }));
      paths.push(splitContours(commands));
      x += pos.xAdvance; y += pos.yAdvance;
      if (infos[i + 1]?.cluster !== info.cluster && i + 1 < infos.length && !cursive) x += options.letterSpacing * face.upem;
      // Buffer.addText uses UTF-16 cluster indices.
      if ((line[info.cluster] === ' ' || line[info.cluster] === '\u00a0') && infos[i + 1]?.cluster !== info.cluster) x += options.wordSpacing * face.upem;
    });
    return { paths, width: x * scale };
  });
  const maxWidth = Math.max(...lines.map(l => l.width), .01);
  const commands: string[] = [];
  let minX = 0, maxX = maxWidth, minY = -1.4, maxY = (lines.length - 1) * options.lineHeight * 1.4;
  lines.forEach((line, row) => {
    const dx = (maxWidth - line.width) * (options.align === 'right' ? 1 : options.align === 'center' ? .5 : 0);
    const dy = row * options.lineHeight * 1.4;
    for (const [glyph, contours] of line.paths.entries()) {
      const glyphPaths: string[] = [];
      for (const contour of contours) {
        const transformed = contour.map(c => ({ type: c.type, values: c.values.map((v, n) => v + (n % 2 ? dy : dx)) }));
        for (const c of transformed) for (let i = 0; i < c.values.length; i += 2) {
          minX = Math.min(minX, c.values[i]!); maxX = Math.max(maxX, c.values[i]!);
          minY = Math.min(minY, c.values[i + 1]!); maxY = Math.max(maxY, c.values[i + 1]!);
        }
        if (legacy) commands.push(`<path d="${pathData(transformed)}"/>`);
        else glyphPaths.push(pathData(transformed));
      }
      if (glyphPaths.length) commands.push(`<path ${OUTLINE_VERSION_ATTRIBUTE}="1" ${OUTLINE_GLYPH_ATTRIBUTE}="${row}-${glyph}" fill-rule="nonzero" d="${glyphPaths.join(' ')}"/>`);
    }
  });
  if (!commands.length) throw new Error('This text contains no plottable outlines.');
  const width = Math.max(.01, maxX - minX), height = Math.max(.01, maxY - minY);
  return { id: makeId('text'), name: content.trim().slice(0, 24), markup: commands.join(''), viewBox: [minX, minY, width, height], x: 20, y: 20, width: width * capHeightMm / 1.4, height: height * capHeightMm / 1.4, rotation: 0, stroke: '#000000', text: { content, options: { ...options } } };
}
/** Verify legacy source before replacing it: node edits and element overrides win. */
export function migrateOutlineText(item: ArtworkItem): {replacement?: ArtworkItem; notice?: string} {
  const id = item.text?.options?.fontId;
  if (!id || id === 'plot-sans' || item.text?.format === 'plotfont' || findFont(id)?.plotfont || findFont(id)?.kind === 'plotfont') return {};
  const notice = `${item.name}: Perimeter cleanup was not applied; stored outlines were preserved. Reload the font or edit the text to regenerate.`;
  const root = markupRoot(item.markup), paths = [...root.children];
  if (paths.length && paths.every(isOutlineGlyph)) return {};
  try {
    if (!findFont(id)?.face) return {notice};
    const legacy = createTypographyItem(item.text!.content, 1, textOptions(item), true);
    const original = [...markupRoot(legacy.markup).children];
    const matches = paths.length === original.length && paths.every((p, i) => {
      const untouched = [...p.attributes].every(a => a.name === 'd' || (a.name === 'xmlns' && a.value === 'http://www.w3.org/2000/svg'));
      return p.localName === 'path' && untouched && p.hasAttribute('d') &&
        JSON.stringify(parsePath(p.getAttribute('d')!)) === JSON.stringify(parsePath(original[i]!.getAttribute('d')!));
    });
    if (!matches || item.viewBox.some((v, i) => Math.abs(v - legacy.viewBox[i]!) > 1e-6)) return {notice};
    const replacement = createTypographyItem(item.text!.content, 1, textOptions(item));
    return {replacement: {...item, markup: replacement.markup}};
  } catch { return {notice}; }
}
export function editTypography(item: ArtworkItem, content: string, capHeightMm?: number, options = textOptions(item)): void {
  const sx = item.width / item.viewBox[2], sy = item.height / item.viewBox[3];
  const replacement = typographyToItem(content, capHeightMm ?? sy * 1.4, options);
  Object.assign(item, { markup: replacement.markup, viewBox: replacement.viewBox, text: replacement.text,
    width: replacement.viewBox[2] * (capHeightMm === undefined ? sx : capHeightMm / 1.4), height: replacement.height });
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
