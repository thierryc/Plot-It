// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTypography, registerFont, typographyToItem, defaultTextOptions, migrateOutlineText, splitContours } from './typography';
import { elements, markupRoot, parsePath, pathData } from './editor';
import { flattenContour } from '@thierryc/plotfont';
import { generateGeometry, resolveRegionBoundaries, type GeometryJob } from './fill';
import { defaultFillSettings, initialState, type ArtworkItem, type Point } from './model';
import { isOutlineGlyph } from './outline-source';
import { parsePlotIt, serializePlotIt } from './document-file';
import { fillItemKey } from './fill-dom';

beforeAll(async()=>{
  await initializeTypography();
  const data=readFileSync('public/fonts/library/inter/inter.ttf');
  registerFont(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength) as ArrayBuffer,'Inter','inter-test');
});
const make=(content:string,changes={})=>typographyToItem(content,12,{...defaultTextOptions,fontId:'inter-test',...changes});
function winding(rings: Point[][], p: Point): number {
  let n=0;
  for(const ring of rings)for(let i=0;i<ring.length;i++){
    const a=ring[i]!,b=ring[(i+1)%ring.length]!,cross=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
    if(a.y<=p.y&&b.y>p.y&&cross>0)n++;
    if(a.y>p.y&&b.y<=p.y&&cross<0)n--;
  }
  return n;
}
function legacy(item:ArtworkItem): ArtworkItem {
  return {...structuredClone(item),markup:elements(markupRoot(item.markup)).flatMap(p=>splitContours(parsePath(p.getAttribute('d')!)).map(c=>`<path d="${pathData(c)}"/>`)).join('')};
}
function geometry(item: ArtworkItem): GeometryJob {
  const sx=item.width/item.viewBox[2],sy=item.height/item.viewBox[3];
  const groups=elements(markupRoot(item.markup)).map(p=>({rule:'nonzero' as const,contours:splitContours(parsePath(p.getAttribute('d')!)).map(c=>flattenContour(c.map(cmd=>({...cmd,values:cmd.values.map((v,i)=>v*(i%2?sy:sx))})),.005))}));
  return {contours:[],groups,rule:'nonzero',settings:defaultFillSettings,perimeter:true,key:'text',tool:'#000000',outlineTool:'#000000',outlineWidth:.35};
}
describe('Inter outline source and migration',()=>{
  it('preserves editable curves, glyph grouping, and both counters in B',()=>{
    const item=make('BO'),paths=elements(markupRoot(item.markup));
    expect(paths).toHaveLength(2);expect(paths.every(isOutlineGlyph)).toBe(true);
    expect(item.markup).toMatch(/[CQ]/);
    const result=generateGeometry(geometry(item));
    expect(result.paths).toHaveLength(5);
    for(const path of result.paths) expect(path.points[0]).toEqual(path.points.at(-1));
  });
  it('removes Inter component and text overlaps, including multiline overlap',()=>{
    const e=make('e'),job=geometry(e);
    const source=job.groups!.flatMap(g=>g.contours);
    const result=generateGeometry(job);
    expect(result.paths).toHaveLength(2);
    let seams=0;
    for(const ring of source)for(let i=1;i<ring.length;i++){
      const a=ring[i-1]!,b=ring[i]!,length=Math.hypot(b.x-a.x,b.y-a.y);if(length<1e-6)continue;
      const x=(a.x+b.x)/2,y=(a.y+b.y)/2,dx=-(b.y-a.y)/length*.0001,dy=(b.x-a.x)/length*.0001;
      if(winding(source,{x:x+dx,y:y+dy})!==0&&winding(source,{x:x-dx,y:y-dy})!==0)seams++;
    }
    expect(seams).toBeGreaterThan(0);
    for(const path of result.paths)for(let i=1;i<path.points.length;i++){
      const a=path.points[i-1]!,b=path.points[i]!,length=Math.hypot(b.x-a.x,b.y-a.y);
      const x=(a.x+b.x)/2,y=(a.y+b.y)/2,dx=-(b.y-a.y)/length*.0001,dy=(b.x-a.x)/length*.0001;
      expect(winding(source,{x:x+dx,y:y+dy})!==0).not.toBe(winding(source,{x:x-dx,y:y-dy})!==0);
    }
    const repeated=make('HH',{letterSpacing:-.3}),overlap=generateGeometry(geometry(repeated));
    const separate=geometry(repeated).groups!.flatMap(g=>resolveRegionBoundaries(g.contours,g.rule));
    expect(overlap.paths.length).toBeLessThan(separate.length);
    const stacked=geometry(make('H\nH',{lineHeight:.5})),lines=generateGeometry(stacked);
    const area=(rings:Point[][])=>Math.abs(rings.reduce((n,r)=>n+r.reduce((a,p,i)=>{const q=r[(i+1)%r.length]!;return a+(p.x*q.y-q.x*p.y)/2;},0),0));
    // Overlapping H stems join; the two crossbars create a real enclosed hole.
    expect(lines.paths).toHaveLength(2);
    expect(area(lines.paths.map(p=>p.points))).toBeLessThan(stacked.groups!.reduce((n,g)=>n+area(resolveRegionBoundaries(g.contours,g.rule)),0));
  });
  it('resolves heavier variable outlines and anisotropic scaling in physical units',()=>{
    const light=make('Hello',{variations:'wght=100'}),heavy=make('Hello',{variations:'wght=900'});
    const a=generateGeometry(geometry(light)),b=generateGeometry(geometry(heavy));
    expect(a.paths).not.toEqual(b.paths);
    const stretched=structuredClone(heavy);stretched.width*=3;
    const c=generateGeometry(geometry(stretched));
    const extent=(result:typeof a)=>Math.max(...result.paths.flatMap(p=>p.points.map(q=>q.x)))-Math.min(...result.paths.flatMap(p=>p.points.map(q=>q.x)));
    expect(extent(c)/extent(b)).toBeCloseTo(3,3);
  });
  it('upgrades only matching legacy paths, preserving placement and options',()=>{
    const item=legacy(make('Hello',{variations:'wght=700'}));
    Object.assign(item,{x:42,y:37,rotation:28,width:item.width*2,stroke:'#ff0000'});
    const before=structuredClone(item),result=migrateOutlineText(item);
    expect(result.notice).toBeUndefined();expect(result.replacement).toBeDefined();
    expect({...result.replacement,markup:item.markup}).toEqual(item);expect(item).toEqual(before);
    expect(migrateOutlineText(result.replacement!)).toEqual({});
  });
  it('preserves node edits, element overrides and unavailable fonts with a notice',()=>{
    const modified=legacy(make('e'));
    modified.markup=modified.markup.replace(/M[\d.-]+/, 'M999');
    const override=legacy(make('e'));override.markup=override.markup.replace('<path ', '<path stroke="red" ');
    const missing=legacy(make('e'));missing.text!.options!.fontId='missing-font';
    for(const item of [modified,override,missing]) {
      const before=structuredClone(item),result=migrateOutlineText(item);
      expect(result.replacement).toBeUndefined();expect(result.notice).toContain('preserved');expect(item).toEqual(before);
    }
  });
  it('accepts benign namespace attributes introduced by browser XML serialization',()=>{
    const item=legacy(make('Hello'));
    item.markup=item.markup.replaceAll('<path ', '<path xmlns="http://www.w3.org/2000/svg" ');
    expect(migrateOutlineText(item).replacement).toBeDefined();
  });
  it('retains manually edited grouped source without regenerating it',()=>{
    const item=make('e');item.markup=item.markup.replace(/M[\d.-]+/,'M999');
    expect(migrateOutlineText(item)).toEqual({});
  });
  it('round-trips source grouping in version 1 without generated geometry',()=>{
    const state=structuredClone(initialState);state.items=[make('Hello')];
    const saved=serializePlotIt(state),restored=parsePlotIt(saved).state;
    expect(JSON.parse(saved).version).toBe(1);expect(saved).not.toContain('data-generated-fill');
    expect(elements(markupRoot(restored.items[0]!.markup)).every(isOutlineGlyph)).toBe(true);
    expect(generateGeometry(geometry(restored.items[0]!))).toEqual(generateGeometry(geometry(state.items[0]!)));
  });
  it('keeps generated paths out of element indexing and invalidates changed classification',()=>{
    const root=markupRoot('<path d="M0 0L1 1"/><g data-generated-fill="true"><path d="M1 1L2 2"/></g>');
    expect(elements(root)).toHaveLength(1);
    const item=make('Hello'),key=fillItemKey(item);delete item.text;
    expect(fillItemKey(item)).not.toBe(key);
  });
});
