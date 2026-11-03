import type { ArtworkItem, Point } from './model';

declare const coordinateSpace: unique symbol;
export type WorldPointMm = Point & { readonly [coordinateSpace]: 'world-mm' };
export type ViewportPointPx = Point & { readonly [coordinateSpace]: 'viewport-px' };
export type ClientPointPx = Point & { readonly [coordinateSpace]: 'client-px' };
export const worldPoint = (x: number, y: number) => ({ x, y }) as WorldPointMm;
export const viewportPoint = (x: number, y: number) => ({ x, y }) as ViewportPointPx;
export const clientPoint = (x: number, y: number) => ({ x, y }) as ClientPointPx;
export interface WorldBounds { x: number; y: number; width: number; height: number }
export interface ViewportSize { width: number; height: number }
export interface ViewportInsets { top: number; right: number; bottom: number; left: number }
export interface CameraState { center: WorldPointMm; scale: number }
export const REFERENCE_SCALE = 96 / 25.4;
const MIN_SCALE = 1e-6, MAX_SCALE = REFERENCE_SCALE * 64;
export const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export function worldToViewport(point: WorldPointMm, camera: CameraState, size: ViewportSize): ViewportPointPx {
  return viewportPoint(size.width / 2 + (point.x - camera.center.x) * camera.scale, size.height / 2 + (point.y - camera.center.y) * camera.scale);
}
export function viewportToWorld(point: ViewportPointPx, camera: CameraState, size: ViewportSize): WorldPointMm {
  return worldPoint(camera.center.x + (point.x - size.width / 2) / camera.scale, camera.center.y + (point.y - size.height / 2) / camera.scale);
}
export function clientToWorld(point: ClientPointPx, camera: CameraState, rect: WorldBounds): WorldPointMm {
  return viewportToWorld(viewportPoint(point.x - rect.x, point.y - rect.y), camera, rect);
}
export function panCamera(camera: CameraState, pixels: Point): CameraState {
  return { ...camera, center: worldPoint(camera.center.x + pixels.x / camera.scale, camera.center.y + pixels.y / camera.scale) };
}
export function zoomCamera(camera: CameraState, scale: number, anchor: ViewportPointPx, size: ViewportSize): CameraState {
  const point = viewportToWorld(anchor, camera, size), next = { ...camera, scale: clampScale(scale) };
  const after = viewportToWorld(anchor, next, size);
  return { ...next, center: worldPoint(camera.center.x + point.x - after.x, camera.center.y + point.y - after.y) };
}
export function fitCamera(bounds: WorldBounds, size: ViewportSize, insets: ViewportInsets): CameraState {
  const width = Math.max(1, size.width - insets.left - insets.right), height = Math.max(1, size.height - insets.top - insets.bottom);
  const scale = clampScale(Math.min(width / Math.max(.01, bounds.width), height / Math.max(.01, bounds.height)));
  return { scale, center: worldPoint(bounds.x + bounds.width / 2 + (insets.right - insets.left) / (2 * scale), bounds.y + bounds.height / 2 + (insets.bottom - insets.top) / (2 * scale)) };
}
export function itemWorldBounds(item: ArtworkItem): WorldBounds {
  const angle = item.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const width = Math.abs(c) * item.width + Math.abs(s) * item.height, height = Math.abs(s) * item.width + Math.abs(c) * item.height;
  return { x: item.x + (item.width - width) / 2, y: item.y + (item.height - height) / 2, width, height };
}
export function unionBounds(bounds: WorldBounds[]): WorldBounds {
  const x = Math.min(...bounds.map(b => b.x)), y = Math.min(...bounds.map(b => b.y));
  return { x, y, width: Math.max(...bounds.map(b => b.x + b.width)) - x, height: Math.max(...bounds.map(b => b.y + b.height)) - y };
}
/** Camera displacement in screen pixels/second; independent of zoom and frame rate. */
export function edgePanVelocity(point: ViewportPointPx, size: ViewportSize, insets: ViewportInsets): Point {
  const edge = 32, speed = 600;
  const axis = (value: number, start: number, end: number) => value < start + edge
    ? -speed * Math.min(1, Math.max(0, (start + edge - value) / edge)) ** 2
    : value > end - edge ? speed * Math.min(1, Math.max(0, (value - end + edge) / edge)) ** 2 : 0;
  return { x: axis(point.x, insets.left, size.width - insets.right), y: axis(point.y, insets.top, size.height - insets.bottom) };
}

/** The only DOM-matrix adapter: imported SVG geometry stays local, results are mm. */
export function elementToWorldMatrix(scene: SVGSVGElement, element: SVGGraphicsElement, root = scene.getScreenCTM()): DOMMatrix {
  const local = element.getScreenCTM();
  if (!root || !local) throw new Error('The artwork transform is unavailable.');
  const matrix = (m: DOMMatrix) => new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]);
  return matrix(root).inverse().multiply(matrix(local));
}

