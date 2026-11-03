import styles from './plot-status.module.css';

/** Canvas-side process summary. Frequent numeric updates are silent for screen readers. */
export class PlotCanvasStatus {
  readonly element: HTMLElement;
  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = styles.status!;
    this.element.dataset.plotCanvasStatus = '';
    this.element.innerHTML = `<div class="${styles.summary}"><span class="${styles.pen}" data-player-pen-state role="img" aria-label="Pen up" title="Pen up" hidden><svg viewBox="0 0 32 38" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 34h26"/><g data-pen-body><path d="M11 19V8a5 5 0 0 1 10 0v11l-5 5Z"/><path d="M11 9h10"/></g></svg></span><div class="${styles.heading}" role="status" aria-live="polite" aria-atomic="true" data-player-status></div></div><div class="${styles.details}" aria-live="off"><span data-player-time></span><span data-plot-distances></span><span data-plot-elapsed></span><span role="status" aria-live="polite" aria-atomic="true" data-power-status hidden></span><span data-player-notice hidden></span></div>`;
    root.querySelector('[data-ui="status"]')?.append(this.element);
  }
  text(selector: string, value: string): void {
    const node = this.element.querySelector<HTMLElement>(selector)!;
    if (node.textContent !== value) node.textContent = value;
    node.hidden = !value;
  }
  penState(down: boolean | undefined, visible: boolean): void {
    const node = this.element.querySelector<HTMLElement>('[data-player-pen-state]')!;
    node.hidden = !visible;
    const state = down === undefined ? 'unknown' : down ? 'down' : 'up';
    if (node.dataset.state === state) return;
    node.dataset.state = state;
    const label = down === undefined ? 'Pen state unknown' : down ? 'Pen down' : 'Pen up';
    node.setAttribute('aria-label', label); node.title = label;
    node.querySelector('[data-pen-body]')!.setAttribute('transform', `translate(0 ${down ? 10 : 0})`);
  }
  destroy(): void { this.element.remove(); }
}
