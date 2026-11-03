import { describe, expect, it } from 'vitest';
import { remapVariationRanges, selectedVariationValue, setVariationRange, sliceVariationRanges, validateVariationRanges, variationRuns } from './text-variation-ranges';

describe('source variation ranges',()=>{
  it('splits overlapping axis values, merges neighbors, and retains other axes on reset',()=>{
    let ranges=setVariationRange([],0,6,'wght',700);
    ranges=setVariationRange(ranges,2,4,'wght',300);ranges=setVariationRange(ranges,0,6,'opsz',14.5);
    expect(ranges.filter(range=>range.tag==='wght').map(range=>[range.start,range.end,range.value])).toEqual([[0,2,700],[2,4,300],[4,6,700]]);
    expect(selectedVariationValue(400,ranges,'wght',0,6)).toBeUndefined();
    expect(selectedVariationValue(400,ranges,'opsz',0,6)).toBe(14.5);
    ranges=setVariationRange(ranges,2,4,'wght',700);
    expect(ranges.filter(range=>range.tag==='wght')).toEqual([{start:0,end:6,tag:'wght',value:700}]);
    expect(setVariationRange(ranges,0,6,'wght').map(range=>range.tag)).toEqual(['opsz']);
  });
  it('inherits insertions, replacements, paste, and complete combining/emoji graphemes',()=>{
    const ranges=[{start:0,end:2,tag:'wght',value:650.5}];
    expect(remapVariationRanges(ranges,'ab cd','abXY cd')).toEqual([{start:0,end:4,tag:'wght',value:650.5}]);
    expect(remapVariationRanges(ranges,'ab cd','Q cd')).toEqual([{start:0,end:1,tag:'wght',value:650.5}]);
    expect(remapVariationRanges([{start:0,end:1,tag:'wght',value:700}],'a','á')).toEqual([{start:0,end:2,tag:'wght',value:700}]);
    const emoji=[{start:0,end:5,tag:'wght',value:700}];
    expect(remapVariationRanges(emoji,'👩‍💻a','👩‍💻Za')).toEqual([{start:0,end:6,tag:'wght',value:700}]);
    expect(remapVariationRanges(ranges,'ab cd',' cd')).toEqual([]);
  });
  it('accepts finite fractional axes and rejects invalid intervals or split graphemes',()=>{
    expect(()=>validateVariationRanges([{start:0,end:2,tag:'opsz',value:14.5}],'á')).not.toThrow();
    expect(()=>validateVariationRanges([{start:0,end:2,tag:1234,value:500}] as never,'á')).toThrow(/variation range/i);
    for(const range of [{start:1,end:2,tag:'wght',value:500},{start:0,end:3,tag:'wght',value:500},{start:0,end:2,tag:'bad',value:500},{start:0,end:2,tag:'wght',value:Infinity}])expect(()=>validateVariationRanges([range],'á')).toThrow(/variation range/i);
  });
  it('slices source offsets and merges equal effective font instances across boundaries',()=>{
    const ranges=[{start:0,end:4,tag:'wght',value:400},{start:1,end:3,tag:'opsz',value:16.5}];
    expect(sliceVariationRanges(ranges,2,4)).toEqual([{start:0,end:2,tag:'wght',value:400},{start:0,end:1,tag:'opsz',value:16.5}]);
    expect(variationRuns(4,{wght:400,opsz:14},ranges)).toEqual([
      {start:0,end:1,values:{wght:400,opsz:14}},
      {start:1,end:3,values:{wght:400,opsz:16.5}},
      {start:3,end:4,values:{wght:400,opsz:14}}
    ]);
    expect(variationRuns(4,{wght:400},[{start:0,end:2,tag:'wght',value:400}])).toEqual([{start:0,end:4,values:{wght:400}}]);
  });
});
