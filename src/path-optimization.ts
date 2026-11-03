import type { PlotSettings, Point } from './model';
import type { PlotPath } from './svg';

export const PATH_OPTIMIZATION_DEFAULTS = {
  pathJoinToleranceMm: 0, pathSimplifyToleranceMm: 0,
  closedPathStart: 'preserve' as NonNullable<PlotSettings['closedPathStart']>, pathRandomSeed: 1,
};

export function pathOptimizationSettings(settings: Partial<PlotSettings>) {
  const result = { ...PATH_OPTIMIZATION_DEFAULTS };
  for (const key of ['pathJoinToleranceMm', 'pathSimplifyToleranceMm'] as const) {
    const value = settings[key];
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) throw new Error(`Invalid ${key}.`);
      result[key] = value;
    }
  }
  if (settings.closedPathStart !== undefined) {
    if (!['preserve', 'nearest', 'random'].includes(settings.closedPathStart)) throw new Error('Invalid closedPathStart.');
    result.closedPathStart = settings.closedPathStart;
  }
  if (settings.pathRandomSeed !== undefined) {
    if (!Number.isInteger(settings.pathRandomSeed) || settings.pathRandomSeed < 0 || settings.pathRandomSeed > 0xffffffff) throw new Error('Invalid pathRandomSeed.');
    result.pathRandomSeed = settings.pathRandomSeed;
  }
  return result;
}

const squareDistance = (a: Point, b: Point) => (a.x-b.x)**2 + (a.y-b.y)**2;
const samePoint = (a: Point, b: Point) => squareDistance(a,b) <= 1e-18;
const copyPath = (path: PlotPath): PlotPath => ({ ...path, points: path.points.map(point=>({...point})) });
/** Generated fills and ordered font operations keep their authored geometry. */
export const protectedPath = (path: PlotPath) => !!path.orderGroup || !!path.sourceKey;
export const closedPolyline = (points: Point[]) => points.length >= 4 && samePoint(points[0]!,points.at(-1)!);

function segmentDistanceSquared(point: Point, start: Point, end: Point): number {
  const length = squareDistance(start,end);
  const fraction = length ? Math.max(0,Math.min(1,((point.x-start.x)*(end.x-start.x)+(point.y-start.y)*(end.y-start.y))/length)) : 0;
  return squareDistance(point,{x:start.x+(end.x-start.x)*fraction,y:start.y+(end.y-start.y)*fraction});
}

/** Iterative maximum-deviation reduction; endpoints and explicit closure are retained. */
export function simplifyPolyline(points: Point[], toleranceMm: number): Point[] {
  if (!Number.isFinite(toleranceMm) || toleranceMm < 0) throw new Error('Invalid simplification tolerance.');
  if (toleranceMm === 0 || points.length < 3) return points.map(point=>({...point}));
  const closed = closedPolyline(points), keep = new Set([0,points.length-1]);
  const work: Array<[number,number]> = [];
  if (closed) {
    // Split a ring at its farthest vertex rather than simplifying a zero-length chord.
    let pivot = 1;
    for (let i=2;i<points.length-1;i++) if (squareDistance(points[0]!,points[i]!) > squareDistance(points[0]!,points[pivot]!)) pivot=i;
    keep.add(pivot); work.push([0,pivot],[pivot,points.length-1]);
  } else work.push([0,points.length-1]);
  while (work.length) {
    const [start,end] = work.pop()!;
    let selected = -1, distance = toleranceMm*toleranceMm;
    for (let i=start+1;i<end;i++) {
      const candidate=segmentDistanceSquared(points[i]!,points[start]!,points[end]!);
      if (candidate > distance) { selected=i; distance=candidate; }
    }
    if (selected >= 0) { keep.add(selected); work.push([start,selected],[selected,end]); }
  }
  const result=[...keep].sort((a,b)=>a-b).map(index=>({...points[index]!}));
  // Do not collapse a ring into a dot or a doubled line at large tolerances.
  if (closed && new Set(result.slice(0,-1).map(point=>`${point.x},${point.y}`)).size < 3) return points.map(point=>({...point}));
  if (closed) result[result.length-1]={...result[0]!};
  return result;
}

/** Rotate only the cyclic start; every edge and the drawing direction are retained. */
export function rotateClosedPath(points: Point[], index: number): Point[] {
  if (!closedPolyline(points)) return points.map(point=>({...point}));
  const ring=points.slice(0,-1), start=((index%ring.length)+ring.length)%ring.length;
  const rotated=[...ring.slice(start),...ring.slice(0,start)].map(point=>({...point}));
  rotated.push({...rotated[0]!}); return rotated;
}

export function nearestClosedVertex(points: Point[], cursor: Point): number {
  let selected=0;
  for (let i=1;i<points.length-1;i++) if (squareDistance(cursor,points[i]!) < squareDistance(cursor,points[selected]!)) selected=i;
  return selected;
}

export function seededPathRandom(seed: number): () => number {
  let state=seed>>>0;
  return () => { state=(Math.imul(state,1664525)+1013904223)>>>0; return state/2**32; };
}

