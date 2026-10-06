import { describe, expect, it } from 'vitest';
import { planPolyline, planSegment } from './trajectory';

const options = { acceleration: 200, maximumVelocity: 35, cornering: .127 };
describe('original acceleration planning', () => {
  it.each([2,100])('matches analytical rest-to-rest motion over %s mm', length => {
    const blocks = planPolyline([{x:0,y:0},{x:length,y:0}],options);
    const duration = blocks.reduce((sum,block)=>sum+block.duration,0);
    expect(duration).toBeCloseTo(length < 35**2/200 ? 2*Math.sqrt(length/200) : length/35+35/200);
    expect(blocks[0]!.initialSpeed).toBe(0);
    const last=blocks.at(-1)!; expect(last.initialSpeed+last.acceleration*last.duration).toBeCloseTo(0);
    expect(last.to).toEqual({x:length,y:0});
  });
  it('uses one constant-speed command profile for a one-step stroke', () => {
    const blocks = planPolyline([{x:0,y:0},{x:.025,y:0}],options);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ stopBefore: true, acceleration: 0 });
    expect(blocks[0]!.initialSpeed).toBeCloseTo(Math.sqrt(200 * .025));
    expect(blocks[0]!.duration).toBeCloseTo(.025 / Math.sqrt(200 * .025));
  });
  it('uses the reviewed boosted-entry linear profile when a triangle has too few slices', () => {
    const [block] = planSegment({x:0,y:0},{x:1,y:0},0,0,options);
    expect(block!.initialSpeed).toBeCloseTo(Math.sqrt(200) / 2);
    expect(block!.acceleration).toBeCloseTo(-25);
    expect(block!.duration).toBeCloseTo(.282842712474619);
    expect(block!.stopBefore).toBe(true);
    expect(block!.initialSpeed + block!.acceleration * block!.duration).toBeCloseTo(0);
  });
  it('reduces local acceleration at the triangle/cruise crossover', () => {
    const blocks = planSegment({x:0,y:0},{x:6,y:0},0,0,options);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.acceleration).toBeCloseTo(183.75);
    expect(blocks[0]!.initialSpeed + blocks[0]!.acceleration * blocks[0]!.duration).toBeCloseTo(Math.sqrt(1102.5));
    expect(blocks.at(-1)!.to).toEqual({x:6,y:0});
  });
  it('handles already-cruising and one-sided short ramps without NaN', () => {
    for (const [length,initial,final] of [[.02,35,35],[.05,5,3],[.05,3,5],[.01,0,2],[.01,2,0]]) {
      const blocks = planSegment({x:0,y:0},{x:length!,y:0},initial!,final!,options);
      for (const b of blocks) {
        expect(b.duration).toBeGreaterThan(0);
        expect(b.initialSpeed * b.duration + .5 * b.acceleration * b.duration ** 2).toBeCloseTo(Math.hypot(b.to.x-b.from.x,b.to.y-b.from.y),10);
        expect(b.initialSpeed).toBeLessThanOrEqual(35);
        expect(b.initialSpeed + b.acceleration * b.duration).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });
  it('retains every vertex and satisfies speed, distance and acceleration bounds', () => {
    const points=[{x:0,y:0},{x:.01,y:0},{x:5,y:1},{x:5,y:10},{x:0,y:0}];
    const before=structuredClone(points),blocks=planPolyline(points,options);
    for(let i=0;i<blocks.length;i++) {
      const b=blocks[i]!,final=b.initialSpeed+b.acceleration*b.duration;
      expect(b.duration).toBeGreaterThan(0); expect(b.initialSpeed).toBeGreaterThanOrEqual(0);
      expect(final).toBeGreaterThanOrEqual(-1e-9); expect(Math.max(b.initialSpeed,final)).toBeLessThanOrEqual(35+1e-9);
      expect(Math.abs(b.acceleration)).toBeLessThanOrEqual(200);
      expect(b.initialSpeed*b.duration+.5*b.acceleration*b.duration**2).toBeCloseTo(Math.hypot(b.to.x-b.from.x,b.to.y-b.from.y),8);
      if(i) { const p=blocks[i-1]!; expect(b.from).toEqual(p.to); expect(b.initialSpeed).toBeCloseTo(p.initialSpeed+p.acceleration*p.duration); }
    }
    for(const p of points.slice(1)) expect(blocks.some(b=>b.to.x===p.x&&b.to.y===p.y)).toBe(true);
    expect(points).toEqual(before);
  });
  it('stops at reversals and when cornering is disabled without tapping the pen', () => {
    for(const points of [[{x:0,y:0},{x:10,y:0},{x:0,y:0}], [{x:0,y:0},{x:10,y:0},{x:10,y:10}]]) {
      const blocks=planPolyline(points,{...options,cornering:0});
      const entering=blocks.find(b=>b.to.x===10&&b.to.y===0)!;
      expect(entering.initialSpeed+entering.acceleration*entering.duration).toBeCloseTo(0);
    }
  });
  it('deduplicates coincident points and rejects invalid geometry', () => {
    expect(planPolyline([{x:0,y:0},{x:0,y:0}],options)).toEqual([]);
    expect(()=>planPolyline([{x:NaN,y:0}],options)).toThrow('coordinate');
    expect(()=>planPolyline([],{...options,acceleration:0})).toThrow('settings');
  });
});
