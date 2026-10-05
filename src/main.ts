import "./styles.css";
import { applicationDeployment } from './app-deployment';
import type { TaskProgress } from "./task-progress";
import { FillPreview, adoptFillPreviewClone, awaitFills, effectiveFill, hasActiveFill, hasElementFills, ELEMENT_FILL_ATTRIBUTE, exportFilledSvg } from './fill-dom';
import { fillSpacing, validateFill } from './fill';
import { fillDocumentKey } from './fill-dom';
import { defaultFillSettings, type FillSettings } from './model';
import { prepareJob } from "./plot-job";
import { PlotWorkspace } from "./plot-workspace";
import { calibrationSheet } from './calibration';
import { DOCUMENT_ACCEPT, DOCUMENT_EXTENSION, MAX_DOCUMENT_BYTES, documentFontIds, isPlotItDocumentFile, parsePlotIt, serializePlotIt } from './document-file';
import { exportDocumentFonts, importDocumentFonts } from './typography';
import { canonicalColor, restorePens } from "./pens";
import { restoreMachineOrientation } from './motion';
import { PlotterBackground } from './plotter-background';
import { PLOTTER_POSITIONS, setupModel } from './plotter-setup';
import { icon } from "./icons";
import { initializeTheme } from "./theme";
import { parseHexColor, restorePaperColor } from "./colors";
import { initialState, itemTransform, PAPERS, type AppState, type ArtworkItem, type Point } from "./model";
import { freehandItem, parseSvg, renderItem } from "./svg";
import { recoverPlotText, supportedCharacters, textToItem } from "./plot-font";
import { constrainedDelta, editElement, elementName, ELEMENT_NAME_ATTRIBUTE, elements, markupRoot, movePathNode, parsePath, pathData, pathNodes, resizedDimensions, resizedItem, SHAPE_FIELDS } from "./editor";
import { SHAPES, shapeItem, type ShapeKind } from './shapes';
import { documentName, documentFilename } from './document-name';
import { DEFAULT_FONT_ID, defaultTextOptions, editTypography, ensureFontLoaded, findFont, fontTextOptions, loadedFonts, loadFontFile, migrateOutlineText, restoreFonts, textOptions, typographyToItem } from "./typography";
import type { TextOptions } from "./model";
import { Plotter } from "./plotter";
import { canvasPaper, MAX_CANVAS_MM, MIN_CANVAS_MM, paperPresetIndex, restorePaper } from "./paper";
import { GestureController, type GestureSample } from './gesture';
import { editorPreferences, type EditorPreferences } from './editor-preferences';
import { angleStep, snappedAngle, DuplicationChain, clonedMarkup, cloneSvgElement, remapSvgIds, type SelectionPose } from './editor-modifiers';

const app = document.querySelector<HTMLDivElement>("#app")!;
const deployment = applicationDeployment(import.meta.env.MODE);
const theme = initializeTheme(window, document);
const plotter = new Plotter();
let state = loadState();
let history: AppState[] = [];
let future: AppState[] = [];
let installPrompt: Event & { prompt?: () => Promise<void> } | null = null;
let selectedElement: number | null = null;
let editNodes = false;
let selectedNode: { command: number; pair: number } | null = null;
let plotWorkspace: PlotWorkspace | null = null;
let plotterBackground: PlotterBackground | null = null;
let fieldEditInput: Element | null = null;
const fillPreview = new FillPreview();
let fillStatus = '';
let fillError = false;
let fillStats = '';
let gestureActive = false;
let previewScreenMatrix: DOMMatrix | undefined;
const gestures = new GestureController();
const preferences = editorPreferences(localStorage);
const duplication = new DuplicationChain();
let spaceHeld = false;
let pan = { x: 0, y: 0 };
let nudgeGesture: { before: AppState; keys: Set<string> } | undefined;
type EditorSelection = { element: number | null; nodes: boolean; node: { command: number; pair: number } | null };
const undoSelections = new WeakMap<AppState, EditorSelection>();
function rememberSnapshot(snapshot = cloneState()): AppState {
  undoSelections.set(snapshot, { element: selectedElement, nodes: editNodes, node: selectedNode ? { ...selectedNode } : null });
  return snapshot;
}
function restoreSelection(snapshot: AppState): void {
  const selection = undoSelections.get(snapshot);
  selectedElement = selection?.element ?? null; editNodes = selection?.nodes ?? false; selectedNode = selection?.node ?? null;
}
let estimateTimer: ReturnType<typeof setTimeout> | undefined;
let estimatedKey = "";
let canvasFillKey = "";
let fillTask: TaskProgress | undefined;
let statsJob: ReturnType<typeof prepareJob> | undefined;
let statsRevision = 0;
let loadRevision = 0;
let restoredOutlineUpgradePending = false;
const inspectorSections = new Map<string, boolean>();
const boundObjectRows = new WeakSet<HTMLElement>();

function rememberInspectorSections(): void {
  app.querySelectorAll<HTMLDetailsElement>('details[data-inspector-section]').forEach(details => {
    inspectorSections.set(details.dataset.inspectorSection!, details.open);
  });
}
function inspectorSection(key: string): string {
  return `data-inspector-section="${key}" ${(inspectorSections.get(key) ?? true) ? 'open' : ''}`;
}
function colorControl(label: string, color: string, attributes: string): string {
  let value = '#000000';
  try { value = canonicalColor(color); } catch { /* A color picker cannot represent SVG none or gradients. */ }
  return `<div class="color-field"><span class="field-label">${label}</span><div class="color-inputs"><input type="color" ${attributes} value="${value}" aria-label="${label} picker"><input type="text" data-color-hex value="${value}" aria-label="${label} hex" autocomplete="off" spellcheck="false" placeholder="#RRGGBB"></div><p class="field-error" data-color-error role="alert" hidden></p></div>`;
}
function selectionPanelMarkup(): string {
  const item = selected();
  return `<summary class="panel-title">Selection</summary><div class="panel-body">${item && !item.text ? elementList(item) : ""}${item ? inspectorMarkup(item) : '<p class="panel-empty">Select an object on the paper or in the object list.</p>'}</div>`;
}

function cloneState(value = state): AppState { return structuredClone(value); }
function loadState(): AppState {
  try {
    const stored = localStorage.getItem("plot-it-document") ?? localStorage.getItem("svgplot-document") ?? localStorage.getItem("plotit-document");
    if (!stored) return cloneState(initialState);
    const parsed = JSON.parse(stored) as Partial<AppState> & { settings?: Partial<AppState["settings"]> & { optimize?: boolean } };
    parsed.items?.forEach(recoverPlotText);
    const paper = restorePaper(parsed.paper);
    const restored = {
      ...cloneState(initialState),
      ...parsed,
      documentName: documentName(parsed.documentName),
      paper,
      paperColor: restorePaperColor(parsed.paperColor),
      pens: restorePens(parsed.pens),
      settings: {
        ...initialState.settings,
        ...parsed.settings,
        axidrawModel: setupModel(parsed.settings?.axidrawModel),
        pauseOnToolChange: true,
        ...restoreMachineOrientation(parsed.settings),
        reorderMode: parsed.settings?.reorderMode ?? (parsed.settings?.optimize === false ? "preserve" : "reversible")
      }
    } as AppState;
    if (parsed.settings?.machineOrientationVersion !== restored.settings.machineOrientationVersion) {
      localStorage.setItem('plot-it-document', JSON.stringify(restored));
    }
    return restored;
  } catch { return cloneState(initialState); }
}
function commit(mutator: () => void, keepRepeat = false): void {
  if (plotWorkspace) return;
  gestures.finish(false);
  finishNudge();
  if (!keepRepeat) duplication.clear();
  fieldEditInput = null;
  history.push(rememberSnapshot());
  if (history.length > 60) history.shift();
  future = [];
  mutator();
  persist();
  render();
}
function commitField(input: HTMLInputElement | HTMLTextAreaElement, mutator: () => void): void {
  const interrupted = gestures.active;
  gestures.finish(false);
  finishNudge();
  if (!['x', 'y', 'rotation'].includes(input.dataset.itemProp ?? input.dataset.elementBounds ?? '')) duplication.clear();
  const before = rememberSnapshot(); mutator();
  if (JSON.stringify(before.items) === JSON.stringify(state.items)) { if (interrupted) render(); return; }
  if (fieldEditInput !== input) { history.push(before); if (history.length > 60) history.shift(); future = []; fieldEditInput = input; }
  persist();
  const item = selected(), group = app.querySelector<SVGGElement>(`[data-item-id="${state.selectedId}"]`);
  if (item && group) { group.innerHTML = item.markup; group.style.color = item.stroke; updateCanvasOnly(); }
  refreshCanvas();
  updateRepeat(input.dataset.itemProp === 'rotation');
  if (item) {
    app.querySelectorAll<HTMLInputElement>("[data-item-prop]").forEach((field) => {
      if (field === input) return;
      const value = item[field.dataset.itemProp as keyof ArtworkItem];
      if (typeof value === "number") field.value = String(Number(value.toFixed(3)));
      else if (typeof value === "string") field.value = value;
    });
    const size = app.querySelector<HTMLInputElement>("[data-text-size]");
    if (size && size !== input) size.value = String(Number((item.height / item.viewBox[3] * 1.4).toFixed(3)));
    const bounds = elementBounds();
    if (bounds) app.querySelectorAll<HTMLInputElement>("[data-element-bounds]").forEach((field) => {
      if (field !== input) field.value = String(Number(bounds[field.dataset.elementBounds as keyof typeof bounds].toFixed(3)));
    });
    const element = liveElement(), data = app.querySelector<HTMLTextAreaElement>("[data-path-data]");
    if (element && data && data !== input) data.value = element.getAttribute("d") ?? "";
  }
  const objects = app.querySelector(".objects-panel");
  if (objects) {
    const scroll = objects.querySelector(".object-list")?.scrollTop ?? 0;
    objects.innerHTML = objectsMarkup(); bindEditorEvents(objects); restoreObjectListScroll(scroll);
  }
  app.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled = !history.length;
  app.querySelector<HTMLButtonElement>('[data-action="redo"]')!.disabled = !future.length;
}
function persist(): void { localStorage.setItem("plot-it-document", JSON.stringify(state)); plotterBackground?.refresh(); }
function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}
function selected(): ArtworkItem | undefined { return state.items.find((item) => item.id === state.selectedId); }


