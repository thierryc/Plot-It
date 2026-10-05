import { describe, expect, it } from 'vitest';
import { generateGeometry, resolveRegionBoundaries, unionResolvedRegions, MAX_FILL_POINTS, type GeometryJob } from './fill';
import { defaultFillSettings, type Point } from './model';

const box = (x: number, y: number, w: number, h: number): Point[] => [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const area = (rings: Point[][]) => Math.abs(rings.reduce((n,r) => n + r.reduce((a,p,i) => {
  const q = r[(i+1)%r.length]!; return a + (p.x*q.y-q.x*p.y)/2;
},0),0));
function winding(rings: Point[][], p: Point): number {
  let n = 0;
  for (const ring of rings) for (let i=0; i<ring.length; i++) {
    const a=ring[i]!,b=ring[(i+1)%ring.length]!;
    const cross=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
    if(a.y<=p.y && b.y>p.y && cross>0) n++;
    if(a.y>p.y && b.y<=p.y && cross<0) n--;
  }
  return n;
}
function expectBoundaries(rings: Point[][], inside: (p: Point) => boolean): void {
  for (const ring of rings) for(let i=0;i<ring.length;i++) {
    const a=ring[i]!,b=ring[(i+1)%ring.length]!,length=Math.hypot(b.x-a.x,b.y-a.y);
    expect(length).toBeGreaterThan(0);
    const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},dx=-(b.y-a.y)/length*.0001,dy=(b.x-a.x)/length*.0001;
    expect(inside({x:mid.x+dx,y:mid.y+dy})).not.toBe(inside({x:mid.x-dx,y:mid.y-dy}));
  }
}
const job = (contours:Point[][], changes:Partial<GeometryJob>={}):GeometryJob => ({contours,rule:'nonzero',settings:{...defaultFillSettings},perimeter:true,key:'test',tool:'#123456',outlineTool:'#654321',outlineWidth:.35,...changes});

describe('resolved perimeter geometry',()=>{
  it('removes rectangle overlap seams and duplicate edges',()=>{
    const input=[box(0,0,10,10),box(5,0,10,10),box(0,0,10,10)];
    const rings=resolveRegionBoundaries(input,'nonzero');
    expect(rings).toHaveLength(1); expect(area(rings)).toBe(150);
    expectBoundaries(rings,p=>winding(input,p)!==0);
  });
  it('preserves counters and islands inside nested holes',()=>{
    const input=[box(0,0,20,20),box(3,3,14,14).reverse(),box(7,7,6,6)];
    const rings=resolveRegionBoundaries(input,'nonzero');
    expect(rings).toHaveLength(3);expect(area(rings)).toBe(240);
    expect(winding(rings,{x:5,y:5})).toBe(0);expect(winding(rings,{x:10,y:10})).not.toBe(0);
    expectBoundaries(rings,p=>winding(input,p)!==0);
  });
  it('distinguishes nonzero and evenodd at a self-intersecting star center',()=>{
    const star=[{x:0,y:-10},{x:5.88,y:8.09},{x:-9.51,y:-3.09},{x:9.51,y:-3.09},{x:-5.88,y:8.09}];
    const nonzero=resolveRegionBoundaries([star],'nonzero'),evenodd=resolveRegionBoundaries([star],'evenodd');
    expect(winding(nonzero,{x:0,y:0})).not.toBe(0);expect(winding(evenodd,{x:0,y:0})).toBe(0);
    expect(area(nonzero)).toBeGreaterThan(area(evenodd));
    expectBoundaries(nonzero,p=>winding([star],p)!==0);
    expectBoundaries(evenodd,p=>Math.abs(winding([star],p))%2===1);
  });
  it('resolves glyphs separately so opposite glyph winding cannot cancel their overlap',()=>{
    const a=[box(0,0,10,10),box(2,2,3,3).reverse()],b=[box(5,0,10,10).reverse()];
    const rings=unionResolvedRegions([{contours:a,rule:'nonzero'},{contours:b,rule:'nonzero'}]);
    expect(area(rings)).toBe(141);
    expect(winding(rings,{x:8,y:4})).not.toBe(0);expect(winding(rings,{x:3,y:3})).toBe(0);
    expectBoundaries(rings,p=>winding(a,p)!==0 || winding(b,p)!==0);
  });
  it('handles shared edges, point contacts, empty geometry and disconnected islands',()=>{
    const input=[box(0,0,2,2),box(2,0,2,2),box(4,2,2,2),box(10,0,2,2)];
    const rings=resolveRegionBoundaries(input,'nonzero');
    expect(area(rings)).toBe(16);expectBoundaries(rings,p=>winding(input,p)!==0);
    expect(resolveRegionBoundaries([],'nonzero')).toEqual([]);
    expect(resolveRegionBoundaries([[{x:0,y:0},{x:1,y:0}]],'nonzero')).toEqual([]);
  });
  it('closes each boundary independently and preserves narrow outlines without hatching',()=>{
    const result=generateGeometry(job([box(0,0,.1,10)],{perimeter:false,settings:{...defaultFillSettings,mode:'solid',outline:true}}));
    expect(result.diagnostics.join(' ')).toContain('too narrow');expect(result.paths).toHaveLength(1);
    expect(result.paths[0]!.points[0]).toEqual(result.paths[0]!.points.at(-1));
    expect(result.paths[0]!.tool).toBe('#654321');expect(result.paths[0]!.width).toBe(.35);
    const separate=generateGeometry(job([box(0,0,2,2),box(5,0,2,2)]));
    expect(separate.paths).toHaveLength(2);
    for(const p of separate.paths) expect(p.points.every(q=>q.x<=2)||p.points.every(q=>q.x>=5)).toBe(true);
  });
  it('uses resolved boundaries for filled outlines and honors the outline switch',()=>{
    const input=[box(0,0,10,10),box(5,0,10,10)];
    const settings={...defaultFillSettings,mode:'hatch' as const,connect:false};
    const off=generateGeometry(job(input,{settings,perimeter:false}));
    const on=generateGeometry(job(input,{settings:{...settings,outline:true},perimeter:false}));
    expect(on.paths).toHaveLength(off.paths.length+1);
    expectBoundaries([on.paths.at(-1)!.points.slice(0,-1)],p=>winding(input,p)!==0);
  });
  it('draws resolved boundaries in None mode without generating interior strokes',()=>{
    const input=[box(0,0,10,10),box(5,0,10,10)];
    const result=generateGeometry(job(input,{perimeter:true,settings:{...defaultFillSettings,mode:'none',outline:true},outlineWidth:.7}));
    expect(result.paths).toHaveLength(1);expect(result.diagnostics).toEqual([]);
    expect(result.paths[0]!.width).toBe(.7);
    expectBoundaries([result.paths[0]!.points.slice(0,-1)],p=>winding(input,p)!==0);
  });
  it('is deterministic, leaves source untouched, and rejects invalid/oversized geometry',()=>{
    const source=job([box(0,0,10,10)]),before=structuredClone(source);
    expect(generateGeometry(source)).toEqual(generateGeometry(source));expect(source).toEqual(before);
    expect(()=>resolveRegionBoundaries([[{x:NaN,y:0}]],'nonzero')).toThrow('bounds');
    expect(()=>resolveRegionBoundaries([[{x:100001,y:0}]],'nonzero')).toThrow('bounds');
    expect(()=>resolveRegionBoundaries([Array.from({length:MAX_FILL_POINTS+1},()=>({x:0,y:0}))],'nonzero')).toThrow('complex');
  });
});
