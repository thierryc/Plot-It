import { publicAssetUrl } from '../../app-deployment';
import appOverlay from './overlay.module.css';
import appCanvas from './canvas.module.css';
import appField from './field.module.css';
import appWorkspace from './workspace.module.css';
import dsField from '../design-system/field.module.css';
import dsInput from '../design-system/input.module.css';
import dsSelect from '../design-system/select.module.css';
import type { AppState } from '../../model';
import type { ThemePreference } from '../../theme';
import type { EditorPreferences } from '../../editor-preferences';
import { icon } from '../../icons';
import { button, escapeUI, field, floatingSurface, popover, segmentedControl } from './components';


function workspaceModeControl(): string {
  return segmentedControl('Workspace mode', [
    {label:'Hide sidebar',action:'ghost-mode',icon:'ghost',iconOnly:true,selected:false},
    {label:'Canvas',action:'canvas-mode',icon:'canvas',selected:false},
    {label:'Edit',action:'edit-mode',icon:'pen',selected:true},
    {label:'Plot',action:'open-plot',icon:'plot',selected:false}
  ]);
}

export function workspaceControls(state: AppState, history: boolean, future: boolean): string {
  const tool = (label: string, name: AppState['tool'], image: 'cursor' | 'pen', shortcut: string) => button({
    label: `${label} (${shortcut})`, icon: image, iconOnly: true, className: `tool ${appWorkspace.tool} ${state.tool === name ? 'active' : ''}`,
    attributes: { 'data-tool':name, 'aria-pressed':state.tool === name }
  });
  const tools = tool('Select', 'select', 'cursor', 'V') + tool('Draw', 'draw', 'pen', 'P') +
    button({ label: 'Text', icon: 'text', iconOnly: true, action: 'add-text', className: `tool ${appWorkspace.tool}` }) +
    button({ label: 'Shapes', icon: 'shape', iconOnly: true, className: `tool ${appWorkspace.tool}`, action: 'shapes', attributes: { 'popovertarget': 'shape-menu', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'shape-menu' } }) +
    button({ label: 'Import SVG', icon: 'upload', iconOnly: true, action: 'import', className: `tool ${appWorkspace.tool}` }) +
    button({ label: 'More elements', icon: 'more', iconOnly: true, className: `tool ${appWorkspace.tool}`, action: 'more-elements', attributes: { 'popovertarget': 'more-elements', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'more-elements' } });
  const toolbar = `<div class="${appCanvas['drawing-tools']}" data-drawing-tools data-edit-control>${tools}</div><span class="toolbar-divider ${appCanvas['toolbar-divider']}" data-mode-divider aria-hidden="true"></span><div class="${appWorkspace['workspace-mode-dock']}" data-workspace-mode-dock>${workspaceModeControl()}</div>`;
  return floatingSurface(toolbar, 'drawing-toolbar', { 'data-ui':'drawing-toolbar', role:'toolbar', 'aria-label':'Drawing tools' }) +
    `<div class="viewport-controls ${appCanvas["viewport-controls"]} " data-ui="viewport-controls">` +
    floatingSurface(`<button type="button" class="canvas-size-button ${appCanvas["canvas-size-button"]} " data-action="canvas-size" data-edit-control aria-label="Change canvas size" aria-haspopup="dialog"><strong>${escapeUI(state.paper.name)}</strong><span>${state.paper.width} × ${state.paper.height} mm</span><span class="canvas-size-chevron ${appCanvas["canvas-size-chevron"]} " aria-hidden="true">${icon('chevron')}</span></button><div class="zoom-control ${appCanvas["zoom-control"]} " data-ui="zoom-control">${button({ label: 'Zoom out', icon: 'minus', iconOnly: true, action: 'zoom-out', variant: 'ghost' })}<span data-zoom-label>${Math.round(state.zoom * 100)}%</span>${button({ label: 'Zoom in', icon: 'plus', iconOnly: true, action: 'zoom-in', variant: 'ghost' })}${button({ label: 'Fit paper', icon: 'fit', iconOnly: true, action: 'zoom-fit', variant: 'ghost' })}${button({label:'Selection',action:'zoom-selection',variant:'ghost',disabled:!state.selectedId,attributes:{'aria-label':'Fit selection','data-edit-control':''}})}${button({label:'All',action:'zoom-all',variant:'ghost',attributes:{'aria-label':'Fit all','data-edit-control':''}})}</div>`, 'viewport-surface') +
    floatingSurface(button({ label: 'Undo', icon: 'undo', iconOnly: true, action: 'undo', variant: 'ghost', disabled: !history, attributes: { 'data-edit-control': '' } }) + button({ label: 'Redo', icon: 'redo', iconOnly: true, action: 'redo', variant: 'ghost', disabled: !future, attributes: { 'data-edit-control': '' } }), 'history-controls') + '</div>';
}
export type WorkspaceMode = 'canvas' | 'edit' | 'plot';

