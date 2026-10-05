import type { PlotSettings, Point } from './model';
import { setupAngle, setupPen, setupSize } from './plotter-setup';

// Original Figma frame 13:23. SVG layers are used unchanged at their native size.
const PEN = { x: 50.4546, y: 256.8636 };
// Visible bounds, excluding the empty padding of the original Figma frame.
const FOOTPRINT = { width: 968.182, height: 1091.773 };

/** Viewport-clipped decoration outside #paper and outside the scrolling stage.
 * It cannot participate in Fit, hit testing, export, or the plot planner. */
export class PlotterBackground {
  private layer: HTMLDivElement;
  private rig: HTMLDivElement;
  private arm: HTMLDivElement;
  private carriage: HTMLDivElement;
  private observer: ResizeObserver;
  private mutation: MutationObserver;
  private frame = 0;
  private position: Point = { x: 0, y: 0 };
  private planSettings: PlotSettings | undefined;
  private onPosition = (event: Event): void => {
    const detail = (event as CustomEvent<{ position: Point; settings?: PlotSettings }>).detail;
    this.planSettings = detail.settings; this.setPosition(detail.position);
  };

  constructor(private paper: SVGSVGElement, private settings: () => PlotSettings) {
    const stage = paper.closest<HTMLElement>('.stage')!;
    this.layer = document.createElement('div');
    this.layer.className = 'plotter-background';
    this.layer.setAttribute('aria-hidden', 'true');
    this.layer.inert = true;
    this.layer.innerHTML = `<div class="plotter-rig">
      <div class="plotter-main-rail"></div><div class="plotter-main-rail second"></div>
      <img class="plotter-motor top" src="/plotter/motor-top.svg" alt="" width="234.652" height="123.227" draggable="false">
      <img class="plotter-motor bottom" src="/plotter/motor-bottom.svg" alt="" width="90.9091" height="90.9091" draggable="false">
      <div class="plotter-arm"><img src="/plotter/pen-arm.svg" alt="" width="968.182" height="80.4546" draggable="false"></div>
      <div class="plotter-carriage"></div>
    </div>`;
    stage.parentElement!.append(this.layer);
    this.rig = this.layer.querySelector<HTMLDivElement>('.plotter-rig')!;
    this.arm = this.layer.querySelector<HTMLDivElement>('.plotter-arm')!;
    this.carriage = this.layer.querySelector<HTMLDivElement>('.plotter-carriage')!;
    this.observer = new ResizeObserver(this.refresh);
    this.observer.observe(stage); this.observer.observe(paper);
    this.mutation = new MutationObserver(this.refresh);
    this.mutation.observe(paper.parentElement!, { attributes: true, attributeFilter: ['style'] });
    stage.addEventListener('scroll', this.refresh, { passive: true });
    paper.addEventListener('plotter-position', this.onPosition);
    this.refresh();
  }

  refresh = (): void => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  };

  setPosition(position: Point): void { this.position = position; this.refresh(); }

  private draw(): void {
    const matrix = this.paper.getScreenCTM();
    if (!matrix) return;
    const bounds = this.layer.getBoundingClientRect(), settings = this.planSettings ?? this.settings();
    const size = setupSize(settings), sx = size.width / FOOTPRINT.width, sy = size.height / FOOTPRINT.height;
    // Preserve square motor/carriage symbols while adapting rail lengths to the model.
    this.rig.style.setProperty('--symbol-scale-x', String(sy / sx));
    const pen = setupPen(this.position, settings);
    this.rig.style.transform = `translate(${matrix.e - bounds.left}px,${matrix.f - bounds.top}px) scale(${matrix.a},${matrix.d}) rotate(${setupAngle(settings)}deg) scale(${sx},${sy}) translate(${-PEN.x}px,${-PEN.y}px)`;
    this.arm.style.translate = `${pen.x / sx}px ${pen.y / sy}px`;
    this.carriage.style.translate = `0 ${pen.y / sy}px`;
  }

  destroy(): void {
    cancelAnimationFrame(this.frame); this.observer.disconnect(); this.mutation.disconnect();
    this.paper.closest('.stage')?.removeEventListener('scroll', this.refresh);
    this.paper.removeEventListener('plotter-position', this.onPosition);
    this.layer.remove();
  }
}
