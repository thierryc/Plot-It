import type * as HB from 'harfbuzzjs';
import { parseOpenPlotFont, openPlotFontLayoutBytes, type OpenPlotFontData } from './reader.js';
import type { OpenPlotFont } from './types.js';
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
function handle(state: FontState): OpenPlotFont {
  freeze(state.data);
  const font: OpenPlotFont = Object.freeze({ data: state.data,
    features: Object.freeze(state.data.layout?.features.map(f => f.tag).sort() ?? []),
    hasOpenTypeLayout: !!state.shapingFont });
  rememberFont(font, state);
  return font;
}
/** Revalidate and snapshot caller-owned data so later changes cannot invalidate a font. */
export function createOpenPlotFont(data: OpenPlotFontData): OpenPlotFont {
  const snapshot = parseOpenPlotFont(JSON.stringify(data));
  if (snapshot.layout) throw new Error('OpenPlotFont: embedded OpenType layout requires await loadOpenPlotFont(jsonOrBytes).');
  return handle({ data: snapshot });
}
/** Decode UTF-8, validate bindings, and initialize WASM only for embedded layout. */
export async function loadOpenPlotFont(source: string | ArrayBuffer | Uint8Array): Promise<OpenPlotFont> {
  if (typeof source !== 'string' && source.byteLength > 32 * 1024 * 1024) throw new Error('OpenPlotFont: file exceeds 32 MB.');
  const json = typeof source === 'string' ? source : new TextDecoder('utf-8', { fatal: true }).decode(source);
  const data = parseOpenPlotFont(json);
  if (!data.layout) return handle({ data });
  const bytes = await openPlotFontLayoutBytes(data);
  const hb = await engine();
  return handle({ data, engine: hb, shapingFont: new hb.Font(new hb.Face(new hb.Blob(bytes!))) });
}
