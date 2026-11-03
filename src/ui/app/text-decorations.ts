import styles from './text-decorations.module.css';

export interface TextSelection {
  start: number;
  end: number;
  direction: 'forward' | 'backward' | 'none';
}
interface Interval { start: number; end: number }
interface DecorationState {
  selection: TextSelection;
  scope: 'block' | 'selection';
  overrides: readonly Interval[];
  composing: boolean;
}
interface Rectangle { left: number; top: number; width: number; height: number }

/** Display intervals only: values and feature/axis precedence remain in typography. */
export function decorationIntervals(ranges: readonly Interval[], length: number): Interval[] {
  const sorted = ranges.filter(range => Number.isInteger(range.start) && Number.isInteger(range.end))
    .map(range => ({start: Math.max(0, range.start), end: Math.min(length, range.end)}))
    .filter(range => range.start < range.end).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({...range});
  }
  return merged;
}

/** A plain-text measuring mirror; the textarea remains the only editing surface. */
export function bindTextDecorations(input: HTMLTextAreaElement, legend: HTMLElement, description: HTMLElement) {
  const surface = document.createElement('span'); surface.className = styles.surface!;
  const layer = document.createElement('span'); layer.className = styles.layer!;
  layer.setAttribute('aria-hidden', 'true'); layer.dataset.textDecorations = '';
  const mirror = document.createElement('span'); mirror.className = styles.mirror!;
  const source = document.createTextNode(''); mirror.append(source);
  const paint = document.createElement('span'); paint.className = styles.paint!;
  layer.append(mirror, paint); input.before(surface); surface.append(layer, input);
  const controller = new AbortController(), eventOptions = {signal: controller.signal};
  let state: DecorationState = {selection: {start: 0, end: 0, direction: 'none'}, scope: 'block', overrides: [], composing: false};
  let frame: number | undefined, closed = false, layoutDirty = true;
  let text = '', selectionKey = '', overridesKey = '';
  let selectionRects: Rectangle[] = [], overrideRects: Rectangle[] = [];
  const layoutProperties = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant',
    'font-feature-settings', 'font-variation-settings', 'font-kerning', 'font-optical-sizing', 'font-synthesis',
    'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-indent', 'text-transform', 'text-rendering',
    'direction', 'unicode-bidi', 'tab-size', 'word-break', 'overflow-wrap', 'white-space',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left'] as const;

  function rectangles(interval: Interval): Rectangle[] {
    if (interval.start >= interval.end) return [];
    const range = document.createRange(); range.setStart(source, interval.start); range.setEnd(source, interval.end);
    // jsdom has no layout; actual rectangle alignment is verified in a browser.
    if (!range.getClientRects) return [];
    const origin = mirror.getBoundingClientRect();
    const scaleX = origin.width / (mirror.offsetWidth || origin.width || 1) || 1;
    const scaleY = origin.height / (mirror.offsetHeight || origin.height || 1) || 1;
    return [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).map(rect => ({
      left: (rect.left - origin.left) / scaleX, top: (rect.top - origin.top) / scaleY,
      width: rect.width / scaleX, height: rect.height / scaleY,
    }));
  }
  function draw() {
    frame = undefined;
    if (closed || !input.isConnected) return;
    layer.hidden = state.composing;
    legend.hidden = !state.overrides.length;
    const describedBy = new Set((input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
    if (state.overrides.length) describedBy.add(description.id); else describedBy.delete(description.id);
    input.setAttribute('aria-describedby', [...describedBy].join(' '));
    if (state.composing) return;
    if (text !== input.value) {
      text = input.value;
      // A sentinel gives a final empty line its normal layout; it has no source offset.
      source.data = text + (text.endsWith('\n') ? '\u200b' : '');
      layoutDirty = true;
    }
    if (layoutDirty) {
      const computed = getComputedStyle(input);
      for (const property of layoutProperties) mirror.style.setProperty(property, computed.getPropertyValue(property));
      mirror.style.whiteSpace = input.wrap === 'off' ? 'pre' : 'pre-wrap';
      mirror.style.width = `${input.clientWidth}px`;
      layer.style.left = `${input.clientLeft}px`; layer.style.top = `${input.clientTop}px`;
      layer.style.width = `${input.clientWidth}px`; layer.style.height = `${input.clientHeight}px`;
    }
    const currentSelection = decorationIntervals([state.selection], text.length)[0] ?? {start: 0, end: 0};
    const nextSelectionKey = `${currentSelection.start}:${currentSelection.end}`;
    if (layoutDirty || selectionKey !== nextSelectionKey) selectionRects = rectangles(currentSelection);
    const nextOverridesKey = state.overrides.map(range => `${range.start}:${range.end}`).join(',');
    if (layoutDirty || overridesKey !== nextOverridesKey) overrideRects = state.overrides.flatMap(rectangles);
    selectionKey = nextSelectionKey; overridesKey = nextOverridesKey; layoutDirty = false;
    paint.style.transform = mirror.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
    const fragments = document.createDocumentFragment();
    const add = (rect: Rectangle, kind: 'selection' | 'override') => {
      const mark = document.createElement('span'); mark.dataset.textDecoration = kind;
      mark.className = kind === 'selection' ? styles.selection! : styles.override!;
      mark.style.left = `${rect.left}px`; mark.style.top = `${rect.top + (kind === 'override' ? rect.height : 0)}px`;
      mark.style.width = `${rect.width}px`; if (kind === 'selection') mark.style.height = `${rect.height}px`;
      fragments.append(mark);
    };
    if (document.activeElement !== input) for (const rect of selectionRects) add(rect, 'selection');
    for (const rect of overrideRects) add(rect, 'override');
    paint.dataset.decorationScope = state.scope;
    paint.replaceChildren(fragments);
  }
  function schedule() { if (!closed && frame === undefined) frame = requestAnimationFrame(draw); }
  function invalidate() { layoutDirty = true; schedule(); }
  input.addEventListener('scroll', () => {
    // Scrolling changes only the paint translation, never text measurements.
    paint.style.transform = mirror.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
  }, eventOptions);
  input.addEventListener('focus', schedule, eventOptions); input.addEventListener('blur', schedule, eventOptions);
  window.addEventListener('resize', invalidate, eventOptions);
  const observer = new ResizeObserver(invalidate); observer.observe(input);
  const themeObserver = new MutationObserver(invalidate);
  themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['class', 'style', 'data-theme']});
  themeObserver.observe(input, {attributes: true, attributeFilter: ['class', 'style', 'wrap', 'dir']});
  document.fonts?.addEventListener('loadingdone', invalidate, eventOptions);
  return {
    update(next: DecorationState) {
      state = {...next, selection: {...next.selection}, overrides: decorationIntervals(next.overrides, input.value.length)};
      schedule();
    },
    invalidate,
    destroy() {
      closed = true; if (frame !== undefined) cancelAnimationFrame(frame);
      controller.abort(); observer.disconnect(); themeObserver.disconnect();
      surface.before(input); surface.remove();
    },
  };
}
