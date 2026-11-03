import { resizeHandleMarkup } from './resize-controls';
import appCanvas from './canvas.module.css';
import appInspector from './inspector.module.css';
import appOverlay from './overlay.module.css';
import appWorkspace from './workspace.module.css';
import dsButton from '../design-system/button.module.css';
import dsField from '../design-system/field.module.css';
import dsInput from '../design-system/input.module.css';
import dsOverlay from '../design-system/overlay.module.css';
import type { AppState } from '../../model';
import { SHAPES } from '../../shapes';
import { DOCUMENT_ACCEPT } from '../../document-file';
import { icon } from '../../icons';
import { workspaceHeader, workspaceControls } from './workspace';
import { escapeUI, propertyField } from '../design-system';
import { button, inspectorSectionMarkup, popover } from './components';
import type { editorViews } from './editor-views';
export interface ShellView {
  state: AppState; canUndo:boolean; canRedo:boolean; canInstall?:boolean;
  inspectorSections: ReadonlyMap<string, boolean>; editor: ReturnType<typeof editorViews>;
  progress:string; artwork:string; selection:string; connectionStatus:string; menu:string;
}
export function workspaceShell(view: ShellView): string {
  const { state } = view;
  return `
    <div class="app-shell ${appWorkspace["app-shell"]} " data-ui-root>
      ${workspaceHeader()}
      <main class="workspace ${appWorkspace["workspace"]} ">
        <section class="stage-wrap ${appCanvas["stage-wrap"]} " data-ui="canvas-viewport">
          ${view.progress}
          ${workspaceControls(state, view.canUndo, view.canRedo)}
          <output class="${appCanvas['resize-dimensions']}" data-resize-dimensions hidden aria-live="polite"></output><span id="resize-instructions" class="${appCanvas['visually-hidden']}">Arrow keys resize by 0.1 millimetres. Shift adjusts by 1 millimetre. Enter finishes. Escape cancels.</span>
          <div class="stage ${appCanvas["stage"]} " id="stage" tabindex="0" aria-label="Editing canvas">
            <div class="paper-shadow ${appCanvas["paper-shadow"]} " data-ui="paper-frame" >
              <svg id="paper" class="paper ${appCanvas["paper"]} " style="--paper-color:${state.paperColor}" viewBox="0 0 ${state.paper.width} ${state.paper.height}" role="img" aria-label="Plotting paper">
                <defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#e2e2e8" stroke-width=".18"/></pattern></defs>
                <rect id="paper-background" x="0" y="0" width="${state.paper.width}" height="${state.paper.height}" fill="${state.paperColor}"/>
                <rect x="0" y="0" width="${state.paper.width}" height="${state.paper.height}" fill="url(#grid)" opacity=".3"/>
                <rect x="${state.settings.margin}" y="${state.settings.margin}" width="${Math.max(0, state.paper.width - state.settings.margin * 2)}" height="${Math.max(0, state.paper.height - state.settings.margin * 2)}" class="margin-guide "/>
                <g id="artwork-layer" fill="none" stroke="currentColor" stroke-width=".35" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round">
                  ${view.artwork}
                </g>
                <path id="draft-path" class="draft-path " d=""/>
              </svg>
              <svg data-edit-overlay id="selection-overlay" class="paper ${appCanvas.paper} ${appCanvas["selection-overlay"]}" role="group" aria-label="Selection controls"><g data-world-overlay>${view.selection}</g></svg>
              ${state.items.length ? "" : `<div class="empty-state ${appCanvas["empty-state"]} "><div class="empty-icon ${appCanvas["empty-icon"]} ">${icon("pen")}</div><h2>Plot-It</h2><p>A blank page, ready for your next plot.<br>Draw a line, add text, or bring in an SVG.</p><div><button class="button primary ${dsButton["button"]} ${dsButton["primary"]} " data-action="import">Import SVG</button><button class="button ${dsButton["button"]} " data-action="add-text">Add text</button></div>${button({label:'Canvas settings',action:'canvas-mode'})}${button({label:'Install app',icon:'download',action:'install',attributes:{'data-install-app':'',hidden:view.canInstall===false}})}<small>Everything stays in your browser.</small></div>`}
            </div>
          </div>
          <footer class="statusbar ${appWorkspace["statusbar"]} " data-ui="status"><button type="button" data-action="canvas-connection" data-connection-status><i></i>${escapeUI(view.connectionStatus)}</button><span data-object-count>${state.items.length} object${state.items.length === 1 ? "" : "s"}</span></footer>
        </section>
        <div class="inspector-host ${appInspector["inspector-host"]} " data-inspector-dock>
        ${resizeHandleMarkup('Resize sidebar','horizontal','data-sidebar-resize')}
        <aside class="inspector ${appInspector["inspector"]} " data-ui="inspector" aria-label="Inspector">
          ${editInspectorMarkup(view)}

        </aside>
        </div>
      </main>
      <dialog id="inspector-drawer" class="inspector-host ${appInspector["inspector-host"]} " data-inspector-host aria-labelledby="inspector-title"><header class="inspector-head ${appInspector["inspector-head"]} "><span id="inspector-title">Inspector</span><button type="button" class="button ghost icon-button ${dsButton["button"]} ${dsButton["ghost"]} ${dsButton["icon-button"]} " data-close-inspector aria-label="Close inspector">${icon("close")}</button></header><div class="inspector-mode ${appInspector['inspector-mode']}" data-inspector-mode></div></dialog>
      <input class="${dsInput["input"]} " id="file-input" type="file" accept="image/svg+xml,.svg" hidden>
      <input class="${dsInput["input"]}" id="document-input" type="file" accept="${DOCUMENT_ACCEPT}" hidden>
      ${popover('shape-menu', 'shape-title',
        `<h2 id="shape-title" class="${appOverlay['popover-title']}">Shapes</h2><div class="${appOverlay['menu-items']}">${SHAPES.map(shape => button({label:shape.label,icon:shape.icon,variant:'ghost',attributes:{'data-add-shape':shape.id}})).join('')}</div>`,
        `toolbar-popover ${appOverlay['toolbar-popover']} ${appOverlay['shape-popover']}`)}
      ${popover('more-elements', 'elements-title',
        `<h2 id="elements-title" class="${appOverlay['popover-title']}">Add an element</h2><div class="${appOverlay['menu-settings']}"><p class="${appOverlay['popover-note']}">Create a calibration grid across the paper.</p>
        ${propertyField({label:'Line spacing',prefix:'Spacing',unit:'mm',value:20,attributes:{id:'calibration-spacing',min:2,max:100,step:1}})}
        <p id="calibration-error" class="field-error ${dsField['field-error']}" role="alert" hidden></p></div>
        <div class="${appOverlay['menu-items']}">${button({label:'Add calibration sheet',icon:'plus',variant:'ghost',action:'surface-calibration'})}</div>`,
        `toolbar-popover ${appOverlay['toolbar-popover']}`)}
      <dialog class="${dsOverlay["dialog"]} " id="text-dialog" aria-label="Add plot text">${view.editor.textDialogMarkup()}</dialog>
      <dialog class="${dsOverlay["dialog"]} " id="canvas-dialog" aria-labelledby="canvas-title">${view.editor.canvasDialogMarkup()}</dialog>
      ${view.menu}
      <div id="toast" class="toast ${appOverlay["toast"]} " role="status"></div>
    </div>`;
}

export function editInspectorMarkup(view: Pick<ShellView, 'state'|'inspectorSections'|'editor'>): string {
  const { inspectorSections } = view;
  return `          ${inspectorSectionMarkup("objects", `${view.editor.objectsMarkup()}`, inspectorSections.get("objects") ?? true, "objects-panel")}
          ${inspectorSectionMarkup("selection", `${view.editor.selectionPanelMarkup()}`, inspectorSections.get("selection") ?? true, "selection-panel")}`;
}
