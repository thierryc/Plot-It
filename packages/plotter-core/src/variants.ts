import {clone} from './identity.js';
import {compileJob} from './compiler.js';
import {compileLayerProgram} from './layer-program.js';
import type {ExecutablePlan,Path,PlotOptions} from './types.js';
import type {Layer} from './sequence.js';
/** Seeded cyclic starts preserve every edge/direction. Protected operations stay fixed. */
export function variedCopy(paths:readonly Path[],options:PlotOptions,copy:number,baseSeed=1,layers?:readonly Layer[],offsetMm=0):ExecutablePlan {
 let seed=(baseSeed^Math.imul(copy,0x9e3779b9))>>>0;
 const vary=(path:Path):Path=>{const p=clone(path),points=p.points,n=points.length-1;if(n<3||'orderGroup'in p||'sourceKey'in p||Math.hypot(points[0]!.x-points[n]!.x,points[0]!.y-points[n]!.y)>1e-9)return p;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const at=seed%n,body=[...points.slice(at,n),...points.slice(0,at)];p.points=[...body,{...body[0]!}];return p;};
 if(offsetMm)throw new Error('Varied closed starts cannot be combined with a recovered drawing offset.');
 return layers?compileLayerProgram(layers.map(l=>({...clone(l),paths:l.paths.map(vary)})),options):compileJob(paths.map(vary),options);
}
