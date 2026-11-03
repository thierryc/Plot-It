import type { Point } from './model';
import { elements, markupRoot } from './editor';

/** Shortest angular step, allowing pointer rotation to cross the -180/180 seam. */
export function angleStep(previous: number, next: number): number { return ((next - previous + 540) % 360 + 360) % 360 - 180; }
export function snappedAngle(angle: number, snap = false): number { return snap ? Math.round(angle / 15) * 15 : angle; }
export interface SelectionPose { center: Point; rotation: number; wrapped?: boolean }
export interface RepeatTransform { x: number; y: number; rotation: number }
export function repeatTransform(source: SelectionPose, copy: SelectionPose): RepeatTransform {
  return { x: copy.center.x - source.center.x, y: copy.center.y - source.center.y, rotation: copy.wrapped ? angleStep(source.rotation, copy.rotation) : copy.rotation - source.rotation };
}
export class DuplicationChain {
  private chain?: { key: string; transform: RepeatTransform; lastPose: SelectionPose };
  clear() { this.chain = undefined; }
  next(key: string): RepeatTransform { return this.chain?.key === key ? { ...this.chain.transform } : { x: 5, y: 5, rotation: 0 }; }
  start(key: string, source: SelectionPose, copy: SelectionPose, transform = repeatTransform(source, copy)) {
    this.chain = { key, transform: { ...transform }, lastPose: structuredClone(copy) };
  }
  update(key: string, pose: SelectionPose, rotationOnly = false) {
    if (this.chain?.key !== key) return;
    const { transform, lastPose } = this.chain;
    this.chain.transform = {
      // A rotated asymmetric path can have a different bounding-box center.
      // That change is not an intentional page translation.
      x: transform.x + (rotationOnly ? 0 : pose.center.x - lastPose.center.x),
      y: transform.y + (rotationOnly ? 0 : pose.center.y - lastPose.center.y),
      rotation: transform.rotation + (pose.wrapped ? angleStep(lastPose.rotation, pose.rotation) : pose.rotation - lastPose.rotation)
    };
    this.chain.lastPose = structuredClone(pose);
  }
}

/** Remap references only to IDs owned by the cloned subtree. External defs stay shared. */
export function remapSvgIds(root: Element, prefix: string): void {
  const nodes = [root, ...root.querySelectorAll('*')], ids = new Map<string, string>();
  for (const node of nodes) if (node.id) ids.set(node.id, `${prefix}-${ids.size}`);
  for (const node of nodes) {
    for (const attr of [...node.attributes]) {
      let value = attr.value;
      if (attr.name === 'id') value = ids.get(value) ?? value;
      else {
        value = value.replace(/url\(\s*(['"]?)#([^\s)'"()]+)\1\s*\)/g, (full, quote: string, id: string) => ids.has(id) ? `url(${quote}#${ids.get(id)}${quote})` : full);
        if ((attr.localName === 'href') && value.startsWith('#') && ids.has(value.slice(1))) value = `#${ids.get(value.slice(1))}`;
        if (['aria-labelledby', 'aria-describedby'].includes(attr.name)) value = value.split(/\s+/).map(id => ids.get(id) ?? id).join(' ');
        if (attr.name === 'begin' || attr.name === 'end') value = value.replace(/(^|;\s*)([^;.\s]+)\./g, (full, start: string, id: string) => ids.has(id) ? `${start}${ids.get(id)}.` : full);
      }
      if (value !== attr.value) node.setAttributeNS(attr.namespaceURI, attr.name, value);
    }
  }
}
export function clonedMarkup(markup: string, prefix: string): string {
  const root = markupRoot(markup);
  if (!root.querySelector('[id]')) return markup;
  remapSvgIds(root, prefix); return root.innerHTML;
}
export function cloneSvgElement(markup: string, index: number, prefix: string, edit?: (copy: SVGGraphicsElement) => void): { markup: string; index: number } {
  const root = markupRoot(markup), source = elements(root)[index];
  if (!source) throw new Error('The selected element no longer exists.');
  const copy = source.cloneNode(true) as SVGGraphicsElement;
  remapSvgIds(copy, prefix); copy.setAttribute('data-plot-it-id', prefix);
  edit?.(copy);
  source.after(copy);
  return { markup: root.innerHTML, index: elements(root).indexOf(copy) };
}