function render(): void {
  if (plotWorkspace) return;
  plotterBackground?.destroy();
  finishNudge();
  // Settle the gesture while its SVG and geometry are still available.
  gestures.finish(false);
  document.title = `${state.documentName} · Plot-it`;
  rememberInspectorSections();
  const settingsOpen = app.querySelector("#settings-popover")?.matches(":popover-open") ?? false;
  const inspectorScroll = app.querySelector(".inspector")?.scrollTop ?? 0;
  const objectListScroll = app.querySelector(".objects-panel .object-list")?.scrollTop ?? 0;
  const stageScroll = app.querySelector("#stage");
  const scroll = { top: stageScroll?.scrollTop ?? 0, left: stageScroll?.scrollLeft ?? 0 };
  const item = selected();
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand"><span class="brand-mark">P</span><span>Plot-it</span><span class="beta" title="Beta · Active development">BETA</span>${deployment.hosted ? '<a href="/" class="hosted-home" aria-label="Plot-it home">Home</a>' : ''}</div>
        <div class="document-title"><span class="status-dot"></span><button class="document-name" data-document-name title="Double-click or press F2 to rename the plot">${escapeHtml(state.documentName)}</button><span class="saved">Saved locally</span></div>
        <div class="top-actions">
          <button class="button ghost icon-button" data-action="undo" title="Undo" aria-label="Undo" ${history.length ? "" : "disabled"}>${icon("undo")}</button>
          <button class="button ghost icon-button" data-action="redo" title="Redo" aria-label="Redo" ${future.length ? "" : "disabled"}>${icon("redo")}</button>
          <button class="button ghost" data-action="install" ${installPrompt ? "" : "hidden"}>Install app</button>
          ${plotControlsMarkup()}
        </div>
      </header>
      <main class="workspace">
        <aside class="tool-rail" aria-label="Drawing tools">
          <button class="tool ${state.tool === "select" ? "active" : ""}" data-tool="select" title="Select (V)">${icon("cursor")}<span>Select</span></button>
          <button class="tool ${state.tool === "draw" ? "active" : ""}" data-tool="draw" title="Draw (P)">${icon("pen")}<span>Draw</span></button>
          <button class="tool" data-action="add-text" title="Add plot text">${icon("text")}<span>Text</span></button>
          <button class="tool" data-action="shapes" popovertarget="shape-menu" title="Insert a shape" aria-haspopup="dialog" aria-expanded="false" aria-controls="shape-menu">${icon("shape")}<span>Shapes</span></button>
          <div class="rail-rule"></div>
          <button class="tool" data-action="import" title="Import SVG">${icon("upload")}<span>Import</span></button>
          <button class="tool" data-action="export" title="Export SVG" ${state.items.length ? "" : "disabled"}>${icon("download")}<span>Export</span></button>
          <button class="tool" data-action="save-document" title="Save Plot-it document (.plit.json)">${icon("save")}<span>Save</span></button>
          <button class="tool" data-action="load-document" title="Load Plot-it document (.plit or .plit.json)">${icon("load")}<span>Load</span></button>
          <button class="tool" data-action="more-elements" popovertarget="more-elements" title="More elements" aria-haspopup="dialog" aria-expanded="false" aria-controls="more-elements">${icon("more")}<span>More</span></button>
          <button class="tool settings-trigger" popovertarget="settings-popover" title="Settings" aria-label="Settings" aria-haspopup="dialog">${icon("settings")}<span>Settings</span></button>
        </aside>
        <section class="stage-wrap">
          ${fillProgressMarkup(true)}
          <div class="stage-toolbar">
            <button class="canvas-size-button" data-action="canvas-size" aria-label="Change canvas size" aria-haspopup="dialog" title="Change canvas size"><strong>${state.paper.name}</strong><span>${state.paper.width} × ${state.paper.height} mm</span><span class="canvas-size-chevron" aria-hidden="true">${icon("chevron")}</span></button>
            <div class="zoom-control"><button data-action="zoom-out" title="Zoom out" aria-label="Zoom out">${icon("minus")}</button><span>${Math.round(state.zoom * 100)}%</span><button data-action="zoom-in" title="Zoom in" aria-label="Zoom in">${icon("plus")}</button><button data-action="zoom-fit" title="Fit to view and reset pan" aria-label="Fit to view">${icon("fit")}</button></div>
          </div>
          <div class="stage" id="stage" tabindex="0" aria-label="Editing canvas">
            <div class="paper-shadow" style="--paper-ratio:${state.paper.width}/${state.paper.height};--zoom:${state.zoom};translate:${pan.x}px ${pan.y}px">
              <svg id="paper" class="paper" style="--paper-color:${state.paperColor}" viewBox="0 0 ${state.paper.width} ${state.paper.height}" role="img" aria-label="Plotting paper">
                <defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#d5d5d5" stroke-width=".18"/></pattern></defs>
                <rect id="paper-background" width="100%" height="100%" fill="${state.paperColor}"/>
                <rect width="100%" height="100%" fill="url(#grid)" opacity=".52"/>
                <rect x="${state.settings.margin}" y="${state.settings.margin}" width="${Math.max(0, state.paper.width - state.settings.margin * 2)}" height="${Math.max(0, state.paper.height - state.settings.margin * 2)}" class="margin-guide"/>
                <g id="artwork-layer" fill="none" stroke="currentColor" stroke-width=".35" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round">
                  ${state.items.map((entry) => renderItem(entry, entry.id === state.selectedId)).join("")}
                </g>
                ${item ? selectionMarkup(item) : ""}
                <path id="draft-path" class="draft-path" d=""/>
              </svg>
              ${state.items.length ? "" : `<div class="empty-state"><div class="empty-icon">${icon("pen")}</div><h2>Start with a line</h2><p>Drop an SVG here, draw directly, or set type with single-line or loaded OpenType fonts.</p><div><button class="button primary" data-action="import">Import SVG</button><button class="button" data-action="add-text">Add text</button></div><small>Everything stays in your browser.</small></div>`}
            </div>
          </div>
          <footer class="statusbar"><span><i></i>${plotter.connected ? `EBB connected · Firmware ${plotter.firmwareLabel}` : plotter.supported ? "Web Serial ready in Chrome" : "Web Serial requires desktop Chrome or Edge"}</span>${deployment.hosted ? '<span class="hosted-attribution"><span class="hosted-extra"><a href="/docs/">Docs</a> · <a href="https://github.com/thierryc/Plot-It/issues">Support on GitHub</a> · </span><a href="https://ap.cx/" title="An Another Planet Experience project">AP.CX</a></span>' : ''}<span><a href="/plot-it-source.tar.gz" download>Source · AGPL-3.0</a> · ${state.items.length} object${state.items.length === 1 ? "" : "s"}</span></footer>
        </section>
        <aside class="inspector">
          <details class="panel editor-panel" ${inspectorSection("paper")}><summary class="panel-title">Paper</summary><div class="panel-body"><label>Size<select data-setting="paper">${paperOptions(paperPresetIndex(state.paper))}</select></label><button class="button" data-action="canvas-size">Canvas dimensions…</button>${colorControl("Paper color", state.paperColor, 'data-setting="paperColor"')}<label>Safe margin<div class="unit-input"><input type="number" min="0" max="50" step="1" value="${state.settings.margin}" data-setting="margin"><span>mm</span></div></label></div></details>
          <details class="panel editor-panel" ${inspectorSection('setup')}><summary class="panel-title">Plotter setup</summary><div class="panel-body">
            <label>Machine profile<select data-setting="profile"><option value="axidraw" ${state.settings.profile === 'axidraw' ? 'selected' : ''}>AxiDraw / EBB</option><option value="xylodraw" ${state.settings.profile === 'xylodraw' ? 'selected' : ''}>XyloDraw</option></select></label>
            ${state.settings.profile === 'axidraw' ? `<label>AxiDraw model<select data-setting="axidrawModel"><option value="v3-a4" ${setupModel(state.settings.axidrawModel) === 'v3-a4' ? 'selected' : ''}>V3 · A4</option><option value="v3-a3" ${state.settings.axidrawModel === 'v3-a3' ? 'selected' : ''}>V3/A3 · A3</option></select></label>` : ''}
            <label>Plotter position<select data-setting="machineRotation">${PLOTTER_POSITIONS.map(option => `<option value="${option.rotation}" ${(state.settings.machineRotation ?? 90) === option.rotation ? 'selected' : ''}>${option.label}</option>`).join('')}</select></label>
            <p class="field-help">Position sets the machine orientation. The diagram follows the pen during simulation. Fit frames the paper.</p>
          </div></details>
          <details class="panel editor-panel objects-panel" ${inspectorSection("objects")}>${objectsMarkup()}</details>
          <details class="panel editor-panel selection-panel" ${inspectorSection("selection")}>${selectionPanelMarkup()}</details>

        </aside>
      </main>
      <input id="file-input" type="file" accept="image/svg+xml,.svg" hidden>
      <input id="document-input" type="file" accept="${DOCUMENT_ACCEPT}" hidden>
      <section id="shape-menu" class="elements-popover shape-popover" popover="auto" role="dialog" aria-labelledby="shape-title">
        <div class="dialog-head"><h2 id="shape-title">Insert a shape</h2><button class="close" popovertarget="shape-menu" popovertargetaction="hide" aria-label="Close shapes">${icon("close")}</button></div>
        <div class="shape-grid">${SHAPES.map(shape => `<button class="button" data-add-shape="${shape.id}">${icon(shape.icon)}<span>${shape.label}</span></button>`).join('')}</div>
      </section>
      <section id="more-elements" class="elements-popover" popover="auto" role="dialog" aria-labelledby="elements-title">
        <div class="dialog-head"><h2 id="elements-title">Add an element</h2><button class="close" popovertarget="more-elements" popovertargetaction="hide" aria-label="Close elements">${icon("close")}</button></div>
        <h3>Calibration sheet</h3><p>Crossing horizontal and vertical lines cover the paper inside its safe margin. Check for faint or missing lines to find uneven pen contact.</p>
        <label>Line spacing<div class="unit-input"><input id="calibration-spacing" type="number" min="2" max="100" step="1" value="20"><span>mm</span></div></label>
        <p id="calibration-error" class="field-error" role="alert" hidden></p>
        <button class="button primary" data-action="surface-calibration">${icon("plus")} Add calibration sheet</button>
      </section>
      <dialog id="text-dialog">${textDialogMarkup()}</dialog>
      <dialog id="canvas-dialog" aria-labelledby="canvas-title">${canvasDialogMarkup()}</dialog>
      <section id="settings-popover" class="settings-popover" popover="auto" role="dialog" aria-labelledby="settings-title">
        <div class="dialog-head"><h2 id="settings-title">Settings</h2><button class="close" popovertarget="settings-popover" popovertargetaction="hide" aria-label="Close settings">${icon("close")}</button></div>
        <label class="settings-theme">Interface theme
          <select class="theme-select" aria-label="Interface theme">${["system", "light", "dark"].map((value) => `<option value="${value}" ${theme.preference === value ? "selected" : ""}>${value[0]!.toUpperCase() + value.slice(1)}</option>`).join("")}</select>
        </label>
        <div class="nudge-preferences">${(['nudgeMm', 'shiftNudgeMm'] as const).map(key => `<label>${key === 'nudgeMm' ? 'Normal nudge' : 'Shift nudge'}<div class="unit-input"><input type="number" min="0" step="any" data-nudge-preference="${key}" value="${preferences.value[key]}"><span>mm</span></div><span class="field-error" data-nudge-error="${key}" role="alert" hidden></span></label>`).join('')}<button class="button" data-reset-nudges>Reset nudge defaults</button></div>
      </section>
      <div id="toast" class="toast" role="status"></div>
    </div>`;
  bindEvents();
  plotterBackground = new PlotterBackground(app.querySelector<SVGSVGElement>('#paper')!, () => state.settings);
  applyPan();
  if (settingsOpen) app.querySelector<HTMLElement>("#settings-popover")?.showPopover();
  refreshCanvas();
  refreshInspector();
  restoreObjectListScroll(objectListScroll);
  app.querySelector(".inspector")!.scrollTop = inspectorScroll;
  app.querySelector("#stage")!.scrollTop = scroll.top;
  app.querySelector("#stage")!.scrollLeft = scroll.left;
}

function handleScale(): number {
  const matrix = app.querySelector<SVGSVGElement>('#paper')?.getScreenCTM();
  return matrix ? Math.max(.001, Math.hypot(matrix.a, matrix.b)) : 3;
}
function rotationHandle(x: number, y: number): string {
  const scale = handleScale(), cy = y - 26 / scale;
  return `<path class="rotation-connector" d="M${x} ${y}V${cy}"/><circle class="rotation-hit" data-rotate cx="${x}" cy="${cy}" r="${13 / scale}" role="button" aria-label="Rotate selection" tabindex="0"><title>Rotate · Shift snaps to 15°</title></circle><circle class="rotation-knob" cx="${x}" cy="${cy}" r="${5 / scale}"/>`;
}
function selectionMarkup(item: ArtworkItem): string {
  return `<g class="selection-ui" transform="translate(${item.x} ${item.y}) rotate(${item.rotation} ${item.width / 2} ${item.height / 2})"><rect class="selection-box" width="${item.width}" height="${item.height}"/>${editNodes ? '' : [['nw',0,0],['ne',1,0],['se',1,1],['sw',0,1]].map(([corner,x,y]) => `<circle class="handle ${corner}" data-handle="${corner}" cx="${Number(x)*item.width}" cy="${Number(y)*item.height}" r="${6 / handleScale()}"/>`).join('') + rotationHandle(item.width / 2, 0)}</g>`;
}
function inspectorMarkup(item: ArtworkItem): string {
  if (selectedElement !== null && !item.text) return elementInspector(item);
  return `<label>Name<input data-item-prop="name" value="${escapeHtml(item.name)}"></label>${item.text ? `<label>Text<textarea data-text-content rows="3">${escapeHtml(item.text.content)}</textarea></label><label>Cap height<div class="unit-input"><input type="number" min=".1" step=".1" data-text-size value="${Number((item.height / item.viewBox[3] * 1.4).toFixed(3))}"><span>mm</span></div></label>${typographyControls(textOptions(item))}` : ""}<div class="two-col"><label>X<div class="unit-input"><input type="number" step=".1" data-item-prop="x" value="${item.x.toFixed(3)}"><span>mm</span></div></label><label>Y<div class="unit-input"><input type="number" step=".1" data-item-prop="y" value="${item.y.toFixed(3)}"><span>mm</span></div></label><label>Width<div class="unit-input"><input type="number" min=".1" step=".1" data-item-prop="width" value="${item.width.toFixed(3)}"><span>mm</span></div></label><label>Height<div class="unit-input"><input type="number" min=".1" step=".1" data-item-prop="height" value="${item.height.toFixed(3)}"><span>mm</span></div></label></div><label>Rotation<div class="unit-input"><input type="number" step="1" data-item-prop="rotation" value="${item.rotation}"><span>°</span></div></label>${colorControl("Pen color", item.stroke, 'data-item-prop="stroke"')}${fillControls(item)}<div class="selection-actions"><button class="button" data-action="duplicate" title="Duplicate selection · Command/Ctrl+D · repeats the last copy transformation">${icon("copy")} Duplicate</button><button class="button" data-action="rotate">${icon("rotate")} 90°</button></div><button class="button danger" data-action="delete">${icon("trash")} Delete object</button>`;
}
function objectsMarkup(): string {
  return `<summary class="panel-title object-panel-heading"><span>Objects</span><span class="object-count">${state.items.length}</span></summary><div class="panel-body">${state.items.length ? `<div class="object-list">${state.items.map((item) => `<button class="object-row ${item.id === state.selectedId ? "active" : ""}" data-select-item="${item.id}" aria-pressed="${item.id === state.selectedId}" title="${escapeHtml(item.name)} · Double-click or press F2 to rename"><span class="object-icon" aria-hidden="true">${icon(item.text ? "text" : "shape")}</span><span class="object-name">${escapeHtml(item.name)}</span></button>`).join("")}</div><p class="field-help">Option/Alt-drag copies · Shift constrains. Corners resize · Option/Alt resizes from center. Shift rotates in 15° steps · Space-drag pans · ⌘/Ctrl+D repeats copies. Double-click a name to rename.</p>` : `<p class="panel-empty">Import an SVG, add text or a shape, or draw a path.</p>`}</div>`;
}
function elementList(item: ArtworkItem): string {
  return `<details class="element-list-section" data-item-elements="${item.id}" ${inspectorSection("elements")}><summary class="panel-title">SVG elements</summary><div class="panel-body"><div class="object-list">${elements(markupRoot(item.markup)).map((element, index) => `<button class="object-row ${selectedElement === index ? "active" : ""}" data-select-element="${index}" aria-pressed="${selectedElement === index}" title="Double-click or press F2 to rename · ${escapeHtml(`${index + 1}. ${elementName(element)}${element.id ? ` · ${element.id}` : ""}`)}"><span class="object-name">${index + 1}. ${escapeHtml(elementName(element))}${element.id ? ` · ${escapeHtml(element.id)}` : ""}</span></button>`).join("")}</div><p class="field-help">Double-click a name or press F2 to rename.</p></div></details>`;
}
function elementInspector(item: ArtworkItem): string {
  const element = elements(markupRoot(item.markup))[selectedElement!];
  if (!element) { selectedElement = null; return inspectorMarkup(item); }
  const fields = SHAPE_FIELDS[element.localName] ?? [];
  const bounds = elementBounds();
  return `<button class="button" data-action="select-object">${icon("back")} Whole object</button><div class="panel-title">${escapeHtml(element.localName)} ${selectedElement! + 1}</div><label>Name<input data-element-name value="${escapeHtml(elementName(element))}"></label>${bounds ? `<div class="two-col">${["x", "y", "width", "height"].map((key) => `<label>${key === "x" || key === "y" ? key.toUpperCase() : key}<div class="unit-input"><input type="number" step=".1" ${key === "width" || key === "height" ? 'min=".1"' : ""} data-element-bounds="${key}" value="${bounds[key as keyof typeof bounds].toFixed(3)}"><span>mm</span></div></label>`).join("")}</div>` : ""}${fields.length ? `<details><summary>Shape geometry (SVG units)</summary><div class="two-col">${fields.map((field) => `<label>${field}<input type="number" step="any" data-element-attr="${field}" value="${escapeHtml(element.getAttribute(field) ?? (field === "font-size" ? "16" : "0"))}"></label>`).join("")}</div></details>` : ""}${element.localName === "text" ? `<label>Text<textarea data-element-content rows="3">${escapeHtml(element.textContent ?? "")}</textarea></label><p class="field-help">Imported SVG text must be converted to paths before pen plotting. Use the Text tool to create plottable font outlines.</p>` : ""}${element.localName === "path" ? `<button class="button ${editNodes ? "node-active" : ""}" data-action="edit-nodes">${editNodes ? "Finish node editing" : "Edit path nodes"}</button>${nodeInspector()}<label>Path data<textarea data-path-data rows="4" spellcheck="false">${escapeHtml(element.getAttribute("d") ?? "")}</textarea></label><p class="field-help">Drag square anchors or round curve handles. Path data uses the original SVG units.</p>` : ""}${element.localName === "polyline" || element.localName === "polygon" ? `<label>Points (SVG units)<textarea data-element-points rows="3">${escapeHtml(element.getAttribute("points") ?? "")}</textarea></label>` : ""}${colorControl("Element pen color", liveElement() ? getComputedStyle(liveElement()!).stroke : element.getAttribute("stroke") ?? item.stroke, "data-element-color")}${fillControls(item)}<div class="selection-actions"><button class="button" data-action="duplicate" title="Duplicate element · Command/Ctrl+D">${icon("copy")} Duplicate</button><button class="button" data-action="rotate" title="Rotate selected element 90°">${icon("rotate")} 90°</button></div><button class="button danger" data-action="delete-element">${icon("trash")} Delete element</button>`;
}
function nodeInspector(): string {
  const element = liveElement(); if (!selectedNode || !element) return "";
  try {
    const node = pathNodes(parsePath(element.getAttribute("d") ?? "")).find((entry) => entry.command === selectedNode?.command && entry.pair === selectedNode.pair);
    if (!node) return "";
    const point = new DOMPoint(node.point.x, node.point.y).matrixTransform(elementMatrix(element));
    return `<div class="two-col">${["x", "y"].map((axis) => `<label>Node ${axis.toUpperCase()}<div class="unit-input"><input type="number" step=".1" data-node-axis="${axis}" value="${point[axis as "x" | "y"].toFixed(3)}"><span>mm</span></div></label>`).join("")}</div>`;
  } catch { return ""; }
}
function fontOptions(selectedId: string): string {
  const groups = new Map<string, ReturnType<typeof loadedFonts>>();
  for (const font of loadedFonts()) {
    const group = font.group ?? 'Your fonts';
    const list = groups.get(group) ?? []; list.push(font); groups.set(group, list);
  }
  return [...groups].map(([group, entries]) => `<optgroup label="${escapeHtml(group)}">${entries.map(font => `<option value="${escapeHtml(font.id)}" ${font.id === selectedId ? 'selected' : ''}>${escapeHtml(font.name)}${font.id === DEFAULT_FONT_ID ? ' · default' : ''}</option>`).join('')}</optgroup>`).join('');
}
function typographyControls(options: TextOptions): string {
  const font = findFont(options.fontId), outline = options.fontId !== "plot-sans", advanced = outline && (!font?.plotfont || !!font.plotfont.layout);
  const numeric = (key: "letterSpacing" | "wordSpacing" | "lineHeight", label: string, unit: string) => `<label>${label}<div class="unit-input"><input data-typography="${key}" type="number" step="any" ${key === "lineHeight" ? 'min=".01"' : ''} value="${options[key]}"><span>${unit}</span></div></label>`;
  return `<label>Font<select data-typography="fontId" data-font-current="${escapeHtml(options.fontId)}"><option value="plot-sans" ${!outline ? 'selected' : ''}>Plot Sans · single line</option>${outline && !font ? `<option value="${escapeHtml(options.fontId)}" selected>Unavailable font · load original file</option>` : ''}${fontOptions(options.fontId)}</select></label><p class="field-help" data-font-status role="status" hidden></p><label class="font-load">Load a font<input type="file" data-font-file accept=".ttf,.otf,.plotfont.json,.json"></label><p class="field-help">${font?.plotfont ? `PlotFont ${font.plotfont.version} · original strokes and fill regions. ${font.plotfont.layout ? 'OpenType layout enabled.' : 'Simple Latin layout with stored spacing and kerning.'} ${font.bundled ? `Bundled with Plot-it. <a href="${font.noticeUrl}" target="_blank" rel="noopener">Font attribution</a>.` : 'Fonts are saved in this browser.'}${font.id === 'plotfont-layout-demo' ? ' Demo characters: A, f, i, n, u, 0, space and combining marks. Try fi AA or Á.' : ''}` : outline ? `Font outlines are plotted as resolved boundaries. ${font?.bundled ? `Bundled with Plot-it. <a href="${font.noticeUrl}" target="_blank" rel="noopener">Font attribution</a>.` : 'Fonts are saved in this browser.'}` : `Plot Sans supports ${supportedCharacters()}. Lowercase uses uppercase forms.`}${font?.coverageHint ? ` ${escapeHtml(font.coverageHint)}` : ''}</p><div class="two-col">${numeric("letterSpacing", "Letter spacing", "em")}${numeric("wordSpacing", "Word spacing", "em")}${numeric("lineHeight", "Line height", "× cap")}<label>Alignment<select data-typography="align">${['left', 'center', 'right'].map(v => `<option ${options.align === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>${font?.plotfont && !advanced ? `<label class="check"><input type="checkbox" data-typography="kerning" ${options.kerning ? 'checked' : ''}><span>Kerning</span></label>` : ''}${advanced ? `<div class="type-checks">${([['kerning', 'Kerning'], ['ligatures', 'Standard ligatures'], ['contextual', 'Contextual alternates']] as const).map(([key, label]) => `<label><input type="checkbox" data-typography="${key}" ${options[key] ? 'checked' : ''}>${label}</label>`).join('')}</div><details><summary>OpenType features and language</summary><div class="typography-advanced"><label>Features<input data-typography="features" value="${escapeHtml(options.features)}" placeholder="smcp=1, dlig=1, ss01=1, salt=2" spellcheck="false"></label><p class="field-help">${font ? `Available tags: ${escapeHtml(font.features.join(', ') || 'none')}` : 'Load the original font to edit.'} Features depend on the font, script, and language. Nonzero letter spacing suppresses optional ligatures unless explicitly enabled here.</p>${font && Object.keys(font.axes).length ? `<label>Variable axes<input data-typography="variations" value="${escapeHtml(options.variations)}" placeholder="wght=700, wdth=100" spellcheck="false"></label><p class="field-help">${Object.entries(font.axes).map(([tag, axis]) => `${tag}: ${axis.min}–${axis.max} (default ${axis.default})`).join(' · ')}</p>` : ''}<div class="two-col"><label>Direction<select data-typography="direction">${['auto', 'ltr', 'rtl'].map(v => `<option ${options.direction === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>Language<input data-typography="language" value="${escapeHtml(options.language)}" placeholder="auto / en / tr"></label><label>Script<input data-typography="script" value="${escapeHtml(options.script)}" placeholder="auto / Latn / Arab" maxlength="4"></label></div><p class="field-help">Use one script and direction per text object. Automatic detection uses each line. Tracking is suppressed for Arabic, Syriac, and Mongolian to preserve joining.</p></div></details>` : ''}`;
}
function readTypography(root: ParentNode, base = defaultTextOptions): TextOptions {
  const options = { ...base };
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-typography]').forEach(input => {
    const key = input.dataset.typography as keyof TextOptions;
    const value = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : ['letterSpacing', 'wordSpacing', 'lineHeight'].includes(key) ? Number(input.value) : input.value;
    Object.assign(options, { [key]: value });
  });
  return options;
}
function textDialogMarkup(): string {
  return `<form method="dialog" id="text-form"><div class="dialog-head"><div><span class="eyebrow">Typography</span><h2>Add plot text</h2></div><button class="close" value="cancel" formnovalidate aria-label="Close">${icon("close")}</button></div><label>Text<textarea id="text-value" rows="3" placeholder="PLOT SOMETHING" required></textarea></label><label>Cap height<div class="unit-input"><input id="text-size" type="number" value="12" min=".1" step=".1"><span>mm</span></div></label><div data-dialog-typography>${typographyControls(defaultTextOptions)}</div><p id="text-error" class="text-error" role="alert" hidden></p><div class="dialog-actions"><button class="button" value="cancel" formnovalidate>Cancel</button><button class="button primary" value="default">Add to canvas</button></div></form>`;
}
function paperOptions(index: number): string {
  return `${PAPERS.map((paper, candidate) => `<option value="${candidate}" ${candidate === index ? "selected" : ""}>${paper.name}</option>`).join("")}<option value="custom" ${index < 0 ? "selected" : ""}>Custom size…</option>`;
}
function canvasDialogMarkup(): string {
  return `<form id="canvas-form" method="dialog"><div class="dialog-head"><div><span class="eyebrow">Paper & canvas</span><h2 id="canvas-title">Canvas size</h2></div><button class="close" type="button" data-action="close-canvas" aria-label="Close canvas size">${icon("close")}</button></div><label>Paper format<select id="canvas-preset">${paperOptions(paperPresetIndex(state.paper))}</select></label><div class="two-col"><label>Canvas width<div class="unit-input"><input id="canvas-width" type="number" min="${MIN_CANVAS_MM}" max="${MAX_CANVAS_MM}" step="any" value="${state.paper.width}" required><span>mm</span></div></label><label>Canvas height<div class="unit-input"><input id="canvas-height" type="number" min="${MIN_CANVAS_MM}" max="${MAX_CANVAS_MM}" step="any" value="${state.paper.height}" required><span>mm</span></div></label></div><button class="button" type="button" data-action="swap-canvas">${icon("rotate")} Swap width and height</button><p class="dialog-note">Artwork keeps its size and position. The safe margin stays unchanged. A larger canvas does not increase your plotter’s physical travel.</p><p id="canvas-error" class="canvas-error" role="alert" hidden></p><div class="dialog-actions"><button class="button" type="button" data-action="close-canvas">Cancel</button><button class="button primary" value="apply">Apply size</button></div></form>`;
}
function openCanvasSize(custom = false): void {
  const dialog = app.querySelector<HTMLDialogElement>("#canvas-dialog")!;
  app.querySelector<HTMLInputElement>("#canvas-width")!.value = String(state.paper.width);
  app.querySelector<HTMLInputElement>("#canvas-height")!.value = String(state.paper.height);
  app.querySelector<HTMLSelectElement>("#canvas-preset")!.value = custom ? "custom" : String(paperPresetIndex(state.paper) < 0 ? "custom" : paperPresetIndex(state.paper));
  app.querySelector<HTMLElement>("#canvas-error")!.hidden = true;
  dialog.showModal();
}
function syncCanvasPreset(): void {
  const width = Number(app.querySelector<HTMLInputElement>("#canvas-width")!.value);
  const height = Number(app.querySelector<HTMLInputElement>("#canvas-height")!.value);
  const index = paperPresetIndex({ width, height });
  app.querySelector<HTMLSelectElement>("#canvas-preset")!.value = index < 0 ? "custom" : String(index);
  app.querySelector<HTMLElement>("#canvas-error")!.hidden = true;
}
function applyCanvasSize(event: SubmitEvent): void {
  event.preventDefault();
  const dialog = app.querySelector<HTMLDialogElement>("#canvas-dialog")!;
  if ((event.submitter as HTMLButtonElement | null)?.value === "cancel") { dialog.close(); return; }
  try {
    const paper = canvasPaper(Number(app.querySelector<HTMLInputElement>("#canvas-width")!.value), Number(app.querySelector<HTMLInputElement>("#canvas-height")!.value));
    dialog.close();
    if (paper.width !== state.paper.width || paper.height !== state.paper.height) commit(() => { state.paper = paper; });
  } catch (error) {
    const message = app.querySelector<HTMLElement>("#canvas-error")!;
    message.textContent = (error as Error).message; message.hidden = false;
  }
}
function plotControlsMarkup(): string {
  return `<div class="mode-switch" role="group" aria-label="Workspace mode">
    <button class="button" data-action="edit-mode" aria-pressed="true" title="Edit mode">Edit</button>
    <button class="button" data-action="open-plot" aria-pressed="false" title="Plot mode">Plot</button>
  </div>`;
}

function bindEvents(): void {
  app.querySelectorAll<HTMLInputElement>('[data-nudge-preference]').forEach(input => input.addEventListener('input', () => {
    const key = input.dataset.nudgePreference as keyof EditorPreferences;
    const error = app.querySelector<HTMLElement>(`[data-nudge-error="${key}"]`)!;
    try { preferences.set(key, input.value); error.hidden = true; input.setAttribute('aria-invalid', 'false'); }
    catch (failure) { error.textContent = (failure as Error).message; error.hidden = false; input.setAttribute('aria-invalid', 'true'); }
  }));
  app.querySelector('[data-reset-nudges]')?.addEventListener('click', () => {
    preferences.reset();
    app.querySelectorAll<HTMLInputElement>('[data-nudge-preference]').forEach(input => {
      input.value = String(preferences.value[input.dataset.nudgePreference as keyof EditorPreferences]); input.setAttribute('aria-invalid', 'false');
    });
    app.querySelectorAll<HTMLElement>('[data-nudge-error]').forEach(error => error.hidden = true);
  });
  const title = app.querySelector<HTMLElement>('[data-document-name]');
  title?.addEventListener('dblclick', beginDocumentRename);
  title?.addEventListener('keydown', event => { if (event.key === 'F2' || event.key === 'Enter') { event.preventDefault(); beginDocumentRename(); } });
  app.querySelector<HTMLElement>('#shape-menu')?.addEventListener('toggle', event => {
    const menu = event.target as HTMLElement, open = menu.matches(':popover-open');
    const trigger = app.querySelector('[data-action="shapes"]');
    trigger?.setAttribute('aria-expanded', String(open));
    if (open && trigger) {
      const anchor = trigger.getBoundingClientRect(); menu.style.left = `${anchor.right + 12}px`;
      menu.style.top = `${Math.max(12, Math.min(anchor.top, window.innerHeight - menu.offsetHeight - 12))}px`;
      menu.querySelector<HTMLButtonElement>('[data-add-shape]')?.focus();
    }
  });
  app.querySelectorAll<HTMLElement>('[data-add-shape]').forEach(button => button.addEventListener('click', () => {
    if (plotWorkspace) return;
    const item = shapeItem(button.dataset.addShape as ShapeKind, state.paper, selected()?.stroke);
    app.querySelector<HTMLElement>('#shape-menu')?.hidePopover();
    commit(() => { state.items.push(item); state.selectedId = item.id; selectedElement = null; selectedNode = null; editNodes = false; state.tool = 'select'; });
  }));
  app.querySelector<HTMLElement>('#more-elements')?.addEventListener('toggle', event => {
    const menu = event.target as HTMLElement, open = menu.matches(':popover-open');
    const trigger = app.querySelector('[data-action="more-elements"]');
    trigger?.setAttribute('aria-expanded', String(open));
    if (open && trigger) {
      const anchor = trigger.getBoundingClientRect(); menu.style.left = `${anchor.right + 12}px`;
      menu.style.top = `${Math.max(12, Math.min(anchor.top, window.innerHeight - menu.offsetHeight - 12))}px`;
      app.querySelector<HTMLInputElement>('#calibration-spacing')?.focus();
    }
  });
  app.querySelector<HTMLInputElement>('#calibration-spacing')?.addEventListener('input', () => {
    app.querySelector<HTMLElement>('#calibration-error')!.hidden = true;
  });
  app.querySelector<HTMLSelectElement>(".theme-select")?.addEventListener("change", (event) => {
    theme.setPreference((event.target as HTMLSelectElement).value);
  });
  app.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => element.addEventListener("click", () => void action(element.dataset.action!)));
  app.querySelectorAll<HTMLElement>("[data-tool]").forEach((element) => element.addEventListener("click", () => { gestures.finish(); state.tool = element.dataset.tool as AppState["tool"]; render(); }));
  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-setting]").forEach((input) => input.addEventListener("change", () => updateSetting(input)));
  bindEditorEvents(app);
  bindTypographyEvents(app);
  app.querySelector<HTMLInputElement>("#file-input")?.addEventListener("change", importFile);
  app.querySelector<HTMLInputElement>('#document-input')?.addEventListener('change', event => {
    const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
    if (file) void loadDocument(file);
  });
  app.querySelector<HTMLFormElement>("#text-form")?.addEventListener("submit", addText);
  app.querySelector<HTMLFormElement>("#canvas-form")?.addEventListener("submit", applyCanvasSize);
  app.querySelector<HTMLDialogElement>("#canvas-dialog")?.addEventListener("close", () => {
    const index = paperPresetIndex(state.paper);
    app.querySelector<HTMLSelectElement>('[data-setting="paper"]')!.value = index < 0 ? "custom" : String(index);
  });
  app.querySelector<HTMLSelectElement>("#canvas-preset")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (value === "custom") { app.querySelector<HTMLInputElement>("#canvas-width")!.focus(); return; }
    const paper = PAPERS[Number(value)]!;
    app.querySelector<HTMLInputElement>("#canvas-width")!.value = String(paper.width);
    app.querySelector<HTMLInputElement>("#canvas-height")!.value = String(paper.height);
    app.querySelector<HTMLElement>("#canvas-error")!.hidden = true;
  });
  app.querySelectorAll<HTMLInputElement>("#canvas-width,#canvas-height").forEach((input) => input.addEventListener("input", syncCanvasPreset));
  const paper = app.querySelector<SVGSVGElement>("#paper");
  paper?.addEventListener("pointerdown", pointerDown);
  paper?.addEventListener("dblclick", (event) => {
    if (plotWorkspace) return;
    const target = event.target as Element;
    const group = target.closest<SVGGElement>("[data-item-id]");
    if (!group) return;
    const item = state.items.find((entry) => entry.id === group.dataset.itemId);
    if (item?.text) { selectObject(item.id); app.querySelector<HTMLTextAreaElement>("[data-text-content]")?.focus(); }
    else if (target.hasAttribute("data-element-index")) {
      selectObject(group.dataset.itemId!, Number(target.getAttribute("data-element-index")));
      if (target.localName === "path") { editNodes = true; refreshCanvas(); refreshInspector(); }
    }
  });
  const stage = app.querySelector<HTMLElement>("#stage");
  stage?.addEventListener('pointerdown', event => {
    if (!spaceHeld || plotWorkspace || gestures.active || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); stage.focus({ preventScroll: true }); beginPan(event);
  }, true);
  stage?.addEventListener("dragover", (event) => { event.preventDefault(); if (!plotWorkspace) stage.classList.add("dragging"); });
  stage?.addEventListener("dragleave", () => stage.classList.remove("dragging"));
  stage?.addEventListener("drop", (event) => { event.preventDefault(); if (plotWorkspace) return; stage.classList.remove("dragging"); void importDropped(event); });
}

function bindEditorEvents(root: ParentNode): void {
  bindColorControls(root);
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-fill-setting]').forEach(input => input.addEventListener('change', () => {
    const item = selected(); if (!item) return;
    try {
      const current = currentFill(item), key = input.dataset.fillSetting as keyof FillSettings;
      if(selectedElement!==null && item.fillSettings?.mode==='none') throw new Error('Enable the object fill before changing element fill settings.');
      const value = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : key === 'mode' ? input.value : Number(input.value);
      const next = { ...current, [key]: key === 'overlap' ? Number(value) / 100 : value } as FillSettings;
      if (key === 'mode') next.connect = next.mode === 'solid';
      validateFill(next);
      commit(() => saveFill(item, next));
    } catch (error) { toast((error as Error).message, true); refreshInspector(); }
  }));
  root.querySelectorAll<HTMLButtonElement>('[data-fill-overlap]').forEach(button => button.addEventListener('click', () => {
    const item = selected(); if (item) commit(() => saveFill(item, { ...currentFill(item), overlap: Number(button.dataset.fillOverlap) }));
  }));
  root.querySelectorAll<HTMLElement>("[data-select-item],[data-select-element]").forEach(button => {
    if (boundObjectRows.has(button)) return;
    boundObjectRows.add(button);
    const choose = () => {
      const id = button.dataset.selectItem ?? state.selectedId;
      const index = button.dataset.selectElement === undefined ? null : Number(button.dataset.selectElement);
      if (id && (state.selectedId !== id || selectedElement !== index)) selectObject(id, index);
    };
    button.addEventListener('click', event => { if (event.detail > 1) startRowRename(button); else choose(); });
    button.addEventListener('dblclick', () => startRowRename(button));
    button.addEventListener('keydown', event => {
      if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); choose(); startRowRename(button); }
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-item-prop]").forEach((input) => {
    input.addEventListener("input", () => updateItem(input, false));
    input.addEventListener("change", () => updateItem(input));
    input.addEventListener("blur", () => { fieldEditInput = null; });
  });
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-text-content],[data-text-size],[data-element-attr],[data-element-content],[data-element-points],[data-path-data],[data-element-color],[data-element-name],[data-element-bounds],[data-node-axis]")
    .forEach((input) => {
      const edit = (event: Event) => {
      const item = selected(); if (!item) return;
      try {
        if (input.hasAttribute("data-text-content") || input.hasAttribute("data-text-size")) {
          const content = input.hasAttribute("data-text-content") ? input.value : item.text!.content;
          const size = input.hasAttribute("data-text-size") ? validNumber(input, true) : undefined;
          if (!content.trim()) throw new Error("Enter some text.");
          commitField(input, () => editTypography(item, content, size)); return;
        }
        const index = selectedElement; if (index === null) return;
        if (input.hasAttribute('data-element-name')) {
          commitField(input, () => editElement(item, index, element => {
            const name = input.value.trim();
            if (name) element.setAttribute(ELEMENT_NAME_ATTRIBUTE, name);
            else element.removeAttribute(ELEMENT_NAME_ATTRIBUTE);
          }));
          syncElementNames(item); return;
        }
        if (input.dataset.elementBounds) { updateElementBounds(input); return; }
        if (input.dataset.nodeAxis) { updateNode(input); return; }
        let value = input.value;
        if (input.hasAttribute("data-path-data")) { value = pathData(parsePath(value)); if (!value) throw new Error("A path needs at least one point."); }
        if (input.hasAttribute("data-element-points")) {
          const tokens = value.trim().split(/[\s,]+/);
          if (tokens.length < 4 || tokens.length % 2 || !tokens.every((token) => token !== "" && Number.isFinite(Number(token)))) throw new Error("Enter at least two X,Y coordinate pairs.");
          value = tokens.map(Number).join(" ");
        }
        if (input.dataset.elementAttr) {
          const field = input.dataset.elementAttr;
          const numeric = validNumber(input, field === "font-size");
          if (["width", "height", "r", "rx", "ry"].includes(field) && numeric < 0) throw new Error("Shape dimensions cannot be negative.");
          value = String(numeric);
        }
        commitField(input, () => editElement(item, index, (element) => {
          if (input.hasAttribute("data-element-content")) element.textContent = value;
          else element.setAttribute(input.dataset.elementAttr ?? (input.hasAttribute("data-path-data") ? "d" : input.hasAttribute("data-element-color") ? "stroke" : "points"), value);
        }));
      } catch (error) { if (event.type === "change" || error instanceof TypeError) toast(error instanceof Error ? error.message : "Could not edit this element.", true); }
      };
      input.addEventListener("input", edit); input.addEventListener("change", edit);
      input.addEventListener("blur", () => { fieldEditInput = null; });
    });
}

function bindColorControls(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.color-field').forEach(field => {
    const picker = field.querySelector<HTMLInputElement>('input[type=color]')!;
    const hex = field.querySelector<HTMLInputElement>('[data-color-hex]')!;
    const error = field.querySelector<HTMLElement>('[data-color-error]')!;
    const clearError = () => { hex.removeAttribute('aria-invalid'); hex.setCustomValidity(''); error.hidden = true; };
    const apply = () => {
      if (plotWorkspace) return;
      try {
        const value = parseHexColor(hex.value); clearError(); hex.value = value;
        if (picker.value.toUpperCase() === value) return;
        picker.value = value;
        picker.dispatchEvent(new Event('change', {bubbles:true}));
      } catch (cause) {
        hex.setAttribute('aria-invalid', 'true');
        error.textContent = (cause as Error).message; error.hidden = false;
      }
    };
    picker.addEventListener('input', () => { clearError(); hex.value = picker.value.toUpperCase(); });
    picker.addEventListener('change', () => { clearError(); hex.value = picker.value.toUpperCase(); });
    hex.addEventListener('change', apply);
    hex.addEventListener('blur', () => { apply(); fieldEditInput = null; });
    hex.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); apply(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hex.value = picker.value.toUpperCase(); clearError(); }
    });
  });
}

function syncElementNames(item: ArtworkItem): void {
  const source = elements(markupRoot(item.markup));
  app.querySelectorAll<HTMLElement>('[data-select-element]').forEach(row => {
    const index = Number(row.dataset.selectElement), element = source[index];
    if (!element) return;
    const label = `${index + 1}. ${elementName(element)}${element.id ? ` · ${element.id}` : ''}`;
    row.querySelector('.object-name')!.textContent = label;
    row.title = `${label} · Double-click or press F2 to rename`;
  });
}

function beginDocumentRename(): void {
  if (plotWorkspace || app.querySelector('[data-document-rename]')) return;
  const title = app.querySelector<HTMLElement>('[data-document-name]'); if (!title) return;
  const original = state.documentName;
  const input = document.createElement('input'); input.className = 'document-rename-input'; input.dataset.documentRename = '';
  input.value = original; input.setAttribute('aria-label', 'Plot name');
  title.replaceWith(input);
  let closed = false;
  const finish = (save: boolean) => {
    if (closed) return; closed = true;
    if (!input.isConnected) return;
    const name = documentName(input.value);
    if (save && name !== original) commit(() => { state.documentName = name; });
    else input.replaceWith(title);
    app.querySelector<HTMLElement>('[data-document-name]')?.focus({ preventScroll: true });
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(event.key === 'Enter'); }
  });
  input.focus(); input.select();
}

function startRowRename(sourceRow: HTMLElement): void {
  if (plotWorkspace || app.querySelector('[data-row-rename]')) return;
  const id = sourceRow.dataset.selectItem ?? state.selectedId;
  const index = sourceRow.dataset.selectElement === undefined ? null : Number(sourceRow.dataset.selectElement);
  const item = state.items.find(item => item.id === id); if (!item) return;
  if (state.selectedId !== id || selectedElement !== index) selectObject(id!, index);
  const row = app.querySelector<HTMLElement>(index === null ? `[data-select-item="${id}"]` : `[data-select-element="${index}"]`);
  if (!row) return;
  const original = index === null ? item.name : elementName(elements(markupRoot(item.markup))[index]!);
  const container = document.createElement('div'); container.className = 'object-row active is-renaming';
  const input = document.createElement('input'); input.className = 'object-rename-input'; input.dataset.rowRename = '';
  input.value = original; input.setAttribute('aria-label', index === null ? 'Rename object' : 'Rename SVG element');
  container.append(input); row.replaceWith(container);
  let closed = false;
  const finish = (save: boolean) => {
    if (closed) return; closed = true;
    const name = input.value.trim() || original;
    if (save && name !== original) {
      commit(() => { if (index === null) item.name = name; else editElement(item, index, element => element.setAttribute(ELEMENT_NAME_ATTRIBUTE, name)); });
      app.querySelector<HTMLElement>(index === null ? `[data-select-item="${id}"]` : `[data-select-element="${index}"]`)?.focus();
    } else { container.replaceWith(row); row.focus(); }
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(event.key === 'Enter'); }
  });
  input.focus(); input.select();
}
function validNumber(input: HTMLInputElement | HTMLTextAreaElement, positive = false): number {
  const value = Number(input.value);
  if (!input.value.trim() || !Number.isFinite(value) || (positive && value <= 0)) throw new Error(positive ? "Enter a positive number." : "Enter a finite number.");
  return value;
}
function selectObject(id: string | null, index: number | null = null): void {
  gestures.finish();
  finishNudge();
  if (state.selectedId !== id || selectedElement !== index) duplication.clear();
  if (state.selectedId===id && selectedElement===index && state.tool==='select') return;
  const previousId=state.selectedId;
  const row = index === null ? null : app.querySelector<HTMLElement>(`[data-select-element="${index}"]`);
  const anchor = row && app.querySelector('.element-list-section')?.getAttribute('data-item-elements') === id ? row.getBoundingClientRect().top : null;
  const restoreFocus = row === document.activeElement;
  if (state.selectedId !== id || selectedElement !== index) { editNodes = false; selectedNode = null; }
  state.selectedId = id; selectedElement = selected()?.text ? null : index;
  state.tool = "select";
  app.querySelectorAll<HTMLElement>("[data-tool]").forEach((button) => button.classList.toggle("active", button.dataset.tool === state.tool));
  if(previousId)app.querySelector(`[data-item-id="${previousId}"]`)?.classList.remove('is-selected');
  if(id)app.querySelector(`[data-item-id="${id}"]`)?.classList.add('is-selected');
  refreshSelectionUI(); refreshInspector();
  if (row?.isConnected && anchor !== null) {
    app.querySelector<HTMLElement>('.inspector')!.scrollTop += row.getBoundingClientRect().top - anchor;
    if (restoreFocus) row.focus({preventScroll:true});
  }
}
function refreshInspector(): void {
  rememberInspectorSections();
  const panel = app.querySelector(".selection-panel"), objects = app.querySelector(".objects-panel");
  if (panel) {
    const list = panel.querySelector('.element-list-section');
    const preserveList = list?.getAttribute('data-item-elements') === state.selectedId;
    panel.innerHTML = selectionPanelMarkup();
    if (list && preserveList) {
      panel.querySelector('.element-list-section')?.replaceWith(list);
      list.querySelectorAll<HTMLElement>('[data-select-element]').forEach(row => {
        const active = Number(row.dataset.selectElement) === selectedElement;
        row.classList.toggle('active', active); row.setAttribute('aria-pressed', String(active));
      });
    }
    panel.querySelectorAll<HTMLElement>("[data-action]").forEach((button) => button.addEventListener("click", () => void action(button.dataset.action!)));
    bindEditorEvents(panel);
    bindTypographyEvents(panel);
  }
  if (objects) {
    const scroll = objects.querySelector(".object-list")?.scrollTop ?? 0;
    objects.innerHTML = objectsMarkup(); bindEditorEvents(objects); restoreObjectListScroll(scroll);
  }
}

async function action(name: string): Promise<void> {
  gestures.finish();
  finishNudge();
  if (name === 'cancel-fill-task') {
    const generating = fillStatus === 'Generating fill…';
    clearTimeout(estimateTimer); statsJob?.cancel(); statsJob = undefined; statsRevision++;
    if (generating) fillPreview.cancel();
    setFillTask();
    fillStatus = generating ? 'Fill generation cancelled. Change a fill setting to regenerate.' : 'Plot estimation cancelled.';
    fillError = false; updateFillMessage(); return;
  }
  if (plotWorkspace) {
    if (name === "edit-mode") { plotWorkspace.destroy(); return; }
    if (name === "zoom-in") state.zoom = Math.min(2, state.zoom + .1);
    else if (name === "zoom-out") state.zoom = Math.max(.5, state.zoom - .1);
    else if (name === "zoom-fit") state.zoom = 1;
    else if (name === "open-plot") app.querySelector<HTMLElement>('.plot-sidebar h2')?.focus();
    else return;
    app.querySelector<HTMLElement>('.paper-shadow')?.style.setProperty('--zoom', String(state.zoom));
    const zoom = app.querySelector('.zoom-control span'); if (zoom) zoom.textContent = `${Math.round(state.zoom * 100)}%`;
    return;
  }
  if (name === "canvas-size") openCanvasSize();
  if (name === "close-canvas") app.querySelector<HTMLDialogElement>("#canvas-dialog")?.close();
  if (name === "swap-canvas") {
    const width = app.querySelector<HTMLInputElement>("#canvas-width")!, height = app.querySelector<HTMLInputElement>("#canvas-height")!;
    [width.value, height.value] = [height.value, width.value]; syncCanvasPreset();
  }
  if (name === "import") app.querySelector<HTMLInputElement>("#file-input")?.click();
  if (name === "add-text") app.querySelector<HTMLDialogElement>("#text-dialog")?.showModal();
  if (name === "export") void downloadSvg();
  if (name === 'save-document') void saveDocument();
  if (name === 'load-document') { const input = app.querySelector<HTMLInputElement>('#document-input')!; input.value = ''; input.click(); }
  if (name === 'surface-calibration') {
    try {
      const item = calibrationSheet(state.paper, state.settings.margin, Number(app.querySelector<HTMLInputElement>('#calibration-spacing')!.value));
      app.querySelector<HTMLElement>('#more-elements')!.hidePopover();
      commit(() => { state.items.push(item); state.selectedId = item.id; selectedElement = null; state.tool = 'select'; });
      toast('Calibration sheet added. Plot it to check pen contact across the surface.');
    } catch (error) { const message = app.querySelector<HTMLElement>('#calibration-error')!; message.textContent = (error as Error).message; message.hidden = false; }
  }
  if (name === 'fill-calibration') addFillCalibration();
  if (name === "delete" && state.selectedId) commit(() => { state.items = state.items.filter((item) => item.id !== state.selectedId); state.selectedId = null; selectedElement = null; });
  if (name === "delete-element" && selectedElement !== null) commit(() => {
    const item = selected(); if (!item) return;
    editElement(item, selectedElement!, (element) => element.remove()); selectedElement = null; editNodes = false; selectedNode = null;
  });
  if (name === "select-object") selectObject(state.selectedId);
  if (name === "edit-nodes") { editNodes = !editNodes; selectedNode = null; refreshCanvas(); refreshInspector(); }
  if (name === "duplicate") duplicateSelection();
  if (name === "rotate") rotateSelection(90);
  if (name === "undo") undo();
  if (name === "redo") redo();
  if (name === "zoom-in") { state.zoom = Math.min(2, state.zoom + .1); render(); }
  if (name === "zoom-out") { state.zoom = Math.max(.5, state.zoom - .1); render(); }
  if (name === "zoom-fit") { pan = { x: 0, y: 0 }; state.zoom = 1; render(); const stage = app.querySelector("#stage")!; stage.scrollTop = 0; stage.scrollLeft = 0; }
  if (name === "install") await installPrompt?.prompt?.();
  if (name === "open-plot") {
    clearTimeout(estimateTimer); statsJob?.cancel(); statsJob = undefined; statsRevision++; setFillTask();
    plotWorkspace = new PlotWorkspace(app, plotter, state, persist, () => {
      plotWorkspace = null; render();
      app.querySelector<HTMLButtonElement>('[data-action="edit-mode"]')?.focus({ preventScroll: true });
    });
  }

}

function updateSetting(input: HTMLInputElement | HTMLSelectElement): void {
  const key = input.dataset.setting!;
  if (plotWorkspace || plotter.active) return;
  if (key === "paper" && input.value === "custom") { openCanvasSize(true); return; }
  if (key === 'profile' && input.value !== state.settings.profile && plotter.connected) plotter.invalidateOrigin();
  commit(() => {
    if (key === "paperColor") state.paperColor = restorePaperColor(input.value);
    else if (key === "paper") state.paper = PAPERS[Number(input.value)] ?? state.paper;
    else if (key === "returnToOrigin" && input instanceof HTMLInputElement) state.settings[key] = input.checked;
    else if (key === "profile") state.settings.profile = input.value as "axidraw" | "xylodraw";
    else if (key === 'axidrawModel') state.settings.axidrawModel = setupModel(input.value);
    else if (key === 'machineRotation') state.settings.machineRotation = Number(input.value) as AppState['settings']['machineRotation'];
    else if (key === "reorderMode") state.settings.reorderMode = input.value as AppState["settings"]["reorderMode"];
    else if (["margin", "speed", "travelSpeed", "maxPenDownMm", "drawAcceleration", "travelAcceleration", "cornering", "penUp", "penDown"].includes(key)) {
      const value = Number(input.value);
      if (Number.isFinite(value)) (state.settings as unknown as Record<string, number>)[key] = (key === "penUp" || key === "penDown") ? Math.max(0, Math.min(100, value)) : value;
    }
  });
}
function updateItem(input: HTMLInputElement, showError = true): void {
  const key = input.dataset.itemProp as keyof ArtworkItem;
  let numeric = 0;
  try { if (!["name", "stroke"].includes(key)) numeric = validNumber(input, key === "width" || key === "height"); }
  catch (error) { if (showError) toast((error as Error).message, true); return; }
  commitField(input, () => {
    const item = selected();
    if (!item) return;
    if (key === "name" || key === "stroke") (item as unknown as { [key: string]: string })[key] = input.value;
    else if (["x", "y", "width", "height", "rotation"].includes(key)) (item as unknown as { [key: string]: number })[key] = numeric;
  });
}

function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const point = new DOMPoint(clientX, clientY).matrixTransform((previewScreenMatrix ?? svg.getScreenCTM()!).inverse());
  if (![point.x, point.y].every(Number.isFinite)) throw new Error('The artwork transform is unavailable.');
  return { x: point.x, y: point.y };
}
function pointerDown(event: PointerEvent): void {
  if (plotWorkspace || gestures.active) return;
  if (event.button !== 0) return;
  finishNudge();
  app.querySelector<HTMLElement>("#stage")?.focus({ preventScroll: true });
  try { beginPointerGesture(event); }
  catch (error) {
    gestures.finish();
    toast(error instanceof Error ? error.message : 'Could not start the gesture.', true);
  }
}
function beginPointerGesture(event: PointerEvent): void {
  const svg = event.currentTarget as SVGSVGElement;
  const target = event.target as Element;
  const handle = target.closest<SVGElement>("[data-handle]");
  const artwork = target.closest<SVGElement>("[data-item-id]");
  const start = clientToSvg(svg, event.clientX, event.clientY);
  if (target.closest("[data-rotate]") && selected()) return beginRotation(svg, event, start);
  if (state.tool === "draw") return beginDrawing(svg, event, start);
  const node = target.getAttribute("data-path-node");
  if (node) { beginNodeDrag(svg, event, node); return; }
  if (handle && selected()) return beginResize(svg, event, start);
  const id = artwork?.dataset.itemId ?? target.getAttribute("data-hit-item-id");
  if (id) {
    const index = state.selectedId === id && selectedElement !== null && target.hasAttribute("data-element-index") ? Number(target.getAttribute("data-element-index")) : null;
    selectObject(id, index);
    beginDrag(svg, event, start);
  } else selectObject(null);
}
function selectionKey(): string { return `${state.selectedId}:${selectedElement ?? 'object'}`; }
function selectionPose(): SelectionPose | undefined {
  const item = selected(); if (!item) return;
  const bounds = elementBounds(), element = liveElement();
  return bounds && element ? { center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, rotation: Math.atan2(elementMatrix(element).b, elementMatrix(element).a) * 180 / Math.PI, wrapped: true }
    : { center: { x: item.x + item.width / 2, y: item.y + item.height / 2 }, rotation: item.rotation };
}
function updateRepeat(rotationOnly = false): void { const pose = selectionPose(); if (pose) duplication.update(selectionKey(), pose, rotationOnly); }
interface ArtworkGesture {
  source?: SVGGraphicsElement;
  move(sample: GestureSample, generated: ((operation: DOMMatrix) => void)[]): void;
  restore(): void;
  commit(): boolean;
  onSample?(sample: GestureSample): void;
}
/** Capture affine conversion and source attributes once; never serialize on a frame. */
function previewOperation(element: SVGGraphicsElement): (operation: DOMMatrix) => void {
  const parent = elementMatrix(element.parentNode as SVGGraphicsElement), inverse = parent.inverse();
  if (![inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f].every(Number.isFinite)) throw new Error('This element has a collapsed transform.');
  const attribute = element.getAttribute('transform'), local = element.transform.baseVal.consolidate()?.matrix;
  const original = new DOMMatrix(local ? [local.a, local.b, local.c, local.d, local.e, local.f] : undefined);
  return operation => {
    if (operation.isIdentity) { if (attribute === null) element.removeAttribute('transform'); else element.setAttribute('transform', attribute); }
    else element.setAttribute('transform', matrixData(inverse.multiply(operation).multiply(parent).multiply(original)));
  };
}
function attribute(element: Element, name: string, value: string): void { if (element.getAttribute(name) !== value) element.setAttribute(name, value); }
function previewOverlay(svg: SVGSVGElement) {
  const box = svg.querySelector<SVGGElement>('.selection-ui:not(.node-ui)')!, rect = box.querySelector('rect')!;
  const handles = [...box.querySelectorAll<SVGCircleElement>('[data-handle]')];
  const connector = box.querySelector('.rotation-connector'), rotation = [...box.querySelectorAll<SVGCircleElement>('.rotation-hit,.rotation-knob')];
  const nodeUi = svg.querySelector<SVGGElement>('.node-ui');
  const hit = svg.querySelector<SVGRectElement>(`[data-hit-item-id="${state.selectedId}"]`), hitAttributes = hit ? [...hit.attributes].map(attr => [attr.name, attr.value] as const) : [];
  const position = (x: number, y: number, width: number, height: number) => {
    attribute(rect, 'x', String(x)); attribute(rect, 'y', String(y)); attribute(rect, 'width', String(width)); attribute(rect, 'height', String(height));
    for (const handle of handles) { const corner = handle.dataset.handle!; attribute(handle, 'cx', String(x + (corner.includes('w') ? 0 : width))); attribute(handle, 'cy', String(y + (corner.includes('n') ? 0 : height))); }
    const cy = y - 26 / handleScale(); if (connector) attribute(connector, 'd', `M${x + width / 2} ${y}V${cy}`);
    for (const handle of rotation) { attribute(handle, 'cx', String(x + width / 2)); attribute(handle, 'cy', String(cy)); }
  };
  return {
    restoreHit() { if (hit) for (const [name, value] of hitAttributes) attribute(hit, name, value); },
    whole(item: ArtworkItem) { attribute(hit!, 'transform', itemTransform(item)); attribute(box, 'transform', `translate(${item.x} ${item.y}) rotate(${item.rotation} ${item.width / 2} ${item.height / 2})`); position(0, 0, item.width, item.height); },
    element(element: SVGGraphicsElement, operation?: DOMMatrix) {
      box.removeAttribute('transform'); const bounds = graphicsBounds(element); position(bounds.x, bounds.y, bounds.width, bounds.height);
      if (hit) { attribute(hit, 'transform', ''); for (const name of ['x', 'y', 'width', 'height'] as const) attribute(hit, name, String(bounds[name])); }
      if (nodeUi && operation) attribute(nodeUi, 'transform', matrixData(operation));
    },
    nodes(commands: ReturnType<typeof parsePath>, element: SVGGraphicsElement) {
      if (!nodeUi) return;
      const matrix = elementMatrix(element), world = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(matrix);
      for (const handle of nodeUi.querySelectorAll<SVGGraphicsElement>('[data-path-node]')) {
        const [command, pair] = handle.dataset.pathNode!.split(':').map(Number), cmd = commands[command!]!;
        const p = world(cmd.values[pair!]!, cmd.values[pair! + 1]!);
        if (handle.localName === 'circle') { attribute(handle, 'cx', String(p.x)); attribute(handle, 'cy', String(p.y)); }
        else { attribute(handle, 'x', String(p.x - 1.2)); attribute(handle, 'y', String(p.y - 1.2)); }
      }
      const lines = [...nodeUi.querySelectorAll<SVGPathElement>('.node-tangent')]; let index = 0, previous = { x: 0, y: 0 }, subpath = previous;
      for (const command of commands) {
        if (command.type === 'C' || command.type === 'Q') {
          const from = world(previous.x, previous.y), control = world(command.values[0]!, command.values[1]!), end = world(command.values.at(-2)!, command.values.at(-1)!);
          const last = command.type === 'C' ? world(command.values[2]!, command.values[3]!) : control;
          attribute(lines[index++]!, 'd', `M${from.x} ${from.y}L${control.x} ${control.y} M${end.x} ${end.y}L${last.x} ${last.y}`);
        }
        previous = command.type === 'Z' ? subpath : { x: command.values.at(-2)!, y: command.values.at(-1)! }; if (command.type === 'M') subpath = previous;
      }
      this.element(element);
    }
  };
}
function updateHit(item: ArtworkItem): void {
  const layer = app.querySelector('.editor-hit-layer')!;
  let hit = [...layer.querySelectorAll<SVGRectElement>('[data-hit-item-id]')].find(hit => hit.dataset.hitItemId === item.id);
  if (!hit) { hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); hit.dataset.hitItemId = item.id; layer.append(hit); }
  attribute(hit, 'transform', itemTransform(item)); attribute(hit, 'x', String(item.viewBox[0])); attribute(hit, 'y', String(item.viewBox[1])); attribute(hit, 'width', String(item.viewBox[2])); attribute(hit, 'height', String(item.viewBox[3]));
}
function gesture(svg: SVGSVGElement, event: PointerEvent, preview: ArtworkGesture, kind = 'edit', completed?: () => void): void {
  const item = selected(); if (!item) return;
  fieldEditInput = null;
  const before = rememberSnapshot(), originalElement = selectedElement, originalNodes = editNodes, originalNode = selectedNode;
  let last: GestureSample | undefined, interaction: ReturnType<FillPreview['beginInteraction']> | undefined;
  let generated: ((operation: DOMMatrix) => void)[] = [];
  gestures.start(svg, event, {
    // Unexpected interruption saves the last valid preview; only Escape cancels
    // artwork. Keep viewport cancellation separate in beginPan().
    cancelOnInterrupt: false, animationFrame: true, onSample: preview.onSample,
    snapshot: () => last,
    restore: sample => { if (sample) { preview.move(sample, generated); last = sample; } else { preview.restore(); last = undefined; } },
    onStart: () => {
      gestureActive = true; interaction = fillPreview.beginInteraction(svg, item, preview.source, kind === 'resize' || kind === 'edit');
      generated = preview.source ? interaction.generated.map(previewOperation) : [];
      statsJob?.cancel(); statsRevision++; clearTimeout(estimateTimer); setFillTask();
    },
    onMove: sample => { previewScreenMatrix = svg.getScreenCTM()!; try { preview.move(sample, generated); last = { ...sample }; } finally { previewScreenMatrix = undefined; } },
    onFinish: (reason, redraw) => {
      const moving = gestureActive; gestureActive = false;
      let changed = false;
      // On a preview error the controller has restored the last good sample.
      if (reason !== 'escape' && reason !== 'cancel') {
        try { changed = !!last && preview.commit(); }
        catch (error) {
          preview.restore(); Object.assign(item, structuredClone(before.items.find(source => source.id === item.id)!));
          state.items = state.items.filter(source => before.items.some(original => original.id === source.id)); state.selectedId = before.selectedId;
          selectedElement = originalElement; editNodes = originalNodes; selectedNode = originalNode;
          interaction?.finish(false); refreshSelectionUI(); refreshFills(svg); refreshInspector(); throw error;
        }
      }
      else { state.selectedId = before.selectedId; selectedElement = originalElement; editNodes = originalNodes; selectedNode = originalNode; }
      interaction?.finish(changed);
      if (changed) {
        history.push(before); if (history.length > 60) history.shift(); future = []; persist();
        if (kind === 'resize' || kind === 'edit') duplication.clear(); else { completed?.(); updateRepeat(kind === 'rotate'); }
        const active = selected()!; updateHit(item); updateHit(active);
        const group = app.querySelector<SVGGElement>(`[data-item-id="${active.id}"]`)!;
        elements(group).forEach((element, index) => attribute(element, 'data-element-index', String(index)));
      }
      if (redraw && (moving || changed)) {
        refreshSelectionUI(); refreshFills(svg); refreshInspector();
        app.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled = !history.length;
        app.querySelector<HTMLButtonElement>('[data-action="redo"]')!.disabled = !future.length;
        const count = app.querySelector('.statusbar')?.lastElementChild; if (count) count.innerHTML = `<a href="/plot-it-source.tar.gz" download>Source · AGPL-3.0</a> · ${state.items.length} object${state.items.length === 1 ? '' : 's'}`;
      }
      if (restoredOutlineUpgradePending) queueMicrotask(upgradeRestoredOutlines);
    },
    onError: error => toast(error instanceof Error ? error.message : 'Could not finish the gesture.', true)
  });
}
/** Capture page conversion once; every sample applies it to the original source. */
function sourceElementOperation(element: SVGGraphicsElement): (item: ArtworkItem, index: number, operation: DOMMatrix) => void {
  const parent = elementMatrix(element.parentNode as SVGGraphicsElement), inverse = parent.inverse();
  if (![inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f].every(Number.isFinite)) throw new Error('This element has a collapsed transform.');
  const local = element.transform.baseVal.consolidate()?.matrix;
  const original = new DOMMatrix(local ? [local.a, local.b, local.c, local.d, local.e, local.f] : undefined);
  return (item, index, operation) => { if (!operation.isIdentity) editElement(item, index, source => source.setAttribute('transform', matrixData(inverse.multiply(operation).multiply(parent).multiply(original)))); };
}
function beginDrag(svg: SVGSVGElement, event: PointerEvent, start: Point): void {
  const item = selected(); if (!item) return;
  const origin = structuredClone(item), index = selectedElement, element = liveElement();
  const group = app.querySelector<SVGGElement>(`[data-item-id="${item.id}"]`)!;
  const sourceTransform = element ? previewOperation(element) : null, overlay = previewOverlay(svg), sourcePose = selectionPose()!;
  const copyId = `item-${crypto.randomUUID()}`, originalTransform = group.getAttribute('transform')!;
  let copy: ArtworkItem | undefined, copyGroup: SVGGElement | undefined, copyElement: SVGGraphicsElement | undefined;
  let copyTransform: ((operation: DOMMatrix) => void) | undefined, copyGenerated: SVGGElement[] = [], copyGeneratedTransforms: ((operation: DOMMatrix) => void)[] = [];
  let copying = false, delta = { x: 0, y: 0 };
  const restoreSource = (generated: ((operation: DOMMatrix) => void)[]) => {
    if (sourceTransform) sourceTransform(new DOMMatrix()); else attribute(group, 'transform', originalTransform);
    generated.forEach(transform => transform(new DOMMatrix()));
  };
  const removeCopy = () => { copyGroup?.remove(); copyElement?.remove(); copyGenerated.forEach(node => node.remove()); };
  const createCopy = () => {
    if (index === null) {
      if (!copyGroup) { copy = { ...structuredClone(origin), id: copyId, name: origin.name + ' copy', markup: clonedMarkup(origin.markup, copyId) }; copyGroup = group.cloneNode(true) as SVGGElement; adoptFillPreviewClone(group, copyGroup); copyGroup.dataset.itemId = copyId; remapSvgIds(copyGroup, copyId); }
      if (!copyGroup.isConnected) group.parentNode!.appendChild(copyGroup);
    } else {
      if (!copyElement) { copyElement = element!.cloneNode(true) as SVGGraphicsElement; adoptFillPreviewClone(element!, copyElement); remapSvgIds(copyElement, copyId); copyElement.setAttribute('data-plot-it-id', copyId); }
      if (!copyElement.isConnected) element!.after(copyElement);
      if (!copyTransform) copyTransform = previewOperation(copyElement);
      if (!copyGenerated.length) {
        const key = element!.getAttribute('data-fill-path-key');
        copyGenerated = [...group.querySelectorAll<SVGGElement>('[data-generated-fill]')].filter(node => node.dataset.fillPathKey === key).map(node => node.cloneNode(true) as SVGGElement);
        copyGenerated.forEach(node => { node.dataset.fillPathKey = `preview-${copyId}`; });
      }
      let anchor: Element = copyElement; for (const node of copyGenerated) { anchor.after(node); anchor = node; }
      if (!copyGeneratedTransforms.length) copyGeneratedTransforms = copyGenerated.map(previewOperation);
    }
  };
  gesture(svg, event, {
    source: element,
    move: (move, generated) => {
      const point = clientToSvg(svg, move.clientX, move.clientY); delta = constrainedDelta({ x: point.x - start.x, y: point.y - start.y }, move.shiftKey);
      const operation = new DOMMatrix().translate(delta.x, delta.y);
      if (move.altKey !== copying) { restoreSource(generated); copying = move.altKey; if (copying) createCopy(); else removeCopy(); }
      if (copying) {
        if (copyGroup) { copy!.x = origin.x + delta.x; copy!.y = origin.y + delta.y; attribute(copyGroup, 'transform', itemTransform(copy!)); overlay.whole(copy!); }
        else { copyTransform!(operation); copyGeneratedTransforms.forEach(transform => transform(operation)); overlay.element(copyElement!, operation); }
      } else if (sourceTransform) { sourceTransform(operation); generated.forEach(transform => transform(operation)); overlay.element(element!, operation); }
      else { const view = { ...origin, x: origin.x + delta.x, y: origin.y + delta.y }; attribute(group, 'transform', itemTransform(view)); overlay.whole(view); }
      if (group.classList.contains('is-selected') === copying) group.classList.toggle('is-selected', !copying);
      if (copyGroup && copyGroup.classList.contains('is-selected') !== copying) copyGroup.classList.toggle('is-selected', copying);
    },
    restore: () => { overlay.restoreHit(); removeCopy(); if (sourceTransform) sourceTransform(new DOMMatrix()); else attribute(group, 'transform', originalTransform); group.classList.add('is-selected'); },
    commit: () => {
      if (!copying && delta.x === 0 && delta.y === 0) return false;
      if (index === null) {
        if (copying) { state.items.push(copy!); state.selectedId = copyId; }
        else { item.x = origin.x + delta.x; item.y = origin.y + delta.y; }
      } else {
        const live = copying ? copyElement! : element!, transform = live.getAttribute('transform');
        const applyTransform = (source: SVGGraphicsElement) => { if (transform === null) source.removeAttribute('transform'); else source.setAttribute('transform', transform); };
        if (copying) {
          const clone = cloneSvgElement(origin.markup, index, copyId, applyTransform);
          item.markup = clone.markup; selectedElement = clone.index; app.querySelector('.element-list-section')?.remove();
        } else editElement(item, index, applyTransform);
      }
      if (copying) { editNodes = false; selectedNode = null; } return true;
    }
  }, 'move', () => { if (copying) duplication.start(selectionKey(), sourcePose, selectionPose()!); });
}
function duplicateSelection(): void {
  const item = selected(), pose = selectionPose(); if (!item || !pose) return;
  const step = duplication.next(selectionKey()), element = liveElement(), index = selectedElement;
  const transform = element ? sourceElementOperation(element) : null;
  commit(() => {
    const id = `item-${crypto.randomUUID()}`;
    if (index === null) {
      const copy = structuredClone(item); copy.id = id; copy.name += ' copy'; copy.markup = clonedMarkup(copy.markup, id);
      copy.x += step.x; copy.y += step.y; copy.rotation += step.rotation;
      state.items.push(copy); state.selectedId = id;
    } else {
      const clone = cloneSvgElement(item.markup, index, id); item.markup = clone.markup; selectedElement = clone.index;
      const center = pose.center;
      transform!(item, clone.index, new DOMMatrix().translate(step.x, step.y).translate(center.x, center.y).rotate(step.rotation).translate(-center.x, -center.y));
    }
    editNodes = false; selectedNode = null;
  }, true);
  duplication.start(selectionKey(), pose, selectionPose()!, step);
}
function rotateSelection(degrees: number): void {
  const pose = selectionPose(), item = selected(), element = liveElement(); if (!pose || !item) return;
  const transform = element ? elementTransformer(element) : null;
  commit(() => {
    if (transform) transform(new DOMMatrix().translate(pose.center.x, pose.center.y).rotate(degrees).translate(-pose.center.x, -pose.center.y));
    else item.rotation += degrees;
  }, true);
  updateRepeat(true);
}
function beginRotation(svg: SVGSVGElement, event: PointerEvent, start: Point): void {
  const item = selected(), pose = selectionPose(); if (!item || !pose) return;
  const element = liveElement(), transform = element ? previewOperation(element) : null, index = selectedElement;
  const origin = { ...item }, group = app.querySelector<SVGGElement>(`[data-item-id="${item.id}"]`)!, original = group.getAttribute('transform')!, overlay = previewOverlay(svg);
  const screen = new DOMPoint(pose.center.x, pose.center.y).matrixTransform(svg.getScreenCTM()!);
  const stage = app.querySelector('#stage')!, scroll = { x: stage.scrollLeft, y: stage.scrollTop };
  let previous = Math.atan2(start.y - pose.center.y, start.x - pose.center.x) * 180 / Math.PI, angle = 0, rotation = pose.rotation;
  gesture(svg, event, {
    source: element,
    onSample: sample => {
      const dx = sample.clientX - (screen.x - (stage.scrollLeft - scroll.x)), dy = sample.clientY - (screen.y - (stage.scrollTop - scroll.y));
      if (Math.hypot(dx, dy) < .0001) return; const next = Math.atan2(dy, dx) * 180 / Math.PI; angle += angleStep(previous, next); previous = next;
    },
    move: (sample, generated) => {
      rotation = snappedAngle(pose.rotation + angle, sample.shiftKey); const delta = rotation - pose.rotation;
      const operation = new DOMMatrix().translate(pose.center.x, pose.center.y).rotate(delta).translate(-pose.center.x, -pose.center.y);
      if (transform) { transform(operation); generated.forEach(apply => apply(operation)); overlay.element(element!, operation); }
      else { const view = { ...origin, rotation: origin.rotation + delta }; attribute(group, 'transform', itemTransform(view)); overlay.whole(view); }
    },
    restore: () => { overlay.restoreHit(); if (transform) transform(new DOMMatrix()); else attribute(group, 'transform', original); },
    commit: () => {
      if (rotation === pose.rotation) return false;
      if (element) editElement(item, index!, source => source.setAttribute('transform', element.getAttribute('transform')!)); else item.rotation = origin.rotation + rotation - pose.rotation;
      return true;
    }
  }, 'rotate');
}
function beginResize(svg: SVGSVGElement, event: PointerEvent, start: Point): void {
  const item = selected(); if (!item) return;
  const origin = { ...item }, corner = (event.target as Element).getAttribute('data-handle')!, element = liveElement(), bounds = elementBounds(), index = selectedElement;
  const transform = element ? previewOperation(element) : null, group = app.querySelector<SVGGElement>(`[data-item-id="${item.id}"]`)!, original = group.getAttribute('transform')!, overlay = previewOverlay(svg);
  let view = origin, operation = new DOMMatrix();
  gesture(svg, event, {
    source: element,
    move: sample => {
      const point = clientToSvg(svg, sample.clientX, sample.clientY), delta = { x: point.x - start.x, y: point.y - start.y };
      if (transform && bounds) {
        const west = corner.includes('w'), north = corner.includes('n'), { width, height } = resizedDimensions(bounds, corner, delta, sample.shiftKey, sample.altKey);
        const anchor = { x: bounds.x + (sample.altKey ? bounds.width / 2 : west ? bounds.width : 0), y: bounds.y + (sample.altKey ? bounds.height / 2 : north ? bounds.height : 0) };
        operation = new DOMMatrix().translate(anchor.x, anchor.y).scale(width / Math.max(bounds.width, .0001), height / Math.max(bounds.height, .0001)).translate(-anchor.x, -anchor.y);
        transform(operation); overlay.element(element!);
      } else { view = { ...origin, ...resizedItem(origin, corner, delta, sample.shiftKey, sample.altKey) }; attribute(group, 'transform', itemTransform(view)); overlay.whole(view); }
    },
    restore: () => { overlay.restoreHit(); if (transform) transform(new DOMMatrix()); else attribute(group, 'transform', original); },
    commit: () => {
      if (element) { if (operation.isIdentity) return false; editElement(item, index!, source => source.setAttribute('transform', element.getAttribute('transform')!)); }
      else { if (view.x === origin.x && view.y === origin.y && view.width === origin.width && view.height === origin.height) return false; Object.assign(item, { x: view.x, y: view.y, width: view.width, height: view.height }); }
      return true;
    }
  }, 'resize');
}
function beginDrawing(svg: SVGSVGElement, event: PointerEvent, start: Point): void {
  const points = [start]; svg.setPointerCapture(event.pointerId);
  svg.onpointermove = (move) => { const point = clientToSvg(svg, move.clientX, move.clientY); if (Math.hypot(point.x - points.at(-1)!.x, point.y - points.at(-1)!.y) > .4) points.push(point); app.querySelector<SVGPathElement>("#draft-path")?.setAttribute("d", points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ")); };
  svg.onpointerup = () => { svg.onpointermove = null; svg.onpointerup = null; svg.onpointercancel = null; if (points.length > 1) commit(() => { const item = freehandItem(points); state.items.push(item); state.selectedId = item.id; selectedElement = null; state.tool = "select"; }); else render(); };
  svg.onpointercancel = () => { svg.onpointermove = null; svg.onpointerup = null; svg.onpointercancel = null; render(); };
}
function updateCanvasOnly(): void {
  const item = selected(); if (!item) return;
  app.querySelector<SVGGElement>(`[data-item-id="${item.id}"]`)?.setAttribute("transform", itemTransform(item));
}

function liveElement(): SVGGraphicsElement | undefined {
  if (selectedElement === null) return undefined;
  const group = app.querySelector<SVGGElement>(`[data-item-id="${state.selectedId}"]`);
  return group ? elements(group)[selectedElement] : undefined;
}
function elementMatrix(element: SVGGraphicsElement): DOMMatrix {
  const svg = app.querySelector<SVGSVGElement>("#paper")!;
  // Some engines expose legacy SVGMatrix instances; normalize before composing
  // them with DOMMatrix page-space translations/scales.
  const root = previewScreenMatrix ?? svg.getScreenCTM()!, local = element.getScreenCTM()!;
  const matrix = (m: DOMMatrix) => new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]);
  return matrix(root).inverse().multiply(matrix(local));
}
function elementBounds(): { x: number; y: number; width: number; height: number } | null {
  const element = liveElement(); if (!element) return null;
  return graphicsBounds(element);
}
function graphicsBounds(element: SVGGraphicsElement): {x:number;y:number;width:number;height:number} {
  const box = element.getBBox(), matrix = elementMatrix(element);
  const points = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
  const x = Math.min(...points.map((p) => p.x)), y = Math.min(...points.map((p) => p.y));
  return { x, y, width: Math.max(...points.map((p) => p.x)) - x, height: Math.max(...points.map((p) => p.y)) - y };
}
function matrixData(matrix: DOMMatrix): string { return `matrix(${[matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].join(" ")})`; }
/** Apply a page-space operation while preserving all imported ancestor transforms. */
function elementTransformer(element: SVGGraphicsElement): (operation: DOMMatrix) => void {
  const item = selected()!, index = selectedElement!;
  const originalMarkup = item.markup, originalTransform = element.getAttribute('transform');
  const parent = elementMatrix(element.parentNode as SVGGraphicsElement);
  const inverse = parent.inverse();
  if (![inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f].every(Number.isFinite)) throw new Error("This element has a collapsed transform. Edit its SVG geometry instead.");
  const local = element.transform.baseVal.consolidate()?.matrix;
  const original = new DOMMatrix(local ? [local.a, local.b, local.c, local.d, local.e, local.f] : undefined);
  return (operation) => {
    if (operation.isIdentity) {
      if (originalTransform === null) element.removeAttribute('transform');
      else element.setAttribute('transform', originalTransform);
      item.markup = originalMarkup;
      return;
    }
    const transform = matrixData(inverse.multiply(operation).multiply(parent).multiply(original));
    element.setAttribute("transform", transform);
    editElement(item, index, (source) => source.setAttribute("transform", transform));
  };
}
function updateElementBounds(input: HTMLInputElement | HTMLTextAreaElement): void {
  const element = liveElement(), bounds = elementBounds(); if (!element || !bounds) return;
  const key = input.dataset.elementBounds!, value = validNumber(input, key === "width" || key === "height");
  const transform = elementTransformer(element);
  if ((key === "width" && bounds.width <= 0) || (key === "height" && bounds.height <= 0)) throw new Error("A zero-length axis cannot be resized. Edit its geometry instead.");
  commitField(input, () => transform(key === "x" || key === "y"
    ? new DOMMatrix().translate(key === "x" ? value - bounds.x : 0, key === "y" ? value - bounds.y : 0)
    : new DOMMatrix().translate(bounds.x, bounds.y).scale(key === "width" ? value / bounds.width : 1, key === "height" ? value / bounds.height : 1).translate(-bounds.x, -bounds.y)));
}
function refreshCanvas(): void {
  if (plotWorkspace) return;
  const svg = app.querySelector<SVGSVGElement>("#paper"), layer = app.querySelector<SVGGElement>("#artwork-layer"); if (!svg || !layer) return;
  svg.querySelectorAll(".selection-ui,.editor-hit-layer").forEach((node) => node.remove());
  layer.querySelectorAll<SVGGElement>("[data-item-id]").forEach((group) => {
    group.classList.toggle("is-selected", group.dataset.itemId === state.selectedId);
    elements(group).forEach((element, index) => element.setAttribute("data-element-index", String(index)));
  });
  layer.insertAdjacentHTML("beforebegin", `<g class="editor-hit-layer">${state.items.map((item) => `<rect data-hit-item-id="${item.id}" transform="${itemTransform(item)}" x="${item.viewBox[0]}" y="${item.viewBox[1]}" width="${item.viewBox[2]}" height="${item.viewBox[3]}"/>`).join("")}</g>`);
  refreshFills(svg);
  refreshSelectionUI();
}
function refreshFills(svg: SVGSVGElement): void {
  const nextFillKey=fillDocumentKey(state.items);
  if (nextFillKey!==canvasFillKey) {
    canvasFillKey=nextFillKey; statsJob?.cancel(); statsJob=undefined; statsRevision++;
    clearTimeout(estimateTimer); setFillTask(); fillStats='';
  }
  if (!gestureActive) fillPreview.update(svg,state.items,(status,error=false)=>{
    fillStatus=status;fillError=error;updateFillMessage();
    if(!plotWorkspace&&status!=='Generating fill…'&&!error&&state.items.some(item=>{const group=[...svg.querySelectorAll<SVGGElement>('#artwork-layer > [data-item-id]')].find(group=>group.dataset.itemId===item.id);return group&&hasActiveFill(item,group);})) {
      const key=JSON.stringify([fillDocumentKey(state.items),state.paper,state.settings,state.pens]);
      if(key!==estimatedKey||!fillStats) {
        clearTimeout(estimateTimer);
        estimateTimer=setTimeout(()=>{if(svg===app.querySelector('#paper')) void updateFillStatistics(svg,key);},200);
      }
    }
  },setFillTask);
}
function refreshSelectionUI(): void {
  const svg=app.querySelector<SVGSVGElement>('#paper');if(!svg)return;
  svg.querySelectorAll('.selection-ui').forEach(node=>node.remove());
  const item = selected(); if (!item) return;
  const bounds = elementBounds();
  const box = bounds ? `<g class="selection-ui"><rect class="selection-box" x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"/>${editNodes ? "" : [["nw", 0, 0], ["ne", 1, 0], ["se", 1, 1], ["sw", 0, 1]].map(([corner, x, y]) => `<circle class="handle ${corner}" data-handle="${corner}" cx="${bounds.x + Number(x) * bounds.width}" cy="${bounds.y + Number(y) * bounds.height}" r="${6 / handleScale()}"/>`).join("") + rotationHandle(bounds.x + bounds.width / 2, bounds.y)}</g>` : selectionMarkup(item);
  svg.insertAdjacentHTML("beforeend", box);
  const element = liveElement();
  if (editNodes && element?.localName === "path") {
    try {
      const commands = parsePath(element.getAttribute("d") ?? ""), matrix = elementMatrix(element);
      const world = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(matrix);
      let previous = { x: 0, y: 0 }, subpath = previous;
      const lines: string[] = [];
      for (const command of commands) {
        if (command.type === "C" || command.type === "Q") {
          const from = world(previous.x, previous.y), control = world(command.values[0]!, command.values[1]!);
          const end = world(command.values.at(-2)!, command.values.at(-1)!);
          const lastControl = command.type === "C" ? world(command.values[2]!, command.values[3]!) : control;
          lines.push(`<path class="node-tangent" d="M${from.x} ${from.y}L${control.x} ${control.y} M${end.x} ${end.y}L${lastControl.x} ${lastControl.y}"/>`);
        }
        if (command.type === "Z") previous = subpath;
        else previous = { x: command.values.at(-2)!, y: command.values.at(-1)! };
        if (command.type === "M") subpath = previous;
      }
      const nodes = pathNodes(commands).map((node) => {
        const point = world(node.point.x, node.point.y), key = `${node.command}:${node.pair}`;
        const active = selectedNode?.command === node.command && selectedNode.pair === node.pair;
        return node.control ? `<circle class="path-node control ${active ? "active" : ""}" data-path-node="${key}" cx="${point.x}" cy="${point.y}" r="1.3"/>` : `<rect class="path-node ${active ? "active" : ""}" data-path-node="${key}" x="${point.x - 1.2}" y="${point.y - 1.2}" width="2.4" height="2.4"/>`;
      });
      svg.insertAdjacentHTML("beforeend", `<g class="selection-ui node-ui">${lines.join("")}${nodes.join("")}</g>`);
    } catch { /* Invalid legacy paths can still be repaired in the path-data field. */ }
  }
}
function beginNodeDrag(svg: SVGSVGElement, event: PointerEvent, key: string): void {
  const element = liveElement(), item = selected(); if (!element || !item) return;
  const [command, pair] = key.split(":").map(Number);
  selectedNode = { command: command!, pair: pair! }; refreshInspector(); refreshSelectionUI();
  const inverse = elementMatrix(element).inverse(), index = selectedElement!;
  const originalD = element.getAttribute('d') ?? '';
  const original = parsePath(originalD), normalizedOriginal = pathData(original);
  const pageStart = clientToSvg(svg, event.clientX, event.clientY);
  const start = new DOMPoint(pageStart.x, pageStart.y).matrixTransform(inverse);
  const anchor = { x: original[command!]!.values[pair!]!, y: original[command!]!.values[pair! + 1]! };
  const overlay = previewOverlay(svg); let edited = originalD, commands = original;
  gesture(svg, event, {
    source: element,
    move: move => {
      const page = clientToSvg(svg, move.clientX, move.clientY), point = new DOMPoint(page.x, page.y).matrixTransform(inverse);
      if (![point.x, point.y, start.x, start.y].every(Number.isFinite)) throw new Error('The node transform is unavailable.');
      commands = structuredClone(original); movePathNode(commands, command!, pair!, { x: anchor.x + point.x - start.x, y: anchor.y + point.y - start.y });
      const d = pathData(commands); edited = d === normalizedOriginal ? originalD : d; attribute(element, 'd', edited); overlay.nodes(commands, element);
    },
    restore: () => { overlay.restoreHit(); attribute(element, 'd', originalD); },
    commit: () => { if (edited === originalD) return false; editElement(item, index, source => source.setAttribute('d', edited)); return true; }
  });
}
function updateNode(input: HTMLInputElement | HTMLTextAreaElement): void {
  const item = selected(), element = liveElement(); if (!item || !element || !selectedNode) return;
  const commands = parsePath(element.getAttribute("d") ?? "");
  const command = commands[selectedNode.command]!;
  const matrix = elementMatrix(element);
  const point = new DOMPoint(command.values[selectedNode.pair], command.values[selectedNode.pair + 1]).matrixTransform(matrix);
  point[input.dataset.nodeAxis as "x" | "y"] = validNumber(input);
  movePathNode(commands, selectedNode.command, selectedNode.pair, point.matrixTransform(matrix.inverse()));
  commitField(input, () => editElement(item, selectedElement!, (source) => source.setAttribute("d", pathData(commands))));
}

async function importFile(event: Event): Promise<void> { const file = (event.target as HTMLInputElement).files?.[0]; if (file) await addSvgFile(file); }
async function importDropped(event: DragEvent): Promise<void> { const file = event.dataTransfer?.files[0]; if (file && isPlotItDocumentFile(file.name)) await loadDocument(file); else if (file?.name.toLowerCase().endsWith(".svg")) await addSvgFile(file); else toast("Drop an SVG, .plit, or .plit.json document."); }
async function saveDocument(): Promise<void> {
  gestures.finish();
  const snapshot = cloneState();
  try {
    const fonts = await exportDocumentFonts(documentFontIds(snapshot));
    const blob = new Blob([serializePlotIt(snapshot, fonts)], {type: 'application/json'});
    if (blob.size > MAX_DOCUMENT_BYTES) throw new Error('This document exceeds 100 MB. Split the artwork into smaller documents before saving.');
    downloadBlob(blob, `${documentFilename(snapshot.documentName)}${DOCUMENT_EXTENSION}`);
  } catch (error) { toast((error as Error).message || 'Could not save this document.', true); }
}
async function loadDocument(file: File): Promise<void> {
  const revision = ++loadRevision, before = JSON.stringify(state);
  try {
    if (file.size > MAX_DOCUMENT_BYTES) throw new Error('Choose a Plot-it document smaller than 100 MB.');
    const loaded = parsePlotIt(await file.text());
    await importDocumentFonts(loaded.fonts);
    const downloads = await Promise.allSettled(documentFontIds(loaded.state).map(ensureFontLoaded));
    const notices = downloads.flatMap(result => result.status === 'rejected' ? [String(result.reason instanceof Error ? result.reason.message : result.reason)] : []);
    loaded.state.items = loaded.state.items.map(item => {
      const migrated = migrateOutlineText(item);
      if (migrated.notice) notices.push(migrated.notice);
      return migrated.replacement ?? item;
    });
    if (revision !== loadRevision) return;
    if (plotWorkspace || gestures.active || before !== JSON.stringify(state)) throw new Error('The document changed while loading. Load the file again.');
    if (plotter.connected && state.settings.profile !== loaded.state.settings.profile) plotter.invalidateOrigin();
    commit(() => { state = loaded.state; selectedElement = null; selectedNode = null; editNodes = false; canvasFillKey = ''; estimatedKey = ''; });
    toast([`${file.name} loaded. Undo restores the previous document.`, ...notices].join(' '));
  } catch (error) { if (revision === loadRevision) toast((error as Error).message || 'Could not load this document.', true); }
}
function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function addSvgFile(file: File): Promise<void> {
  try { const item = parseSvg(await file.text(), file.name.replace(/\.svg$/i, "")); commit(() => { state.items.push(item); state.selectedId = item.id; selectedElement = null; state.tool = "select"; }); toast(`${file.name} imported`); }
  catch (error) { toast(error instanceof Error ? error.message : "Could not import this SVG.", true); }
}
async function addText(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if ((event.submitter as HTMLButtonElement | null)?.value === "cancel") { app.querySelector<HTMLDialogElement>("#text-dialog")?.close(); return; }
  const text = app.querySelector<HTMLTextAreaElement>("#text-value")?.value ?? "";
  const size = Number(app.querySelector<HTMLInputElement>("#text-size")?.value ?? 12);
  if (!text.trim()) return;
  if (!Number.isFinite(size) || size <= 0) return;
  try {
    const form = app.querySelector<HTMLFormElement>("#text-form")!;
    const options = readTypography(form);
    await ensureFontLoaded(options.fontId);
    if (!form.isConnected || !form.closest('dialog')?.hasAttribute('open') || readTypography(form).fontId !== options.fontId) return;
    const item = typographyToItem(text, size, options);
    app.querySelector<HTMLDialogElement>("#text-dialog")?.close();
    commit(() => { state.items.push(item); state.selectedId = item.id; selectedElement = null; state.tool = "select"; });
  } catch (error) { showTextError(error instanceof Error ? error.message : "Could not create text."); }
}
async function downloadSvg(): Promise<void> {
  const svg = app.querySelector<SVGSVGElement>('#paper'); if (!svg) return;
  try { await awaitFills(svg); } catch (error) { toast((error as Error).message, true); return; }
  if (svg !== app.querySelector('#paper')) { toast('Artwork changed during export; export again.', true); return; }
  const blob = new Blob([exportFilledSvg(svg, state.paper.width, state.paper.height)], { type: "image/svg+xml" });
  downloadBlob(blob, `${documentFilename(state.documentName)}.svg`);
}
function undo(): void { gestures.finish(); finishNudge(); duplication.clear(); const previous = history.pop(); if (!previous) return; future.push(rememberSnapshot()); state = previous; restoreSelection(previous); persist(); render(); }
function redo(): void { gestures.finish(); finishNudge(); duplication.clear(); const next = future.pop(); if (!next) return; history.push(rememberSnapshot()); state = next; restoreSelection(next); persist(); render(); }

plotter.onConnectionChange = () => {
  if (plotWorkspace) plotWorkspace.connectionChanged(); else render();
};

function toast(message: string, error = false): void {
  const node = app.querySelector<HTMLElement>('#toast'); if (!node) return;
  node.textContent = message; node.classList.toggle('error', error); node.classList.add('show');
  setTimeout(() => node.classList.remove('show'), 5000);
}

window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installPrompt = event as typeof installPrompt; render(); });
function editingContext(event: KeyboardEvent): boolean {
  const target = event.target;
  return !event.isComposing && !plotWorkspace && document.hasFocus() && target instanceof Element &&
    !target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),dialog,[role="menu"],[role="dialog"]') &&
    !app.querySelector('dialog[open],:popover-open') && (target === document.body || app.contains(target));
}
function finishNudge(): void {
  if (!nudgeGesture) return;
  nudgeGesture = undefined; gestureActive = false; refreshCanvas();
}
function nudge(key: string, delta: Point, shift: boolean): void {
  const item = selected(); if (!item) return;
  if (!nudgeGesture) {
    fieldEditInput = null; nudgeGesture = { before: rememberSnapshot(), keys: new Set() };
    gestureActive = true;
    const svg = app.querySelector<SVGSVGElement>('#paper'); if (svg) fillPreview.suspend(svg,state.items);
    statsJob?.cancel(); statsRevision++; clearTimeout(estimateTimer); setFillTask();
    history.push(nudgeGesture.before); if (history.length > 60) history.shift(); future = [];
  }
  nudgeGesture.keys.add(key);
  const step = shift ? preferences.value.shiftNudgeMm : preferences.value.nudgeMm;
  const element = liveElement();
  if (element) elementTransformer(element)(new DOMMatrix().translate(delta.x*step,delta.y*step));
  else { item.x += delta.x*step; item.y += delta.y*step; updateCanvasOnly(); }
  persist(); refreshCanvas(); updateRepeat(); refreshInspector();
  app.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled = false;
  app.querySelector<HTMLButtonElement>('[data-action="redo"]')!.disabled = true;
}
function applyPan(): void {
  const wrapper = app.querySelector<HTMLElement>('.paper-shadow');
  if (wrapper) wrapper.style.translate = `${pan.x}px ${pan.y}px`;
  app.querySelector('#stage')?.classList.toggle('space-pan',spaceHeld);
}
function beginPan(event: PointerEvent): void {
  const svg = app.querySelector<SVGSVGElement>('#paper')!, origin = { ...pan };
  const stage = app.querySelector<HTMLElement>('#stage')!;
  const scroll = { left: stage.scrollLeft, top: stage.scrollTop };
  stage.classList.add('panning');
  gestures.start(svg,event,{
    cancelOnInterrupt: true, snapshot: () => ({ ...pan }), restore: snapshot => { pan = snapshot; applyPan(); },
    onStart: () => {}, onMove: sample => {
      pan = { x: origin.x+sample.clientX-event.clientX, y: origin.y+sample.clientY-event.clientY }; applyPan();
    },
    onFinish: reason => {
      if (reason === 'escape' || reason === 'cancel' || reason === 'error') { stage.scrollLeft = scroll.left; stage.scrollTop = scroll.top; }
      stage.classList.remove('panning'); applyPan();
    }, onError: error => toast((error as Error).message,true)
  });
}
window.addEventListener('keydown', event => {
  if (!editingContext(event)) return;
  if (event.code === 'Space' || event.key === ' ') {
    event.preventDefault(); if (!gestures.active) { spaceHeld = true; applyPan(); } return;
  }
  if (gestures.active) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); finishNudge(); duplicateSelection(); return; }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if ((event.key === 'Backspace' || event.key === 'Delete') && state.selectedId) { event.preventDefault(); void action(selectedElement === null ? 'delete' : 'delete-element'); }
  if (event.key === 'Escape') selectObject(selectedElement === null ? null : state.selectedId);
  const directions: Record<string,Point> = { ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0},ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1} };
  const delta = directions[event.key];
  if (delta && selected()) { event.preventDefault(); nudge(event.key,delta,event.shiftKey); }
  if (event.key.toLowerCase() === 'v') { finishNudge(); state.tool = 'select'; render(); }
  if (event.key.toLowerCase() === 'p') { finishNudge(); state.tool = 'draw'; render(); }
});
window.addEventListener('keyup', event => {
  if (event.code === 'Space' || event.key === ' ') { spaceHeld = false; applyPan(); }
  nudgeGesture?.keys.delete(event.key); if (nudgeGesture?.keys.size === 0) finishNudge();
});
window.addEventListener('blur', () => { spaceHeld = false; finishNudge(); applyPan(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { spaceHeld = false; finishNudge(); applyPan(); } });
document.addEventListener('focusin', event => { if ((event.target as Element).closest('input,textarea,select,[contenteditable],dialog,[role="menu"],[role="dialog"]')) { spaceHeld = false; finishNudge(); applyPan(); } });
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  // Retire only the old Plot-it root worker on a previously hosted origin.
  // Other applications' workers and caches belong to their owners.
  void (async () => {
    if (deployment.hosted) {
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        const worker = registration.active ?? registration.waiting ?? registration.installing;
        if (registration.scope === `${location.origin}/` && worker?.scriptURL === `${location.origin}/sw.js`) await registration.unregister();
      }
    }
    await navigator.serviceWorker.register(deployment.worker, { scope: deployment.scope });
  })().catch(error => console.warn('Plot-it offline cache unavailable', error));
}
render();

