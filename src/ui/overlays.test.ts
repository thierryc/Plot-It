// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { popoverPosition, WorkspaceOverlays } from './overlays';

describe('floating overlay placement', () => {
  it('opens below a toolbar trigger and clamps the right edge', () => {
    expect(popoverPosition({ left: 270, right: 310, top: 16, bottom: 56 }, { width: 300, height: 200 }, { width: 390, height: 844 })).toEqual({ left: 78, top: 64 });
  });
  it('flips above a low trigger and keeps a tall menu inside the viewport', () => {
    expect(popoverPosition({ left: 16, right: 56, top: 700, bottom: 744 }, { width: 300, height: 250 }, { width: 390, height: 844 }).top).toBe(442);
    expect(popoverPosition({ left: 0, right: 40, top: 16, bottom: 56 }, { width: 300, height: 800 }, { width: 320, height: 600 })).toEqual({ left: 12, top: 12 });
  });
});

describe('responsive inspector lifecycle', () => {
  it('moves the same panel into the drawer, restores it, and releases listeners', () => {
    const media = new EventTarget() as EventTarget & { matches: boolean }; media.matches = true;
    vi.stubGlobal('matchMedia', () => media);
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect; });
    const root = document.createElement('div'); document.body.append(root);
    root.innerHTML = '<div class="top-actions"><div role="radiogroup" data-segmented aria-label="Workspace mode"><button role="radio" aria-checked="true">Edit</button><button role="radio" aria-checked="false">Plot</button></div></div><div data-inspector-dock><aside data-ui="inspector"><input value="kept"></aside></div><button data-inspector-trigger></button><dialog data-inspector-host><div data-inspector-mode></div><button data-close-inspector></button></dialog>';
    const drawer = root.querySelector<HTMLDialogElement>('dialog')!, panel = root.querySelector('aside')!;
    drawer.showModal = () => drawer.setAttribute('open', '');
    drawer.close = () => { drawer.removeAttribute('open'); drawer.dispatchEvent(new Event('close')); };
    const modes=root.querySelector('[role="radiogroup"]')!;
    const overlays = new WorkspaceOverlays(root);
    overlays.openInspector();
    expect(drawer.contains(panel)).toBe(true);
    expect(drawer.querySelector('[data-inspector-mode]')!.contains(modes)).toBe(true);
    expect(overlays.inspectorOpen).toBe(true);
    expect(root.querySelector('[data-inspector-trigger]')?.getAttribute('aria-expanded')).toBe('true');
    media.matches = false; media.dispatchEvent(new Event('change'));
    expect(overlays.inspectorOpen).toBe(false);
    expect(root.querySelector('[data-inspector-dock]')?.firstElementChild).toBe(panel);
    expect(panel.querySelector('input')?.value).toBe('kept');
    expect(root.querySelector('.top-actions [role="radiogroup"]')).toBe(modes);
    overlays.destroy(); expect(disconnect).toHaveBeenCalledOnce();
    root.remove(); vi.unstubAllGlobals();
  });
});
