import { layoutText, toSVGPaths, type OpenPlotFont } from '@thierryc/openplotfont';
import type { ArtworkItem, TextOptions } from './model';
import { makeId } from './model';

/** Plot-it placement and SVG metadata stay outside the reusable font library. */
export function openPlotFontToItem(font: OpenPlotFont, content: string, capHeightMm: number, options: TextOptions): ArtworkItem {
  if (options.variations.trim()) throw new Error('OpenPlotFont contains static geometry; variable axes are unavailable.');
  const geometry = layoutText(font, content, { ...options, capHeight: 1.4 });
  const markup = toSVGPaths(geometry).map(p => p.kind === 'fill'
    ? `<path data-openplotfont-kind="fill" fill="currentColor" stroke="none" fill-rule="${p.fillRule}" d="${p.d}"/>`
    : `<path data-openplotfont-kind="stroke" fill="none" d="${p.d}"/>`).join('');
  return { id: makeId('text'), name: content.trim().slice(0, 24), markup, viewBox: geometry.viewBox,
    x: 20, y: 20, width: geometry.viewBox[2] * capHeightMm / 1.4,
    height: geometry.viewBox[3] * capHeightMm / 1.4, rotation: 0, stroke: '#000000',
    text: { content, options: { ...options }, format: 'openplotfont' } };
}
