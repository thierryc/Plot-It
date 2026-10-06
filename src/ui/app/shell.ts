import appCanvas from './canvas.module.css';
import appInspector from './inspector.module.css';
import appOverlay from './overlay.module.css';
import appWorkspace from './workspace.module.css';
import dsButton from '../design-system/button.module.css';
import dsField from '../design-system/field.module.css';
import dsInput from '../design-system/input.module.css';
import dsOverlay from '../design-system/overlay.module.css';
import dsSelect from '../design-system/select.module.css';
import type { AppState } from '../../model';
import { PLOTTER_POSITIONS, setupModel } from '../../plotter-setup';
import { paperPresetIndex } from '../../paper';
import { SHAPES } from '../../shapes';
import { DOCUMENT_ACCEPT } from '../../document-file';
import { icon } from '../../icons';
import { workspaceHeader, workspaceControls } from './workspace';
import { colorField, escapeUI } from '../design-system';
import { inspectorSectionMarkup } from './components';
import type { editorViews } from './editor-views';
export interface ShellView {
  state: AppState; pan: {x:number; y:number}; canUndo:boolean; canRedo:boolean;
  inspectorSections: ReadonlyMap<string, boolean>; editor: ReturnType<typeof editorViews>;
  progress:string; artwork:string; selection:string; connectionStatus:string; menu:string;
}
export function workspaceShell(view: ShellView): string {
  const { state, pan, inspectorSections } = view;
  return `
    <div class="app-shell ${appWorkspace["app-shell"]} " data-ui-root>
      ${workspaceHeader()}
      <main class="workspace ${appWorkspace["workspace"]} ">
        <section class="stage-wrap ${appCanvas["stage-wrap"]} " data-ui="canvas-viewport">
          ${view.progress}
          ${workspaceControls(state, view.canUndo, view.canRedo)}
          <div class="stage ${appCanvas["stage"]} " id="stage" tabindex="0" aria-label="Editing canvas">
            <div class="paper-shadow ${appCanvas["paper-shadow"]} " data-ui="paper-frame" style="--paper-ratio:${state.paper.width}/${state.paper.height};--zoom:${state.zoom};translate:${pan.x}px ${pan.y}px">
              <svg id="paper" class="paper ${appCanvas["paper"]} " style="--paper-color:${state.paperColor}" viewBox="0 0 ${state.paper.width} ${state.paper.height}" role="img" aria-label="Plotting paper">
                <defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#e2e2e8" stroke-width=".18"/></pattern></defs>
                <rect id="paper-background" width="100%" height="100%" fill="${state.paperColor}"/>
                <rect width="100%" height="100%" fill="url(#grid)" opacity=".3"/>
                <rect x="${state.settings.margin}" y="${state.settings.margin}" width="${Math.max(0, state.paper.width - state.settings.margin * 2)}" height="${Math.max(0, state.paper.height - state.settings.margin * 2)}" class="margin-guide "/>
                <g id="artwork-layer" fill="none" stroke="currentColor" stroke-width=".35" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round">
                  ${view.artwork}
                </g>
                ${view.selection}
                <path id="draft-path" class="draft-path " d=""/>
              </svg>
              ${state.items.length ? "" : `<div class="empty-state ${appCanvas["empty-state"]} "><div class="empty-icon ${appCanvas["empty-icon"]} ">${icon("pen")}</div><h2>Plot-It</h2><p>A blank page, ready for your next plot.<br>Draw a line, add text, or bring in an SVG.</p><div><button class="button primary ${dsButton["button"]} ${dsButton["primary"]} " data-action="import">Import SVG</button><button class="button ${dsButton["button"]} " data-action="add-text">Add text</button></div><small>Everything stays in your browser.</small></div>`}
            </div>
          </div>
          <footer class="statusbar ${appWorkspace["statusbar"]} " data-ui="status"><span data-connection-status><i></i>${escapeUI(view.connectionStatus)}</span><span data-object-count>${state.items.length} object${state.items.length === 1 ? "" : "s"}</span></footer>
        </section>
        <div class="inspector-host ${appInspector["inspector-host"]} " data-inspector-dock>
        <aside class="inspector ${appInspector["inspector"]} " data-ui="inspector" aria-label="Inspector">
          ${inspectorSectionMarkup("paper", `<summary class="panel-title ${appInspector["panel-title"]} ">Paper</summary><div class="panel-body ${appInspector["panel-body"]} "><label class="${dsField["field"]} ">Size<select class="${dsSelect["select"]} " data-setting="paper">${view.editor.paperOptions(paperPresetIndex(state.paper))}</select></label><button class="button ${dsButton["button"]} " data-action="canvas-size">Canvas dimensions…</button>${colorField('Paper color', state.paperColor, { 'data-setting':'paperColor' })}<label class="${dsField["field"]} ">Safe margin<div class="unit-input ${dsInput["unit-input"]} "><input class="${dsInput["input"]}" type="number" min="0" max="50" step="1" value="${state.settings.margin}" data-setting="margin"><span>mm</span></div></label></div>`, inspectorSections.get("paper") ?? true, "")}
          ${inspectorSectionMarkup('setup', `<summary class="panel-title ${appInspector["panel-title"]} ">Plotter setup</summary><div class="panel-body ${appInspector["panel-body"]} ">
            <label class="${dsField["field"]} ">Machine profile<select class="${dsSelect["select"]} " data-setting="profile"><option value="axidraw" ${state.settings.profile === 'axidraw' ? 'selected' : ''}>AxiDraw / EBB</option><option value="xylodraw" ${state.settings.profile === 'xylodraw' ? 'selected' : ''}>XyloDraw</option></select></label>
            ${state.settings.profile === 'axidraw' ? `<label class="${dsField["field"]} ">AxiDraw model<select class="${dsSelect["select"]} " data-setting="axidrawModel"><option value="v3-a4" ${setupModel(state.settings.axidrawModel) === 'v3-a4' ? 'selected' : ''}>V3 · A4</option><option value="v3-a3" ${state.settings.axidrawModel === 'v3-a3' ? 'selected' : ''}>V3/A3 · A3</option></select></label>` : ''}
            <label class="${dsField["field"]} ">Plotter position<select class="${dsSelect["select"]} " data-setting="machineRotation">${PLOTTER_POSITIONS.map(option => `<option value="${option.rotation}" ${(state.settings.machineRotation ?? 90) === option.rotation ? 'selected' : ''}>${option.label}</option>`).join('')}</select></label>
            <p class="field-help ${dsField["field-help"]} ">Position sets the machine orientation. The diagram follows the pen during simulation. Fit frames the paper.</p>
          </div>`, inspectorSections.get('setup') ?? true, "")}
          ${inspectorSectionMarkup("objects", `${view.editor.objectsMarkup()}`, inspectorSections.get("objects") ?? true, "objects-panel")}
          ${inspectorSectionMarkup("selection", `${view.editor.selectionPanelMarkup()}`, inspectorSections.get("selection") ?? true, "selection-panel")}

        </aside>
        </div>
      </main>
      <dialog id="inspector-drawer" class="inspector-host ${appInspector["inspector-host"]} " data-inspector-host aria-labelledby="inspector-title"><header class="inspector-head ${appInspector["inspector-head"]} "><span id="inspector-title">Inspector</span><button type="button" class="button ghost icon-button ${dsButton["button"]} ${dsButton["ghost"]} ${dsButton["icon-button"]} " data-close-inspector aria-label="Close inspector">${icon("close")}</button></header></dialog>
      <input class="${dsInput["input"]} " id="file-input" type="file" accept="image/svg+xml,.svg" hidden>
      <input class="${dsInput["input"]}" id="document-input" type="file" accept="${DOCUMENT_ACCEPT}" hidden>
      <section id="shape-menu" class="elements-popover shape-popover ${appOverlay["elements-popover"]} " popover="auto" role="dialog" aria-labelledby="shape-title">
        <div class="dialog-head ${appOverlay["dialog-head"]} "><h2 id="shape-title">Insert a shape</h2><button class="close ${appOverlay["close"]} " popovertarget="shape-menu" popovertargetaction="hide" aria-label="Close shapes">${icon("close")}</button></div>
        <div class="shape-grid ${appOverlay["shape-grid"]} ">${SHAPES.map(shape => `<button class="button ${dsButton["button"]} " data-add-shape="${shape.id}">${icon(shape.icon)}<span>${shape.label}</span></button>`).join('')}</div>
      </section>
      <section id="more-elements" class="elements-popover ${appOverlay["elements-popover"]} " popover="auto" role="dialog" aria-labelledby="elements-title">
        <div class="dialog-head ${appOverlay["dialog-head"]} "><h2 id="elements-title">Add an element</h2><button class="close ${appOverlay["close"]} " popovertarget="more-elements" popovertargetaction="hide" aria-label="Close elements">${icon("close")}</button></div>
        <h3>Calibration sheet</h3><p>Crossing horizontal and vertical lines cover the paper inside its safe margin. Check for faint or missing lines to find uneven pen contact.</p>
        <label class="${dsField["field"]} ">Line spacing<div class="unit-input ${dsInput["unit-input"]} "><input class="${dsInput["input"]} " id="calibration-spacing" type="number" min="2" max="100" step="1" value="20"><span>mm</span></div></label>
        <p id="calibration-error" class="field-error ${dsField["field-error"]} " role="alert" hidden></p>
        <button class="button primary ${dsButton["button"]} ${dsButton["primary"]} " data-action="surface-calibration">${icon("plus")} Add calibration sheet</button>
      </section>
      <dialog class="${dsOverlay["dialog"]} " id="text-dialog" aria-label="Add plot text">${view.editor.textDialogMarkup()}</dialog>
      <dialog class="${dsOverlay["dialog"]} " id="canvas-dialog" aria-labelledby="canvas-title">${view.editor.canvasDialogMarkup()}</dialog>
      ${view.menu}
      <div id="toast" class="toast ${appOverlay["toast"]} " role="status"></div>
    </div>`;
}
