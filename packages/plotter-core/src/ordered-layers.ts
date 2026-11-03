import type {Path} from './types.js';
import type {Layer} from './sequence.js';
/** Implicit drawing between explicit layers is a barrier, not one merged bucket. */
export function orderedLayerRuns(paths:readonly Path[],definitions:readonly Layer[]):Layer[]{
 const byId=new Map(definitions.map(l=>[l.id,l])),result:Layer[]=[],seen=new Set<string>();let last:string|null=null;
 for(const path of paths){const key=path.layerId??'default',definition=byId.get(key)??{id:key,name:'Drawing',paths:[]};if(last!==key){const repeated=seen.has(key);result.push({...definition,id:repeated?`${key}:run-${result.length}`:key,sourceLayerId:key,sourceOrder:path.sourceOrder??definition.sourceOrder,paths:[],...(repeated?{pause:false,delayMs:0}:{})});seen.add(key);last=key;}const layer=result.at(-1)!;layer.paths=[...layer.paths,path];}
 // Empty layers carry their source anchor so their timer/gate survives optimization.
 for(const definition of definitions)if(!seen.has(definition.id)){const index=result.findIndex(l=>(l.sourceOrder??Infinity)>(definition.sourceOrder??Infinity));result.splice(index<0?result.length:index,0,{...definition,paths:[]});}
 return result;
}
