import styles from './ui/app/plot.module.css';
import type { PlotSignal } from './plot-signals';

/** HTML above the paper, outside the plotted SVG and its clipping bounds. */
export class PlotPenCounter {
  private node = document.createElement('div');
  constructor(paper: SVGSVGElement) {
    this.node.className = `plot-pen-counter ${styles['plot-pen-counter']}`;
    this.node.dataset.plotPenCounter = '';
    this.node.setAttribute('aria-label', 'Simulation pen transitions and position');
    this.node.innerHTML = '<span>Pen up <b data-pen-up-count>0</b></span><span>Pen down <b data-pen-down-count>0</b></span><span data-pen-position>X 0.00 · Y 0.00 mm</span><span data-pen-state>Up</span>';
    this.node.hidden = true;
    paper.parentElement?.append(this.node);
  }
  update(signal: PlotSignal | null, visible: boolean): void {
    this.node.hidden = !visible;
    const set = (selector: string, value: string) => { const node = this.node.querySelector(selector)!; if (node.textContent !== value) node.textContent = value; };
    set('[data-pen-up-count]', String(signal?.penCounts.up ?? 0));
    set('[data-pen-down-count]', String(signal?.penCounts.down ?? 0));
    set('[data-pen-position]', `X ${(signal?.position.x ?? 0).toFixed(2)} · Y ${(signal?.position.y ?? 0).toFixed(2)} mm`);
    set('[data-pen-state]', signal?.penDown ? 'Down' : 'Up');
  }
  destroy(): void { this.node.remove(); }
}
