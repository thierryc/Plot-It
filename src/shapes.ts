import { makeId, type ArtworkItem, type Paper } from './model';

export const SHAPES = [
  { id: 'rectangle', label: 'Rectangle', icon: 'rectangle' },
  { id: 'square', label: 'Square', icon: 'square' },
  { id: 'circle', label: 'Circle', icon: 'circle' },
  { id: 'ellipse', label: 'Ellipse', icon: 'circle' },
  { id: 'triangle', label: 'Triangle', icon: 'triangle' },
  { id: 'line', label: 'Line', icon: 'line' }
] as const;
export type ShapeKind = typeof SHAPES[number]['id'];

/** Native SVG shapes remain editable and use the normal fill/export/plot pipeline. */
export function shapeItem(kind: ShapeKind, paper: Paper, stroke = '#171714'): ArtworkItem {
  const shape = SHAPES.find(shape => shape.id === kind);
  if (!shape) throw new Error('Unknown shape.');
  const size = Math.min(40, paper.width / 3, paper.height / 3);
  const width = kind === 'rectangle' || kind === 'ellipse' || kind === 'line' ? size * 1.5 : size;
  const height = kind === 'line' ? .1 : size;
  const markup = kind === 'circle' ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/>`
    : kind === 'ellipse' ? `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}"/>`
    : kind === 'triangle' ? `<polygon points="${width / 2},0 ${width},${height} 0,${height}"/>`
    : kind === 'line' ? `<line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}"/>`
    : `<rect width="${width}" height="${height}"/>`;
  return { id: makeId('shape'), name: shape.label, markup, viewBox: [0, 0, width, height],
    x: (paper.width - width) / 2, y: (paper.height - height) / 2, width, height, rotation: 0, stroke };
}
