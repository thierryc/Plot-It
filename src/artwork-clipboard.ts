import { elements } from './editor';
import { clonedMarkup } from './editor-modifiers';
import { exportFilledSvg } from './fill-dom';
import { parsePlotIt, serializePlotIt, type EmbeddedFont } from './document-file';
import { initialState, makeId, type ArtworkItem } from './model';
import { parseSvg } from './svg';
import type { WorldBounds } from './editor-viewport';

const NS = 'http://www.w3.org/2000/svg';
const METADATA = 'metadata[data-plot-it-clipboard]';
export const MAX_CLIPBOARD_BYTES = 32 * 1024 * 1024;
export interface ClipboardArtwork { item: ArtworkItem; svg: string }

function checkSize(source: string): void {
  if (source.length > MAX_CLIPBOARD_BYTES || new Blob([source]).size > MAX_CLIPBOARD_BYTES)
    throw new Error('This clipboard artwork exceeds 32 MB. Use an SVG or Plot-It file instead.');
}

/** Export only the selected object/element, including its generated fill and inherited SVG context. */
export function captureClipboardArtwork(scene: SVGSVGElement, item: ArtworkItem, index: number | null, bounds: WorldBounds): ClipboardArtwork {
  const layer = scene.querySelector('#artwork-layer')?.cloneNode(true) as SVGGElement | undefined;
  const groups = [...layer?.children ?? []].filter(node => node.hasAttribute('data-item-id')) as SVGGElement[];
  const group = groups.find(node => node.dataset.itemId === item.id);
  if (!layer || !group) throw new Error('Select artwork to copy.');
  for (const node of groups) if (node !== group) node.remove();
  if (index !== null) {
    const source = elements(group)[index];
    if (!source) throw new Error('The selected element no longer exists.');
    const key = source.getAttribute('data-fill-path-key');
    for (const node of elements(group)) if (node !== source && (!key || node.getAttribute('data-fill-path-key') !== key)) node.remove();
    for (const node of group.querySelectorAll('[data-generated-fill]')) if (!key || node.getAttribute('data-fill-path-key') !== key) node.remove();
  }
  const root = document.createElementNS(NS, 'svg'); root.append(layer);
  const exported = new DOMParser().parseFromString(exportFilledSvg(root, bounds.width, bounds.height), 'image/svg+xml').documentElement;
  // A small transparent margin keeps strokes on the bounding edge from being clipped by other apps.
  const box = { x: bounds.x - 1, y: bounds.y - 1, width: Math.max(.01, bounds.width) + 2, height: Math.max(.01, bounds.height) + 2 };
  exported.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
  exported.setAttribute('width', `${box.width}mm`); exported.setAttribute('height', `${box.height}mm`);
  const svg = new XMLSerializer().serializeToString(exported);
  let native = structuredClone(item);
  if (index !== null) {
    native = parseSvg(svg, `${item.name} element`);
    Object.assign(native, box);
  }
  return { item: native, svg };
}

/** Standard SVG for other apps; versioned, validated editable data for Plot-It. */
export function encodeClipboardArtwork(artwork: ClipboardArtwork, fonts: EmbeddedFont[] = []): string {
  const root = new DOMParser().parseFromString(artwork.svg, 'image/svg+xml').documentElement;
  root.querySelectorAll(METADATA).forEach(node => node.remove());
  const metadata = root.ownerDocument.createElementNS(NS, 'metadata');
  metadata.setAttribute('data-plot-it-clipboard', '1');
  metadata.textContent = serializePlotIt({ ...structuredClone(initialState), documentName: 'Clipboard', items: [artwork.item] }, fonts);
  root.prepend(metadata);
  const source = new XMLSerializer().serializeToString(root); checkSize(source); return source;
}

export function decodeClipboardArtwork(source: string, editable = true): { item: ArtworkItem; fonts: EmbeddedFont[]; native: boolean } {
  checkSize(source);
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = parsed.documentElement;
  if (parsed.querySelector('parsererror') || root.localName !== 'svg') throw new Error('The clipboard does not contain a valid SVG.');
  const metadata = root.querySelector(METADATA);
  if (editable && metadata?.getAttribute('data-plot-it-clipboard') === '1') {
    try {
      const payload = parsePlotIt(metadata.textContent ?? '');
      if (payload.state.items.length === 1) return { item: payload.state.items[0]!, fonts: payload.fonts, native: true };
    } catch { /* Foreign apps may strip or alter metadata; the portable SVG remains usable. */ }
  }
  root.querySelectorAll(METADATA).forEach(node => node.remove());
  const item = parseSvg(new XMLSerializer().serializeToString(root), 'Pasted SVG');
  // Preserve physical SVG dimensions instead of applying the file import's convenient preview scale.
  const mm = (value: string | null) => value?.trim().match(/^(\d+(?:\.\d+)?)mm$/i)?.[1];
  const width = mm(root.getAttribute('width')), height = mm(root.getAttribute('height'));
  if (width && height && Number(width) > 0 && Number(height) > 0) { item.width = Number(width); item.height = Number(height); }
  return { item, fonts: [], native: false };
}

