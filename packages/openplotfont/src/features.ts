export interface FeatureRange { start: number; end: number; tag: string; value: number }
export function validateFeatureRanges(ranges: readonly FeatureRange[], length: number): void {
  if (!Array.isArray(ranges) || ranges.length > 10000) throw new Error('Invalid feature ranges.');
  for (const r of ranges) if (!r || !Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < 0 || r.start >= r.end || r.end > length || !/^[ -~]{4}$/.test(r.tag) || !Number.isInteger(r.value) || r.value < 0 || r.value > 0xffffffff) throw new Error('Invalid feature range.');
}
export function sliceFeatureRanges(ranges: readonly FeatureRange[] = [], start: number, end: number): FeatureRange[] {
  return ranges.filter(r => r.start < end && r.end > start).map(r => ({...r,start:Math.max(start,r.start)-start,end:Math.min(end,r.end)-start}));
}
export function setFeatureRange(ranges: readonly FeatureRange[], start: number, end: number, tag?: string, value?: number): FeatureRange[] {
  const result = ranges.flatMap(r => r.end <= start || r.start >= end || tag && r.tag !== tag ? [{...r}] : [ ...(r.start < start ? [{...r,end:start}] : []), ...(r.end > end ? [{...r,start:end}] : []) ]);
  if (tag && value !== undefined && end > start) result.push({start,end,tag,value});
  return result.sort((a,b)=>a.tag.localeCompare(b.tag)||a.start-b.start).reduce<FeatureRange[]>((out,r)=> { const last=out.at(-1); if(last && last.tag===r.tag && last.value===r.value && last.end===r.start) last.end=r.end; else out.push({...r}); return out; },[]);
}
export function remapFeatureRanges(ranges: readonly FeatureRange[], before: string, after: string): FeatureRange[] {
  let start=0,end=before.length,nextEnd=after.length;
  while(start<end && start<nextEnd && before[start]===after[start]) start++;
  // Keep replacement boundaries outside surrogate pairs.
  if(start && /[\uDC00-\uDFFF]/.test(before[start]??'')) start--;
  while(end>start && nextEnd>start && before[end-1]===after[nextEnd-1]) {end--;nextEnd--;}
  const delta=nextEnd-end, inherited = ranges.filter(r=>r.start <= (start<end?start:Math.max(0,start-1)) && r.end > (start<end?start:Math.max(0,start-1)));
  let result=ranges.flatMap(r=>[...(r.start<start?[{...r,end:Math.min(r.end,start)}]:[]),...(r.end>end?[{...r,start:Math.max(r.start,end)+delta,end:r.end+delta}]:[])]);
  for(const r of inherited) if(nextEnd>start) result=setFeatureRange(result,start,nextEnd,r.tag,r.value);
  return setFeatureRange(result,0,0);
}
