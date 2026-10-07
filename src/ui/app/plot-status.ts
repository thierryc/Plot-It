import styles from './plot-status.module.css';

/** Canvas-side process summary. Frequent numeric updates are silent for screen readers. */
export class PlotCanvasStatus {
  readonly element: HTMLElement;
  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = styles.status!;
    this.element.dataset.plotCanvasStatus = '';
    this.element.innerHTML = `<div class="${styles.heading}" role="status" aria-live="polite" aria-atomic="true" data-player-status></div><div class="${styles.details}" aria-live="off"><span data-player-time></span><span data-plot-distances></span><span data-plot-elapsed></span><span role="status" aria-live="polite" aria-atomic="true" data-power-status hidden></span><span data-player-notice hidden></span></div>`;
    root.querySelector('[data-ui="status"]')?.append(this.element);
  }
  text(selector: string, value: string): void {
    const node = this.element.querySelector<HTMLElement>(selector)!;
    if (node.textContent !== value) node.textContent = value;
    node.hidden = !value;
  }
  destroy(): void { this.element.remove(); }
}
