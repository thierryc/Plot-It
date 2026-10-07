import type { PenPreferences, Point, PlotSettings } from './model';
import { clipPlotPaths, splitPlotPaths, type PlotPath } from './svg';
import { closedPolyline, nearestClosedVertex, optimizePathUnits, pathOptimizationSettings, protectedPath, rotateClosedPath } from './path-optimization';

export interface PlotPen { color: string; name: string; sources: string[]; included: boolean }
export const defaultPens = (): PenPreferences => ({ assignments: {}, excluded: [], order: [], mode: 'group' });

/** Browser computed paint is normally RGB. Resolve named/HSL CSS before sending to a worker. */
export function canonicalColor(value: string): string {
  const input = value.trim();
  const hex = input.match(/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];
  if (hex) return '#' + (hex.length < 5 ? hex.slice(0, 3).split('').map(c => c + c).join('') : hex.slice(0, 6)).toUpperCase();
  const rgb = input.match(/^rgba?\(\s*([^)]*)\)$/i);
  if (rgb) {
    const channels = rgb[1]!.split('/')[0]!.trim().split(/[\s,]+/).slice(0, 3);
    if (channels.length === 3 && channels.every(c => /^[-+]?(?:\d*\.)?\d+%?$/.test(c))) {
      return '#' + channels.map(c => Math.round(Math.max(0, Math.min(255, (c.endsWith('%') ? parseFloat(c) / 100 * 255 : parseFloat(c))))).toString(16).padStart(2, '0')).join('').toUpperCase();
    }
  }
  const srgb = input.match(/^color\(srgb\s+([^)]*)\)$/i);
  if (srgb) {
    const channels = srgb[1]!.split('/')[0]!.trim().split(/\s+/);
    if (channels.length === 3 && channels.every(c => /^[-+]?(?:\d*\.)?\d+$/.test(c))) return canonicalColor(`rgb(${channels.map(c => Number(c) * 255).join(' ')})`);
  }
  const named: Record<string, string> = { black: '#000000', white: '#FFFFFF', red: '#FF0000', blue: '#0000FF', green: '#008000', lime: '#00FF00', yellow: '#FFFF00', cyan: '#00FFFF', aqua: '#00FFFF', magenta: '#FF00FF', fuchsia: '#FF00FF', gray: '#808080', grey: '#808080', silver: '#C0C0C0', maroon: '#800000', purple: '#800080', olive: '#808000', navy: '#000080', teal: '#008080', rebeccapurple: '#663399' };
  if (named[input.toLowerCase()]) return named[input.toLowerCase()]!;
  if (typeof document !== 'undefined' && !/url\(|var\(|currentcolor|none|transparent/i.test(input)) {
    const node = document.createElement('span'); node.style.color = input;
    if (node.style.color) {
      document.body.append(node);
      const resolved = getComputedStyle(node).color; node.remove();
      if (resolved !== input && /^rgba?\(/i.test(resolved)) return canonicalColor(resolved);
      // Canvas converts supported wide-gamut/HSL colors to the physical RGB palette.
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = input.replace(/\/\s*[^)]*(?=\))/, ''); context.fillRect(0, 0, 1, 1);
        return '#' + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
      }
    }
  }
  throw new Error(`Unsupported pen color: ${value}. Choose a flat RGB color.`);
}

