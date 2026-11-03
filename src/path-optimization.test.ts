import { describe, expect, it } from 'vitest';
import { initialState, type Point } from './model';
import type { PlotPath } from './svg';
import { closedPolyline, joinNearbyPaths, nearestClosedVertex, optimizePathUnits, pathOptimizationSettings, rotateClosedPath, simplifyPolyline } from './path-optimization';

const path=(points:Point[],extra:Partial<PlotPath>={}):PlotPath=>({points,tool:'#000000',width:.5,...extra});
const settings={...initialState.settings,pathJoinToleranceMm:.2,pathSimplifyToleranceMm:.01};
const length=(points:Point[])=>points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i]!.x,p.y-points[i]!.y),0);

describe('endpoint joining',()=>{
  it.each([false,true])('grows chains at both ends without changing inputs (reverse %s)',reverse=>{
    const source=[path([{x:10,y:0},{x:20,y:0}]),path([{x:0,y:0},{x:9.9,y:0}]),path([{x:20.1,y:0},{x:30,y:0}])],before=structuredClone(source);
    const result=joinNearbyPaths(source,.2,reverse);
    expect(result).toHaveLength(1); expect(result[0]!.points).toEqual([source[1]!.points[0],source[1]!.points[1],...source[0]!.points,...source[2]!.points]);
    expect(length(result[0]!.points)).toBeCloseTo(30); expect(source).toEqual(before);
  });
  it.each(['head','tail'])('reverses a candidate at the %s only when allowed',side=>{
    const source=[path([{x:10,y:0},{x:20,y:0}]),path(side==='tail'?[{x:30,y:0},{x:20.1,y:0}]:[{x:10.1,y:0},{x:0,y:0}])];
    expect(joinNearbyPaths(source,.2,false)).toHaveLength(2);
    const result=joinNearbyPaths(source,.2,true); expect(result).toHaveLength(1);
    expect(result[0]!.points[0]).toEqual({x:side==='tail'?10:0,y:0}); expect(result[0]!.points.at(-1)).toEqual({x:side==='tail'?30:20,y:0});
  });
  it.each([{tool:'#FF0000'},{width:.6},{orderGroup:'font'},{sourceKey:'fill'}])('does not join incompatible/protected paths (%j)',extra=>{
    expect(joinNearbyPaths([path([{x:0,y:0},{x:10,y:0}]),path([{x:10.1,y:0},{x:20,y:0}],extra)],.2,true)).toHaveLength(2);
  });
  it('selects the closest candidate in the tolerance and leaves out-of-range paths alone',()=>{
    const source=[path([{x:0,y:0},{x:10,y:0}]),path([{x:10.15,y:0},{x:20,y:0}]),path([{x:10.05,y:0},{x:30,y:0}]),path([{x:30.21,y:0},{x:40,y:0}])];
    const result=joinNearbyPaths(source,.2,false);
    expect(result).toHaveLength(3); expect(result[0]!.points.at(-1)).toEqual({x:30,y:0});
    expect(joinNearbyPaths(source,0,true)).toEqual(source);
  });
  it('does not append an open stroke to an existing closed contour',()=>{
    const ring=path([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:0}]);
    expect(joinNearbyPaths([ring,path([{x:.1,y:0},{x:2,y:0}])],.2,true)).toHaveLength(2);
  });
});

