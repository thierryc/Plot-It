import {describe,it,expect} from 'vitest';
import {setFeatureRange,remapFeatureRanges,validateFeatureRanges,sliceFeatureRanges} from '@thierryc/openplotfont';
import {wrapTextLines} from './text-wrap';
describe('source feature ranges',()=>{
  it('splits conflicting overrides and resets only the requested source interval',()=>{
    const ranges=setFeatureRange([{tag:'ss01',value:1,start:0,end:10}],3,6,'ss01',0);
    expect(ranges.map(r=>[r.start,r.end,r.value])).toEqual([[0,3,1],[3,6,0],[6,10,1]]);
    expect(setFeatureRange(ranges,2,8).map(r=>[r.start,r.end])).toEqual([[0,2],[8,10]]);
  });
  it('inherits insertion and replacement formatting and shifts surviving text',()=>{
    const ranges=[{tag:'ss01',value:1,start:0,end:3}];
    expect(remapFeatureRanges(ranges,'abc def','abXYc def')).toEqual([{tag:'ss01',value:1,start:0,end:5}]);
    expect(remapFeatureRanges(ranges,'abc def','aQ def')).toEqual([{tag:'ss01',value:1,start:0,end:2}]);
    expect(remapFeatureRanges(ranges,'abc def',' def')).toEqual([]);
    expect(sliceFeatureRanges(ranges,2,4)).toEqual([{tag:'ss01',value:1,start:0,end:1}]);
  });
  it('maps repeated words and consumed spaces to their original source coordinates',()=>{
    const lines=wrapTextLines('fi  fi\nfi',2,s=>s.length);
    expect(lines).toEqual([{text:'fi',start:0,end:2},{text:'fi',start:4,end:6},{text:'fi',start:7,end:9}]);
  });
  it('rejects malformed and out-of-bounds persisted ranges',()=>{
    for(const r of [{tag:'ss01',value:1,start:0,end:20},{tag:'ss01',value:-1,start:0,end:1},{tag:'bad',value:1,start:0,end:1}])expect(()=>validateFeatureRanges([r],3)).toThrow();
  });
});