/** Join open paths at either end, using a local endpoint grid and stable nearest ties. */
export function joinNearbyPaths(paths: PlotPath[], toleranceMm: number, allowReverse: boolean): PlotPath[] {
  if (!Number.isFinite(toleranceMm) || toleranceMm < 0) throw new Error('Invalid endpoint tolerance.');
  if (!toleranceMm || paths.length < 2) return paths.map(copyPath);
  const grid=new Map<string, Array<{index:number; end:boolean}>>(), used=new Set<number>();
  const cell=(point:Point):[number,number]=>[Math.floor(point.x/toleranceMm),Math.floor(point.y/toleranceMm)];
  const eligible=(path:PlotPath)=>path.points.length>=2&&!protectedPath(path)&&!closedPolyline(path.points);
  paths.forEach((path,index)=>{
    if (!eligible(path)) return;
    for (const end of [false,true]) {
      const [x,y]=cell(end?path.points.at(-1)!:path.points[0]!),key=`${x},${y}`;
      const entries=grid.get(key)??[]; entries.push({index,end}); grid.set(key,entries);
    }
  });
  const result:PlotPath[]=[];
  for (let seed=0;seed<paths.length;seed++) {
    if (used.has(seed)) continue;
    used.add(seed); const base=paths[seed]!;
    if (!eligible(base)) { result.push(copyPath(base)); continue; }
    const heads:PlotPath[]=[],tails:PlotPath[]=[];
    let start=base.points[0]!,end=base.points.at(-1)!;
    while (!samePoint(start,end)) {
      let best: {index:number; prepend:boolean; reverse:boolean; distance:number} | undefined;
      for (const prepend of [false,true]) {
        const anchor=prepend?start:end,[x,y]=cell(anchor);
        for (let dx=-1;dx<=1;dx++) for (let dy=-1;dy<=1;dy++) for (const entry of grid.get(`${x+dx},${y+dy}`)??[]) {
          const candidate=paths[entry.index]!;
          if (used.has(entry.index)||candidate.tool!==base.tool||candidate.width!==base.width) continue;
          const reverse=prepend?!entry.end:entry.end;
          if (reverse&&!allowReverse) continue;
          const distance=squareDistance(anchor,entry.end?candidate.points.at(-1)!:candidate.points[0]!);
          if (distance > toleranceMm*toleranceMm + 1e-18) continue;
          if (!best||distance<best.distance||distance===best.distance&&entry.index<best.index) best={index:entry.index,prepend,reverse,distance};
        }
      }
      if (!best) break;
      used.add(best.index); const next=copyPath(paths[best.index]!);
      if (best.reverse) next.points.reverse();
      if (best.prepend) { heads.push(next); start=next.points[0]!; } else { tails.push(next); end=next.points.at(-1)!; }
    }
    const points:Point[]=[];
    for (const fragment of [...heads.reverse(),base,...tails]) for (const point of fragment.points) {
      if (!points.length||!samePoint(points.at(-1)!,point)) points.push({...point});
    }
    result.push({...base,points});
  }
  return result;
}

/** Joining never crosses protected operations, generated fills, or existing closed paths. */
export function optimizePathUnits(units: PlotPath[][], settings: PlotSettings, preserveOrder = false): PlotPath[][] {
  const options=pathOptimizationSettings(settings), random=seededPathRandom(options.pathRandomSeed);
  const joined:PlotPath[][]=[];
  let run:PlotPath[]=[];
  const flush=()=>{
    if (!run.length) return;
    if (preserveOrder||settings.reorderMode==='preserve') {
      const consecutive:PlotPath[]=[];
      for (const path of run) {
        const previous=consecutive.at(-1);
        if (options.pathJoinToleranceMm>0&&previous&&!closedPolyline(previous.points)&&previous.tool===path.tool&&previous.width===path.width
          &&squareDistance(previous.points.at(-1)!,path.points[0]!)<=options.pathJoinToleranceMm**2+1e-18) {
          previous.points.push(...path.points.slice(samePoint(previous.points.at(-1)!,path.points[0]!)?1:0).map(point=>({...point})));
        } else consecutive.push(copyPath(path));
      }
      joined.push(...consecutive.map(path=>[path]));
    } else joined.push(...joinNearbyPaths(run,options.pathJoinToleranceMm,settings.reorderMode==='reversible').map(path=>[path]));
    run=[];
  };
  for (const unit of units) {
    const path=unit[0];
    if (unit.length===1&&path&&!protectedPath(path)&&!closedPolyline(path.points)&&path.points.length>=2) run.push(path);
    else { flush(); joined.push(unit.map(copyPath)); }
  }
  flush();
  return joined.map(unit=>unit.map(path=>{
    if (protectedPath(path)) return path;
    let points=simplifyPolyline(path.points,options.pathSimplifyToleranceMm);
    if (options.closedPathStart==='random'&&closedPolyline(points)) points=rotateClosedPath(points,Math.floor(random()*(points.length-1)));
    return {...path,points};
  }));
}
