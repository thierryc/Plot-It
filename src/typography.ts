import { sliceVariationRanges, validateVariationRanges, variationRuns } from './text-variation-ranges';
import { sliceFeatureRanges, validateFeatureRanges } from '@thierryc/openplotfont';
import { MAX_IMPORT_FONT_BYTES } from './font-limits';
import { publicAssetUrl } from './app-deployment';
import type { ArtworkItem, TextFrame, TextOptions } from './model';
import { normalizeTextLineBreaks, wrapTextLines } from './text-wrap';
import { makeId } from './model';
import { markupRoot, parsePath, pathData, type PathCommand } from './editor';
import { isOutlineGlyph, OUTLINE_GLYPH_ATTRIBUTE, OUTLINE_VERSION_ATTRIBUTE } from './outline-source';
import { textToItem } from './plot-font';
import { createOpenPlotFont, loadOpenPlotFont, parseOpenPlotFont, type OpenPlotFontData, type OpenPlotFont } from '@thierryc/openplotfont';
import { openPlotFontToItem } from './openplotfont-layout';
import type * as HB from 'harfbuzzjs';
import hersheySource from './fonts/hershey-roman-simplex.opf.json?raw';
import duplexSource from './fonts/hershey-roman-duplex.opf.json?raw';
import triplexSource from './fonts/hershey-roman-triplex.opf.json?raw';
import scriptSource from './fonts/hershey-script-simplex.opf.json?raw';
import layoutDemoSource from './fonts/openplotfont-layout-demo.opf.json?raw';
import spaceRocksSource from './fonts/pf-ems-spacerocks.opf.json?raw';
import catalog from './fonts/catalog.json';
import type { EmbeddedFont } from './document-file';
import { fontImportMetadata, type FontImportMetadata } from './font-metadata';

