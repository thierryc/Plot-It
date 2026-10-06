import { NativeOverlays, navigateControls, dimensions, mountSegmentedControls } from '../design-system';
/** One controller per rendered shell. Native overlays own dismissal and trapping. */
export class WorkspaceOverlays {
  private native: NativeOverlays;
  private releaseSegments: () => void;
  private controller = new AbortController();
  private observer: ResizeObserver;
  private mobile = matchMedia(`(max-width: ${dimensions.mobileMax}px)`);
  constructor(private root: HTMLElement) {
    const signal = this.controller.signal;
    this.releaseSegments = mountSegmentedControls(root);
    this.native = new NativeOverlays([
      ...[...root.querySelectorAll<HTMLElement>('[popover]')].map(overlay => ({ overlay, trigger:root.querySelector<HTMLElement>(`[popovertarget="${overlay.id}"]:not([popovertargetaction])`) ?? undefined, navigation:true })),
      ...[...root.querySelectorAll<HTMLDialogElement>('dialog')].map(overlay => ({ overlay, trigger:overlay.hasAttribute('data-inspector-host') ? root.querySelector<HTMLElement>('[data-inspector-trigger]') ?? undefined : undefined }))
    ]);
    root.querySelectorAll<HTMLElement>('[role="toolbar"]').forEach(toolbar => {
      toolbar.addEventListener('keydown', event => navigateControls(event, toolbar, 'button:not(:disabled)', true), { signal });
    });
    const drawer = this.drawer;
    drawer?.addEventListener('close', () => {
      const panel = root.querySelector<HTMLElement>('[data-ui="inspector"]');
      if (panel) root.querySelector('[data-inspector-dock]')?.append(panel);
      root.querySelector('[data-inspector-trigger]')?.setAttribute('aria-expanded', 'false');
    }, { signal });
    root.querySelector('[data-close-inspector]')?.addEventListener('click', () => drawer?.close(), { signal });
    this.mobile.addEventListener('change', () => { if (!this.mobile.matches) this.drawer?.close(); }, { signal });
    this.observer = new ResizeObserver(() => this.fit());
    const stage = root.querySelector<HTMLElement>('#stage'); if (stage) this.observer.observe(stage);
    this.fit();
  }
  private get drawer() { return this.root.querySelector<HTMLDialogElement>('[data-inspector-host]'); }
  get inspectorOpen() { return this.drawer?.open ?? false; }
  openInspector(): void {
    if (!this.mobile.matches) { this.root.querySelector<HTMLElement>('[data-ui="inspector"]')?.querySelector<HTMLElement>('summary,h2')?.focus(); return; }
    const drawer = this.drawer, inspector = this.root.querySelector<HTMLElement>('[data-ui="inspector"]');
    if (!drawer || !inspector || drawer.open) return;
    drawer.append(inspector); drawer.showModal();
    this.root.querySelector('[data-inspector-trigger]')?.setAttribute('aria-expanded', 'true');
  }
  closeMenu(): void { this.root.querySelector<HTMLElement>('#main-menu')?.hidePopover(); }
  private fit(): void {
    const stage = this.root.querySelector<HTMLElement>('#stage'); if (!stage) return;
    const style = getComputedStyle(stage);
    const height = Math.max(80, stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
    stage.style.setProperty('--paper-fit-height', `${height}px`);
  }
  destroy(): void { this.native.destroy(); this.releaseSegments(); this.controller.abort(); this.observer.disconnect(); }
}
