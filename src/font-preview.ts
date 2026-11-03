import type { OpenPlotFontData } from '@thierryc/openplotfont';
import type { ArtworkItem } from './model';
export type DrawingType = 'stroke' | 'outline' | 'mixed';
export function drawingType(font?: OpenPlotFontData): DrawingType {
    if (!font)
        return 'outline';
    let stroke = false, fill = false;
    for (const glyph of font.glyphs)
        for (const path of glyph.strokes) {
            stroke ||= (path.kind ?? 'stroke') === 'stroke';
            fill ||= path.kind === 'fill';
        }
    return stroke && fill ? 'mixed' : stroke ? 'stroke' : 'outline';
}
export function specimenText(font?: OpenPlotFontData): string {
    if (!font)
        return 'Aa 012';
    const encoded = font.glyphs.filter(g => g.strokes.length).flatMap(g => g.unicodes.map(u => parseInt(u, 16)));
    const supported = new Set(font.glyphs.flatMap(g => g.unicodes.map(u => parseInt(u, 16))));
    const standard = [...'Aa 012'].filter(c => supported.has(c.codePointAt(0)!)).join('');
    if (standard.replace(/ /g, '').length >= 4)
        return standard;
    const demo = [...'A fi 0'].filter(c => supported.has(c.codePointAt(0)!)).join('');
    if (demo.replace(/ /g, '').length >= 3)
        return demo;
    return [...new Set(encoded)].slice(0, 4).map(c => String.fromCodePoint(c)).join(supported.has(32) ? ' ' : '');
}
/** Geometry from the app renderer, never HTML text or user-supplied SVG. */
export function previewSVG(item: ArtworkItem): string {
    if (item.markup.length > 128000)
        throw new Error('Specimen geometry is too large.');
    const [x, y, width, height] = item.viewBox, padding = height * .12;
    const box = [x - padding, y - padding, width + 2 * padding, height + 2 * padding].map(n => Number(n.toFixed(5))).join(' ');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="180" height="40"><g color="#000" fill="none" stroke="#000" stroke-width="${Number((height * .025).toFixed(5))}" stroke-linecap="round" stroke-linejoin="round">${item.markup}</g></svg>`;
}
