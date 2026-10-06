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


export function workspaceControls(state: AppState, history: boolean, future: boolean): string {
  const tool = (label: string, name: AppState['tool'], image: 'cursor' | 'pen', shortcut: string) => button({
    label: `${label} (${shortcut})`, icon: image, iconOnly: true, className: `tool ${appWorkspace.tool} ${state.tool === name ? 'active' : ''}`,
    attributes: { 'data-tool':name, 'aria-pressed':state.tool === name }
  });
  const tools = tool('Select', 'select', 'cursor', 'V') + tool('Draw', 'draw', 'pen', 'P') +
    button({ label: 'Text', icon: 'text', iconOnly: true, action: 'add-text', className: `tool ${appWorkspace.tool}` }) +
    button({ label: 'Shapes', icon: 'shape', iconOnly: true, className: `tool ${appWorkspace.tool}`, action: 'shapes', attributes: { 'popovertarget': 'shape-menu', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'shape-menu' } }) +
    `<span class="toolbar-divider ${appCanvas["toolbar-divider"]} " aria-hidden="true"></span>` +
    button({ label: 'More elements', icon: 'more', iconOnly: true, className: `tool ${appWorkspace.tool}`, action: 'more-elements', attributes: { 'popovertarget': 'more-elements', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'more-elements' } });
  return floatingSurface(tools, 'drawing-toolbar', { 'data-ui':'drawing-toolbar', 'data-edit-control':'', role:'toolbar', 'aria-label':'Drawing tools' }) +
    `<div class="viewport-controls ${appCanvas["viewport-controls"]} " data-ui="viewport-controls">` +
    floatingSurface(`<button type="button" class="canvas-size-button ${appCanvas["canvas-size-button"]} " data-action="canvas-size" data-edit-control aria-label="Change canvas size" aria-haspopup="dialog"><strong>${escapeUI(state.paper.name)}</strong><span>${state.paper.width} × ${state.paper.height} mm</span><span class="canvas-size-chevron ${appCanvas["canvas-size-chevron"]} " aria-hidden="true">${icon('chevron')}</span></button><div class="zoom-control ${appCanvas["zoom-control"]} " data-ui="zoom-control">${button({ label: 'Zoom out', icon: 'minus', iconOnly: true, action: 'zoom-out', variant: 'ghost' })}<span data-zoom-label>${Math.round(state.zoom * 100)}%</span>${button({ label: 'Zoom in', icon: 'plus', iconOnly: true, action: 'zoom-in', variant: 'ghost' })}${button({ label: 'Fit to view', icon: 'fit', iconOnly: true, action: 'zoom-fit', variant: 'ghost' })}</div>`, 'viewport-surface') +
    floatingSurface(button({ label: 'Undo', icon: 'undo', iconOnly: true, action: 'undo', variant: 'ghost', disabled: !history, attributes: { 'data-edit-control': '' } }) + button({ label: 'Redo', icon: 'redo', iconOnly: true, action: 'redo', variant: 'ghost', disabled: !future, attributes: { 'data-edit-control': '' } }), 'history-controls') + '</div>';
}
export function workspaceHeader(): string {
  return button({ label: 'Main menu', icon: 'menu', iconOnly: true, className: `menu-trigger ${appWorkspace['menu-trigger']}`, attributes: { 'data-menu-trigger': '', 'popovertarget': 'main-menu', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'main-menu' } }) +
    `<div class="top-actions ${appWorkspace["top-actions"]} ">${segmentedControl('Workspace mode', [{ label: 'Edit', action: 'edit-mode', selected: true }, { label: 'Plot', action: 'open-plot', selected: false }])}${button({ label: 'Inspector', icon: 'panel', iconOnly: true, className: `inspector-trigger ${appWorkspace['inspector-trigger']}`, action: 'open-inspector', attributes: { 'aria-haspopup': 'dialog', 'aria-controls': 'inspector-drawer', 'aria-expanded': 'false', 'data-inspector-trigger': '' } })}</div>`;
}
export function mainMenu(state: AppState, theme: ThemePreference, preferences: EditorPreferences, hosted: boolean, install: boolean): string {
  return popover('main-menu', 'menu-title',
    `<h2 id="menu-title" class="menu-brand ${appWorkspace["menu-brand"]} ">${icon('pen')} Plot-It</h2><div class="document-title ${appWorkspace["document-title"]} "><button class="document-name ${appWorkspace["document-name"]} " data-document-name title="Double-click or press F2 to rename the plot">${escapeUI(state.documentName)}</button>${button({ label: 'Rename plot', icon: 'text', iconOnly: true, variant: 'ghost', action: 'rename-document' })}</div><p class="saved ${appWorkspace["saved"]} ">Saved locally in this browser</p>` +
    `<div class="menu-actions ${appWorkspace["menu-actions"]} ">${[
      { label: 'Load', icon: 'load' as const, action: 'load-document' },
      { label: 'Save', icon: 'save' as const, action: 'save-document' },
      { label: 'Import SVG', icon: 'upload' as const, action: 'import' },
      { label: 'Export SVG', icon: 'download' as const, action: 'export', disabled: !state.items.length },
    ].map(options => button({ ...options, variant: 'ghost', attributes: { 'data-edit-control': '' } })).join('')}${install ? button({ label: 'Install app', action: 'install', variant: 'ghost' }) : ''}</div>` +
    `<label class="${dsField["field"]} settings-theme ${appField["settings-theme"]} ">Interface theme<select class="${dsSelect["select"]} theme-select ${appField["theme-select"]} " data-theme-select aria-label="Interface theme">${['system', 'light', 'dark'].map(value => `<option value="${value}" ${theme === value ? 'selected' : ''}>${value[0]!.toUpperCase() + value.slice(1)}</option>`).join('')}</select></label>` +
    `<div class="nudge-preferences ${appField["nudge-preferences"]} ">${(['nudgeMm', 'shiftNudgeMm'] as const).map(key => field(key === 'nudgeMm' ? 'Normal nudge' : 'Shift nudge', `<div class="unit-input ${dsInput["unit-input"]} "><input class="${dsInput["input"]}" type="number" min="0" step="any" data-nudge-preference="${key}" value="${preferences[key]}"><span>mm</span></div><span class="field-error ${dsField["field-error"]} " data-nudge-error="${key}" role="alert" hidden></span>`)).join('')}${button({ label: 'Reset nudge defaults', attributes: { 'data-reset-nudges': '' } })}</div>` +
    `<nav class="menu-links ${appWorkspace["menu-links"]} " aria-label="Project links">${hosted ? '<a href="/">Home</a>' : ''}<a href="${hosted ? '/docs/' : 'https://github.com/thierryc/Plot-It#readme'}">Docs</a><a href="https://github.com/thierryc/Plot-It/issues" target="_blank" rel="noopener">Support</a><a href="/plot-it-source.tar.gz" download>Source · AGPL-3.0</a>${hosted ? '<a href="https://ap.cx/">AP.CX</a>' : ''}</nav>`, `main-menu ${appOverlay['main-menu']}`);
}
