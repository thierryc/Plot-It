import { initialState, defaultFillSettings, type AppState, type ArtworkItem, type PlotSettings, type TextOptions } from './model';
import { canvasPaper } from './paper';
import { restorePaperColor } from './colors';
import { canonicalColor, restorePens } from './pens';
import { restoreMachineOrientation } from './motion';
import { setupModel } from './plotter-setup';
import { validateFill } from './fill';
import { sanitizeArtworkMarkup } from './svg';
import { documentName } from './document-name';

export const DOCUMENT_EXTENSION = '.plit.json';
export const DOCUMENT_ACCEPT = '.plit,.plit.json,application/json';
export function isPlotItDocumentFile(name: string): boolean {
  return /\.plit(?:\.json)?$/i.test(name);
}
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
export interface EmbeddedFont { id: string; name: string; format: 'plotfont' | 'opentype'; encoding: 'base64'; data: string }
export interface PlotItDocument {
  format: 'plot-it'; version: 1; units: 'mm';
  document: Pick<AppState, 'items' | 'paper' | 'paperColor' | 'settings' | 'pens'> & { documentName?: string };
  fonts: EmbeddedFont[];
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value as Record<string, unknown>;
}
function number(value: unknown, label: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label}.`);
  return value;
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}.`);
  return value;
}
function settingsFrom(value: unknown): PlotSettings {
  const source = object(value ?? {}, 'plot settings');
  const result = {...initialState.settings, ...source, ...restoreMachineOrientation(source), pauseOnToolChange: true} as PlotSettings;
  result.axidrawModel = setupModel(source.axidrawModel);
  if (!['axidraw','xylodraw'].includes(result.profile) || !['preserve','nearest','reversible'].includes(result.reorderMode)) throw new Error('Invalid machine profile or path order.');
  for (const key of ['speed','travelSpeed','drawAcceleration','travelAcceleration'] as const) number(result[key], key, .000001);
  for (const key of ['cornering','margin','maxPenDownMm'] as const) number(result[key], key, 0);
  for (const key of ['penUp','penDown'] as const) number(result[key], key, 0, 100);
  if (typeof result.returnToOrigin !== 'boolean') throw new Error('Invalid final-return preference.');
  // Keep only documented settings, never arbitrary file properties.
  return Object.fromEntries(Object.keys(initialState.settings).map(key => [key, result[key as keyof PlotSettings]])) as unknown as PlotSettings;
}
function itemFrom(value: unknown): ArtworkItem {
  const source = object(value, 'artwork item');
  const id = string(source.id, 'artwork ID');
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid artwork ID.');
  if (!Array.isArray(source.viewBox) || source.viewBox.length !== 4) throw new Error('Invalid artwork viewBox.');
  const viewBox = source.viewBox.map((v, i) => number(v, 'artwork viewBox', i < 2 ? -Infinity : .000001)) as ArtworkItem['viewBox'];
  const stroke = string(source.stroke, 'artwork pen color'); canonicalColor(stroke);
  const result: ArtworkItem = {id, name: string(source.name, 'artwork name'), markup: sanitizeArtworkMarkup(string(source.markup, 'artwork geometry')),
    viewBox, x: number(source.x, 'artwork X'), y: number(source.y, 'artwork Y'), width: number(source.width, 'artwork width', .000001),
    height: number(source.height, 'artwork height', .000001), rotation: number(source.rotation, 'artwork rotation'), stroke};
  if (source.fillSettings !== undefined) {
    const fill = {...defaultFillSettings, ...object(source.fillSettings, 'fill settings')}; validateFill(fill);
    if (typeof fill.outline !== 'boolean' || typeof fill.connect !== 'boolean') throw new Error('Invalid fill options.');
    result.fillSettings = Object.fromEntries(Object.keys(defaultFillSettings).map(key => [key, fill[key as keyof typeof fill]])) as unknown as typeof fill;
  }
  if (source.text !== undefined) {
    const text = object(source.text, 'text');
    result.text = {content: string(text.content, 'text content')};
    if (text.format !== undefined) { if (text.format !== 'plotfont') throw new Error('Unsupported text format.'); result.text.format = text.format; }
    if (text.options !== undefined) {
      const options = object(text.options, 'text options');
      for (const key of ['fontId','features','variations','language','script'] as const) string(options[key], `text ${key}`);
      for (const key of ['letterSpacing','wordSpacing','lineHeight'] as const) number(options[key], `text ${key}`, key === 'lineHeight' ? .000001 : -Infinity);
      for (const key of ['kerning','ligatures','contextual'] as const) if (typeof options[key] !== 'boolean') throw new Error(`Invalid text ${key}.`);
      if (!['left','center','right'].includes(String(options.align)) || !['auto','ltr','rtl'].includes(String(options.direction))) throw new Error('Invalid text alignment or direction.');
      result.text.options = Object.fromEntries(['fontId','features','variations','language','script','letterSpacing','wordSpacing','lineHeight','kerning','ligatures','contextual','align','direction'].map(key => [key, options[key]])) as unknown as TextOptions;
    }
  }
  return result;
}
export function documentFontIds(state: AppState): string[] {
  return [...new Set(state.items.flatMap(item => item.text?.options?.fontId ? [item.text.options.fontId] : []))];
}
export function serializePlotIt(state: AppState, fonts: EmbeddedFont[] = []): string {
  const snapshot: PlotItDocument = {format: 'plot-it', version: 1, units: 'mm', document: {
    documentName: documentName(state.documentName),
    items: structuredClone(state.items), paper: {...state.paper}, paperColor: state.paperColor,
    settings: {...state.settings, pauseOnToolChange: true}, pens: restorePens(state.pens)
  }, fonts: structuredClone(fonts)};
  return JSON.stringify(snapshot, null, 2) + '\n';
}
/** Parse completely before replacing the live document. Machine state is never restored. */
export function parsePlotIt(source: string): {state: AppState; fonts: EmbeddedFont[]} {
  if (source.length > MAX_DOCUMENT_BYTES) throw new Error('Choose a Plot-it document smaller than 100 MB.');
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new Error('This file is not valid JSON. Choose a .plit or .plit.json document.'); }
  const file = object(parsed, 'Plot-it document');
  if (file.format !== 'plot-it' || file.version !== 1 || file.units !== 'mm') throw new Error('Unsupported Plot-it document format or version.');
  const doc = object(file.document, 'document');
  if (doc.documentName !== undefined) string(doc.documentName, 'document name');
  if (!Array.isArray(doc.items) || doc.items.length > 10000) throw new Error('Invalid artwork list.');
  const items = doc.items.map(itemFrom);
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Artwork IDs must be unique.');
  const paper = object(doc.paper, 'paper');
  if (doc.paperColor !== undefined && (typeof doc.paperColor !== 'string' || !/^#[\da-f]{6}$/i.test(doc.paperColor))) throw new Error('Invalid paper color.');
  const state: AppState = {...structuredClone(initialState), items, paper: canvasPaper(number(paper.width, 'paper width'), number(paper.height, 'paper height')),
    documentName: documentName(doc.documentName), paperColor: restorePaperColor(doc.paperColor), settings: settingsFrom(doc.settings), pens: restorePens(doc.pens as AppState['pens'])};
  if (file.fonts !== undefined && !Array.isArray(file.fonts)) throw new Error('Invalid embedded fonts.');
  const used = new Set(documentFontIds(state));
  const fonts = (file.fonts as unknown[] ?? []).map(value => {
    const font = object(value, 'embedded font');
    const id = string(font.id, 'font ID'), name = string(font.name, 'font name'), data = string(font.data, 'font data');
    if (!used.has(id) || !/^(?:plotfont-)?[a-f0-9]{64}$/.test(id) || !['plotfont','opentype'].includes(String(font.format)) || font.encoding !== 'base64'
      || data.length > Math.ceil(20 * 1024 * 1024 / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data) || !data) throw new Error('Invalid embedded font data.');
    return {id, name, data, format: font.format as EmbeddedFont['format'], encoding: 'base64' as const};
  });
  if (new Set(fonts.map(font => font.id)).size !== fonts.length) throw new Error('Embedded font IDs must be unique.');
  return {state, fonts};
}
