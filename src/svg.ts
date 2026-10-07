import {parseLayerControls} from '@thierryc/plotter-core';
import {flattenSvgGeometry} from './svg-scene';
import { WorkSlice } from './cooperative';
import type { ArtworkItem, Point } from "./model";
import { itemTransform, makeId } from "./model";
import { parsePath, parsePathSteps, pathData } from "./editor";
import { flattenContour } from '@thierryc/openplotfont';

const DRAWABLE = "path,line,polyline,polygon,rect,circle,ellipse";
const SVG_NS = "http://www.w3.org/2000/svg";

export interface PlotPath {
  points: Point[];
  tool: string;
  width?: number;
  /** OpenPlotFont trajectories are an atomic ordered block, even during travel optimization. */
  orderGroup?: string;
  sourceKey?: string;
  layerId?:string;sourceId?:string;sourceOrder?:number;
}

function number(value: string | null, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stripUnsafeSvg(svg: SVGSVGElement): void {
  svg.querySelectorAll("script,foreignObject,iframe,object,embed,style").forEach((node) => node.remove());
  [svg, ...svg.querySelectorAll("*")].forEach((node) => {
    for (const attr of [...node.attributes]) {
      const key = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (key.startsWith("on") || value.startsWith("javascript:")) node.removeAttribute(attr.name);
      if ((key === "href" || key === "xlink:href") && !value.startsWith("#")) node.removeAttribute(attr.name);
      if (value.includes("url(") && !/url\(\s*['\"]?#/.test(value)) node.removeAttribute(attr.name);
    }
  });
}

/** Native documents retain editable SVG geometry, never executable markup. */
export function sanitizeArtworkMarkup(markup: string): string {
  const parsed = new DOMParser().parseFromString(`<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink">${markup}</svg>`, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) throw new Error('Document contains invalid SVG geometry.');
  stripUnsafeSvg(parsed.documentElement as unknown as SVGSVGElement);
  return parsed.documentElement.innerHTML;
}

export function parseSvg(source: string, name = "Imported SVG"): ArtworkItem {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const error = document.querySelector("parsererror");
  const svg = document.documentElement;
  if (error || svg.localName !== "svg") throw new Error("This file is not a valid SVG.");
  stripUnsafeSvg(svg as unknown as SVGSVGElement);
  if (!svg.querySelector(`${DRAWABLE},text`)) throw new Error("The SVG contains no editable paths, shapes, or text.");

  const viewBoxValues = svg.getAttribute("viewBox")?.split(/[ ,]+/).map(Number);
  const validViewBox = viewBoxValues?.length === 4 && viewBoxValues.every(Number.isFinite);
  const width = number(svg.getAttribute("width"), 100);
  const height = number(svg.getAttribute("height"), 100);
  const viewBox = (validViewBox ? viewBoxValues : [0, 0, width, height]) as [number, number, number, number];
  const aspect = Math.max(viewBox[2], 0.001) / Math.max(viewBox[3], 0.001);
  const displayWidth = Math.min(140, Math.max(30, viewBox[2] * 0.264583));

  // Keep inherited presentation (especially fill rules/colors) from the SVG root.
  const presentation = document.createElementNS(SVG_NS, 'g');
  for (const key of ['fill','fill-rule','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-linecap','stroke-linejoin','opacity','transform','style','clip-path','mask','visibility','display','color','vector-effect']) {
    if (svg.hasAttribute(key)) presentation.setAttribute(key, svg.getAttribute(key)!);
  }
  presentation.innerHTML = svg.innerHTML;
  return {
    id: makeId("svg"),
    name,
    markup: presentation.attributes.length ? presentation.outerHTML : svg.innerHTML,
    viewBox,
    x: 20,
    y: 20,
    width: displayWidth,
    height: displayWidth / aspect,
    rotation: 0,
    stroke: "#171714"
  };
}

export function freehandItem(points: Point[]): ArtworkItem {
  if (points.length < 2) throw new Error("A path needs at least two points.");
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));
  const width = Math.max(maxX - minX, 0.1);
  const height = Math.max(maxY - minY, 0.1);
  const d = points.map((p, index) => `${index ? "L" : "M"}${(p.x - minX).toFixed(2)},${(p.y - minY).toFixed(2)}`).join(" ");
  return {
    id: makeId("path"), name: "Drawn path", markup: `<path d="${d}"/>`, viewBox: [0, 0, width, height],
    x: minX, y: minY, width, height, rotation: 0, stroke: "#000000"
  };
}

export function renderItem(item: ArtworkItem, selected = false): string {
  return `<g class="artwork ${selected ? "is-selected" : ""}" data-item-id="${item.id}" ${item.text?.format === 'openplotfont' ? 'data-openplotfont-order="true"' : ''} transform="${itemTransform(item)}" style="color:${item.stroke}">${item.markup}</g>`;
}

export function serializeDocument(items: ArtworkItem[], width: number, height: number): string {
  const body = items.map((item) => `<g transform="${itemTransform(item)}" fill="none" stroke="${item.stroke}" stroke-width="0.35" stroke-linecap="round" stroke-linejoin="round">${item.markup}</g>`).join("\n  ");
  return `<svg xmlns="${SVG_NS}" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" fill="none">\n  ${body}\n</svg>\n`;
}

function* plotPathSteps(svg: SVGSVGElement, spacingMm = 0.7, skipGenerated = false, generated: PlotPath[] = [], toleranceMm?:number): Generator<void, PlotPath[]> {
  const rootMatrix = svg.getScreenCTM();
  if (!rootMatrix) return [];
  const inverseRoot = rootMatrix.inverse();
  const paths: PlotPath[] = [];
  const artwork = svg.querySelector("#artwork-layer") ?? svg;
  const bySource = new Map<string, PlotPath[]>();
  for (const path of generated) if (path.sourceKey) { const list = bySource.get(path.sourceKey) ?? []; list.push(path); bySource.set(path.sourceKey, list); }
  const layerNodes=Array.from(artwork.querySelectorAll<SVGGElement>('g')).filter(node=>!!sourceLayerLabel(node)||node.getAttributeNS('http://www.inkscape.org/namespaces/inkscape','groupmode')==='layer'||node.getAttribute('inkscape:groupmode')==='layer');
  let sourceOrdinal=0;
  for (const element of artwork.querySelectorAll<SVGGeometryElement>(DRAWABLE)) {
    yield;
    const sourceId=`scene-${sourceOrdinal++}`;element.setAttribute('data-plot-source-id',sourceId);
    const layer=layerNodes.filter(node=>node.contains(element)).at(-1),layerId=layer?.id||`source-layer-${layerNodes.indexOf(layer!)}`;
    const append=(...incoming:PlotPath[])=>{paths.push(...incoming.map(path=>({...path,sourceId,sourceOrder:sourceOrdinal-1,...(layer?{layerId}:{})})));};
    if(layer&&(parseLayerControls(sourceLayerLabel(layer)).documentation||getComputedStyle(layer).display==='none'||getComputedStyle(layer).visibility==='hidden'))continue;
    if (skipGenerated && element.closest("[data-generated-fill]")) continue;
    if (skipGenerated && element.hasAttribute('data-fill-source')) {
      const sourceKey = element.getAttribute('data-fill-path-key') ?? '';
      append(...(bySource.get(sourceKey) ?? []));
      // Several editable glyphs can share one resolved batch. Insert that batch
      // at its first source only, retaining intentional strokes within it.
      bySource.delete(sourceKey);
      continue;
    }
    if (element.closest(".selection-ui,defs,clipPath,mask,pattern,marker,symbol") || element.hasAttribute("data-fill-source")) continue;
    const matrix = element.getScreenCTM();
    if (!matrix) continue;
    const transform = inverseRoot.multiply(matrix);
    const orderRoot = element.closest<SVGGElement>('[data-openplotfont-order]');
    const orderGroup = orderRoot?.dataset.itemId;
    if (element.getAttribute('data-openplotfont-kind') === 'stroke') {
      const commands = parsePath(element.getAttribute('d') ?? '').map(command => ({...command,values:command.values.flatMap((_,i,values)=>{
        if(i%2)return [];const p=new DOMPoint(values[i]!,values[i+1]!).matrixTransform(transform);return [p.x,p.y];
      })}));
      const points = flattenContour(commands, .005);
      if(points.length>1) append({points,tool:getComputedStyle(element).stroke,orderGroup});
      continue;
    }
    // Fill output is already flattened page-space geometry. Preserve each vertex:
    // resampling a connected hatch can cut across a hole at a corner.
    if (element.closest('[data-generated-fill]') && element.localName === 'path') {
      const points = parsePath(element.getAttribute('d') ?? '').filter(c => c.type === 'M' || c.type === 'L').map(c => {
        const p = new DOMPoint(c.values[0]!, c.values[1]!).matrixTransform(transform);
        return { x: p.x, y: p.y };
      });
      if (points.length > 1) append({ points, tool: getComputedStyle(element).stroke, width: Number(element.getAttribute('stroke-width')) || .35, orderGroup });
      continue;
    }
    if(toleranceMm!==undefined){
      const mode=layer?parseLayerControls(sourceLayerLabel(layer)).handlingMetadata:undefined,localTolerance=mode===2?.0508:mode===3?.2032:mode===4?.127:toleranceMm;
      const contours=flattenSvgGeometry(element,[transform.a,transform.b,transform.c,transform.d,transform.e,transform.f],localTolerance);
      const stroke=getComputedStyle(element).stroke;for(const points of contours){if(points.length>1)append({points,tool:stroke&&stroke!=='none'?stroke:'rgb(23, 23, 20)',orderGroup});yield;}
      continue;
    }
    const geometries: SVGGeometryElement[] = [];
    if (element.localName === "path") {
      // Sample each contour independently so moves never become pen-down travel.
      const contours: ReturnType<typeof parsePath>[] = [];
      for (const command of parsePathSteps(element.getAttribute("d") ?? "")) {
        yield;
        if (command.type === "M") contours.push([]);
        contours.at(-1)?.push(command);
      }
      for (const contour of contours) {
        const path = document.createElementNS(SVG_NS, "path");
        const parts:string[]=[];for(const command of contour){parts.push(pathData([command]));yield;}
        path.setAttribute("d", parts.join(" ")); geometries.push(path);
      }
    } else geometries.push(element);
    const physicalScale = Math.hypot(transform.a, transform.b, transform.c, transform.d);
    for (const geometry of geometries) {
    const length = geometry.getTotalLength();
    if (!Number.isFinite(length) || length <= 0) continue;
    const samples = Math.max(1, Math.ceil(length * physicalScale / spacingMm));
    const points: Point[] = [];
    for (let i = 0; i <= samples; i += 1) {
      yield;
      const point = geometry.getPointAtLength((length * i) / samples);
      const transformed = new DOMPoint(point.x, point.y).matrixTransform(transform);
      const next = { x: transformed.x, y: transformed.y };
      const previous = points.at(-1);
      if (!previous || Math.hypot(next.x - previous.x, next.y - previous.y) > (orderGroup ? 0 : 0.01)) points.push(next);
    }
    if (points.length > 1) {
      const computedStroke = getComputedStyle(element).stroke;
      const tool = computedStroke && computedStroke !== "none" && computedStroke !== "rgba(0, 0, 0, 0)"
        ? computedStroke
        : "rgb(23, 23, 20)";
      append({ points, tool, orderGroup });
    }
    }
  }
  return paths;
}

export function flattenPlotPaths(svg:SVGSVGElement,spacingMm=.7):PlotPath[] {
  const steps=plotPathSteps(svg,spacingMm); let step=steps.next();
  while(!step.done) step=steps.next(); return step.value;
}
export async function flattenPlotPathsAsync(svg:SVGSVGElement,work:WorkSlice,generated:PlotPath[],toleranceMm?:number):Promise<PlotPath[]> {
  const steps=plotPathSteps(svg,.7,true,generated,toleranceMm); let step=steps.next();
  while(!step.done) {const pause=work.checkpoint();if(pause) await pause;step=steps.next();}
  return [...step.value,...generated.filter(path=>!path.sourceKey)];
}

export function flattenSvg(svg: SVGSVGElement, spacingMm = 0.7): Point[][] {
  return flattenPlotPaths(svg, spacingMm).map((path) => path.points);
}

export function optimizePaths(paths: Point[][], allowReverse = true, onProgress?: (fraction: number) => void): Point[][] {
  const remaining = paths.map((path) => [...path]);
  const ordered: Point[][] = [];
  let cursor: Point = { x: 0, y: 0 };
  while (remaining.length) {
    let bestIndex = 0;
    let reverse = false;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((path, index) => {
      const start = path[0]!;
      const end = path.at(-1)!;
      const fromStart = Math.hypot(start.x - cursor.x, start.y - cursor.y);
      const fromEnd = allowReverse ? Math.hypot(end.x - cursor.x, end.y - cursor.y) : Number.POSITIVE_INFINITY;
      if (Math.min(fromStart, fromEnd) < bestDistance) {
        bestDistance = Math.min(fromStart, fromEnd);
        bestIndex = index;
        reverse = fromEnd < fromStart;
      }
    });
    const [chosen] = remaining.splice(bestIndex, 1);
    if (!chosen) break;
    if (reverse) chosen.reverse();
    ordered.push(chosen);
    cursor = chosen.at(-1)!;
    onProgress?.(ordered.length / paths.length);
  }
  return ordered;
}

export function optimizePlotPaths(paths: PlotPath[], allowReverse: boolean, onProgress?: (fraction: number) => void): PlotPath[] {
  if (paths.some(path => path.orderGroup)) return optimizeOrderedGroups(paths, allowReverse, onProgress);
  let completed = 0;
  const toolOrder = [...new Set(paths.map((path) => path.tool))];
  return toolOrder.flatMap((tool) => {
    const source = paths.filter((path) => path.tool === tool);
    const ordered = optimizePaths(source.map((path) => path.points), allowReverse, fraction => onProgress?.((completed + source.length * fraction) / paths.length));
    completed += source.length;
    const metadata = new Map<Point, PlotPath>();
    source.forEach(path => { metadata.set(path.points[0]!, path); metadata.set(path.points.at(-1)!, path); });
    return ordered.map((points) => ({ ...metadata.get(points[0]!)!, points, tool }));
  });
}

/** Preserve the complete glyph schedule; optimize travel between atomic text blocks. */
function optimizeOrderedGroups(paths: PlotPath[], allowReverse: boolean, progress?: (fraction: number) => void): PlotPath[] {
  const groups: PlotPath[][] = [];
  for (const path of paths) {
    const last = groups.at(-1);
    if (path.orderGroup && last?.[0]?.orderGroup === path.orderGroup) last.push(path); else groups.push([path]);
  }
  const result: PlotPath[] = []; let cursor: Point = {x:0,y:0};
  while (groups.length) {
    let index = 0, reverse = false, best = Infinity;
    groups.forEach((group, i) => {
      const start = group[0]!.points[0]!, end = group.at(-1)!.points.at(-1)!;
      const forward = Math.hypot(start.x-cursor.x,start.y-cursor.y), backward = allowReverse && !group[0]!.orderGroup ? Math.hypot(end.x-cursor.x,end.y-cursor.y) : Infinity;
      if (Math.min(forward, backward) < best) { best = Math.min(forward, backward); index = i; reverse = backward < forward; }
    });
    const group = groups.splice(index,1)[0]!;
    result.push(...group.map(path=>({...path,points:reverse?[...path.points].reverse():[...path.points]})));
    cursor = result.at(-1)!.points.at(-1)!; progress?.(result.length/paths.length);
  }
  return result;
}

export function splitPathByLength(points: Point[], maxLengthMm: number): Point[][] {
  if (maxLengthMm <= 0 || points.length < 2) return [points];
  const result: Point[][] = [];
  let current: Point[] = [points[0]!];
  let remaining = maxLengthMm;

  for (let index = 1; index < points.length; index += 1) {
    let start = current.at(-1)!;
    const end = points[index]!;
    let segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    while (segmentLength > remaining + 1e-9) {
      const ratio = remaining / segmentLength;
      const cut = { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
      current.push(cut);
      result.push(current);
      current = [cut];
      start = cut;
      segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
      remaining = maxLengthMm;
    }
    current.push(end);
    remaining -= segmentLength;
    if (remaining <= 1e-9 && index < points.length - 1) {
      result.push(current);
      current = [end];
      remaining = maxLengthMm;
    }
  }
  if (current.length > 1) result.push(current);
  return result;
}

export function splitPlotPaths(paths: PlotPath[], maxLengthMm: number): PlotPath[] {
  return paths.flatMap((path) => splitPathByLength(path.points, maxLengthMm).map((points) => ({ ...path, points })));
}

export interface PlotBounds { minX: number; minY: number; maxX: number; maxY: number }

function clipSegment(a: Point, b: Point, bounds: PlotBounds): [Point, Point] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - bounds.minX, bounds.maxX - a.x, a.y - bounds.minY, bounds.maxY - a.y];
  let enter = 0;
  let leave = 1;
  for (let index = 0; index < 4; index += 1) {
    const pi = p[index]!;
    const qi = q[index]!;
    if (Math.abs(pi) < 1e-12) {
      if (qi < 0) return null;
      continue;
    }
    const ratio = qi / pi;
    if (pi < 0) enter = Math.max(enter, ratio);
    else leave = Math.min(leave, ratio);
    if (enter > leave) return null;
  }
  return [
    { x: a.x + enter * dx, y: a.y + enter * dy },
    { x: a.x + leave * dx, y: a.y + leave * dy }
  ];
}

export function clipPlotPaths(paths: PlotPath[], bounds: PlotBounds): PlotPath[] {
  const result: PlotPath[] = [];
  for (const path of paths) {
    let current: Point[] = [];
    for (let index = 1; index < path.points.length; index += 1) {
      const clipped = clipSegment(path.points[index - 1]!, path.points[index]!, bounds);
      if (!clipped) {
        if (current.length > 1) result.push({ ...path, points: current });
        current = [];
        continue;
      }
      const [start, end] = clipped;
      const previous = current.at(-1);
      if (!previous || Math.hypot(previous.x - start.x, previous.y - start.y) > 1e-6) {
        if (current.length > 1) result.push({ ...path, points: current });
        current = [start];
      }
      current.push(end);
    }
    if (current.length > 1) result.push({ ...path, points: current });
  }
  return result;
}

export interface SourceLayer {id:string;name:string;controls:import('@thierryc/plotter-core').LayerControls;hidden:boolean;sourceOrder?:number}
const sourceLayerLabel=(node:Element)=>node.getAttributeNS('http://www.inkscape.org/namespaces/inkscape','label')??node.getAttribute('inkscape:label')??'';
export function readSourceLayers(svg:SVGSVGElement):SourceLayer[]{
 return Array.from(svg.querySelectorAll<SVGGElement>('g')).filter(node=>!!sourceLayerLabel(node)||node.getAttributeNS('http://www.inkscape.org/namespaces/inkscape','groupmode')==='layer'||node.getAttribute('inkscape:groupmode')==='layer').map((node,index)=>({id:node.id||`source-layer-${index}`,name:sourceLayerLabel(node),sourceOrder:(()=>{const n=Array.from(svg.querySelectorAll('[data-plot-source-id]')).findIndex(path=>node.contains(path)||!!(node.compareDocumentPosition(path)&Node.DOCUMENT_POSITION_FOLLOWING));return n<0?Number.MAX_SAFE_INTEGER:n;})(),controls:parseLayerControls(sourceLayerLabel(node)),hidden:getComputedStyle(node).display==='none'||getComputedStyle(node).visibility==='hidden'}));
}