describe('bounded vertex reduction',()=>{
  it('reduces a dense curve while keeping every original vertex within the tolerance',()=>{
    const source=Array.from({length:1001},(_,i)=>({x:i*.01,y:Math.sin(i*.01)})),before=structuredClone(source),tolerance=.01;
    const result=simplifyPolyline(source,tolerance);
    expect(result.length).toBeLessThan(60); expect(result[0]).toEqual(source[0]); expect(result.at(-1)).toEqual(source.at(-1));
    for (const p of source) {
      const closest=Math.min(...result.slice(1).map((b,i)=>{
        const a=result[i]!,dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
        return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
      }));
      expect(closest).toBeLessThanOrEqual(tolerance+1e-10);
    }
    expect(source).toEqual(before);
  });
  it('retains sharp corners, reversals, coincident endpoints and disabled input geometry',()=>{
    const points=[{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:2,y:0},{x:0,y:0}];
    expect(simplifyPolyline(points,.01)).toEqual(points);
    expect(simplifyPolyline(points,0)).toEqual(points);
    expect(simplifyPolyline([{x:0,y:0},{x:1,y:0},{x:0,y:0}],.01)).toEqual([{x:0,y:0},{x:1,y:0},{x:0,y:0}]);
  });
  it('preserves closed rings and does not collapse them at a large tolerance',()=>{
    const points=Array.from({length:101},(_,i)=>({x:Math.cos(i*Math.PI/50),y:Math.sin(i*Math.PI/50)})); points[100]={...points[0]!};
    const reduced=simplifyPolyline(points,.02); expect(reduced.length).toBeLessThan(40); expect(closedPolyline(reduced)).toBe(true);
    expect(simplifyPolyline(points,100)).toEqual(points);
  });
});

describe('closed start selection and protected units',()=>{
  const ring=[{x:10,y:10},{x:20,y:10},{x:20,y:20},{x:10,y:20},{x:10,y:10}];
  it('rotates a ring without changing its direction, edge lengths or closure',()=>{
    const rotated=rotateClosedPath(ring,2);
    expect(rotated).toEqual([ring[2],ring[3],ring[0],ring[1],ring[2]]);
    expect(length(rotated)).toBe(length(ring)); expect(nearestClosedVertex(ring,{x:21,y:22})).toBe(2);
    expect(rotateClosedPath(ring.slice(0,3),2)).toEqual(ring.slice(0,3));
  });
  it('reproduces random starts with the same seed and varies them with another seed',()=>{
    const units=Array.from({length:8},()=>[path(ring)]);
    const first=optimizePathUnits(units,{...settings,closedPathStart:'random',pathRandomSeed:1});
    expect(optimizePathUnits(units,{...settings,closedPathStart:'random',pathRandomSeed:1})).toEqual(first);
    expect(optimizePathUnits(units,{...settings,closedPathStart:'random',pathRandomSeed:2})).not.toEqual(first);
    expect(first.every(unit=>closedPolyline(unit[0]!.points)&&length(unit[0]!.points)===40)).toBe(true);
  });
  it('keeps protected text/fill geometry and prevents joins across its operation boundaries',()=>{
    const units=[[path([{x:0,y:0},{x:10,y:0}])],[path(ring,{orderGroup:'font'}),path([{x:10,y:10},{x:20,y:10}],{orderGroup:'font'})],[path([{x:10.1,y:0},{x:20,y:0}])],[path(ring,{sourceKey:'fill'})]];
    const before=structuredClone(units),result=optimizePathUnits(units,{...settings,closedPathStart:'random',pathSimplifyToleranceMm:100});
    expect(result).toHaveLength(4); expect(result[1]).toEqual(units[1]); expect(result[3]).toEqual(units[3]); expect(units).toEqual(before);
  });
  it('joins only consecutive forward strokes when source/path order is preserved',()=>{
    const units=[[path([{x:10,y:0},{x:20,y:0}])],[path([{x:0,y:0},{x:9.9,y:0}])],[path([{x:20.1,y:0},{x:30,y:0}])]];
    expect(optimizePathUnits(units,settings,true)).toHaveLength(3);
    expect(optimizePathUnits([units[0]!,units[2]!],settings,true)).toHaveLength(1);
  });
  it('restores legacy defaults and rejects malformed optimization settings',()=>{
    expect(pathOptimizationSettings({})).toEqual({pathJoinToleranceMm:0,pathSimplifyToleranceMm:0,closedPathStart:'preserve',pathRandomSeed:1});
    for (const bad of [{pathJoinToleranceMm:-1},{pathSimplifyToleranceMm:NaN},{closedPathStart:'other'},{pathRandomSeed:.5},{pathRandomSeed:2**32}]) expect(()=>pathOptimizationSettings(bad as never)).toThrow('Invalid');
  });
});