export function freshClipboardItem(item: ArtworkItem, position: { x: number; y: number }): ArtworkItem {
  const copy = structuredClone(item); copy.id = makeId(); copy.name += ' copy';
  copy.markup = clonedMarkup(copy.markup, copy.id); copy.x = position.x; copy.y = position.y;
  return copy;
}

/** Native inputs, text selections and text composition keep browser copy/paste. */
export function isArtworkClipboardTarget(target: EventTarget | null, app: HTMLElement): boolean {
  if (!(target instanceof Element) || target !== document.body && !app.contains(target)) return false;
  if (target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),dialog,[role="dialog"],[role="menu"]')) return false;
  return !window.getSelection()?.toString();
}

function svgText(source: string): string | undefined {
  const text = source.trim();
  if (!text.startsWith('<')) return;
  checkSize(text);
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  return parsed.documentElement.localName === 'svg' && !parsed.querySelector('parsererror') ? text : undefined;
}
/** Read DataTransfer synchronously while the native paste event is still active. */
export function svgFromPaste(data: DataTransfer): string | Promise<string> | undefined {
  const file = [...data.files].find(file => file.type === 'image/svg+xml' || /\.svg$/i.test(file.name));
  if (file) {
    if (file.size > MAX_CLIPBOARD_BYTES) throw new Error('Choose clipboard artwork smaller than 32 MB.');
    return file.text();
  }
  for (const type of ['image/svg+xml', 'text/plain']) { const value = svgText(data.getData(type)); if (value) return value; }
  const html = data.getData('text/html');
  if (html) {
    checkSize(html);
    const svg = new DOMParser().parseFromString(html, 'text/html').querySelector('svg');
    if (svg) return new XMLSerializer().serializeToString(svg);
  }
}

/** Start the write during the user gesture; promised Blobs preserve Safari's activation window. */
export async function writeSvgClipboard(source: Promise<string> | string, clipboard = navigator.clipboard, Item = globalThis.ClipboardItem): Promise<'svg' | 'text'> {
  const text = Promise.resolve(source); text.catch(() => {});
  if (clipboard?.write && Item) {
    const svg = typeof Item.supports === 'function' && Item.supports('image/svg+xml');
    const data: Record<string, Promise<Blob>> = { 'text/plain': text.then(value => new Blob([value], { type: 'text/plain' })) };
    if (svg) data['image/svg+xml'] = text.then(value => new Blob([value], { type: 'image/svg+xml' }));
    for (const blob of Object.values(data)) blob.catch(() => {});
    try { await clipboard.write([new Item(data)]); return svg ? 'svg' : 'text'; }
    catch (error) {
      if (!svg) throw error;
      await clipboard.write([new Item({ 'text/plain': data['text/plain']! })]); return 'text';
    }
  }
  if (clipboard?.writeText) return text.then(value => clipboard.writeText(value)).then(() => 'text');
  return Promise.reject(new Error('Clipboard access is unavailable. Use Command/Ctrl+C or import an SVG file.'));
}

export async function readSvgClipboard(clipboard = navigator.clipboard): Promise<string> {
  if (clipboard?.read) {
    const items = await clipboard.read();
    for (const type of ['image/svg+xml', 'text/plain', 'text/html']) for (const item of items) {
      if (!item.types.includes(type)) continue;
      const blob = await item.getType(type);
      if (blob.size > MAX_CLIPBOARD_BYTES) throw new Error('Choose clipboard artwork smaller than 32 MB.');
      const text = await blob.text();
      const source = type === 'text/html' ? new DOMParser().parseFromString(text, 'text/html').querySelector('svg')?.outerHTML : svgText(text);
      if (source) return source;
    }
  } else if (clipboard?.readText) { const source = svgText(await clipboard.readText()); if (source) return source; }
  throw new Error('No SVG found on the clipboard. Copy SVG artwork or SVG source, then paste on the canvas.');
}
