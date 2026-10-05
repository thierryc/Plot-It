import C from 'clipper-lib';
import type { TaskProgress } from './task-progress';
import type { FillSettings, Point } from './model';

export interface FillRegion { contours: Point[][]; rule: 'evenodd' | 'nonzero'; settings: FillSettings; tool: string; key: string }
export interface FillStroke { points: Point[]; tool: string; width: number }
export interface FillResult { paths: FillStroke[]; diagnostics: string[] }
export interface BoundaryRegion { contours: Point[][]; rule: FillRegion['rule'] }
/** Each group is resolved independently before combining filled glyph regions. */
export interface GeometryJob extends FillRegion {
  groups?: BoundaryRegion[];
  perimeter?: boolean;
  outlineTool: string;
  outlineWidth: number;
}
const SCALE = 100000;
export const MAX_FILL_POINTS = 100000;
const integer = (p: Point): C.IntPoint => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) });
const point = (p: C.IntPoint): Point => ({ x: p.X / SCALE, y: p.Y / SCALE });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function validateFill(s: FillSettings): void {
  if (!['none', 'solid', 'hatch', 'crosshatch'].includes(s.mode)) throw new Error('Unsupported fill mode.');
  if (!Number.isFinite(s.width) || s.width < .05 || s.width > 20) throw new Error('Drawn width must be between 0.05 and 20 mm.');
  if (!Number.isFinite(s.angle) || Math.abs(s.angle) > 360) throw new Error('Angle must be between -360 and 360 degrees.');
  if (!Number.isFinite(s.overlap) || s.overlap < 0 || s.overlap > .8) throw new Error('Overlap must be between 0 and 80%.');
  if (!Number.isFinite(s.gap) || s.gap < 0 || s.gap > 100) throw new Error('Clear gap must be between 0 and 100 mm.');
}
export function fillSpacing(s: FillSettings): number {
  validateFill(s);
  return s.mode === 'solid' ? s.width * (1 - s.overlap) : s.width + s.gap;
}
function normalize(contours: Point[][], rule: FillRegion['rule']): C.Paths {
  if (contours.reduce((n, c) => n + c.length, 0) > MAX_FILL_POINTS) throw new Error('Source geometry is too complex for filling.');
  if (contours.some(c => c.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.max(Math.abs(p.x), Math.abs(p.y)) > 100000))) throw new Error('Fill coordinates exceed supported bounds.');
  const clip = new C.Clipper(2 /* strictly simple polygons */), result: C.Paths = [];
  clip.AddPaths(contours.map(c => c.map(integer)), C.PolyType.ptSubject, true);
  clip.Execute(C.ClipType.ctUnion, result, rule === 'evenodd' ? C.PolyFillType.pftEvenOdd : C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  if (result.reduce((n, r) => n + r.length, 0) > MAX_FILL_POINTS) throw new Error('Resolved boundaries are too complex for plotting.');
  return result;
}
export function resolveRegionBoundaries(contours: Point[][], rule: FillRegion['rule']): Point[][] {
  return normalize(contours, rule).map(r => r.map(point));
}
export function unionResolvedRegions(regions: BoundaryRegion[]): Point[][] {
  const count = regions.reduce((n, r) => n + r.contours.reduce((n, c) => n + c.length, 0), 0);
  if (count > MAX_FILL_POINTS) throw new Error('Source geometry is too complex for filling.');
  return resolveRegionBoundaries(regions.flatMap(r => resolveRegionBoundaries(r.contours, r.rule)), 'nonzero');
}
/** Boundary strokes use the original region, never its pen-radius inset. */
export function generateGeometry(job: GeometryJob, onProgress?: (progress: TaskProgress) => void): FillResult {
  validateFill(job.settings);
  if (!Number.isFinite(job.outlineWidth) || job.outlineWidth <= 0) throw new Error('Boundary width must be finite and positive.');
  onProgress?.({label: 'Preparing boundaries'});
  const boundaries = job.groups ? unionResolvedRegions(job.groups) : resolveRegionBoundaries(job.contours, job.rule);
  const result: FillResult = job.perimeter ? {paths: [], diagnostics: []} : generateFillFromBoundaries(job, boundaries.map(r => r.map(integer)), onProgress);
  if (job.perimeter || job.settings.outline) {
    for (const ring of boundaries) if (ring.length > 2) result.paths.push({points: [...ring, {...ring[0]!}], tool: job.outlineTool, width: job.outlineWidth});
  }
  if (result.paths.reduce((n, p) => n + p.points.length, 0) > MAX_FILL_POINTS) throw new Error('Generated geometry is too dense. Increase width or spacing.');
  return result;
}
/** All of the bridge must lie in the inset region, including passages near holes. */
function bridgeInside(a: Point, b: Point, inset: C.Paths): boolean {
  const len = distance(a, b);
  if (len < 1e-7) return true;
  const clip = new C.Clipper(), tree = new C.PolyTree();
  clip.AddPath([integer(a), integer(b)], C.PolyType.ptSubject, false);
  clip.AddPaths(inset, C.PolyType.ptClip, true);
  clip.Execute(C.ClipType.ctIntersection, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  const fragments = C.Clipper.OpenPathsFromPolyTree(tree);
  const length = fragments.reduce((total, path) => total + path.slice(1).reduce((sum, p, i) => sum + distance(point(path[i]!), point(p)), 0), 0);
  return fragments.length === 1 && Math.abs(length - len) < .00003;
}
/** Pure page-mm geometry. Union before offset honors both SVG winding rules. */
export function generateFill(region: FillRegion, onProgress?: (progress: TaskProgress) => void): FillResult {
  onProgress?.({label: "Preparing fill boundaries"});
  if (region.settings.mode === 'none') { validateFill(region.settings); return {paths: [], diagnostics: []}; }
  return generateFillFromBoundaries(region, normalize(region.contours, region.rule), onProgress);
}
function generateFillFromBoundaries(region: FillRegion, normalized: C.Paths, onProgress?: (progress: TaskProgress) => void): FillResult {
  const s = region.settings, spacing = fillSpacing(s);
  if (s.mode === 'none') return { paths: [], diagnostics: [] };
  const offset = new C.ClipperOffset(2, .002 * SCALE), inset: C.Paths = [];
  offset.AddPaths(normalized, C.JoinType.jtRound, C.EndType.etClosedPolygon);
  // Conservative allowance for curve flattening and integer rounding.
  offset.Execute(inset, -(s.width / 2 + .01) * SCALE);
  const diagnostics: string[] = [];
  if (!inset.length) return { paths: [], diagnostics: ['Region is too narrow for this drawn width.'] };
  // A closing offset exposes narrow necks/slivers that disappeared during inset.
  const expand = new C.ClipperOffset(2, .002 * SCALE), restored: C.Paths = [];
  expand.AddPaths(inset, C.JoinType.jtRound, C.EndType.etClosedPolygon);
  expand.Execute(restored, (s.width / 2 + .01) * SCALE);
  const difference = new C.Clipper(), missing: C.Paths = [];
  difference.AddPaths(normalized, C.PolyType.ptSubject, true);
  difference.AddPaths(restored, C.PolyType.ptClip, true);
  difference.Execute(C.ClipType.ctDifference, missing, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  const lostArea = Math.abs(missing.reduce((sum, p) => sum + C.Clipper.Area(p), 0)) / SCALE ** 2;
  if (lostArea > Math.max(.05, s.width * s.width)) diagnostics.push('Some corners or narrow features cannot be fully covered at this width.');
  const paths: FillStroke[] = [];
  let count = 0;
  for (let pass = 0; pass < (s.mode === 'crosshatch' ? 2 : 1); pass++) {
    const angle = (s.angle + pass * 90) * Math.PI / 180, c = Math.cos(angle), sn = Math.sin(angle);
    const rotate = (p: Point) => ({ x: c * p.x + sn * p.y, y: -sn * p.x + c * p.y });
    const unrotate = (p: Point) => ({ x: c * p.x - sn * p.y, y: sn * p.x + c * p.y });
    const rings = inset.map(ring => ring.map(p => rotate(point(p))));
    let min = Infinity, max = -Infinity;
    for (const ring of rings) for (const p of ring) { min = Math.min(min, p.y); max = Math.max(max, p.y); }
    const rows = Math.ceil((max - min) / spacing);
    if (rows > MAX_FILL_POINTS / 2) throw new Error('Fill is too dense. Increase width or spacing.');
    let last: FillStroke | undefined;
    // Center rows in the available span; avoids erasing thin but valid regions.
    const start = (min + max - Math.max(0, rows - 1) * spacing) / 2;
    onProgress?.({label: 'Generating fill strokes', fraction: pass / (s.mode === 'crosshatch' ? 2 : 1)});
    for (let row = 0; row < rows; row++) {
      const y = start + row * spacing, xs: number[] = [];
      for (const ring of rings) for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
      }
      xs.sort((a, b) => a - b);
      const segments: Point[][] = [];
      for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1]! - xs[i]! > .0001) segments.push([unrotate({ x: xs[i]! + .00004, y }), unrotate({ x: xs[i + 1]! - .00004, y })]);
      if (row % 2) { segments.reverse(); segments.forEach(segment => segment.reverse()); }
      for (const segment of segments) {
        if (s.connect && last && distance(last.points.at(-1)!, segment[0]!) <= spacing * 3 && bridgeInside(last.points.at(-1)!, segment[0]!, inset)) last.points.push(...segment);
        else { last = { points: segment, tool: region.tool, width: s.width }; paths.push(last); }
        count += 2;
        if (count > MAX_FILL_POINTS) throw new Error('Fill is too dense. Increase width or spacing.');
      }
      onProgress?.({label: 'Generating fill strokes', fraction: (pass + (row + 1) / rows) / (s.mode === 'crosshatch' ? 2 : 1)});
    }
  }
  if (!paths.length) diagnostics.push('Region is too narrow for this spacing.');
  return { paths, diagnostics };
}
