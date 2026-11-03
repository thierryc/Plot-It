// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorViewport, REFERENCE_SCALE, worldPoint } from './editor-viewport';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
function setup() {
  let resize!: ResizeObserverCallback;
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resize = callback; } observe() {} disconnect() {} });
  document.body.innerHTML = '<section data-ui="canvas-viewport"><div id="stage"><svg id="scene"><g id="artwork"><path d="M-5 -10L25 20"/></g></svg><svg id="overlay"><g data-world-overlay/></svg></div><span data-zoom-label></span></section>';
  const host=document.querySelector<HTMLElement>('#stage')!, scene=document.querySelector<SVGSVGElement>('#scene')!, overlay=document.querySelector<SVGSVGElement>('#overlay')!;
  let width=900,height=700;
  host.getBoundingClientRect=()=>({x:180,y:25,left:180,top:25,width,height,right:180+width,bottom:25+height,toJSON:()=>({})});
  const viewport=new EditorViewport(), notify=vi.fn();
  viewport.mount(host,scene,overlay,{width:210,height:297},notify);
  return {viewport,host,scene,overlay,notify,resize:(w:number,h:number)=>{width=w;height=h;resize([],{} as ResizeObserver);}};
}
describe('viewport rendering lifecycle', () => {
  it('keeps resize handles near the fit inset stable until the actual viewport edge',()=>{
    const {viewport}=setup(),camera=structuredClone(viewport.camera);
    expect(viewport.edgePan(1030,350,16,true)).toBe(false);expect(viewport.camera).toEqual(camera);
    expect(viewport.edgePan(1030,350,16)).toBe(true);
    expect(viewport.edgePan(1079,350,16,true)).toBe(true);
    viewport.disconnect();
  });
  it('uses one viewBox transform, projects overlays separately, and never edits artwork', () => {
    const {viewport,scene,overlay,host}=setup(), artwork=scene.querySelector('#artwork')!.outerHTML;
    viewport.set({center:worldPoint(-50,-75),scale:REFERENCE_SCALE});
    expect(scene.querySelector('#artwork')!.outerHTML).toBe(artwork);
    expect(overlay.getAttribute('viewBox')).toBe('0 0 900 700');
    const viewBox=scene.getAttribute('viewBox')!.split(' ').map(Number);
    expect(viewBox[0]).toBeLessThan(-50);expect(viewBox[1]).toBeLessThan(-75);
    expect(document.querySelector('[data-zoom-label]')!.textContent).toBe('100%');
    const center=viewport.fromClient(180+450,25+350);
    expect(center).toEqual(worldPoint(-50,-75));
    const change=vi.fn();host.addEventListener('viewportchange',change);viewport.pan({x:-40,y:30});expect(change).toHaveBeenCalledOnce();
    viewport.disconnect();
  });
  it('preserves camera center and scale through resizing and shell replacement', () => {
    const {viewport,scene,overlay,host,resize}=setup();
    viewport.set({center:worldPoint(-120,400),scale:12});const camera=structuredClone(viewport.camera);
    resize(450,850);expect(viewport.camera).toEqual(camera);expect(overlay.getAttribute('viewBox')).toBe('0 0 450 850');
    viewport.mount(host,scene,overlay,{width:148,height:105},()=>{});expect(viewport.camera).toEqual(camera);
    viewport.reset();viewport.mount(host,scene,overlay,{width:148,height:105},()=>{});expect(viewport.camera).not.toEqual(camera);
    viewport.disconnect();
  });
});
