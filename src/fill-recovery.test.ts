// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { awaitFills, fillPlotPaths } from './fill-dom';
import { flattenPlotPathsAsync } from './svg';
import { WorkSlice } from './cooperative';

function preview(legacy = false): SVGSVGElement {
  const root = document.createElementNS('http://www.w3.org/2000/svg','svg');
  root.innerHTML = `<g id="artwork-layer">
    <g data-item-id="logo" transform="scale(5)">
      <path data-fill-source="true" data-fill-path-key="fill-0" d="M0 0L8 0L8 8Z"/>
      <g data-generated-fill="true" ${legacy ? '' : 'data-fill-path-key="fill-0"'} transform="scale(.2)">
        <path stroke="#171714" stroke-width=".5" d="M10.12345 12 L30 12 L30 24 L10.12345 12"/>
        <path stroke="#171714" stroke-width=".5" d="M14 16 L18 16"/>
      </g>
    </g>
    <g data-item-id="text" data-plotfont-order="true">
      <path data-fill-source="true" data-fill-path-key="fill-1" d="M0 0L8 0L8 8Z"/>
      <g data-generated-fill="true" ${legacy ? '' : 'data-fill-path-key="fill-1"'}>
        <path stroke="#000000" stroke-width=".35" d="M60 40 L80 40 L80 70 L60 40"/>
      </g>
      <path data-fill-source="true" d="M0 0L8 0L8 8Z"/>
    </g>
  </g>`;
  // Suppressed sources and generated paths require no geometry sampling.
  Object.assign(root,{getScreenCTM:()=>({inverse:()=>({})})});
  return root;
}

describe('generated geometry without an in-memory preview cache',()=>{
  it.each([false,true])('recovers exact page-mm vertices and inserts each source batch once (legacy=%s)',async legacy=>{
    const svg = preview(legacy);
    await awaitFills(svg);
    const paths = fillPlotPaths(svg);
    expect(paths).toHaveLength(3);
    expect(paths[0]).toEqual({points:[{x:10.12345,y:12},{x:30,y:12},{x:30,y:24},{x:10.12345,y:12}],tool:'#171714',width:.5,sourceKey:'fill-0',orderGroup:undefined});
    expect(paths[2]?.orderGroup).toBe('text');
    expect(await flattenPlotPathsAsync(svg,new WorkSlice(),paths)).toEqual(paths);
  });
  it('rejects a missing generated batch rather than silently omitting an object',()=>{
    const svg = preview();
    svg.querySelector('[data-generated-fill]')!.remove();
    expect(()=>fillPlotPaths(svg)).toThrow('geometry is missing');
  });
  it('rejects duplicate source batches',()=>{
    const svg=preview();
    svg.querySelectorAll('[data-generated-fill]')[1]!.setAttribute('data-fill-path-key','fill-0');
    expect(()=>fillPlotPaths(svg)).toThrow('geometry is incomplete');
  });
  it.each(['pending','error'])('blocks %s geometry when its readiness promise is unavailable',async status=>{
    const svg=preview();svg.setAttribute('data-plot-geometry-status',status);
    await expect(awaitFills(svg)).rejects.toThrow('geometry is not ready');
  });
  it('rejects compound generated strokes that would connect a pen-up move',()=>{
    const svg=preview();
    svg.querySelector('[data-generated-fill] path')!.setAttribute('d','M10 10 L20 10 M30 10 L40 10');
    expect(()=>fillPlotPaths(svg)).toThrow('disconnected strokes');
  });
  it('accepts an intentionally empty resolved region',()=>{
    const svg=preview();svg.querySelector('[data-generated-fill]')!.replaceChildren();
    expect(fillPlotPaths(svg)).toHaveLength(1);
  });
});
