// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { WorkspacePanels } from './workspace-panels';

describe('session inspector views', () => {
  it('restores independent scroll and disclosure state for all three modes', () => {
    const views = new WorkspacePanels(), panel = document.createElement('aside');
    expect(views.mode).toBe('edit');
    panel.innerHTML = '<details data-inspector-section="objects" open><summary>Objects</summary></details>';
    panel.scrollTop = 120; views.capture(panel);
    views.mode = 'canvas'; panel.innerHTML = '<details data-inspector-section="paper"><summary>Paper</summary></details>';
    panel.scrollTop = 35; views.capture(panel);
    views.mode = 'plot'; panel.innerHTML = '<div class="plot-scroll"><details data-section="pen" open><summary>Pen</summary></details></div>';
    panel.querySelector<HTMLElement>('.plot-scroll')!.scrollTop = 80; views.capture(panel);
    panel.querySelector('details')!.open = false;
    panel.querySelector<HTMLElement>('.plot-scroll')!.scrollTop = 0;
    views.restore(panel);
    expect(panel.querySelector('details')!.open).toBe(true);
    expect(panel.querySelector<HTMLElement>('.plot-scroll')!.scrollTop).toBe(80);
    views.mode = 'canvas'; panel.innerHTML = '<details data-inspector-section="paper" open><summary>Paper</summary></details>';
    views.restore(panel); expect(panel.querySelector('details')!.open).toBe(false); expect(panel.scrollTop).toBe(35);
    views.mode = 'edit'; panel.innerHTML = '<details data-inspector-section="objects"><summary>Objects</summary></details>';
    views.restore(panel); expect(panel.querySelector('details')!.open).toBe(true); expect(panel.scrollTop).toBe(120);
  });
});
