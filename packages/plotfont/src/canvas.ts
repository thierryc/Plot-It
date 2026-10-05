import { toSVGPaths } from './svg.js';
import type { TextGeometry } from './types.js';

export type CanvasPath =
  | { kind: 'stroke'; path: Path2D }
  | { kind: 'fill'; path: Path2D; fillRule: 'evenodd' | 'nonzero' };

/** Only calling this browser adapter needs Path2D; importing it is safe in Node. */
export function toCanvasPaths(geometry: TextGeometry): CanvasPath[] {
  if (typeof Path2D === 'undefined') throw new Error('PlotFont: Canvas paths require a runtime providing Path2D.');
  return toSVGPaths(geometry).map(p => p.kind === 'stroke'
    ? { kind: 'stroke', path: new Path2D(p.d) }
    : { kind: 'fill', path: new Path2D(p.d), fillRule: p.fillRule });
}
