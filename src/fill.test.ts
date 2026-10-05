import { describe, expect, it } from 'vitest';
import { generateFill, fillSpacing, validateFill, type FillRegion } from './fill';
import { defaultFillSettings, type Point } from './model';
const box = (x:number,y:number,w:number,h:number): Point[] => [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const region = (contours:Point[][], overrides: Partial<FillRegion['settings']> = {}, rule:FillRegion['rule']='nonzero'): FillRegion => ({contours,rule,key:'test',tool:'#123456',settings:{...defaultFillSettings,mode:'solid',angle:0,...overrides}});
const all = (r:FillRegion) => generateFill(r).paths.flatMap(p=>p.points);
describe('physical fill generation', () => {
  it('uses width/overlap for solid and width/clear gap for hatching',()=>{
    expect(fillSpacing({...defaultFillSettings,mode:'solid'})).toBeCloseTo(.85);
    expect(fillSpacing({...defaultFillSettings,mode:'hatch'})).toBe(2);
    expect(fillSpacing({...defaultFillSettings,mode:'crosshatch'})).toBe(2);
  });
  it('keeps marks inside a rectangle with pencil-radius clearance',()=>{
    const r=region([box(0,0,20,10)]), result=generateFill(r);
    expect(result.paths.length).toBe(1);
    for(const p of all(r)){expect(p.x).toBeGreaterThanOrEqual(.5);expect(p.x).toBeLessThanOrEqual(19.5);expect(p.y).toBeGreaterThanOrEqual(.5);expect(p.y).toBeLessThanOrEqual(9.5);}
    expect(result.paths[0]?.tool).toBe('#123456');
    expect(result.paths[0]?.width).toBe(1);
  });
  it('fills circular regions while keeping pencil-radius clearance',()=>{
    const circle=Array.from({length:256},(_,i)=>({x:10*Math.cos(i*Math.PI/128),y:10*Math.sin(i*Math.PI/128)}));
    const result=generateFill(region([circle],{angle:37}));
    expect(result.paths.length).toBeGreaterThan(0);
    for(const p of result.paths.flatMap(path=>path.points)) expect(Math.hypot(p.x,p.y)).toBeLessThanOrEqual(9.5);
  });
  it('respects evenodd holes and never bridges across a hole',()=>{
    const r=region([box(0,0,20,20),box(5,5,10,10)],{},'evenodd');
    const result=generateFill(r);
    expect(result.paths.length).toBeGreaterThan(1);
    for(const path of result.paths)for(let i=1;i<path.points.length;i++){
      const a=path.points[i-1]!,b=path.points[i]!;
      for(let t=0;t<=1;t+=.02){const p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};expect(Math.hypot(Math.max(5-p.x,0,p.x-15),Math.max(5-p.y,0,p.y-15))).toBeGreaterThanOrEqual(.499);}
    }
  });
  it('preserves nonzero filled overlap and opposite-winding counters',()=>{
    const outer=box(0,0,20,20),inner=box(5,5,10,10);
    const filled=all(region([outer,inner],{connect:false}));
    const hollow=all(region([outer,[...inner].reverse()],{connect:false}));
    expect(filled.some(p=>p.y>5&&p.y<15&&p.x<1)).toBe(true);
    expect(hollow.some(p=>p.x>4&&p.x<6&&p.y>6&&p.y<14)).toBe(true);
    expect(generateFill(region([outer,inner])).paths.length).toBe(1);
    expect(generateFill(region([outer,[...inner].reverse()])).paths.length).toBeGreaterThan(1);
  });
  it('does not bridge disconnected islands',()=>{
    const result=generateFill(region([box(0,0,2,10),box(3,0,2,10)]));
    for(const path of result.paths)expect(path.points.every(p=>p.x<2)||path.points.every(p=>p.x>3)).toBe(true);
  });
  it('preserves concave boundaries and identifies unfillable narrow shapes',()=>{
    const shape=[{x:0,y:0},{x:10,y:0},{x:10,y:3},{x:3,y:3},{x:3,y:10},{x:0,y:10}];
    const result=generateFill(region([shape])); expect(result.paths.length).toBeGreaterThan(0);
    for(const path of result.paths)for(let i=1;i<path.points.length;i++)for(let t=0;t<=1;t+=.05){
      const a=path.points[i-1]!,b=path.points[i]!,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
      expect(p.x<3||p.y<3).toBe(true);
      for(let j=0;j<shape.length;j++){
        const u=shape[j]!,v=shape[(j+1)%shape.length]!,dx=v.x-u.x,dy=v.y-u.y;
        const f=Math.max(0,Math.min(1,((p.x-u.x)*dx+(p.y-u.y)*dy)/(dx*dx+dy*dy)));
        expect(Math.hypot(p.x-u.x-f*dx,p.y-u.y-f*dy)).toBeGreaterThanOrEqual(.499);
      }
    }
    const thin=generateFill(region([box(0,0,.3,20)]));
    expect(thin.paths).toHaveLength(0);expect(thin.diagnostics.join(' ')).toContain('too narrow');
  });
  it('produces two perpendicular hatch passes without connections by default',()=>{
    const hatch=generateFill(region([box(0,0,10,10)],{mode:'hatch',connect:false}));
    const cross=generateFill(region([box(0,0,10,10)],{mode:'crosshatch',connect:false}));
    expect(cross.paths.length).toBe(hatch.paths.length*2);
    expect(cross.paths.every(p=>p.points.length===2)).toBe(true);
    expect(cross.paths.some(p=>Math.abs(p.points[0]!.x-p.points[1]!.x)<1e-8)).toBe(true);
  });
  it('keeps physical spacing after scaling the shape',()=>{
    const small=generateFill(region([box(0,0,10,10)],{mode:'hatch',connect:false}));
    const large=generateFill(region([box(0,0,20,20)],{mode:'hatch',connect:false}));
    for(const paths of [small.paths,large.paths])expect(Math.abs(paths[1]!.points[0]!.y-paths[0]!.points[0]!.y)).toBeCloseTo(2);
  });
  it('is deterministic and never mutates source geometry',()=>{
    const r=region([box(0,0,20,10)],{angle:45}), original=structuredClone(r);
    expect(generateFill(r)).toEqual(generateFill(r));expect(r).toEqual(original);
  });
  it('rejects invalid input and excessively dense output',()=>{
    expect(()=>validateFill({...defaultFillSettings,width:NaN})).toThrow();
    expect(()=>validateFill({...defaultFillSettings,overlap:1})).toThrow();
    expect(()=>generateFill(region([box(0,0,2000,2000)],{width:.05,overlap:.8}))).toThrow('too dense');
  });
});
