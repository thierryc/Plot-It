import {beforeAll,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {initializeTypography,registerOpenPlotFont,findFont,defaultTextOptions,typographyToItem} from './typography';
import {withBasicTextDefaults} from './text-feature-defaults';
beforeAll(async()=>{await initializeTypography();await registerOpenPlotFont(readFileSync(new URL('./test-fonts/openplotfont/layout-demo.opf.json',import.meta.url),'utf8'),'defaults-demo');});
describe('applying defaults to existing text',()=>{
  it('clears conflicting basic overrides while retaining other features and transforms',()=>{
    const item=typographyToItem('fi AA',12,{...defaultTextOptions,fontId:'defaults-demo',kerning:false,ligatures:false,contextual:false,features:'kern=0, liga=0, calt=0, ss01=1',featureRanges:[{tag:'liga',value:0,start:0,end:2},{tag:'ss01',value:1,start:3,end:5}]});
    item.x=37;item.y=45;item.rotation=22;
    const original=structuredClone(item),updated=withBasicTextDefaults(item,findFont('defaults-demo')!)!;
    expect(item).toEqual(original);expect(updated.markup).not.toBe(item.markup);
    expect(updated.text!.options).toMatchObject({kerning:true,ligatures:true,contextual:true,features:'ss01=1',featureRanges:[{tag:'ss01',value:1,start:3,end:5}]});
    expect([updated.x,updated.y,updated.rotation,updated.text!.content,updated.name]).toEqual([37,45,22,item.text!.content,item.name]);
    expect(withBasicTextDefaults(updated,findFont('defaults-demo')!)).toBeUndefined();
  });
  it('enables supported ligatures explicitly on blocks with tracking',()=>{
    const item=typographyToItem('fi',12,{...defaultTextOptions,fontId:'defaults-demo',letterSpacing:.1,ligatures:false});
    const updated=withBasicTextDefaults(item,findFont('defaults-demo')!)!;
    expect(updated.text!.options!.features).toContain('liga=1');expect(updated.markup).not.toBe(item.markup);
  });
});
