import { bindResizeHandle } from './resize-controls';
import { NativeOverlays, navigateControls, dimensions, mountSegmentedControls, mountContextualHelp, animateSurface, stopSurfaceAnimation } from '../design-system';
/** One controller per rendered shell. Native overlays own dismissal and trapping. */
export class WorkspaceOverlays {
  private native: NativeOverlays;
  private releaseHelp: () => void;
  private releaseSegments: () => void;
  private controller = new AbortController();
  private observer: ResizeObserver;
  private sidebarResize?: ReturnType<typeof bindResizeHandle>;
  private sidebarWidth?: number;
  private mobile = matchMedia(`(max-width: ${dimensions.mobileMax}px)`);
  constructor(private root: HTMLElement) {
    const signal = this.controller.signal;
    try { const value=Number(sessionStorage.getItem('plot-it-sidebar-width'));if(value>=dimensions.sidebarMinimum&&value<=dimensions.sidebarMaximum)this.sidebarWidth=value; } catch { /* Session storage is optional. */ }
    const handle=root.querySelector<HTMLElement>('[data-sidebar-resize]');
    const limits=()=>({min:{width:dimensions.sidebarMinimum,height:0},max:{width:Math.max(dimensions.sidebarMinimum,Math.min(dimensions.sidebarMaximum,innerWidth-dimensions.canvasMinimum)),height:0}});
    const width=()=>root.querySelector<HTMLElement>('[data-inspector-dock]')?.getBoundingClientRect().width || (innerWidth<=dimensions.tabletMax?dimensions.sidebarTablet:dimensions.sidebarDefault);
    const applyWidth=(value?:number)=>{
      this.sidebarWidth=value;
      if(value===undefined)root.style.removeProperty('--sidebar-width');
      else root.style.setProperty('--sidebar-width',`${Math.min(limits().max.width,Math.max(dimensions.sidebarMinimum,value))}px`);
    };
    if(this.sidebarWidth!==undefined)applyWidth(this.sidebarWidth);
    if(handle)this.sidebarResize=bindResizeHandle(handle,{axis:'horizontal',reverseX:true,get:()=>({width:width(),height:0}),limits,start:()=>root.setAttribute('data-sidebar-resizing',''),set:size=>applyWidth(size.width),end:()=>{
      root.removeAttribute('data-sidebar-resizing');
      try{if(this.sidebarWidth!==undefined)sessionStorage.setItem('plot-it-sidebar-width',String(this.sidebarWidth));}catch{/* Optional storage. */}
    },reset:()=>{applyWidth();try{sessionStorage.removeItem('plot-it-sidebar-width');}catch{/* Optional storage. */}}});
    window.addEventListener('resize',()=>{if(this.sidebarWidth!==undefined)applyWidth(this.sidebarWidth);this.sidebarResize?.sync();},{signal});
    this.releaseSegments = mountSegmentedControls(root);
    this.releaseHelp = mountContextualHelp(root);
    this.native = new NativeOverlays([
      ...[...root.querySelectorAll<HTMLElement>('[popover]:not([data-context-help-popover])')].map(overlay => ({ overlay, trigger:root.querySelector<HTMLElement>(`[popovertarget="${overlay.id}"]:not([popovertargetaction])`) ?? undefined, navigation:true })),
      ...[...root.querySelectorAll<HTMLDialogElement>('dialog')].map(overlay => ({ overlay, trigger:overlay.hasAttribute('data-inspector-host') ? root.querySelector<HTMLElement>('[data-inspector-trigger]') ?? undefined : undefined, close:overlay.hasAttribute('data-inspector-host')?()=>this.closeInspector():undefined }))
    ]);
    root.querySelectorAll<HTMLElement>('[role="toolbar"]').forEach(toolbar => {
      toolbar.addEventListener('keydown', event => { if (!event.defaultPrevented && !(event.target as Element).closest('[data-segmented]')) navigateControls(event, toolbar, 'button:not(:disabled)', true); }, { signal });
    });
    const drawer = this.drawer;
    drawer?.addEventListener('close', () => {
      drawer.querySelectorAll<HTMLElement>('[data-context-help-popover]:popover-open').forEach(overlay=>overlay.hidePopover());
      const panel = root.querySelector<HTMLElement>('[data-ui="inspector"]');
      if (panel) root.querySelector('[data-inspector-dock]')?.append(panel);
      const modes = drawer.querySelector<HTMLElement>('[role="radiogroup"][data-segmented]');
      if (modes) (root.querySelector('[data-workspace-mode-dock]') ?? root.querySelector('.top-actions'))?.prepend(modes);
      root.querySelector('[data-inspector-trigger]')?.setAttribute('aria-expanded', 'false');
    }, { signal });
    root.querySelector('[data-close-inspector]')?.addEventListener('click', () => drawer?.close(), { signal });
    this.mobile.addEventListener('change', () => { if (!this.mobile.matches) this.closeInspector(false); }, { signal });
    this.observer = new ResizeObserver(() => this.fit());
    const stage = root.querySelector<HTMLElement>('#stage'); if (stage) this.observer.observe(stage);
    const status = root.querySelector<HTMLElement>('[data-ui="status"]'); if (status) this.observer.observe(status);
    this.fit();
  }
  private get drawer() { return this.root.querySelector<HTMLDialogElement>('[data-inspector-host]'); }
  get inspectorOpen() { return this.drawer?.open ?? false; }
  openInspector(): void {
    if (!this.mobile.matches) { this.root.querySelector<HTMLElement>('[data-ui="inspector"]')?.querySelector<HTMLElement>('summary,h2')?.focus(); return; }
    const drawer = this.drawer, inspector = this.root.querySelector<HTMLElement>('[data-ui="inspector"]');
    if (!drawer || !inspector || drawer.open) return;
    const modes = this.root.querySelector<HTMLElement>('[data-workspace-mode-dock] [role="radiogroup"][data-segmented],.top-actions [role="radiogroup"][data-segmented]');
    if (modes) drawer.querySelector('[data-inspector-mode]')?.append(modes);
    drawer.append(inspector); drawer.inert=false;drawer.showModal();animateSurface(drawer,true);
    this.root.querySelector('[data-inspector-trigger]')?.setAttribute('aria-expanded', 'true');
  }
  closeInspector(restoreFocus = true): void {
    const drawer=this.drawer;if(!drawer?.open)return;
    if(!restoreFocus){stopSurfaceAnimation(drawer);drawer.dataset.focusHandoff='';drawer.inert=false;drawer.close();return;}
    if(drawer.inert)return;drawer.inert=true;animateSurface(drawer,false,()=>{drawer.inert=false;drawer.close();});
  }
  closeMenu(): void { this.root.querySelector<HTMLElement>('#main-menu')?.hidePopover(); }
  private fit(): void {
    this.root.querySelectorAll<HTMLElement>('[data-object-list-resize]').forEach(handle=>{
      const list=handle.previousElementSibling as HTMLElement;
      handle.setAttribute('aria-valuenow',String(Math.max(64,Math.round(list?.getBoundingClientRect().height??0))));
      handle.setAttribute('aria-valuemax',String(Math.min(480,innerHeight/2)));
    });
    const stage = this.root.querySelector<HTMLElement>('#stage'); if (!stage) return;
    const status = this.root.querySelector<HTMLElement>('[data-ui="status"]');
    const plotting = this.root.hasAttribute('data-plot-mode');
    if (status && plotting) {
      const bounds = stage.getBoundingClientRect();
      const controls = this.root.querySelector<HTMLElement>('.viewport-controls')?.getBoundingClientRect();
      const right = innerWidth > dimensions.tabletMax && controls ? controls.left - 16 : bounds.right - 16;
      status.style.setProperty('--status-max-width', `${Math.max(100,right - status.getBoundingClientRect().left)}px`);
      stage.style.setProperty('--status-reserve', `${Math.max(0,bounds.bottom - status.getBoundingClientRect().top + 12)}px`);
    } else {
      status?.style.removeProperty('--status-max-width');
      stage.style.removeProperty('--status-reserve');
    }
  }
  destroy(): void { this.root.removeAttribute('data-sidebar-resizing');if(this.drawer)stopSurfaceAnimation(this.drawer);this.native.destroy(); this.releaseSegments(); this.releaseHelp(); this.controller.abort(); this.observer.disconnect(); this.sidebarResize?.destroy(); }
}
