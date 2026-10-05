import type * as HB from 'harfbuzzjs';
import type { PlotFontData } from './reader.js';
import type { PlotFont } from './types.js';

/** Internal only: do not expose engine types through the public loader declarations. */
export interface FontState { data: PlotFontData; engine?: typeof HB; shapingFont?: HB.Font }
const states = new WeakMap<PlotFont, FontState>();
export function rememberFont(font: PlotFont, state: FontState): void { states.set(font, state); }
export function fontState(font: PlotFont): FontState {
  const state = states.get(font);
  if (!state) throw new Error('PlotFont: use a font returned by createPlotFont or loadPlotFont.');
  return state;
}
