import type { WorkspaceMode } from './ui/app/workspace';

/** Session-only inspector state, independent of saved documents and canvas state. */
export class WorkspacePanels {
  mode: WorkspaceMode = 'edit';
  sidebarHidden = false;
  private views = new Map<WorkspaceMode, { scroll: number; details: Map<string, boolean> }>();
  capture(panel: HTMLElement): void {
    const scroll = panel.querySelector<HTMLElement>('.plot-scroll') ?? panel;
    this.views.set(this.mode, { scroll:scroll.scrollTop, details:new Map([...panel.querySelectorAll<HTMLDetailsElement>('details')].map((node,index) => [node.dataset.inspectorSection ?? node.dataset.section ?? `detail-${index}`, node.open])) });
  }
  restore(panel: HTMLElement): void {
    const view = this.views.get(this.mode); if (!view) return;
    panel.querySelectorAll<HTMLDetailsElement>('details').forEach((node,index) => {
      const value = view.details.get(node.dataset.inspectorSection ?? node.dataset.section ?? `detail-${index}`);
      if (value !== undefined) node.open = value;
    });
    (panel.querySelector<HTMLElement>('.plot-scroll') ?? panel).scrollTop = view.scroll;
  }
}
