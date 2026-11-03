import { describe, expect, it } from 'vitest';
import { clientPoint, clientToWorld, edgePanVelocity, fitCamera, itemWorldBounds, panCamera, REFERENCE_SCALE, unionBounds, viewportPoint, viewportToWorld, worldPoint, worldToViewport, zoomCamera } from './editor-viewport';

describe('global millimetre coordinates and camera', () => {
  const size = { width: 1000, height: 700 }, camera = { center: worldPoint(-35, 42), scale: REFERENCE_SCALE };
  it('round trips signed world points independently of viewport offsets and zoom', () => {
    for (const scale of [.03, REFERENCE_SCALE, 150]) for (const point of [worldPoint(-900, -400),worldPoint(0,0),worldPoint(500,700)]) {
      const view = {...camera,scale}, screen = worldToViewport(point,view,size), result = viewportToWorld(screen,view,size);
      expect(result.x).toBeCloseTo(point.x,9); expect(result.y).toBeCloseTo(point.y,9);
      const fromClient=clientToWorld(clientPoint(screen.x+215,screen.y+87),view,{x:215,y:87,...size});
      expect(fromClient.x).toBeCloseTo(point.x,9); expect(fromClient.y).toBeCloseTo(point.y,9);
    }
  });
  it('keeps the world point under the cursor fixed while zooming', () => {
    const anchor=viewportPoint(127,526), before=viewportToWorld(anchor,camera,size), zoomed=zoomCamera(camera,21,anchor,size);
    expect(viewportToWorld(anchor,zoomed,size)).toEqual(before);
    const moved=panCamera(camera,{x:-200,y:100});
    expect(worldToViewport(before,moved,size).x).toBeCloseTo(anchor.x+200);
    expect(worldToViewport(before,moved,size).y).toBeCloseTo(anchor.y-100);
    expect(camera.center).toEqual(worldPoint(-35,42));
  });
  it('fits rotated artwork and negative bounds inside the usable viewport', () => {
    const bounds=unionBounds([{x:0,y:0,width:210,height:297},itemWorldBounds({x:-120,y:-60,width:80,height:40,rotation:37} as Parameters<typeof itemWorldBounds>[0])]);
    const insets={top:80,right:40,bottom:110,left:40}, fitted=fitCamera(bounds,size,insets);
    const a=worldToViewport(worldPoint(bounds.x,bounds.y),fitted,size), b=worldToViewport(worldPoint(bounds.x+bounds.width,bounds.y+bounds.height),fitted,size);
    expect(a.x).toBeGreaterThanOrEqual(insets.left-1e-8); expect(a.y).toBeGreaterThanOrEqual(insets.top-1e-8);
    expect(b.x).toBeLessThanOrEqual(size.width-insets.right+1e-8); expect(b.y).toBeLessThanOrEqual(size.height-insets.bottom+1e-8);
  });
  it('pans smoothly at viewport edges with bounded, zoom-independent screen speed', () => {
    const insets={top:80,left:40,right:40,bottom:80};
    expect(edgePanVelocity(viewportPoint(500,350),size,insets)).toEqual({x:0,y:0});
    expect(edgePanVelocity(viewportPoint(40,80),size,insets)).toEqual({x:-600,y:-600});
    expect(edgePanVelocity(viewportPoint(960,620),size,insets)).toEqual({x:600,y:600});
    expect(edgePanVelocity(viewportPoint(56,350),size,insets).x).toBe(-150);
    expect(edgePanVelocity(viewportPoint(-500,350),size,insets).x).toBe(-600);
  });
});