let hb: typeof HB;
let initialization: Promise<void> | undefined;
export function initializeTypography(): Promise<void> {
  return initialization ??= import('harfbuzzjs').then(async module => {
    const prepared = await Promise.all([...fonts.values()].filter(f => f.bundled && f.openplotfont?.layout).map(async font => ({
      font, prepared: await loadOpenPlotFont(JSON.stringify(font.openplotfont))
    })));
    hb = module;
    for (const result of prepared) result.font.prepared = result.prepared;
  }).catch(error => { initialization = undefined; throw error; });
}
export interface LoadedFont { id: string; name: string; features: string[]; axes: Record<string, HB.AxisInfo>; face?: HB.Face; openplotfont?: OpenPlotFontData; prepared?: OpenPlotFont; bundled?: boolean; noticeUrl?: string; kind?: 'openplotfont' | 'outline'; group?: string; coverageHint?: string; metadata?: FontImportMetadata }
interface BundledFontAsset { id: string; name: string; kind: 'openplotfont' | 'outline'; group: string; url: string; noticeUrl: string; sha256: string; coverageHint: string }
export const bundledFontCatalog = catalog.map(asset => ({...asset, url: publicAssetUrl(asset.url), noticeUrl: publicAssetUrl(asset.noticeUrl)})) as BundledFontAsset[];
export const DEFAULT_FONT_ID = 'hershey-roman-simplex';
const bundledSources = [
  [DEFAULT_FONT_ID, hersheySource], ['hershey-roman-duplex', duplexSource],
  ['hershey-roman-triplex', triplexSource], ['hershey-script-simplex', scriptSource],
  ['openplotfont-layout-demo', layoutDemoSource], ['pf-ems-spacerocks', spaceRocksSource]
] as const;
const fonts = new Map<string, LoadedFont>(bundledSources.map(([id, source]) => {
  const openplotfont = parseOpenPlotFont(source);
  return [id, { id, name: `${openplotfont.familyName} ${openplotfont.styleName}`, openplotfont, prepared: openplotfont.layout ? undefined : createOpenPlotFont(openplotfont),
    features: openplotfont.layout?.features.map(f => f.tag).sort() ?? [], axes: {}, bundled: true, kind: 'openplotfont',
    group: id.startsWith('hershey-') ? 'Hershey' : id.startsWith('pf-ems-') ? 'EMS' : 'Other stroke fonts',
    noticeUrl: publicAssetUrl(id.startsWith('hershey-') ? '/fonts/HERSHEY_NOTICE.txt'
      : id === 'pf-ems-spacerocks' ? '/fonts/ems-spacerocks/ATTRIBUTION.txt' : '/fonts/OPENPLOTFONT_LICENSE.txt') }];
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
      const loaded = asset.kind === 'openplotfont'
        ? await registerOpenPlotFont(new TextDecoder('utf-8', { fatal: true }).decode(bytes), id)
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
const hershey = fonts.get(DEFAULT_FONT_ID)!.openplotfont!;
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
interface FontRecord { id: string; name: string; bytes: ArrayBuffer; format?: 'openplotfont'; metadata?: FontImportMetadata }
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
      return {id: record.id, name: record.name, format: record.format ?? 'opentype', encoding: 'base64', data: btoa(binary), ...(record.metadata ? {metadata: record.metadata} : {})};
    });
  } finally { db.close(); }
}
export async function importDocumentFonts(records: EmbeddedFont[]): Promise<void> {
  if (!records.length) return;
  await initializeTypography();
  // Verify all identities before registration/storage, preserving existing fonts.
  const decoded = await Promise.all(records.map(async record => {
    const bytes = Uint8Array.from(atob(record.data), char => char.charCodeAt(0)).buffer;
    const id = `${record.format === 'openplotfont' ? 'openplotfont-' : ''}${await sha256(bytes)}`;
    if (id !== record.id) throw new Error(`Embedded font ${record.name} does not match its ID.`);
    return {...record, bytes, metadata: fontImportMetadata(record.metadata === undefined ? findFont(id)?.metadata : record.metadata)};
  }));
  for (const record of decoded) {
    await registerStoredFont(record);
    await saveFont({id: record.id, name: record.name, bytes: record.bytes, format: record.format === 'openplotfont' ? 'openplotfont' : undefined, metadata: record.metadata});
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
    for (const record of records) { try { await registerStoredFont(record); } catch { /* Preserve other usable fonts. */ } }
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
export async function loadFontFile(file: File, companion?: FontImportMetadata): Promise<LoadedFont> {
  if (file.size > MAX_IMPORT_FONT_BYTES) throw new Error('Choose a font smaller than 64 MB.');
  const metadata = fontImportMetadata(companion);
  await initializeTypography();
  const bytes = await file.arrayBuffer();
  if (/\.opf(?:\.json)?$/i.test(file.name)) {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const id = `openplotfont-${await sha256(bytes)}`, retained = metadata ?? findFont(id)?.metadata;
    const font = await registerOpenPlotFont(source, id, retained);
    try { await saveFont({ id, name: file.name, bytes, format: 'openplotfont', metadata: retained }); }
    catch { fonts.delete(id); throw new Error('Could not save the OpenPlotFont in browser storage.'); }
    return font;
  }
  if (!/\.(?:otf|ttf)$/i.test(file.name)) throw new Error('Choose an OpenPlotFont .opf or .opf.json, OpenType .otf, or TrueType .ttf file.');
  if (bytes.byteLength < 12) throw new Error('This font file is invalid.');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const id = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  const retained = metadata ?? findFont(id)?.metadata;
  const font = applyFontMetadata(registerFont(bytes, file.name, id), retained);
  try { await saveFont({ id, name: file.name, bytes, metadata: retained }); }
  catch { fonts.delete(id); throw new Error('Could not save the font in browser storage. Check available storage and try again.'); }
  return font;
}

function applyFontMetadata(font: LoadedFont, metadata?: FontImportMetadata): LoadedFont {
  if (metadata) {
    font.metadata = metadata;
    if (metadata.displayName) font.name = metadata.displayName;
  }
  return font;
}
async function registerStoredFont(record: Omit<FontRecord, 'format'> & {format?: 'openplotfont' | 'opentype'}): Promise<LoadedFont> {
  const metadata = fontImportMetadata(record.metadata);
  return record.format === 'openplotfont'
    ? registerOpenPlotFont(new TextDecoder('utf-8', {fatal: true}).decode(record.bytes), record.id, metadata)
    : applyFontMetadata(registerFont(record.bytes, record.name, record.id), metadata);
}
export async function registerOpenPlotFont(source: string, id: string, companion?: FontImportMetadata): Promise<LoadedFont> {
  const metadata = fontImportMetadata(companion);
  const prepared = await loadOpenPlotFont(source, {maxBytes: MAX_IMPORT_FONT_BYTES}), openplotfont = prepared.data;
  const result: LoadedFont = { id, name: `${openplotfont.familyName} ${openplotfont.styleName}`, axes: {},
    features: [...prepared.features], openplotfont, prepared, kind: 'openplotfont' };
  applyFontMetadata(result, metadata);
  fonts.set(id, result); return result;
}
export function fontTextOptions(font: LoadedFont, options: TextOptions): TextOptions {
  const m = font.openplotfont?.metrics;
  return { ...options, fontId: font.id, kerning: true, ligatures: true, contextual: true, features: '', variations: '', featureRanges: [], variationRanges: [],
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
export function typographyToItem(content: string, capHeightMm: number, options: TextOptions, frame?: TextFrame): ArtworkItem {
  content = normalizeTextLineBreaks(content);
  if (!frame) return createTypographyItem(content, capHeightMm, options);
  if (![frame.width, frame.height].every(value => Number.isFinite(value) && value > 0)) throw new Error('Text frame dimensions must be positive.');
  const lines = wrapTextLines(content, frame.width, (line,start) => createTypographyItem(line, 1.4, { ...options, align:'left', featureRanges:sliceFeatureRanges(options.featureRanges,start,start+line.length),variationRanges:sliceVariationRanges(options.variationRanges,start,start+line.length) }).viewBox[2]);
  let layoutOffset=0;
  const featureRanges=lines.flatMap(line=>{const ranges=sliceFeatureRanges(options.featureRanges,line.start,line.end).map(r=>({...r,start:r.start+layoutOffset,end:r.end+layoutOffset}));layoutOffset+=line.text.length+1;return ranges;});
  layoutOffset=0;
  const variationRanges=lines.flatMap(line=>{const ranges=sliceVariationRanges(options.variationRanges,line.start,line.end).map(range=>({...range,start:range.start+layoutOffset,end:range.end+layoutOffset}));layoutOffset+=line.text.length+1;return ranges;});
  const replacement = createTypographyItem(lines.map(l=>l.text).join('\n'), capHeightMm, {...options,featureRanges,variationRanges});
  replacement.text!.options = {...options};
  const width = Math.max(frame.width, replacement.viewBox[2]);
  const dx = (width - replacement.viewBox[2]) * (options.align === 'right' ? 1 : options.align === 'center' ? .5 : 0);
  if (dx) replacement.markup = `<g transform="translate(${dx} 0)">${replacement.markup}</g>`;
  replacement.viewBox[2] = width;
  replacement.viewBox[3] = Math.max(frame.height, replacement.viewBox[3]);
  replacement.width = width * capHeightMm / 1.4;
  replacement.height = replacement.viewBox[3] * capHeightMm / 1.4;
  replacement.text = { ...replacement.text!, content, frame: { ...frame } };
  replacement.name = content.trim().slice(0, 24);
  return replacement;
}
function createTypographyItem(content: string, capHeightMm: number, options: TextOptions, legacy = false): ArtworkItem {
  if (!content.trim()) throw new Error('Enter some text.');
  if (!Number.isFinite(capHeightMm) || capHeightMm <= 0) throw new Error('Cap height must be positive.');
  validateTextOptions(options);
  validateFeatureRanges(options.featureRanges ?? [],content.length);
  validateVariationRanges(options.variationRanges??[],content);
  if (options.fontId === 'plot-sans') {if(options.variationRanges?.length)throw new Error('Plot Sans has no variable axes.');return textToItem(content, capHeightMm, options);}
  const loaded = findFont(options.fontId);
  if (!loaded) throw new Error('This font is unavailable. Load the original font again to edit this text.');
  if (loaded.bundled && !loaded.openplotfont && !loaded.face) throw new Error('This font is still loading. Try again in a moment.');
  if (loaded.openplotfont && !loaded.prepared) throw new Error('The font engine is still loading. Try again in a moment.');
  if (loaded.openplotfont) return openPlotFontToItem(loaded.prepared!, content, capHeightMm, options);
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
  for(const range of options.variationRanges??[]){const axis=loaded.axes[range.tag];if(!axis||range.value<axis.min||range.value>axis.max)throw new Error(`Variation ${range.tag} is unavailable or outside the font's range.`);}
  font.setVariations(variations);
  const baseVariations=Object.fromEntries(Object.entries(loaded.axes).map(([tag,axis])=>[tag,axis.default]));
  for(const variation of variations)baseVariations[variation.tag]=variation.value;
  const fontInstances=new Map<string,HB.Font>([[JSON.stringify(baseVariations),font]]);
  const instance=(values:Record<string,number>)=>{const key=JSON.stringify(values);let result=fontInstances.get(key);if(!result){result=new hb.Font(face);result.setVariations(Object.entries(values).map(([tag,value])=>new hb.Variation(tag,value)));fontInstances.set(key,result);}return result;};
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
  let sourceOffset=0;
  const lines = content.replace(/\r\n?/g, '\n').split('\n').map(line => {
    const ranges=sliceFeatureRanges(options.featureRanges,sourceOffset,sourceOffset+line.length);
    const axisRanges=sliceVariationRanges(options.variationRanges,sourceOffset,sourceOffset+line.length);sourceOffset+=line.length+1;
    const lineFeatures=[...features,...ranges.map(range=>new hb.Feature(range.tag,range.value,range.start,range.end))];
    const shape=(selectedFont:HB.Font,start=0,end=line.length,direction?:HB.Direction)=>{
      const buffer=new hb.Buffer();
      // Keep the complete line as pre/post context; only this font-instance run
      // enters the buffer. This preserves joining without cross-font ligatures.
      buffer.addText(line,start,end-start);
      if(direction!==undefined)buffer.setDirection(direction);
      else if(options.direction!=='auto')buffer.setDirection(options.direction==='rtl'?hb.Direction.RTL:hb.Direction.LTR);
      if(options.language)buffer.setLanguage(options.language);
      if(options.script)buffer.setScript(options.script);
      buffer.guessSegmentProperties();hb.shape(selectedFont,buffer,lineFeatures);
      const positions=buffer.getGlyphPositions();return buffer.getGlyphInfos().map((info,index)=>({info,position:positions[index]!,font:selectedFont}));
    };
    let glyphs=shape(font);
    const runs=variationRuns(line.length,baseVariations,axisRanges);
    if(runs.length>1 || runs.length===1 && Object.keys(runs[0]!.values).some(tag=>runs[0]!.values[tag]!==baseVariations[tag])){
      const first=glyphs[0]?.info.cluster??0,last=glyphs.at(-1)?.info.cluster??0;
      const firstLetter=line.match(/\p{Letter}/u)?.[0]??'';
      const rtl=options.direction==='rtl'||options.direction==='auto'&&(first>last||first===last&&/[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u.test(firstLetter));
      glyphs=(rtl?[...runs].reverse():runs).flatMap(run=>shape(instance(run.values),run.start,run.end,rtl?hb.Direction.RTL:hb.Direction.LTR));
    }
    if(glyphs.some(glyph=>glyph.info.codepoint===0))throw new Error('The selected font is missing characters in this text. Choose another font.');
    let x=0,y=0;
    const paths:PathCommand[][][]=[];
    const cursive=/[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Mongolian}]/u.test(line);
    glyphs.forEach(({info,position:pos,font:selectedFont},i)=>{
      const outline=selectedFont.glyphToPath(info.codepoint);
      const commands=parsePath(outline).map(command=>({type:command.type,values:command.values.map((v,n)=>n%2?-(v+y+pos.yOffset)*scale:(v+x+pos.xOffset)*scale)}));
      paths.push(splitContours(commands));x+=pos.xAdvance;y+=pos.yAdvance;
      if(glyphs[i+1]?.info.cluster!==info.cluster&&i+1<glyphs.length&&!cursive)x+=options.letterSpacing*face.upem;
      if((line[info.cluster]===' '||line[info.cluster]==='\u00a0')&&glyphs[i+1]?.info.cluster!==info.cluster)x+=options.wordSpacing*face.upem;
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
  if (item.text?.frame) return {};
  const id = item.text?.options?.fontId;
  if (!id || id === 'plot-sans' || item.text?.format === 'openplotfont' || findFont(id)?.openplotfont || findFont(id)?.kind === 'openplotfont') return {};
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
  // Changing cap height keeps a framed object's physical frame, then reflows it.
  const frame = item.text?.frame && (capHeightMm === undefined ? item.text.frame : {
    width: item.width / (capHeightMm / 1.4), height: item.text.frame.height * sy / (capHeightMm / 1.4)
  });
  const replacement = typographyToItem(content, capHeightMm ?? sy * 1.4, options, frame);
  Object.assign(item, { markup: replacement.markup, viewBox: replacement.viewBox, text: replacement.text,
    width: replacement.viewBox[2] * (capHeightMm === undefined ? sx : capHeightMm / 1.4), height: replacement.height });
}

/** Resize the layout area while retaining the current glyph scales on both axes. */
export function resizeTextFrame(item: ArtworkItem, width: number, height: number): void {
  if (!item.text) return;
  const sx = item.width / item.viewBox[2], sy = item.height / item.viewBox[3];
  const replacement = typographyToItem(item.text.content, sy * 1.4, textOptions(item), { width: width / sx, height: height / sy });
  Object.assign(item, { markup: replacement.markup, viewBox: replacement.viewBox, text: replacement.text,
    width: replacement.viewBox[2] * sx, height: replacement.height });
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
