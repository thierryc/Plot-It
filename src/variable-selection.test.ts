import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePath } from './editor';
import { defaultTextOptions, findFont, initializeTypography, registerFont, typographyToItem } from './typography';
import type { ArtworkItem, TextOptions } from './model';

beforeAll(async()=>{
  await initializeTypography();
  for(const [name,id] of [['Roboto.ttf','variable-latin'],['NotoSansArabic.ttf','variable-arabic']]){
    const data=readFileSync(`src/test-fonts/${name}`);registerFont(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength) as ArrayBuffer,id!,id!);
  }
});
const options={...defaultTextOptions,fontId:'variable-latin',variations:'wght=400'};
const make=(text:string,changes:Partial<TextOptions>={})=>typographyToItem(text,12,{...options,...changes});
function shapes(item:ArtworkItem) {
  return [...item.markup.matchAll(/ d="([^"]+)"/g)].map(([,data])=>{
    const commands=parsePath(data!),origin=commands[0]!.values;
    return commands.map(command=>({type:command.type,values:command.values.map((value,index)=>value-origin[index%2]!)}));
  });
}
function sameShape(a:ReturnType<typeof shapes>[number],b:ReturnType<typeof shapes>[number]) {
  expect(a.map(command=>command.type)).toEqual(b.map(command=>command.type));
  a.forEach((command,index)=>{expect(command.values).toHaveLength(b[index]!.values.length);command.values.forEach((value,pair)=>expect(value).toBeCloseTo(b[index]!.values[pair]!,5));});
}
describe('selected-letter variable font shaping',()=>{
  it('changes only selected outlines and preserves both unselected neighbors',()=>{
    const normal=shapes(make('HHH')),selected=shapes(make('HHH',{variationRanges:[{start:1,end:2,tag:'wght',value:850}]}));
    expect(selected).toHaveLength(3);sameShape(selected[0]!,normal[0]!);sameShape(selected[2]!,normal[2]!);expect(selected[1]).not.toEqual(normal[1]);
  });
  it('keeps redundant ranges identical and splits ligatures only at font-instance boundaries',()=>{
    expect(make('ffi',{variationRanges:[{start:0,end:2,tag:'wght',value:400}]}).markup).toBe(make('ffi').markup);
    const normal=shapes(make('ffi ffi')),selected=shapes(make('ffi ffi',{variationRanges:[{start:1,end:2,tag:'wght',value:850}]}));
    expect(normal).toHaveLength(2);expect(selected).toHaveLength(4);sameShape(selected.at(-1)!,normal.at(-1)!);
    expect(shapes(make('ffi ffi',{variationRanges:[{start:1,end:2,tag:'wght',value:850}],featureRanges:[{start:4,end:7,tag:'liga',value:0}]}))).toHaveLength(6);
  });
  it('maps repeated words, consumed spaces, and explicit breaks through wrapping',()=>{
    const width=Math.max(make('HH').viewBox[2],make('HH',{variations:'wght=850'}).viewBox[2])+.1;
    const source='HH  HH\nHH',ranges=[{start:4,end:6,tag:'wght',value:850}];
    const normal=typographyToItem(source,12,options,{width,height:1.4});
    const selected=typographyToItem(source,12,{...options,variationRanges:ranges},{width,height:1.4});
    const a=shapes(normal),b=shapes(selected);expect(b).toHaveLength(6);
    for(const index of [0,1,4,5])sameShape(b[index]!,a[index]!);
    for(const index of [2,3])expect(b[index]).not.toEqual(a[index]);
    expect(selected.text!.content).toBe(source);expect(selected.text!.options!.variationRanges).toEqual(ranges);
  });
  it('keeps RTL run order and Arabic joining context',()=>{
    const normal=shapes(make('ABC',{direction:'rtl'})),selected=shapes(make('ABC',{direction:'rtl',variationRanges:[{start:0,end:1,tag:'wght',value:850}]}));
    sameShape(selected[0]!,normal[0]!);sameShape(selected[1]!,normal[1]!);expect(selected[2]).not.toEqual(normal[2]);
    expect(findFont('variable-arabic')!.axes.wght).toBeDefined();
    const settings={fontId:'variable-arabic',direction:'rtl' as const,script:'Arab',language:'ar'};
    const a=shapes(make('ببب',settings)),b=shapes(make('ببب',{...settings,variationRanges:[{start:1,end:2,tag:'wght',value:850}]}));
    expect(b).toHaveLength(a.length);expect(b).toHaveLength(6);for(const index of [0,1,4,5])sameShape(b[index]!,a[index]!);expect([b[2],b[3]]).not.toEqual([a[2],a[3]]);
    expect(shapes(make('لا',{...settings,direction:'auto',variationRanges:[{start:0,end:1,tag:'wght',value:850}]}))).toHaveLength(2);
  });
  it('rejects unavailable or out-of-bounds axes and split combining sequences',()=>{
    for(const range of [{start:0,end:1,tag:'wght',value:2000},{start:0,end:1,tag:'FAKE',value:1},{start:1,end:2,tag:'wght',value:500}])expect(()=>make('á',{variationRanges:[range]})).toThrow();
    for(const fontId of ['plot-sans','hershey-roman-simplex'])expect(()=>make('ABC',{fontId,variations:'',variationRanges:[{start:0,end:1,tag:'wght',value:500}]})).toThrow();
  });
});