const typographyRevisions = new WeakMap<Element, number>();
function bindTypographyEvents(root: ParentNode): void {
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-typography]').forEach(input => input.addEventListener('change', async () => {
    const form = input.closest('#text-form');
    // Form settings are read when adding text; they must not cancel a pending font selection.
    if (form && input.dataset.typography !== 'fontId') return;
    const item = form ? undefined : selected();
    const scope = form ?? input.closest('.panel') ?? app;
    const revision = (typographyRevisions.get(scope) ?? 0) + 1; typographyRevisions.set(scope, revision);
    const current = () => input.isConnected && typographyRevisions.get(scope) === revision;
    const add = form?.querySelector<HTMLButtonElement>('[value="default"]');
    const fontSettings = [...scope.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-typography]')]
      .filter(control => control.dataset.typography !== 'fontId');
    try {
      if (input.dataset.typography === 'fontId') {
        const status = scope.querySelector<HTMLElement>('[data-font-status]');
        if (status) { status.hidden = false; status.textContent = `Loading ${findFont(input.value)?.name ?? 'font'}…`; }
        if (add) add.disabled = true;
        fontSettings.forEach(control => { control.disabled = true; });
        await ensureFontLoaded(input.value);
        if (!current() || (!form && selected() !== item)) return;
      }
      if (form) {
        if (input.dataset.typography !== "fontId") return;
        const options = readTypography(form);
        if (input.dataset.typography === "fontId") { const font = findFont(options.fontId); if (font) Object.assign(options, fontTextOptions(font, options)); else { options.features = ""; options.variations = ""; } }
        const controls = form.querySelector('[data-dialog-typography]')!;
        controls.innerHTML = typographyControls(options); bindTypographyEvents(controls);
      } else {
        if (!item?.text) return;
        const inspector = input.closest('.panel') ?? root;
        const options = readTypography(inspector, textOptions(item));
        if (input.dataset.typography === "fontId") { const font = findFont(options.fontId); if (font) Object.assign(options, fontTextOptions(font, options)); else { options.features = ""; options.variations = ""; } }
        editTypographyPreview(item, options);
      }
    } catch (error) {
      if (!current()) return;
      input.value = input.getAttribute('data-font-current') ?? input.value;
      const message = error instanceof Error ? error.message : 'Could not apply typography.';
      if (form) showTextError(message); else toast(message, true);
    } finally {
      if (typographyRevisions.get(scope) === revision) {
        if (add) add.disabled = false;
        fontSettings.forEach(control => { control.disabled = false; });
        const status = scope.querySelector<HTMLElement>('[data-font-status]'); if (status) status.hidden = true;
      }
    }
  }));
  root.querySelectorAll<HTMLInputElement>('[data-font-file]').forEach(input => input.addEventListener('change', () => { void importTextFont(input); }));
}
function editTypographyPreview(item: ArtworkItem, options: TextOptions): void {
  // Prepare the full replacement before making an undoable mutation.
  const replacement = structuredClone(item); editTypography(replacement, item.text!.content, undefined, options);
  commit(() => Object.assign(item, replacement));
}
async function importTextFont(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0]; if (!file) return;
  const form = input.closest('#text-form');
  const item = form ? undefined : selected();
  input.disabled = true;
  try {
    const font = await loadFontFile(file);
    if (form && form.isConnected) {
      const options = fontTextOptions(font, readTypography(form));
      const controls = form.querySelector('[data-dialog-typography]')!;
      controls.innerHTML = typographyControls(options); bindTypographyEvents(controls);
    } else if (item?.text && selected() === item) {
      editTypographyPreview(item, fontTextOptions(font, textOptions(item)));
    }
    toast(`${font.name} loaded`);
  } catch (error) { const message = error instanceof Error ? error.message : 'Could not load this font.'; if (form) showTextError(message); else toast(message, true); }
  finally { input.disabled = false; input.value = ''; }
}
function showTextError(message: string): void {
  const error = app.querySelector<HTMLElement>('#text-error');
  if (error) { error.textContent = message; error.hidden = false; }
}
const restoringOutlines = new Map(state.items.map(item => [item.id, JSON.stringify(item)]));
function upgradeRestoredOutlines(): void {
  if (plotWorkspace) return;
  if(gestures.active){restoredOutlineUpgradePending=true;return;}
  restoredOutlineUpgradePending=false;
  const replacements = new Map<string, ArtworkItem>(), notices: string[] = [];
  for (const item of state.items) {
    if (restoringOutlines.get(item.id) !== JSON.stringify(item)) continue;
    const migrated = migrateOutlineText(item);
    if (migrated.replacement) replacements.set(item.id, migrated.replacement);
    if (migrated.notice) notices.push(migrated.notice);
  }
  if (replacements.size) commit(() => { state.items = state.items.map(item => replacements.get(item.id) ?? item); });
  if (notices.length) toast(notices.join(' '));
}
void restoreFonts(state.items.flatMap(item => item.text?.options?.fontId ? [item.text.options.fontId] : [])).then(() => {
  upgradeRestoredOutlines();
  refreshInspector();
  const form = app.querySelector<HTMLFormElement>('#text-form');
  const controls = form?.querySelector('[data-dialog-typography]');
  if (form && controls) { controls.innerHTML = typographyControls(readTypography(form)); bindTypographyEvents(controls); }
}).catch(() => { upgradeRestoredOutlines(); toast('Saved fonts could not be restored. Stored geometry was preserved; reload a font or edit text to apply perimeter cleanup.', true); });


