import { WorkSlice } from './cooperative';
import type { PlotPath } from './svg';
import type { TaskProgress } from './task-progress';
import type { ArtworkItem, FillSettings, Point } from './model';
import { defaultFillSettings } from './model';
import { elements, parsePath, parsePathSteps, pathData } from './editor';
import { MAX_FILL_POINTS, validateFill, type GeometryJob, type FillResult, type FillStroke } from './fill';
import { flattenContour } from '@thierryc/openplotfont';
import { isOutlineGlyph } from './outline-source';

const NS = 'http://www.w3.org/2000/svg';
export const ELEMENT_FILL_ATTRIBUTE = 'data-plot-fill';
export function elementFill(element: Element): FillSettings | undefined {
  const value = element.getAttribute(ELEMENT_FILL_ATTRIBUTE);
  return value ? { ...defaultFillSettings, ...JSON.parse(value) } : undefined;
}
/** Explicit object None is a master off switch; absent settings still permit element fills. */
export function resolveFillSettings(object?: FillSettings, element?: FillSettings): FillSettings {
  return { ...defaultFillSettings, ...(object?.mode === 'none' ? object : element ?? object) };
}
export function effectiveFill(item: ArtworkItem, element?: Element): FillSettings {
  if (item.fillSettings?.mode === 'none') {
    if (item.fillSettings.outline && element?.getAttribute('data-openplotfont-kind') === 'stroke') return { ...defaultFillSettings };
    return resolveFillSettings(item.fillSettings);
  }
  if (element?.getAttribute('data-openplotfont-kind') === 'stroke') return { ...defaultFillSettings, mode: 'none' };
  return resolveFillSettings(item.fillSettings, !element ? undefined : elementFill(element));
}
export function hasActiveFill(item: ArtworkItem, root: ParentNode): boolean {
  return elements(root).some(element => { const s = effectiveFill(item, element); return s.mode !== 'none' || s.outline; });
}
export function hasElementFills(item: ArtworkItem, root: ParentNode): boolean {
  if (item.fillSettings) return false;
  try { return hasActiveFill(item, root); } catch { return elements(root).some(element => element.hasAttribute(ELEMENT_FILL_ATTRIBUTE)); }
}
interface Source { element: SVGGraphicsElement; elements: SVGGraphicsElement[]; extra: FillStroke[]; key: string }
interface Collected { regions: GeometryJob[]; sources: Source[]; diagnostics: string[] }
type CollectionCache = Map<string, { signature: string; data: Collected; indices: number[][]; points: number }>;
function outlineGlyph(item: ArtworkItem, element: Element): boolean {
  return !!item.text?.options && item.text.format !== 'openplotfont' && item.text.options.fontId !== 'plot-sans' && isOutlineGlyph(element);
}
async function contours(element: SVGGeometryElement, matrix: DOMMatrix, work: WorkSlice, glyph = false): Promise<{ closed: Point[][]; open: Point[][] }> {
  const geometries: { geometry: SVGGeometryElement; closed: boolean }[] = [];
  const flattened: { points: Point[]; closed: boolean }[] = [];
  if (element.localName === 'path') {
    const groups: ReturnType<typeof parsePath>[] = [];
    for (const command of parsePathSteps(element.getAttribute('d') ?? '')) {
      const pause = work.checkpoint(); if (pause) await pause;
      if (command.type === 'M') groups.push([]);
      groups.at(-1)?.push(command);
    }
    for (const commands of groups) {
      if (glyph && commands.every(c => c.type !== 'A')) {
        const transformed = commands.map(c => ({          
...c, values: c.values.flatMap((_, i, values) => {
            if (i % 2) return [];
            const p = new DOMPoint(values[i]!, values[i + 1]!).matrixTransform(matrix); return [p.x, p.y];
          })        
}));
        const points = flattenContour(transformed, .005);
        const first = points[0], last = points.at(-1);
        const closed = commands.at(-1)?.type === 'Z' || !!(first && last && first.x === last.x && first.y === last.y);
        // Keep exact line vertices and a convex-hull error bound for glyph curves.
        // These points are already page-space; no SVG length resampling is needed.
        flattened.push({ points, closed });
        const pause = work.checkpoint(); if (pause) await pause;
        continue;
      }
      const path = document.createElementNS(NS, 'path'), parts: string[] = [];
      for (const command of commands) { parts.push(pathData([command])); const pause = work.checkpoint(); if (pause) await pause; }
      path.setAttribute('d', parts.join(' '));
      const first = commands[0]?.values, last = commands.at(-1);
      const closed = last?.type === 'Z' || !!(first && last && last.values.at(-2) === first[0] && last.values.at(-1) === first[1]);
      geometries.push({ geometry: path, closed });
    }
  } else {
    const closed = ['rect', 'circle', 'ellipse', 'polygon'].includes(element.localName) || (element.localName === 'polyline' && (() => {
      const values = (element.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
      return values.length >= 6 && values[0] === values.at(-2) && values[1] === values.at(-1);
    })());
    geometries.push({ geometry: element, closed });
  }
  const closed: Point[][] = [], open: Point[][] = [];
  for (const { points, closed: isClosed } of flattened) {
    if (isClosed && points.length > 3) { points.pop(); closed.push(points); }
    else if (points.length > 1) open.push(points);
  }
  let count = 0;
  for (const { geometry, closed: isClosed } of geometries) {
    const length = geometry.getTotalLength(); if (!length) continue;
    const at = (t: number): Point => { const p = geometry.getPointAtLength(t); const q = new DOMPoint(p.x, p.y).matrixTransform(matrix); return { x: q.x, y: q.y }; };
    const points: Point[] = [at(0)];
    // An explicit stack allows yielding even inside one exceptionally long curve.
    const scale = Math.hypot(matrix.a, matrix.b, matrix.c, matrix.d), steps = Math.max(1, Math.ceil(length * scale / .5));
    if (steps > MAX_FILL_POINTS) throw new Error('Source geometry is too complex for filling.');
    for (let i = 0; i < steps; i++) {
      const stack = [{ a: length * i / steps, b: length * (i + 1) / steps, p: points.at(-1)!, q: at(length * (i + 1) / steps), depth: 0 }];
      while (stack.length) {
        const pause = work.checkpoint(); if (pause) await pause;
        const { a, b, p, q, depth } = stack.pop()!;
        const mid = (a + b) / 2, m = at(mid), u = at((a + mid) / 2), v = at((mid + b) / 2);
        const error = Math.max(Math.hypot(m.x - (p.x + q.x) / 2, m.y - (p.y + q.y) / 2), Math.hypot(u.x - (3 * p.x + q.x) / 4, u.y - (3 * p.y + q.y) / 4), Math.hypot(v.x - (p.x + 3 * q.x) / 4, v.y - (p.y + 3 * q.y) / 4));
        if (error > .002 && depth < 22) {
          stack.push({ a: mid, b, p: m, q, depth: depth + 1 }, { a, b: mid, p, q: m, depth: depth + 1 });
        } else { points.push(q); if (++count > MAX_FILL_POINTS) throw new Error('Source geometry is too complex for filling.'); }
      }
    }
    if (isClosed && points.length > 3) { if (Math.hypot(points[0]!.x - points.at(-1)!.x, points[0]!.y - points.at(-1)!.y) < .000001) points.pop(); closed.push(points); }
    else open.push(points);
  }
  return { closed, open };
}
async function collect(svg: SVGSVGElement, items: ArtworkItem[], work: WorkSlice, cache: CollectionCache): Promise<Collected> {
  const regions: GeometryJob[] = [], sources: Source[] = [], diagnostics: string[] = [];
  let sourcePoints = 0;
  const root = svg.getScreenCTM(); if (!root) throw new Error('Paper transform is unavailable.');
  const inverse = root.inverse();
  for (const group of svg.querySelectorAll<SVGGElement>('#artwork-layer > [data-item-id]')) {
    const item = items.find(i => i.id === group.dataset.itemId); if (!item) continue;
    const nodes = elements(group), signature = fillItemKey(item);
    const cached = cache.get(item.id);
    if (cached?.signature === signature) {
      const current = cached.data;
      regions.push(...current.regions); diagnostics.push(...current.diagnostics);
      sources.push(...current.sources.map((source, i) => {
        const element = nodes[cached.indices[i]![0]!]!;
        // Structural rerenders (including zoom) remount source nodes. Retain the
        // cached region identity so those views reuse their resolved geometry.
        sourceIdentities.set(element, sourceIdentity(source.element));
        return { ...source, element, elements: cached.indices[i]!.map(index => nodes[index]!) };
      }));
      sourcePoints += cached.points;
      const pause = work.checkpoint(); if (pause) await pause;
      continue;
    }
    const regionStart = regions.length, sourceStart = sources.length, diagnosticStart = diagnostics.length, pointStart = sourcePoints;
    const batches = new Map<string, number>();
    elementLoop: for (const [index, element] of nodes.entries()) {
      const key = `${item.name} · ${element.localName} ${index + 1}`;
      try {
        const s = effectiveFill(item, element);
        const glyph = outlineGlyph(item, element);
        if (s.mode === 'none' && !s.outline && !glyph) continue;
        validateFill(s);
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || (style.opacity === '0' && !suppressed.has(element))) continue;
        for (let parent: Element | null = element; parent && parent !== svg; parent = parent.parentElement) {
          const ancestor = getComputedStyle(parent);
          if (ancestor.display === 'none' || ancestor.visibility === 'hidden' || (ancestor.opacity === '0' && !suppressed.has(parent as SVGGraphicsElement))) continue elementLoop;
          if ((ancestor.clipPath && ancestor.clipPath !== 'none') || (ancestor.maskImage && ancestor.maskImage !== 'none') || (parent.hasAttribute('clip-path') && parent.getAttribute('clip-path') !== 'none') || (parent.hasAttribute('mask') && parent.getAttribute('mask') !== 'none')) throw new Error('Clipping/masking is unsupported for fills; convert it to paths first.');
        }
        if (element.localName === 'text') throw new Error('Convert SVG text to closed outlines before filling.');
        const ctm = element.getScreenCTM(); if (!ctm) throw new Error('Element transform is unavailable.');
        const matrix = inverse.multiply(ctm), shape = await contours(element as SVGGeometryElement, matrix, work, glyph);
        sourcePoints += [...shape.closed, ...shape.open].reduce((sum, path) => sum + path.length, 0);
        if (sourcePoints > MAX_FILL_POINTS) throw new Error('Source geometry is too complex for filling.');
        if (!shape.closed.length && !glyph) { diagnostics.push(`${key}: Open linework remains unchanged; no closed region to fill.`); continue; }
        const paint = style.fill;
        if (paint.includes('url(')) throw new Error('Gradient/pattern fills are unsupported; choose a flat fill color.');
        const stroke = style.stroke && style.stroke !== 'none' ? style.stroke : item.stroke;
        const tool = paint && paint !== 'none' && paint !== 'rgba(0, 0, 0, 0)' ? paint : stroke;
        const scale = Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c));
        const outlineWidth = Math.max(.01, parseFloat(style.strokeWidth) * (style.vectorEffect === 'non-scaling-stroke' ? 1 : scale) || .35);
        const extra = shape.open.map(points => ({ points, tool: stroke, width: outlineWidth }));
        const rule = glyph ? 'nonzero' : style.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
        const batchKey = JSON.stringify([s, tool, stroke, outlineWidth]);
        const batch = glyph ? batches.get(batchKey) : undefined;
        if (batch !== undefined) {
          regions[batch]!.groups!.push({ contours: shape.closed, rule });
          sources[batch]!.elements.push(element); sources[batch]!.extra.push(...extra);
        } else {
          if (glyph) batches.set(batchKey, regions.length);
          regions.push({
            key, contours: shape.closed, rule, settings: s, tool, groups: glyph ? [{ contours: shape.closed, rule }] : undefined,
            perimeter: s.mode === 'none', outlineTool: stroke, outlineWidth: s.mode === 'none' && !s.outline ? outlineWidth : s.width
          });
          sources.push({ element, elements: [element], extra, key });
        }
      } catch (error) { throw new Error(`${key}: ${(error as Error).message}`); }
      const pause = work.checkpoint(); if (pause) await pause;
    }
    const itemSources = sources.slice(sourceStart);
    cache.set(item.id, { signature, data: { regions: regions.slice(regionStart), sources: itemSources, diagnostics: diagnostics.slice(diagnosticStart) }, indices: itemSources.map(source => source.elements.map(element => nodes.indexOf(element))), points: sourcePoints - pointStart });
  }
  if (sourcePoints > MAX_FILL_POINTS) throw new Error('Source geometry is too complex for filling.');
  return { regions, sources, diagnostics };
}
const jobs = new WeakMap<SVGSVGElement, Promise<void>>();
const GEOMETRY_STATUS = 'data-plot-geometry-status';
export async function awaitFills(svg: SVGSVGElement): Promise<void> {
  await jobs.get(svg);
  const status = svg.getAttribute(GEOMETRY_STATUS);
  if (status === 'pending' || status === 'error') throw new Error('Plot geometry is not ready. Return to editing and prepare again.');
}
const suppressed = new WeakMap<SVGGraphicsElement, { value: string; priority: string }>();
type PaintProperty = 'fill' | 'stroke' | 'stroke-width' | 'stroke-opacity';
const outlinePaint = new WeakMap<SVGGraphicsElement, { property: PaintProperty; value: string; priority: string }[]>();
/** Derive linework without rewriting editable markup or sampling any contours. */
function showUnfilledOutlines(svg: SVGSVGElement, items: ArtworkItem[]): boolean {
  let active = false;
  const changes: { element: SVGGraphicsElement; item: ArtworkItem; missingStroke: boolean; properties: PaintProperty[] }[] = [];
  for (const group of svg.querySelectorAll<SVGGElement>('#artwork-layer > [data-item-id]')) {
    const item = items.find(item => item.id === group.dataset.itemId); if (!item) continue;
    for (const element of elements(group)) {
      if (outlineGlyph(item, element)) active = true;
      const settings = effectiveFill(item, element);
      if (element.getAttribute('data-openplotfont-kind') === 'fill' && settings.mode === 'none' && !settings.outline) throw new Error(`${item.name}: OpenPlotFont contains filled regions. Enable Draw boundary or choose Solid, Hatch stripes or Crosshatch in Plot fill before exporting or plotting.`);
      if (settings.outline) active = true;
      if (effectiveFill(item, element).mode !== 'none') { active = true; continue; }
      if (element.hasAttribute('data-outline-preview')) continue;
      const paint = getComputedStyle(element), properties: PaintProperty[] = ['fill'];
      const missingStroke = !paint.stroke || paint.stroke === 'none' || paint.stroke === 'rgba(0, 0, 0, 0)' || Number(paint.strokeOpacity) === 0 || parseFloat(paint.strokeWidth) === 0;
      if (missingStroke) properties.push('stroke', 'stroke-width', 'stroke-opacity');
      changes.push({ element, item, missingStroke, properties });
    }
  }
  // Read paint before writing styles, avoiding a style/layout flush per shape.
  for (const { element, item, missingStroke, properties } of changes) {
    outlinePaint.set(element, properties.map(property => ({ property, value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) })));
    element.setAttribute('data-outline-preview', 'true'); element.style.setProperty('fill', 'none', 'important');
    if (missingStroke) { element.style.setProperty('stroke', item.stroke, 'important'); element.style.setProperty('stroke-width', '.35', 'important'); element.style.setProperty('stroke-opacity', '1', 'important'); }
  }
  return active;
}
function restoreOutlinePaint(svg: ParentNode): void {
  svg.querySelectorAll<SVGGraphicsElement>('[data-outline-preview]').forEach(element => {
    for (const old of outlinePaint.get(element) ?? []) {
      if (old.value) element.style.setProperty(old.property, old.value, old.priority); else element.style.removeProperty(old.property);
    }
    element.removeAttribute('data-outline-preview'); outlinePaint.delete(element);
  });
}
function restore(svg: ParentNode): void {
  restoreOutlinePaint(svg);
  svg.querySelectorAll<SVGGraphicsElement>('[data-fill-source]').forEach(restoreSuppression);
  svg.querySelectorAll('[data-generated-fill]').forEach(e => e.remove());
}
export function fillItemKey(item: ArtworkItem): string {
  return JSON.stringify([item.markup, item.viewBox, item.x, item.y, item.width, item.height, item.rotation, item.stroke, item.fillSettings, !!item.text, item.text?.format, item.text?.options?.fontId]);
}
export function fillDocumentKey(items: ArtworkItem[]): string { return JSON.stringify(items.map(item => [item.id, fillItemKey(item)])); }
const generatedPaths = new WeakMap<SVGSVGElement, PlotPath[]>();
export function fillPlotPaths(svg: SVGSVGElement): PlotPath[] {
  const status = svg.getAttribute(GEOMETRY_STATUS);
  if (status === 'pending' || status === 'error') throw new Error('Plot geometry is not ready. Return to editing and prepare again.');
  const cached = generatedPaths.get(svg);
  const groups = [...svg.querySelectorAll<SVGGElement>('[data-generated-fill]')];
  const sources = [...svg.querySelectorAll<SVGGraphicsElement>('[data-fill-source][data-fill-path-key]')];
  // The rendered vertices are authoritative. A new module instance (e.g. during
  // development reloads) may have no cache even though the preview is complete.
  const recovered = new Set<string>();
  const keyedGroups = groups.map(group => {
    const sourceKey = group.getAttribute('data-fill-path-key') ?? group.previousElementSibling?.getAttribute('data-fill-path-key');
    if (!sourceKey || recovered.has(sourceKey)) throw new Error('Generated plot geometry is incomplete. Return to editing and prepare again.');
    recovered.add(sourceKey);
    return { group, sourceKey };
  });
  if (sources.some(source => !recovered.has(source.getAttribute('data-fill-path-key')!))) throw new Error('Generated plot geometry is missing. Return to editing and prepare again.');
  if (cached && cached.length === groups.reduce((n, group) => n + group.querySelectorAll('path').length, 0)
    && cached.every(path => !!path.sourceKey && recovered.has(path.sourceKey))) return cached;
  const paths: PlotPath[] = [];
  let count = 0;
  for (const { group, sourceKey } of keyedGroups) {
    const orderGroup = group.closest<SVGGElement>('[data-openplotfont-order]')?.dataset.itemId;
    for (const path of group.querySelectorAll('path')) {
      // apply() writes page-mm coordinates and cancels the ancestor transform.
      // Read those exact rounded vertices, without resampling or retransforming.
      const points: Point[] = [];
      for (const command of parsePathSteps(path.getAttribute('d') ?? '')) {
        if (command.type !== 'M' && command.type !== 'L') throw new Error('Generated plot geometry was changed. Prepare it again.');
        if (command.type === 'M' && points.length) throw new Error('Generated plot geometry contains disconnected strokes. Prepare it again.');
        points.push({ x: command.values[0]!, y: command.values[1]! });
        if (++count > MAX_FILL_POINTS) throw new Error('Document fill is too dense. Increase width or spacing.');
      }
      if (points.length > 1) paths.push({ points, tool: path.getAttribute('stroke')!, width: Number(path.getAttribute('stroke-width')), sourceKey, orderGroup });
    }
  }
  return paths;
}
const sourceIdentities = new WeakMap<Element, string>();
let nextSourceIdentity = 0;
function sourceIdentity(source: Element): string {
  let key = sourceIdentities.get(source);
  if (!key) { key = `${source.closest('[data-item-id]')?.getAttribute('data-item-id') ?? 'artwork'}:region-${++nextSourceIdentity}`; sourceIdentities.set(source, key); }
  return key;
}
/** A provisional DOM clone retains author paint beneath its cached preview. */
export function adoptFillPreviewClone(original: Element, clone: Element): void {
  const sources = [original, ...original.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  sources.forEach((source, index) => {
    const copy = copies[index] as SVGGraphicsElement;
    const suppression = suppressed.get(source as SVGGraphicsElement);
    const paint = outlinePaint.get(source as SVGGraphicsElement);
    if (suppression) suppressed.set(copy, { ...suppression });
    if (paint) outlinePaint.set(copy, paint.map(property => ({ ...property })));
  });
}
const appliedRegions = new WeakMap<Element, { signature: string; group: SVGGElement; elements: SVGGraphicsElement[]; paths: PlotPath[] }>();
function restoreSuppression(element: SVGGraphicsElement): void {
  const old = suppressed.get(element);
  if (old) { if (old.value) element.style.setProperty('opacity', old.value, old.priority); else element.style.removeProperty('opacity'); }
  suppressed.delete(element); element.removeAttribute('data-fill-source'); element.removeAttribute('data-fill-path-key');
}
async function apply(svg: SVGSVGElement, data: Collected, results: FillResult[], work: WorkSlice, signatures: string[]): Promise<string[]> {
  const additions: { source: Source; group: SVGGElement; paths: PlotPath[]; signature: string }[] = [], paths: PlotPath[] = [];
  const retained = new Set<Element>();
  for (const [i, source] of data.sources.entries()) {
    const previous = appliedRegions.get(source.element), signature = signatures[i]!;
    if (previous?.signature === signature && previous.group.isConnected && previous.elements.length === source.elements.length && previous.elements.every((element, j) => element === source.elements[j])) {
      retained.add(previous.group); paths.push(...previous.paths); continue;
    }
    const sourceKey = sourceIdentity(source.element);
    const orderGroup = source.element.closest<SVGGElement>('[data-openplotfont-order]')?.dataset.itemId;
    const group = document.createElementNS(NS, 'g'); group.setAttribute('data-generated-fill', 'true'); group.setAttribute('data-fill-path-key', sourceKey);
    const parentMatrix = (source.element.parentElement as unknown as SVGGraphicsElement).getScreenCTM(), rootMatrix = svg.getScreenCTM();
    if (!parentMatrix || !rootMatrix) throw new Error('Fill transform is unavailable.');
    const inverse = parentMatrix.inverse().multiply(rootMatrix); group.setAttribute('transform', `matrix(${inverse.a} ${inverse.b} ${inverse.c} ${inverse.d} ${inverse.e} ${inverse.f})`); group.style.pointerEvents = 'none'; group.setAttribute('fill', 'none');
    const regionPaths: PlotPath[] = [];
    for (const stroke of [...results[i]!.paths, ...source.extra]) {
      const commands: string[] = [], rounded: Point[] = [];
      for (const [j, p] of stroke.points.entries()) {
        const x = p.x.toFixed(5), y = p.y.toFixed(5); commands.push(`${j ? 'L' : 'M'}${x} ${y}`); rounded.push({ x: Number(x), y: Number(y) });
        const pause = work.checkpoint(); if (pause) await pause;
      }
      const path = document.createElementNS(NS, 'path'); path.setAttribute('d', commands.join(' ')); path.setAttribute('stroke', stroke.tool); path.setAttribute('stroke-width', String(stroke.width));
      path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); group.append(path); regionPaths.push({ ...stroke, points: rounded, sourceKey, orderGroup });
      const pause = work.checkpoint(); if (pause) await pause;
    }
    additions.push({ source, group, paths: regionPaths, signature }); paths.push(...regionPaths);
  }
  work.check();
  // Prepare replacements first. Mutate only changed regions, preserving all others.
  for (const { source, group, paths, signature } of additions) {
    const previous = appliedRegions.get(source.element);
    if (previous) { for (const element of previous.elements) restoreSuppression(element); previous.group.remove(); }
    for (const element of source.elements) {
      if (!suppressed.has(element)) suppressed.set(element, { value: element.style.getPropertyValue('opacity'), priority: element.style.getPropertyPriority('opacity') });
      element.style.setProperty('opacity', '0', 'important'); element.setAttribute('data-fill-source', 'true'); element.setAttribute('data-fill-path-key', sourceIdentity(source.element));
    }
    source.element.after(group); retained.add(group); appliedRegions.set(source.element, { signature, group, elements: source.elements, paths });
  }
  const validSources = new Set(data.sources.flatMap(source => source.elements));
  for (const element of svg.querySelectorAll<SVGGraphicsElement>('[data-fill-source]')) if (!validSources.has(element)) restoreSuppression(element);
  for (const group of svg.querySelectorAll('[data-generated-fill]')) if (!retained.has(group)) group.remove();
  generatedPaths.set(svg, paths);
  return [...data.diagnostics, ...results.flatMap((r, i) => r.diagnostics.map(message => `${data.sources[i]!.key}: ${message}`))];
}
/** Per-object caches survive selection, zoom, and unrelated artwork edits. */
export class FillPreview {
  private worker?: Worker;
  private cancelCurrent?: () => void;
  private cache: CollectionCache = new Map();
  private results = new Map<string, FillResult>();
  private revision = 0;
  private currentSvg?: SVGSVGElement;
  private currentKey = '';
  private currentRoots: (Element | null)[] = [];
  private itemSignatures = new Map<string, string>();
  update(svg: SVGSVGElement, items: ArtworkItem[], notify: (status: string, error?: boolean) => void, onProgress?: (progress?: TaskProgress) => void): void {
    const key = fillDocumentKey(items);
    const roots = [...svg.querySelectorAll('#artwork-layer > [data-item-id]')].map(group => group.firstElementChild);
    if (this.currentSvg === svg && this.currentKey === key && roots.length === this.currentRoots.length && roots.every((node, i) => node === this.currentRoots[i]) && jobs.has(svg)) return;
    this.cancel(); this.currentSvg = svg; this.currentKey = key; this.currentRoots = roots;
    for (const group of svg.querySelectorAll<SVGGElement>('#artwork-layer > [data-item-id]')) {
      const item = items.find(item => item.id === group.dataset.itemId);
      if (item && this.itemSignatures.get(item.id) !== fillItemKey(item)) restoreOutlinePaint(group);
    }
    this.itemSignatures = new Map(items.map(item => [item.id, fillItemKey(item)]));
    generatedPaths.delete(svg);
    let active: boolean;
    try { active = showUnfilledOutlines(svg, items); } catch (error) { svg.setAttribute(GEOMETRY_STATUS, 'error'); const rejected = Promise.reject(error); rejected.catch(() => { }); jobs.set(svg, rejected); onProgress?.(); notify((error as Error).message, true); return; }
    if (!active) { svg.querySelectorAll<SVGGraphicsElement>('[data-fill-source]').forEach(restoreSuppression); svg.querySelectorAll('[data-generated-fill]').forEach(node => node.remove()); svg.setAttribute(GEOMETRY_STATUS, 'ready'); this.results.clear(); this.cache.clear(); jobs.set(svg, Promise.resolve()); onProgress?.(); notify(''); return; }
    svg.setAttribute(GEOMETRY_STATUS, 'pending');
    const revision = this.revision, work = new WorkSlice(() => revision !== this.revision);
    const snapshot = structuredClone(items);
    const ready = new Promise<void>((resolve, reject) => {
      this.cancelCurrent = () => reject(new Error('Fill generation cancelled by an edit.'));
      void (async () => {
        notify('Generating fill…'); onProgress?.({ label: 'Reading fill geometry' });
        await work.yield(120);
        const active = new Set(snapshot.map(item => item.id));
        for (const id of this.cache.keys()) if (!active.has(id)) this.cache.delete(id);
        const data = await collect(svg, snapshot, work, this.cache);
        work.check();
        const keys = data.sources.map((source, i) => JSON.stringify([sourceIdentity(source.element), { ...data.regions[i], key: '' }, source.extra]));
        const missing = data.regions.filter((_, i) => !this.results.has(keys[i]!));
        if (missing.length) {
          const computed = await new Promise<FillResult[]>((resolveWorker, rejectWorker) => {
            const worker = new Worker(new URL('./fill.worker.ts', import.meta.url), { type: 'module' }); this.worker = worker;
            worker.onerror = () => { worker.terminate(); rejectWorker(new Error('Fill generation failed. Change settings and try again.')); };
            worker.onmessage = event => {
              if (revision !== this.revision) return;
              if (event.data.progress) { onProgress?.(event.data.progress); return; }
              worker.terminate(); this.worker = undefined;
              event.data.error ? rejectWorker(new Error(event.data.error)) : resolveWorker(event.data.results);
            };
            worker.postMessage(missing);
          });
          work.check(); let index = 0;
          keys.forEach(key => { if (!this.results.has(key)) this.results.set(key, computed[index++]!); });
        }
        const results = keys.map(key => this.results.get(key)!);
        const points = results.reduce((n, r) => n + r.paths.reduce((n, p) => n + p.points.length, 0), 0) + data.sources.reduce((n, source) => n + source.extra.reduce((n, p) => n + p.points.length, 0), 0);
        if (points > MAX_FILL_POINTS) throw new Error('Document fill is too dense. Increase width or spacing.');
        // Keep only current derived results; avoid retaining dense history in memory.
        const used = new Set(keys); for (const key of this.results.keys()) if (!used.has(key)) this.results.delete(key);
        onProgress?.({ label: 'Updating fill preview' });
        const diagnostics = await apply(svg, data, results, work, keys);
        work.check(); svg.setAttribute(GEOMETRY_STATUS, 'ready'); this.cancelCurrent = undefined; onProgress?.(); notify(diagnostics.join(' ')); resolve();
      })().catch(error => {
        if (revision !== this.revision) return;
        this.worker?.terminate(); this.worker = undefined; this.cancelCurrent = undefined;
        svg.setAttribute(GEOMETRY_STATUS, 'error'); onProgress?.(); notify((error as Error).message, true); reject(error);
      });
    });
    ready.catch(() => { }); jobs.set(svg, ready);
  }
  cancel(): void { this.revision++; this.cancelCurrent?.(); this.cancelCurrent = undefined; this.worker?.terminate(); this.worker = undefined; this.currentKey = ''; }
  beginInteraction(svg: SVGSVGElement, item: ArtworkItem, source?: SVGGraphicsElement, outlines = false) {
    const group = [...svg.querySelectorAll<SVGGElement>('#artwork-layer > [data-item-id]')].find(group => group.dataset.itemId === item.id)!;
    let selected = source ? [source] : elements(group);
    // A resolved text batch can contain several editable glyphs. Moving just one
    // cannot transform that shared preview; expose all of its source contours.
    if (source) {
      const key = source.getAttribute('data-fill-path-key');
      const batch = key ? elements(group).filter(element => element.getAttribute('data-fill-path-key') === key) : [];
      if (batch.length > 1) { selected = batch; outlines = true; }
    }
    const keys = new Set(selected.map(element => element.getAttribute('data-fill-path-key')).filter(Boolean));
    const generated = [...group.querySelectorAll<SVGGElement>('[data-generated-fill]')].filter(node => !source || keys.has(node.getAttribute('data-fill-path-key')));
    const oldStatus = svg.getAttribute(GEOMETRY_STATUS), oldJob = jobs.get(svg), oldKey = this.currentKey;
    this.cancel(); svg.setAttribute(GEOMETRY_STATUS, 'pending');
    const pending = Promise.reject(new Error('Fill is pending an edit.')); pending.catch(() => { }); jobs.set(svg, pending);
    const styles = [...selected, ...generated].map(element => ({ element, style: element.getAttribute('style'), transform: element.getAttribute('transform') }));
    if (outlines) {
      const paints = selected.map(element => { const paint = getComputedStyle(element); return paint.stroke && paint.stroke !== 'none' ? paint.stroke : item.stroke; });
      generated.forEach(node => node.style.setProperty('display', 'none', 'important'));
      selected.forEach((element, i) => { element.style.setProperty('opacity', '1', 'important'); element.style.setProperty('fill', 'none', 'important'); element.style.setProperty('stroke', paints[i]!, 'important'); element.style.setProperty('stroke-width', '.35', 'important'); });
    }
    return {
      generated: outlines ? [] : generated, finish: (committed: boolean) => {
        for (const { element, style, transform } of styles) {
          if (element.getAttribute('style') !== style) { if (style === null) element.removeAttribute('style'); else element.setAttribute('style', style); }
          if (!committed && generated.includes(element as SVGGElement)) { if (transform === null) element.removeAttribute('transform'); else element.setAttribute('transform', transform); }
        }
        if (!committed && oldStatus === 'ready') { this.currentKey = oldKey; svg.setAttribute(GEOMETRY_STATUS, 'ready'); jobs.set(svg, oldJob ?? Promise.resolve()); }
      }
    };
  }
  suspend(svg: SVGSVGElement, items?: ArtworkItem[]): void { this.cancel(); svg.setAttribute(GEOMETRY_STATUS, 'pending'); restore(svg); if (items) showUnfilledOutlines(svg, items); generatedPaths.delete(svg); const rejected = Promise.reject(new Error('Fill is pending an edit.')); rejected.catch(() => { }); jobs.set(svg, rejected); }
}
export function exportFilledSvg(svg: SVGSVGElement, width: number, height: number): string {
  const layer = svg.querySelector('#artwork-layer')!.cloneNode(true) as SVGGElement;
  layer.querySelectorAll('[data-fill-source]').forEach(e => e.remove());
  layer.querySelectorAll('*').forEach(e => { for (const attr of [...e.attributes]) if (attr.name.startsWith('data-') || attr.name === 'class') e.removeAttribute(attr.name); });
  layer.removeAttribute('id');
  return `<svg xmlns="${NS}" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" fill="none">${layer.outerHTML}</svg>`;
}
