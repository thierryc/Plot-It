export type Bounds = { left: number; right: number; top: number; bottom: number };
export function popoverPosition(anchor: Bounds, size: { width: number; height: number }, viewport: { width: number; height: number }, gap = 8) {
  const padding = 12;
  const left = Math.max(padding, Math.min(anchor.left, viewport.width - size.width - padding));
  const below = anchor.bottom + gap;
  const top = below + size.height <= viewport.height - padding ? below : Math.max(padding, anchor.top - gap - size.height);
  return { left, top: Math.min(top, Math.max(padding, viewport.height - size.height - padding)) };
}

export interface OverlayBinding { overlay:HTMLElement; trigger?:HTMLElement; navigation?:boolean; }
export function navigateControls(event:KeyboardEvent, container:HTMLElement, selector:string, horizontal=false):void {
  const next=horizontal?'ArrowRight':'ArrowDown', previous=horizontal?'ArrowLeft':'ArrowUp';
  if (![next,previous,'Home','End'].includes(event.key)) return;
  const controls=[...container.querySelectorAll<HTMLElement>(selector)].filter(node => !node.hidden && !node.closest('[inert]') && node.getClientRects().length);
  if (!controls.length) return;
  const index=controls.indexOf(document.activeElement as HTMLElement);
  const target=event.key==='Home'?0:event.key==='End'?controls.length-1:(index+(event.key===previous?-1:1)+controls.length)%controls.length;
  event.preventDefault(); controls[target]?.focus();
}
/** Native top-layer dismissal/trapping; one abortable owner per mounted view. */
export class NativeOverlays {
  private controller=new AbortController();
  constructor(bindings:OverlayBinding[]) {
    const signal=this.controller.signal;
    for (const {overlay,trigger,navigation} of bindings) {
      if (overlay instanceof HTMLDialogElement) {
        let source:HTMLElement|null=null;
        overlay.addEventListener('beforetoggle',event=>{ if ((event as ToggleEvent).newState==='open') source=document.activeElement instanceof HTMLElement?document.activeElement:null; },{signal});
        overlay.addEventListener('close',()=>{ const target=trigger??source; if(target?.isConnected) target.focus({preventScroll:true}); },{signal});
        overlay.addEventListener('click',event=>{ if(event.target!==overlay)return; const b=overlay.getBoundingClientRect(); if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom) overlay.close(); },{signal});
      } else if(trigger) {
        overlay.addEventListener('beforetoggle',event=>{ if ((event as ToggleEvent).newState==='open') this.position(overlay,trigger,0); },{signal});
        overlay.addEventListener('toggle',()=>{ const open=overlay.matches(':popover-open'); trigger.setAttribute('aria-expanded',String(open)); if(open){this.position(overlay,trigger);overlay.querySelector<HTMLElement>('button:not(:disabled),input,select,a')?.focus({preventScroll:true});}else if(document.activeElement===document.body||overlay.contains(document.activeElement))trigger.focus({preventScroll:true}); },{signal});
        if(navigation) overlay.addEventListener('keydown',event=>{if(event.target instanceof HTMLElement&&!event.target.matches('input,textarea,select'))navigateControls(event,overlay,'button:not(:disabled),a[href],input,select');},{signal});
      }
    }
    window.addEventListener('resize',()=>{for(const {overlay,trigger} of bindings)if(trigger&&overlay.matches(':popover-open'))this.position(overlay,trigger);},{signal});
  }
  private position(overlay:HTMLElement,trigger:HTMLElement,height=overlay.offsetHeight):void {
    const {left,top}=popoverPosition(trigger.getBoundingClientRect(),{width:overlay.offsetWidth||parseFloat(getComputedStyle(overlay).width)||300,height},{width:innerWidth,height:innerHeight});
    overlay.style.left=`${left}px`; overlay.style.top=`${top}px`;
  }
  destroy():void { this.controller.abort(); }
}
