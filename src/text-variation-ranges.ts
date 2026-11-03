import { remapFeatureRanges, setFeatureRange, sliceFeatureRanges } from '@thierryc/openplotfont';

/** Half-open UTF-16 ranges into normalized source text; values may be fractional. */
export interface VariationRange { start: number; end: number; tag: string; value: number }
export function validateVariationRanges(ranges: readonly VariationRange[], content: string): void {
  if (!Array.isArray(ranges) || ranges.length > 10000) throw new Error('Invalid variation ranges.');
  if(!ranges.length)return;
  const boundaries=new Set([...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(content)].map(part=>part.index).concat(content.length));
  for(const range of ranges)if(!range || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start<0 || range.start>=range.end || range.end>content.length || typeof range.tag!=='string' || !/^[ -~]{4}$/.test(range.tag) || !Number.isFinite(range.value) || !boundaries.has(range.start) || !boundaries.has(range.end))throw new Error('Invalid variation range: use finite values and complete grapheme boundaries.');
}
export function setVariationRange(ranges: readonly VariationRange[], start: number, end: number, tag?: string, value?: number): VariationRange[] {
  return setFeatureRange(ranges,start,end,tag,value);
}
export const sliceVariationRanges = (ranges: readonly VariationRange[] | undefined, start: number, end: number): VariationRange[] => sliceFeatureRanges(ranges,start,end);
export function remapVariationRanges(ranges: readonly VariationRange[], before: string, after: string): VariationRange[] {
  if(!ranges.length)return [];
  const boundaries=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(after)].map(part=>part.index).concat(after.length);
  const snap=(index:number,up:boolean)=>{
    let low=0,high=boundaries.length-1;
    while(low<high){const mid=up?Math.floor((low+high)/2):Math.ceil((low+high)/2);if(up?boundaries[mid]!<index:boundaries[mid]!<=index)low=up?mid+1:mid;else high=up?mid:mid-1;}
    return boundaries[low]!;
  };
  return remapFeatureRanges(ranges,before,after).reduce<VariationRange[]>((result,range)=>setVariationRange(result,snap(range.start,false),snap(range.end,true),range.tag,range.value),[]);
}
export function variationValues(expression: string): Record<string,number> {
  const result:Record<string,number>={};
  for(const token of expression.split(',')){
    const match=token.trim().match(/^([ -~]{4})\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/);
    if(match)result[match[1]!]=Number(match[2]);
  }
  return result;
}
export function variationValueAt(base: number, ranges: readonly VariationRange[], tag: string, at: number): number {
  let value=base;for(const range of ranges)if(range.tag===tag && range.start<=at && at<range.end)value=range.value;return value;
}
export function selectedVariationValue(base: number, ranges: readonly VariationRange[], tag: string, start: number, end: number): number | undefined {
  const positions=new Set([start,...ranges.filter(range=>range.tag===tag&&range.start<end&&range.end>start).flatMap(range=>[Math.max(start,range.start),...(range.end<end?[range.end]:[])])]);
  const values=[...positions].map(at=>variationValueAt(base,ranges,tag,at));return values.every(value=>value===values[0])?values[0]:undefined;
}
export interface VariationRun { start: number; end: number; values: Record<string,number> }
/** Sweep range boundaries; merge equal font instances to preserve their shaping. */
export function variationRuns(length: number, base: Record<string,number>, ranges: readonly VariationRange[]): VariationRun[] {
  const events=new Map<number,{starts:number[];ends:number[]}>();
  const event=(at:number)=>{let value=events.get(at);if(!value){value={starts:[],ends:[]};events.set(at,value);}return value;};
  event(0);event(length);
  ranges.forEach((range,index)=>{event(range.start).starts.push(index);event(range.end).ends.push(index);});
  const offsets=[...events.keys()].sort((a,b)=>a-b),active=new Map<string,Map<number,number>>(),runs:VariationRun[]=[];
  let previousKey='';
  for(let i=0;i<offsets.length-1;i++){
    const start=offsets[i]!,end=offsets[i+1]!,changes=events.get(start)!;
    for(const index of changes.ends)active.get(ranges[index]!.tag)?.delete(index);
    for(const index of changes.starts){const range=ranges[index]!;let values=active.get(range.tag);if(!values){values=new Map();active.set(range.tag,values);}values.set(index,range.value);}
    const values={...base};
    for(const [tag,overrides] of active){let last=-1;for(const [index,value] of overrides)if(index>last){values[tag]=value;last=index;}}
    const key=JSON.stringify(Object.entries(values).sort(([a],[b])=>a.localeCompare(b)));
    if(runs.length && key===previousKey)runs.at(-1)!.end=end;else runs.push({start,end,values});previousKey=key;
  }
  return runs;
}