function currentFill(item: ArtworkItem): FillSettings {
  const element = selectedElement === null ? undefined : elements(markupRoot(item.markup))[selectedElement];
  try { return effectiveFill(item,element); }
  catch { return { ...defaultFillSettings, ...item.fillSettings }; }
}
function saveFill(item: ArtworkItem, settings: FillSettings): void {
  if (selectedElement === null) item.fillSettings = settings;
  else editElement(item, selectedElement, e => e.setAttribute(ELEMENT_FILL_ATTRIBUTE, JSON.stringify(settings)));
}
function fillControls(item: ArtworkItem): string {
  const s = currentFill(item);
  const blocked=selectedElement!==null && item.fillSettings?.mode==='none';
  const mixed=selectedElement===null && hasElementFills(item,markupRoot(item.markup));
  const disabledParameters=blocked||mixed;
  const numeric = (key: keyof FillSettings, label: string, unit: string, min: number, max: number, step: number, value: number) => `<label>${label}<div class="unit-input"><input type="number" aria-label="${label} ${unit}" data-fill-setting="${key}" min="${min}" max="${max}" step="${step}" value="${value}" ${disabledParameters?'disabled':''}><span>${unit}</span></div></label>`;
  let spacing = ''; try { spacing = fillSpacing(s).toFixed(3); } catch { /* Invalid saved settings are reported by generation. */ }
  return `<details class="fill-controls" ${inspectorSection("fill")}><summary class="panel-title">Plot fill</summary><div class="panel-body"><label>Fill mode<select data-fill-setting="mode" ${blocked?'disabled':''}>${mixed?'<option value="elements" selected disabled>Element fills</option>':''}${['none','solid','hatch','crosshatch'].map(mode => `<option value="${mode}" ${!mixed && s.mode === mode ? 'selected' : ''}>${{none:'None',solid:'Solid',hatch:'Hatch stripes',crosshatch:'Crosshatch'}[mode]}</option>`).join('')}</select></label>
    ${numeric('width','Drawn line width','mm',.05,20,.05,s.width)}
    <div class="two-col">${numeric('angle','Angle','°',-360,360,1,s.angle)}${s.mode === 'solid' || s.mode === 'none' ? numeric('overlap','Overlap','%',0,80,1,s.overlap*100) : numeric('gap','Clear gap','mm',0,100,.1,s.gap)}</div>
    <label class="check"><input type="checkbox" data-fill-setting="outline" ${s.outline?'checked':''} ${disabledParameters?'disabled':''}><span>Draw boundary</span></label>
    <label class="check"><input type="checkbox" data-fill-setting="connect" ${s.connect?'checked':''} ${disabledParameters?'disabled':''}><span>Connect strokes for faster plotting</span></label>
    <p class="field-help">${blocked?'Object fill is None. Enable a fill mode on the object to use element fill settings.':mixed?'Individual SVG elements have fill settings. Choose None to disable all fills in this object.':s.mode === 'none' ? (s.outline ? 'Draw boundary removes overlap seams within each element and draws outer and hole boundaries, without interior fill.' : item.text?.format === 'plotfont' ? 'Enable Draw boundary or choose a fill mode for filled PlotFont regions. Centerline strokes retain their original paths.' : 'None draws original outlines. Enable Draw boundary for cleaned perimeters without interior fill.') : `Stroke spacing: ${spacing} mm. Interior marks stay inside the shape.`} An outline extends half its stroke width outside the boundary.</p>
    <button class="button" data-action="fill-calibration" ${disabledParameters?'disabled':''}>Add calibration swatch</button>
    <p class="field-help">Compare swatches on your paper, then choose overlap:</p><div class="fill-calibration-options">${[0,.1,.15,.2].map(v=>`<button class="button" data-fill-overlap="${v}" ${disabledParameters?'disabled':''}>Use ${v*100}%</button>`).join('')}</div>
    <p class="field-help" data-fill-status role="status">${escapeHtml(fillStatus === 'Generating fill…' ? '' : fillStatus)}</p><p class="field-help" data-fill-stats>${escapeHtml(fillStats)}</p></div></details>`;
}
function updateFillMessage(): void {
  app.querySelectorAll<HTMLElement>('[data-fill-status]').forEach(e => { e.textContent = fillStatus === 'Generating fill…' ? '' : fillStatus; e.classList.toggle('fill-error', fillError); });
  app.querySelectorAll<HTMLElement>('[data-fill-stats]').forEach(e => { e.textContent = fillStats; });
}
async function updateFillStatistics(svg: SVGSVGElement, key: string): Promise<void> {
  const revision = ++statsRevision;
  try {
    await awaitFills(svg);
    if (revision !== statsRevision || svg !== app.querySelector('#paper')) return;
    statsJob?.cancel(); const job = prepareJob(svg, state.paper, state.settings, progress => { if (revision === statsRevision && !plotWorkspace) setFillTask(progress); }, state.pens); statsJob = job;
    const plan = await job.promise;
    if (revision !== statsRevision) return;
    estimatedKey=key;
    const drawing = plan.events.filter(e => e.kind === 'xy' && e.penDown).reduce((sum,e) => sum + Math.hypot(e.to.x-e.from.x,e.to.y-e.from.y),0);
    const lifts = plan.events.filter(e => e.kind === 'pen' && !e.penDown).length - 1;
    fillStats = `Whole plot: ${drawing.toFixed(0)} mm drawing · ${Math.max(0,lifts)} pen lifts · ${(plan.duration/60).toFixed(1)} min estimated (excludes manual pen changes).`;
    updateFillMessage();
  } catch { /* A cancelled/stale estimate must never replace the new preview. */ }
  finally { if (revision === statsRevision && !plotWorkspace) { statsJob = undefined; setFillTask(); } }
}
function addFillCalibration(): void {
  const item = selected(); if (!item) return;
  const s = currentFill(item);
  commit(() => {
    for (const [i, overlap] of [0,.1,.15,.2].entries()) {
      const x = 10 + i*23;
      const swatch: ArtworkItem = { id: `calibration-${crypto.randomUUID()}`, name: `Calibration ${overlap*100}% overlap`, markup: '<rect x="0" y="0" width="18" height="12"/>', viewBox: [0,0,18,12], x, y: 10, width: 18, height: 12, rotation: 0, stroke: item.stroke, fillSettings: { ...s, mode: 'solid', overlap, outline: false, connect: true } };
      const label = textToItem(`${overlap*100}%`, 3); label.x = x; label.y = 24; label.stroke = item.stroke;
      state.items.push(swatch, label);
    }
  });
  toast('Calibration swatches added at the top of the page. Simulate or plot when ready.');
}

