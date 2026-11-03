import { attributes } from '../design-system';
import styles from './resize-controls.module.css';

export type PanelSize = { width: number; height: number };
type Limits = { min: PanelSize; max: PanelSize };
export function resizeHandleMarkup(label: string, axis: 'horizontal' | 'vertical' | 'corner', data: string): string {
  return `<${axis === 'corner' ? 'button type="button"' : 'div'} class="${styles.handle} ${styles[axis]}" ${attributes({[data]:'', role:axis === 'corner' ? undefined : 'separator', tabindex:0, 'aria-label':label, 'aria-orientation':axis === 'horizontal' ? 'vertical' : axis === 'vertical' ? 'horizontal' : undefined, title:`${label} · Arrow keys resize; Shift adjusts by 1 px; Escape cancels`})}></${axis === 'corner' ? 'button' : 'div'}>`;
}

/** Pointer capture keeps panel resizing separate from artwork gestures. */
export function bindResizeHandle(handle: HTMLElement, config: {
  axis: 'horizontal' | 'vertical' | 'corner'; get(): PanelSize; limits(): Limits; set(size: PanelSize): void;
  reverseX?: boolean; observe?: boolean; start?(): void; end?(): void; reset?(): void;
}): { sync(): void; destroy(): void } {
  const controller = new AbortController(), options = {signal:controller.signal};
  let drag: { id:number; x:number; y:number; size:PanelSize } | undefined;
  let keyboardStart: PanelSize | undefined;
  const sync = () => {
    if (config.axis === 'corner') return;
    const key = config.axis === 'horizontal' ? 'width' : 'height', limits = config.limits();
    handle.setAttribute('aria-valuemin',String(limits.min[key])); handle.setAttribute('aria-valuemax',String(limits.max[key]));
    handle.setAttribute('aria-valuenow',String(Math.round(config.get()[key])));
  };
  const apply = (size: PanelSize) => {
    const {min,max} = config.limits();
    config.set({width:Math.max(min.width,Math.min(max.width,size.width)),height:Math.max(min.height,Math.min(max.height,size.height))}); sync();
  };
  const end = () => { drag=undefined; keyboardStart=undefined; config.end?.(); };
  handle.addEventListener('pointerdown',event=>{
    if(event.button!==0)return; event.preventDefault(); event.stopPropagation(); config.start?.();
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,size:config.get()};handle.setPointerCapture(event.pointerId);
  },options);
  handle.addEventListener('pointermove',event=>{
    if(drag?.id!==event.pointerId)return;
    apply({width:drag.size.width+(config.axis==='vertical'?0:(event.clientX-drag.x)*(config.reverseX?-1:1)),height:drag.size.height+(config.axis==='horizontal'?0:event.clientY-drag.y)});
  },options);
  handle.addEventListener('pointerup',end,options);
  handle.addEventListener('pointercancel',()=>{if(drag)apply(drag.size);end();},options);
  handle.addEventListener('lostpointercapture',()=>{if(drag)end();},options);
  handle.addEventListener('dblclick',event=>{event.preventDefault();config.reset?.();sync();},options);
  handle.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&(drag||keyboardStart)){event.preventDefault();event.stopPropagation();apply(drag?.size??keyboardStart!);end();return;}
    const delta=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,number[]>)[event.key];
    if(!delta||config.axis==='horizontal'&&!delta[0]||config.axis==='vertical'&&!delta[1])return;
    event.preventDefault();event.stopPropagation(); keyboardStart??=config.get();config.start?.();const size=config.get(),step=event.shiftKey?1:10;
    apply({width:size.width+(config.axis==='vertical'?0:delta[0]!*step),height:size.height+(config.axis==='horizontal'?0:delta[1]!*step)});
  },options);
  handle.addEventListener('blur',()=>{if(keyboardStart)end();},options);
  if(config.observe!==false)window.addEventListener('resize',sync,options);
  const observer=config.observe!==false&&typeof ResizeObserver==='function'?new ResizeObserver(sync):undefined;
  if(handle.parentElement)observer?.observe(handle.parentElement);
  sync(); return {sync,destroy:()=>{controller.abort();observer?.disconnect();}};
}
