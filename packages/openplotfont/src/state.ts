import type * as HB from 'harfbuzzjs';
import type { OpenPlotFontData } from './reader.js';
import type { OpenPlotFont } from './types.js';

/** Internal only: do not expose engine types through the public loader declarations. */
export interface FontState { data: OpenPlotFontData; engine?: typeof HB; shapingFont?: HB.Font }
const states = new WeakMap<OpenPlotFont, FontState>();
export function rememberFont(font: OpenPlotFont, state: FontState): void { states.set(font, state); }
export function fontState(font: OpenPlotFont): FontState {
  const state = states.get(font);
  if (!state) throw new Error('OpenPlotFont: use a font returned by createOpenPlotFont or loadOpenPlotFont.');
  return state;
}
