import {
  ArrowLeft, ArrowUp, ArrowDown, ChevronDown, Copy, Download, Maximize, Minus, MousePointer,
  Pause, Play, Square, Pencil, Plus, Redo2, RotateCw, Settings, Shapes, Trash, Type, Undo2, Upload, Usb, X, Save, FolderOpen, Ellipsis,
  Circle, RectangleHorizontal, Triangle, Slash, Menu, PanelRight, createElement
} from 'lucide';

// Named imports keep unused Lucide icons out of the production bundle.
const icons = {
  menu: Menu, panel: PanelRight, cursor: MousePointer, pen: Pencil, text: Type, upload: Upload, usb: Usb,
  circle: Circle, rectangle: RectangleHorizontal, square: Square, triangle: Triangle, line: Slash,
  download: Download, undo: Undo2, redo: Redo2, trash: Trash, rotate: RotateCw, fit: Maximize,
  close: X, shape: Shapes, chevron: ChevronDown, back: ArrowLeft, save: Save, load: FolderOpen, more: Ellipsis,
  up: ArrowUp, down: ArrowDown, minus: Minus, plus: Plus, copy: Copy, pause: Pause, play: Play, stop: Square, settings: Settings
};
const markup = new Map<keyof typeof icons, string>();

/** Decorative SVGs; their containing controls provide accessible names. */
export function icon(name: keyof typeof icons): string {
  let svg = markup.get(name);
  if (!svg) {
    svg = createElement(icons[name], {
      class: 'app-icon', 'aria-hidden': 'true', focusable: 'false'
    }).outerHTML;
    markup.set(name, svg);
  }
  return svg;
}
