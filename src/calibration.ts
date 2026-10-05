import { makeId, type ArtworkItem, type Paper } from './model';

/** Full-length crossing lines reveal weak contact across the entire surface. */
export function calibrationSheet(paper: Paper, margin: number, spacing = 20): ArtworkItem {
  if (!Number.isFinite(spacing) || spacing < 2 || spacing > 100) throw new Error('Grid spacing must be between 2 and 100 mm.');
  if (!Number.isFinite(margin) || margin < 0) throw new Error('Safe margin must be zero or greater.');
  const inset = margin + .5, width = paper.width - inset * 2, height = paper.height - inset * 2;
  if (![width, height].every(value => Number.isFinite(value) && value >= spacing)) throw new Error('The paper inside the safe margin is too small for this grid spacing.');
  const columns = Math.floor(width / spacing) + 1, rows = Math.floor(height / spacing) + 1;
  if (columns + rows > 2000) throw new Error('Choose larger grid spacing for this paper size.');
  const offsetX = (width - (columns - 1) * spacing) / 2, offsetY = (height - (rows - 1) * spacing) / 2;
  const n = (value: number) => Number(value.toFixed(6));
  const paths = [
    ...Array.from({length: columns}, (_, i) => `<path d="M${n(offsetX + i * spacing)} 0V${n(height)}"/>`),
    ...Array.from({length: rows}, (_, i) => `<path d="M0 ${n(offsetY + i * spacing)}H${n(width)}"/>`)
  ];
  return {id: makeId('calibration'), name: `Surface calibration · ${spacing} mm grid`, markup: paths.join(''),
    viewBox: [0,0,width,height], x: inset, y: inset, width, height, rotation: 0, stroke: '#000000'};
}
