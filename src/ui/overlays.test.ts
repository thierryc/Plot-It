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
  it('keeps drawer content during its exit and cancels that exit for an immediate editor handoff', async()=>{
    const media=new EventTarget() as EventTarget & {matches:boolean};media.matches=true;
    vi.stubGlobal('matchMedia',(query:string)=>query.includes('prefers-reduced-motion')?{matches:false}:media);vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}});
    const root=document.createElement('div');document.body.append(root);
    root.innerHTML='<div data-inspector-dock><aside data-ui="inspector"><input value="kept"></aside></div><button data-inspector-trigger>Inspector</button><dialog data-inspector-host><div data-inspector-mode></div></dialog><textarea></textarea>';
    const drawer=root.querySelector('dialog')!,panel=root.querySelector('aside')!,settle:(()=>void)[]=[];
    drawer.animate=vi.fn(()=>{let resolve!:()=>void;const finished=new Promise<void>(done=>{resolve=done;});settle.push(resolve);return {finished,cancel:resolve} as unknown as Animation;});
    drawer.showModal=()=>drawer.setAttribute('open','');
    drawer.close=vi.fn(()=>{drawer.removeAttribute('open');drawer.dispatchEvent(new Event('close'));});
    const overlays=new WorkspaceOverlays(root);overlays.openInspector();overlays.closeInspector();
    expect(drawer.open).toBe(true);expect(drawer.contains(panel)).toBe(true);expect(drawer.inert).toBe(true);
    overlays.closeInspector(false);const input=root.querySelector('textarea')!;input.focus();
    settle.forEach(done=>done());await Promise.resolve();
    expect(drawer.close).toHaveBeenCalledOnce();expect(drawer.open).toBe(false);expect(document.activeElement).toBe(input);
    expect(root.querySelector('[data-inspector-dock] aside input')?.getAttribute('value')).toBe('kept');
    overlays.destroy();root.remove();vi.unstubAllGlobals();
  });
  it('hands focus to an editor without a delayed drawer close stealing it back', async () => {
    const media=new EventTarget() as EventTarget & {matches:boolean};media.matches=true;
    vi.stubGlobal('matchMedia',()=>media);vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}});
    const root=document.createElement('div');document.body.append(root);
    root.innerHTML='<div data-inspector-dock><aside data-ui="inspector"><button>Edit text</button></aside></div><button data-inspector-trigger>Inspector</button><dialog data-inspector-host><div data-inspector-mode></div></dialog><textarea aria-label="Canvas text"></textarea>';
    const drawer=root.querySelector('dialog')!;
    drawer.showModal=()=>drawer.setAttribute('open','');
    drawer.close=()=>{drawer.removeAttribute('open');queueMicrotask(()=>drawer.dispatchEvent(new Event('close')));};
    const overlays=new WorkspaceOverlays(root);overlays.openInspector();overlays.closeInspector(false);
    const input=root.querySelector('textarea')!;input.focus();await Promise.resolve();
    expect(document.activeElement).toBe(input);expect(overlays.inspectorOpen).toBe(false);
    expect(root.querySelector('[data-inspector-dock] aside')).not.toBeNull();
    overlays.destroy();root.remove();vi.unstubAllGlobals();
  });
  it('moves the same panel into the drawer, restores it, and releases listeners', () => {
    const media = new EventTarget() as EventTarget & { matches: boolean }; media.matches = true;
    vi.stubGlobal('matchMedia', () => media);
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect; });
    const root = document.createElement('div'); document.body.append(root);
    root.innerHTML = '<div data-workspace-mode-dock><div role="radiogroup" data-segmented aria-label="Workspace mode"><button role="radio" aria-checked="true">Edit</button><button role="radio" aria-checked="false">Plot</button></div></div><div data-inspector-dock><aside data-ui="inspector"><input value="kept"></aside></div><button data-inspector-trigger></button><dialog data-inspector-host><div data-inspector-mode></div><button data-close-inspector></button></dialog>';
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
    expect(root.querySelector('[data-workspace-mode-dock] [role="radiogroup"]')).toBe(modes);
    overlays.destroy(); expect(disconnect).toHaveBeenCalledOnce();
    root.remove(); vi.unstubAllGlobals();
  });
});