export function restorePens(value?: Partial<PenPreferences>): PenPreferences {
  const result = defaultPens();
  result.mode = value?.mode === 'source' ? 'source' : 'group';
  result.excluded = Array.isArray(value?.excluded) ? value.excluded.filter(c => typeof c === 'string') : [];
  result.order = Array.isArray(value?.order) ? [...new Set(value.order.filter(c => typeof c === 'string'))] : [];
  for (const [source, assignment] of Object.entries(value?.assignments ?? {})) {
    if (!/^#[\dA-F]{6}$/.test(source) || !assignment || typeof assignment.color !== 'string') continue;
    try { result.assignments[source] = { color: canonicalColor(assignment.color), name: typeof assignment.name === 'string' ? assignment.name : '' }; } catch { /* Ignore malformed saved assignments. */ }
  }
  return result;
}

export function discoverPens(paths: PlotPath[], preferences: PenPreferences): PlotPen[] {
  const pens = new Map<string, PlotPen>();
  for (const source of new Set(paths.map(path => path.tool))) {
    const assignment = preferences.assignments[source];
    const color = assignment?.color ?? source;
    const pen = pens.get(color) ?? { color, name: assignment?.name ?? '', sources: [], included: false };
    if (!pen.name && assignment?.name) pen.name = assignment.name;
    pen.sources.push(source); pen.included ||= !preferences.excluded.includes(source); pens.set(color, pen);
  }
  const ranks = new Map(preferences.order.map((color, index) => [color, index]));
  return [...pens.values()].sort((a, b) => (ranks.get(a.color) ?? Infinity) - (ranks.get(b.color) ?? Infinity));
}

/** Optimize atomic units, retaining every protected block's internal operation order. */
function orderUnits(units: PlotPath[][], settings: PlotSettings, mode = settings.reorderMode): PlotPath[] {
  const options=pathOptimizationSettings(settings);
  const closedStart=(unit:PlotPath[],cursor:Point)=>unit.length===1&&!protectedPath(unit[0]!)&&closedPolyline(unit[0]!.points)&&options.closedPathStart==='nearest'
    ? nearestClosedVertex(unit[0]!.points,cursor) : 0;
  const orient=(unit:PlotPath[],cursor:Point)=>{
    const start=closedStart(unit,cursor);
    return start ? [{...unit[0]!,points:rotateClosedPath(unit[0]!.points,start)}] : unit;
  };
  if (mode === 'preserve') {
    let cursor:Point={x:0,y:0},tool=''; const result:PlotPath[]=[];
    for (const unit of units) {
      if (unit[0]!.tool!==tool) cursor={x:0,y:0};
      const chosen=orient(unit,cursor); result.push(...chosen);
      cursor=chosen.at(-1)!.points.at(-1)!; tool=chosen.at(-1)!.tool;
    }
    return result;
  }
  const remaining = [...units], result: PlotPath[] = [];
  // Each color change parks at origin, so each ranked bucket starts there.
  let cursor: Point = { x: 0, y: 0 };
  while (remaining.length) {
    let best = 0, reverse = false, distance = Infinity;
    remaining.forEach((unit, index) => {
      const start = unit[0]!.points[closedStart(unit,cursor)]!, end = unit.at(-1)!.points.at(-1)!;
      const forward = Math.hypot(start.x - cursor.x, start.y - cursor.y);
      const backward = mode === 'reversible' && !unit[0]!.orderGroup && !closedPolyline(unit[0]!.points) ? Math.hypot(end.x - cursor.x, end.y - cursor.y) : Infinity;
      if (Math.min(forward, backward) < distance) { best = index; reverse = backward < forward; distance = Math.min(forward, backward); }
    });
    const unit = orient(remaining.splice(best, 1)[0]!,cursor);
    result.push(...unit.map(path => ({ ...path, points: reverse ? [...path.points].reverse() : [...path.points] })));
    cursor = result.at(-1)!.points.at(-1)!;
    // A protected block may contain several pens. The next bucket-colored
    // stroke changes tool and therefore starts its travel from the origin.
    if (result.at(-1)!.tool !== units[0]?.[0]?.tool) cursor={x:0,y:0};
  }
  return result;
}

export function preparePenPaths(source: PlotPath[], settings: PlotSettings, preferences: PenPreferences, paper?: { width: number; height: number }): { paths: PlotPath[]; pens: PlotPen[] } {
  if(settings.strictOrder){settings={...settings,reorderMode:'preserve',pathJoinToleranceMm:0,pathSimplifyToleranceMm:0,closedPathStart:'preserve'};preferences={...preferences,mode:'source'};}
  pathOptimizationSettings(settings);
  const clipped = paper&&settings.pageClipping!==false ? clipPlotPaths(source, { minX: settings.margin, minY: settings.margin, maxX: paper.width - settings.margin, maxY: paper.height - settings.margin }) : source;
  const pens = discoverPens(clipped, preferences);
  const mapped = clipped.filter(path => !preferences.excluded.includes(path.tool)).map(path => ({ ...path, tool: preferences.assignments[path.tool]?.color ?? path.tool }));
  if (preferences.mode === 'source') return { paths: splitPlotPaths(orderUnits(optimizePathUnits(mapped.map(path=>[path]),settings,true),settings,'preserve'),settings.maxPenDownMm),pens };
  const units: PlotPath[][] = [];
  // Form blocks before filtering so omitted operations never join unrelated source blocks.
  let block: PlotPath[] | undefined;
  for (const path of clipped) {
    if (!path.orderGroup || block?.[0]?.orderGroup !== path.orderGroup) { block = []; units.push(block); }
    if (!preferences.excluded.includes(path.tool)) block!.push({ ...path, tool: preferences.assignments[path.tool]?.color ?? path.tool });
  }
  const buckets = new Map<string, PlotPath[][]>();
  for (const unit of units.filter(unit => unit.length)) {
    const color = unit[0]!.tool; const bucket = buckets.get(color) ?? []; bucket.push(unit); buckets.set(color, bucket);
  }
  return { paths: splitPlotPaths(pens.flatMap(pen => orderUnits(optimizePathUnits(buckets.get(pen.color) ?? [],settings),settings)), settings.maxPenDownMm), pens };
}
