// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { canvasInspectorMarkup } from './canvas-views';
import { editInspectorMarkup } from './shell';
import { workspaceHeader, workspaceControls } from './workspace';
import { initialState } from '../../model';
import { WorkspaceConnection } from '../../workspace-connection';
import { Plotter } from '../../plotter';

describe('Canvas and Edit inspector boundaries', () => {
  it('puts paper, plotter and connection in Canvas, keeping physical and preview models distinct', () => {
    const state = structuredClone(initialState), plotter = new Plotter();
    const connection = new WorkspaceConnection(plotter, () => state.settings, vi.fn());
    const host = document.createElement('aside');
    host.innerHTML = canvasInspectorMarkup(state, {paperOptions:()=>'<option>A4</option>'}, new Map(), connection);
    expect([...host.querySelectorAll('details[data-inspector-section] > summary')].map(node=>node.textContent)).toEqual(['Paper','Plotter','Connection']);
    expect([...host.querySelectorAll<HTMLDetailsElement>('details[data-inspector-section]')].every(node=>node.open)).toBe(true);
    expect(host.querySelector<HTMLDetailsElement>('[data-section="hardware"]')!.open).toBe(false);
    expect(host.querySelectorAll('[data-setting="machineRotation"]')).toHaveLength(1);
    expect(host.querySelector('[data-setting="axidrawModel"]')).not.toBeNull();
    expect(host.querySelector('[data-setting="axidrawHardwareModel"]')).not.toBeNull();
    expect(host.querySelector('[data-plot-destination]')).not.toBeNull();
    expect(host.querySelector('[data-plot-setting="speed"]')).toBeNull();
  });
  it('defaults the header to Edit with a ghost segment before the three workspace modes', () => {
    const host = document.createElement('div'); host.innerHTML = workspaceHeader()+workspaceControls(structuredClone(initialState),false,false);
    expect([...host.querySelectorAll('[role=radio]')].map(node=>node.textContent)).toEqual(['','Canvas','Edit','Plot']);
    expect(host.querySelector('[data-action="ghost-mode"]')!.getAttribute('aria-label')).toBe('Hide sidebar');
    expect(host.querySelector('[aria-checked="true"]')!.getAttribute('data-action')).toBe('edit-mode');
    expect(host.querySelectorAll('[role=radio][tabindex="0"]')).toHaveLength(1);
    const toolbar=host.querySelector('[data-ui="drawing-toolbar"]')!;
    expect(toolbar.querySelector('[data-workspace-mode-dock] [role=radiogroup]')).not.toBeNull();
    expect(toolbar.hasAttribute('data-edit-control')).toBe(false);
    expect(toolbar.querySelector('[data-drawing-tools]')!.hasAttribute('data-edit-control')).toBe(true);
    expect(host.querySelector('.top-actions [role=radiogroup]')).toBeNull();
  });
  it('keeps only Objects and Selection in Edit even when an object is selected', () => {
    const state = structuredClone(initialState); state.selectedId = 'selected';
    const host = document.createElement('aside');
    host.innerHTML = editInspectorMarkup({state,inspectorSections:new Map(),editor:{objectsMarkup:()=>'<summary>Objects</summary>',selectionPanelMarkup:()=>'<summary>Selection</summary>'} as Parameters<typeof editInspectorMarkup>[0]['editor']});
    expect([...host.querySelectorAll('details')].map(node=>node.dataset.inspectorSection)).toEqual(['objects','selection']);
    expect([...host.querySelectorAll('details')].every(node=>node.open)).toBe(true);
  });
});
