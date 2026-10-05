import type * as HB from 'harfbuzzjs';
import { parsePlotFont, plotFontLayoutBytes, type PlotFontData } from './reader.js';
import type { PlotFont } from './types.js';
import { rememberFont, type FontState } from './state.js';

let enginePromise: Promise<typeof HB> | undefined;
function engine(): Promise<typeof HB> {
  return enginePromise ??= import('harfbuzzjs').catch(error => { enginePromise = undefined; throw error; });
}
function freeze(value: unknown): void {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
}
function handle(state: FontState): PlotFont {
  freeze(state.data);
  const font: PlotFont = Object.freeze({ data: state.data,
    features: Object.freeze(state.data.layout?.features.map(f => f.tag).sort() ?? []),
    hasOpenTypeLayout: !!state.shapingFont });
  rememberFont(font, state);
  return font;
}
/** Revalidate and snapshot caller-owned data so later changes cannot invalidate a font. */
export function createPlotFont(data: PlotFontData): PlotFont {
  const snapshot = parsePlotFont(JSON.stringify(data));
  if (snapshot.layout) throw new Error('PlotFont: embedded OpenType layout requires await loadPlotFont(jsonOrBytes).');
  return handle({ data: snapshot });
}
/** Decode UTF-8, validate bindings, and initialize WASM only for embedded layout. */
export async function loadPlotFont(source: string | ArrayBuffer | Uint8Array): Promise<PlotFont> {
  if (typeof source !== 'string' && source.byteLength > 32 * 1024 * 1024) throw new Error('PlotFont: file exceeds 32 MB.');
  const json = typeof source === 'string' ? source : new TextDecoder('utf-8', { fatal: true }).decode(source);
  const data = parsePlotFont(json);
  if (!data.layout) return handle({ data });
  const bytes = await plotFontLayoutBytes(data);
  const hb = await engine();
  return handle({ data, engine: hb, shapingFont: new hb.Font(new hb.Face(new hb.Blob(bytes!))) });
}