function restoreObjectListScroll(scroll: number): void {
  const list = app.querySelector<HTMLElement>('.objects-panel .object-list');
  if (!list) return;
  list.scrollTop = scroll;
  const active = list.querySelector<HTMLElement>('.object-row.active');
  if (!active) return;
  if (active.offsetTop < list.scrollTop) list.scrollTop = active.offsetTop;
  else if (active.offsetTop + active.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = active.offsetTop + active.offsetHeight - list.clientHeight;
}

function fillProgressMarkup(floating = false): string {
  const task = fillTask;
  const percent = task?.fraction === undefined ? undefined : Math.round(task.fraction * 100);
  return `<div class="fill-task-progress ${floating ? 'fill-task-floating' : ''}" data-fill-progress ${task ? '' : 'hidden'}>
    <div class="fill-task-heading"><span data-fill-task-label aria-live="polite">${escapeHtml(task?.label ?? '')}</span><span data-fill-task-percent aria-hidden="true">${percent === undefined ? '' : `${percent}%`}</span></div>
    <progress max="100" ${percent === undefined ? '' : `value="${percent}"`} aria-label="${escapeHtml(task?.label ?? 'Fill task progress')}"></progress>
    ${floating ? '<button class="button" data-action="cancel-fill-task">Cancel task</button>' : ''}
  </div>`;
}
function setFillTask(task?: TaskProgress): void {
  fillTask = task;
  const percent = task?.fraction === undefined ? undefined : Math.max(0, Math.min(100, Math.round(task.fraction * 100)));
  app.querySelectorAll<HTMLElement>('[data-fill-progress]').forEach(container => {
    container.hidden = !task;
    container.querySelector<HTMLElement>('[data-fill-task-label]')!.textContent = task?.label ?? '';
    container.querySelector<HTMLElement>('[data-fill-task-percent]')!.textContent = percent === undefined ? '' : `${percent}%`;
    const progress = container.querySelector('progress')!;
    progress.setAttribute('aria-label', task?.label ?? 'Fill task progress');
    if (percent === undefined) progress.removeAttribute('value'); else progress.value = percent;
  });
}