export function workspaceHeader(): string {
  return button({ label: 'Main menu', icon: 'menu', iconOnly: true, className: `menu-trigger ${appWorkspace['menu-trigger']}`, attributes: { 'data-menu-trigger': '', 'popovertarget': 'main-menu', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'main-menu' } }) +
    `<div class="top-actions ${appWorkspace["top-actions"]} ">${button({ label: 'Inspector', icon: 'panel', iconOnly: true, className: `inspector-trigger ${appWorkspace['inspector-trigger']}`, action: 'open-inspector', attributes: { 'aria-haspopup': 'dialog', 'aria-controls': 'inspector-drawer', 'aria-expanded': 'false', 'data-inspector-trigger': '' } })}</div>`;
}
export function mainMenu(state: AppState, theme: ThemePreference, preferences: EditorPreferences, hosted: boolean, install: boolean): string {
  return popover('main-menu', 'menu-title',
    `<h2 id="menu-title" class="menu-brand ${appWorkspace["menu-brand"]} ">${icon('pen')} Plot-It</h2><div class="document-title ${appWorkspace["document-title"]} "><button class="document-name ${appWorkspace["document-name"]} " data-document-name title="Double-click or press F2 to rename the plot">${escapeUI(state.documentName)}</button>${button({ label: 'Rename plot', icon: 'text', iconOnly: true, variant: 'ghost', action: 'rename-document' })}</div><p class="saved ${appWorkspace["saved"]} ">Saved locally in this browser</p>` +
    `<div class="menu-actions ${appWorkspace["menu-actions"]} ">${[
      { label: 'Load', icon: 'load' as const, action: 'load-document' },
      { label: 'Save', icon: 'save' as const, action: 'save-document' },
      { label: 'Import SVG', icon: 'upload' as const, action: 'import' },
      { label: 'Copy', icon: 'copy' as const, action: 'copy', disabled: !state.selectedId },
      { label: 'Paste', icon: 'clipboard' as const, action: 'paste' },
      { label: 'Duplicate', icon: 'copy' as const, action: 'duplicate', disabled: !state.selectedId },
      { label: 'Enable text defaults', icon:'text' as const, action:'enable-text-defaults', disabled:!state.items.some(item=>item.text) },
      { label: 'Export SVG', icon: 'download' as const, action: 'export', disabled: !state.items.length },
    ].map(options => button({ ...options, variant: 'ghost', attributes: { 'data-edit-control': '' } })).join('')}${install ? button({ label: 'Install app', icon:'download', action: 'install', variant: 'ghost',attributes:{'data-install-app':''} }) : ''}</div>` +
    `<label class="${dsField["field"]} settings-theme ${appField["settings-theme"]} ">Interface theme<select class="${dsSelect["select"]} theme-select ${appField["theme-select"]} " data-theme-select aria-label="Interface theme">${['system', 'light', 'dark'].map(value => `<option value="${value}" ${theme === value ? 'selected' : ''}>${value[0]!.toUpperCase() + value.slice(1)}</option>`).join('')}</select></label>` +
    `<div class="nudge-preferences ${appField["nudge-preferences"]} ">${(['nudgeMm', 'shiftNudgeMm'] as const).map(key => field(key === 'nudgeMm' ? 'Normal nudge' : 'Shift nudge', `<div class="unit-input ${dsInput["unit-input"]} "><input class="${dsInput["input"]}" type="number" min="0" step="any" data-nudge-preference="${key}" value="${preferences[key]}"><span>mm</span></div><span class="field-error ${dsField["field-error"]} " data-nudge-error="${key}" role="alert" hidden></span>`)).join('')}${button({ label: 'Reset nudge defaults', attributes: { 'data-reset-nudges': '' } })}</div>` +
    `<nav class="menu-links ${appWorkspace["menu-links"]} " aria-label="Project links">${hosted ? `<a href="${publicAssetUrl('/')}">Home</a>` : ''}<a href="${hosted ? publicAssetUrl('/docs/') : 'https://github.com/thierryc/Plot-It#readme'}">Docs</a><a href="https://github.com/thierryc/Plot-It/issues" target="_blank" rel="noopener">Support</a><a href="${publicAssetUrl('/plot-it-source.tar.gz')}" download>Source · Apache-2.0</a>${hosted ? '<a href="https://ap.cx/">AP.CX</a>' : ''}</nav>`, `main-menu ${appOverlay['main-menu']}`);
}