/** Session-only camera. The root SVG viewBox is the sole view transform. */
export class EditorViewport {
  camera: CameraState = { center: worldPoint(0, 0), scale: REFERENCE_SCALE };
  private host?: HTMLElement;
  private scene?: SVGSVGElement;
  private overlay?: SVGSVGElement;
  private observer?: ResizeObserver;
  private notify?: () => void;
  private initialized = false;
  get size(): ViewportSize {
    const rect = this.host?.getBoundingClientRect();
    return { width: rect?.width || 1, height: rect?.height || 1 };
  }
  get insets(): ViewportInsets {
    const surface = this.host?.closest('[data-ui="canvas-viewport"]');
    const rect = this.host?.getBoundingClientRect();
    const controls = surface?.querySelector<HTMLElement>('[data-ui="viewport-controls"]')?.getBoundingClientRect();
    const toolbar = surface?.querySelector<HTMLElement>('[data-ui="drawing-toolbar"]')?.getBoundingClientRect();
    const status = surface?.querySelector<HTMLElement>('[data-ui="status"]')?.getBoundingClientRect();
    return {
      top: Math.max(80, toolbar && rect ? toolbar.bottom - rect.top + 20 : 0), right: 40, left: 40,
      bottom: Math.max(86, controls && rect ? rect.bottom - controls.top + 16 : 0, status && rect ? rect.bottom - status.top + 12 : 0)
    };
  }
  mount(host: HTMLElement, scene: SVGSVGElement, overlay: SVGSVGElement, paper: ViewportSize, notify: () => void): void {
    this.disconnect(); this.host = host; this.scene = scene; this.overlay = overlay; this.notify = notify;
    this.layout();
    if (!this.initialized) { this.fit({ x: 0, y: 0, ...paper }); this.initialized = true; }
    else this.apply();
    this.observer = new ResizeObserver(() => {
      this.apply();
    });
    this.observer.observe(host);
  }
  disconnect(): void { this.observer?.disconnect(); this.observer = undefined; this.notify = undefined; }
  reset(): void { this.initialized = false; }
  set(camera: CameraState): void {
    if (![camera.center.x, camera.center.y, camera.scale].every(Number.isFinite) || camera.scale <= 0) throw new Error('Invalid workspace camera.');
    this.camera = { center: worldPoint(camera.center.x, camera.center.y), scale: clampScale(camera.scale) }; this.apply();
  }
  fit(bounds: WorldBounds): void { this.layout(); this.camera = fitCamera(bounds, this.size, this.insets); this.apply(); }
  pan(pixels: Point): void { this.set(panCamera(this.camera, pixels)); }
  zoom(factor: number, anchor = viewportPoint(this.size.width / 2, this.size.height / 2)): void { this.set(zoomCamera(this.camera, this.camera.scale * factor, anchor, this.size)); }
  fromClient(x: number, y: number): WorldPointMm {
    const rect = this.host!.getBoundingClientRect();
    return clientToWorld(clientPoint(x, y), this.camera, { x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  }
  toViewport(point: WorldPointMm): ViewportPointPx { return worldToViewport(point, this.camera, this.size); }
  edgePan(x: number, y: number, elapsed: number, viewportEdges = false): boolean {
    // A fitted resize handle can sit on the content inset. Only the physical
    // viewport edge should pan while resizing, so an inward drag stays inward.
    const rect = this.host!.getBoundingClientRect(), velocity = edgePanVelocity(viewportPoint(x - rect.left, y - rect.top), this.size, viewportEdges ? {top:0,right:0,bottom:0,left:0} : this.insets);
    if (!velocity.x && !velocity.y) return false;
    this.pan({ x: velocity.x * elapsed / 1000, y: velocity.y * elapsed / 1000 }); return true;
  }
  private layout(): void { this.host?.closest('[data-ui="canvas-viewport"]')?.toggleAttribute('data-compact-workspace', this.size.width < 640); }
  private apply(): void {
    if (!this.scene || !this.overlay) return;
    this.layout();
    const { width, height } = this.size, { center, scale } = this.camera;
    this.scene.setAttribute('viewBox', `${center.x - width / (2 * scale)} ${center.y - height / (2 * scale)} ${width / scale} ${height / scale}`);
    this.overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.overlay.querySelector('[data-world-overlay]')!.setAttribute('transform', `matrix(${scale} 0 0 ${scale} ${width / 2 - center.x * scale} ${height / 2 - center.y * scale})`);
    const label = this.host?.closest('[data-ui="canvas-viewport"]')?.querySelector('[data-zoom-label]');
    if (label) label.textContent = `${Number((scale / REFERENCE_SCALE * 100).toFixed(1))}%`;
    this.host?.dispatchEvent(new Event('viewportchange'));
    this.notify?.();
  }
}
