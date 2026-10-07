import { NativeOverlays, navigateControls, dimensions, mountSegmentedControls, mountContextualHelp } from '../design-system';
/** One controller per rendered shell. Native overlays own dismissal and trapping. */
export class WorkspaceOverlays {
  private native: NativeOverlays;
  private releaseHelp: () => void;
  private releaseSegments: () => void;
  private controller = new AbortController();
  private observer: ResizeObserver;
  private mobile = matchMedia(`(max-width: ${dimensions.mobileMax}px)`);
  constructor(private root: HTMLElement) {
    const signal = this.controller.signal;
    this.releaseSegments = mountSegmentedControls(root);
    this.releaseHelp = mountContextualHelp(root);
    this.native = new NativeOverlays([
      ...[...root.querySelectorAll<HTMLElement>('[popover]:not([data-context-help-popover])')].map(overlay => ({ overlay, trigger:root.querySelector<HTMLElement>(`[popovertarget="${overlay.id}"]:not([popovertargetaction])`) ?? undefined, navigation:true })),
      ...[...root.querySelectorAll<HTMLDialogElement>('dialog')].map(overlay => ({ overlay, trigger:overlay.hasAttribute('data-inspector-host') ? root.querySelector<HTMLElement>('[data-inspector-trigger]') ?? undefined : undefined }))
    ]);
    root.querySelectorAll<HTMLElement>('[role="toolbar"]').forEach(toolbar => {
      toolbar.addEventListener('keydown', event => navigateControls(event, toolbar, 'button:not(:disabled)', true), { signal });
    });
    const drawer = this.drawer;
    drawer?.addEventListener('close', () => {
      drawer.querySelectorAll<HTMLElement>('[data-context-help-popover]:popover-open').forEach(overlay=>overlay.hidePopover());
      const panel = root.querySelector<HTMLElement>('[data-ui="inspector"]');
      if (panel) root.querySelector('[data-inspector-dock]')?.append(panel);
      const modes = drawer.querySelector<HTMLElement>('[role="radiogroup"][data-segmented]');
      if (modes) root.querySelector('.top-actions')?.prepend(modes);
      root.querySelector('[data-inspector-trigger]')?.setAttribute('aria-expanded', 'false');
    }, { signal });
    root.querySelector('[data-close-inspector]')?.addEventListener('click', () => drawer?.close(), { signal });
    this.mobile.addEventListener('change', () => { if (!this.mobile.matches) this.drawer?.close(); }, { signal });
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
    const modes = this.root.querySelector<HTMLElement>('.top-actions [role="radiogroup"][data-segmented]');
    if (modes) drawer.querySelector('[data-inspector-mode]')?.append(modes);
    drawer.append(inspector); drawer.showModal();
    this.root.querySelector('[data-inspector-trigger]')?.setAttribute('aria-expanded', 'true');
  }
  closeMenu(): void { this.root.querySelector<HTMLElement>('#main-menu')?.hidePopover(); }
  private fit(): void {
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
    const style = getComputedStyle(stage);
    const height = Math.max(80, stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
    stage.style.setProperty('--paper-fit-height', `${height}px`);
  }
  destroy(): void { this.native.destroy(); this.releaseSegments(); this.releaseHelp(); this.controller.abort(); this.observer.disconnect(); }
}
