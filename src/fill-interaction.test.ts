// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { FillPreview, awaitFills, fillPlotPaths } from './fill-dom';
import type { ArtworkItem } from './model';
const item:ArtworkItem={id:'active',name:'Active',x:0,y:0,width:10,height:10,viewBox:[0,0,10,10],rotation:0,stroke:'#123456',markup:''};
function fixture(batch=false){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.innerHTML=`<g id="artwork-layer"><g data-item-id="active"><path data-fill-source="true" data-fill-path-key="one" style="opacity:0!important" d="M0 0L10 0L10 10Z"/><g data-generated-fill="true" data-fill-path-key="one" transform="translate(2 3)"><path d="M0 0L10 0" stroke="#123456" stroke-width=".3"/></g><path data-fill-source="true" data-fill-path-key="${batch?'one':'two'}" style="opacity:0!important" d="M0 0L1 0L1 1Z"/></g><g data-item-id="other"><path d="M20 20L30 30"/><g data-generated-fill="true" data-fill-path-key="other"><path d="M20 20L30 30"/></g></g></g>`;
  svg.setAttribute('data-plot-geometry-status','ready');document.body.append(svg);
  const sources=svg.querySelectorAll<SVGGraphicsElement>('[data-item-id="active"] > path'),generated=svg.querySelector<SVGGElement>('[data-item-id="active"] > g')!,other=svg.querySelector('[data-item-id="other"]')!;
  return {svg,sources,generated,other,preview:new FillPreview()};
}
afterEach(()=>{document.body.innerHTML='';});
describe('scoped fill interactions',()=>{
  it('blocks provisional output, preserves unrelated paint and restores cancelled rigid previews',async()=>{
    const f=fixture(),other=f.other.outerHTML,original=f.generated.getAttribute('transform');
    const interaction=f.preview.beginInteraction(f.svg,item,f.sources[0]);expect(interaction.generated).toEqual([f.generated]);
    await expect(awaitFills(f.svg)).rejects.toThrow('pending');expect(()=>fillPlotPaths(f.svg)).toThrow('not ready');
    f.generated.setAttribute('transform','translate(50 30)');interaction.finish(false);
    await expect(awaitFills(f.svg)).resolves.toBeUndefined();expect(f.generated.getAttribute('transform')).toBe(original);expect(f.other.outerHTML).toBe(other);
  });
  it('shows affected outlines during resize and restores their exact paint',()=>{
    const f=fixture(),source=f.sources[0]!,style=source.getAttribute('style'),other=f.other.outerHTML;
    const interaction=f.preview.beginInteraction(f.svg,item,source,true);
    expect(interaction.generated).toEqual([]);expect(f.generated.style.display).toBe('none');expect(source.style.opacity).toBe('1');expect(source.style.fill).toBe('none');
    expect(f.sources[1]!.style.opacity).toBe('0');interaction.finish(false);
    expect(source.getAttribute('style')).toBe(style);expect(f.generated.style.display).toBe('');expect(f.other.outerHTML).toBe(other);
  });
  it('exposes the entire resolved glyph batch when only one component moves',()=>{
    const f=fixture(true),interaction=f.preview.beginInteraction(f.svg,item,f.sources[0]);
    expect(interaction.generated).toEqual([]);expect(f.generated.style.display).toBe('none');expect([...f.sources].map(source=>source.style.opacity)).toEqual(['1','1']);
    interaction.finish(false);expect([...f.sources].map(source=>source.style.opacity)).toEqual(['0','0']);
  });
  it('keeps committed output pending until reconciliation completes',async()=>{
    const f=fixture(),interaction=f.preview.beginInteraction(f.svg,item,f.sources[0],true);interaction.finish(true);
    expect(f.generated.style.display).toBe('');await expect(awaitFills(f.svg)).rejects.toThrow('pending');
  });
});
