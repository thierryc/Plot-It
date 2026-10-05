import type { PathCommand, SVGOptions, SVGPath, TextGeometry } from './types.js';

function pathData(commands: readonly PathCommand[]): string {
  return commands.map(({ type, values }) => `${type}${values.map(v => Number(v.toFixed(6))).join(' ')}`).join(' ');
}
export function toSVGPaths(geometry: TextGeometry): SVGPath[] {
  return geometry.operations.map(op => op.kind === 'stroke'
    ? { kind: 'stroke', d: pathData(op.contour.commands) }
    : { kind: 'fill', d: op.contours.map(c => pathData(c.commands)).join(' '), fillRule: op.fillRule });
}
function attribute(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}
/** Standalone SVG; stroke and compound-fill operations remain in drawing order. */
export function toSVG(geometry: TextGeometry, options: SVGOptions = {}): string {
  const { color = '#000000', strokeWidth = geometry.capHeight * .02, unit = 'px' } = options;
  const padding = geometry.operations.some(op => op.kind === 'stroke') ? strokeWidth / 2 : 0;
  const viewBox: [number, number, number, number] = [geometry.viewBox[0] - padding, geometry.viewBox[1] - padding,
    geometry.viewBox[2] + padding * 2, geometry.viewBox[3] + padding * 2];
  const { width = viewBox[2], height = viewBox[3] } = options;
  if (![strokeWidth, width, height].every(Number.isFinite) || strokeWidth < 0 || width <= 0 || height <= 0) throw new Error('PlotFont: invalid SVG dimensions or stroke width.');
  if (!['px', 'mm', 'cm', 'in'].includes(unit)) throw new Error('PlotFont: invalid SVG unit.');
  const paths = toSVGPaths(geometry).map(p => p.kind === 'stroke'
    ? `<path fill="none" stroke="currentColor" d="${p.d}"/>`
    : `<path fill="currentColor" stroke="none" fill-rule="${p.fillRule}" d="${p.d}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(' ')}" width="${width}${unit}" height="${height}${unit}" color="${attribute(color)}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
