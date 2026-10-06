// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlotWorkspace } from './plot-workspace';
import { Plotter } from './plotter';
import { NetworkPlotter } from './network-plotter';
import { buildMotionPlan, type MotionPlan } from './motion-plan';
import { initialState, type AppState } from './model';
import { defaultPens } from './pens';
import type { TaskProgress } from './task-progress';
const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock('./plot-job', () => ({ prepareJob: mocks.prepare }));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const plan = (colors = ['#000000']): MotionPlan => ({
  ...buildMotionPlan(colors.map((tool, index) => ({ tool, points: [{ x: 15 + index * 10, y: 15 }, { x: 20 + index * 10, y: 15 }] })), initialState.settings),
  pens: [...new Set(colors)].map(color => ({ color, name: '', sources: [color], included: true }))
});
let root: HTMLDivElement, workspace: PlotWorkspace, plotter: Plotter, state: AppState;
let jobs: (ReturnType<typeof deferred<MotionPlan>> & { cancel: ReturnType<typeof vi.fn>; progress?: (task: TaskProgress) => void })[];
let save: ReturnType<typeof vi.fn>, exit: ReturnType<typeof vi.fn>, frame: FrameRequestCallback;
const button = (action: string) => root.querySelector<HTMLButtonElement>(`[data-plot-action="${action}"]`)!;
const status = () => root.querySelector<HTMLElement>('[data-player-status]')!.textContent;
async function flush() { await Promise.resolve(); await Promise.resolve(); }
function open(connected = false) {
  plotter = new Plotter();
  vi.spyOn(plotter, 'connected', 'get').mockReturnValue(connected);
  vi.spyOn(plotter, 'supported', 'get').mockReturnValue(true);
  vi.spyOn(plotter, 'plot').mockResolvedValue(undefined);
  vi.spyOn(plotter, 'setPen').mockResolvedValue(undefined);
  vi.spyOn(plotter, 'connect').mockRejectedValue(new Error('Unexpected hardware access'));
  workspace = new PlotWorkspace(root, plotter, state, save, exit);
  return workspace;
}
beforeEach(() => {
  jobs = []; save = vi.fn(); exit = vi.fn(); state = structuredClone(initialState); state.pens = defaultPens();
  root = document.createElement('div'); document.body.append(root);
  root.innerHTML = `<header class="top-actions"><div class="mode-switch" role="radiogroup" aria-label="Workspace mode" data-segmented><button data-action="edit-mode" role="radio" aria-checked="true" tabindex="0">Edit</button><button data-action="open-plot" role="radio" aria-checked="false" tabindex="-1">Plot</button></div><button data-action="undo" data-edit-control>Undo</button><button data-action="redo" data-edit-control>Redo</button></header>
    <main><div data-ui="drawing-toolbar" data-edit-control></div><button class="canvas-size-button" data-edit-control></button><svg id="paper"><g id="artwork-layer"></g></svg><aside class="inspector" data-ui="inspector"><section data-editor>Editing controls</section></aside></main>`;
  mocks.prepare.mockImplementation((_svg, _paper, _settings, progress) => {
    const pending = deferred<MotionPlan>();
    const job = { ...pending, progress, cancel: vi.fn(() => pending.reject(new Error('Planning cancelled.'))) };
    jobs.push(job); return job;
  });
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/["\\]/g, '\\$&') });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(async () => { workspace?.destroy(); await flush(); root.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); mocks.prepare.mockReset(); });

describe('Plot sidebar preparation and recovery', () => {
  it('persists optimization controls, replans, and gates random seed entry by start mode',async()=>{
    open(); jobs[0]!.resolve(plan()); await flush();
    const input=(key:string)=>root.querySelector<HTMLInputElement>(`[data-plot-setting="${key}"]`)!;
    expect(input('pathRandomSeed').disabled).toBe(true);
    for (const [key,value] of [['pathJoinToleranceMm','.15'],['pathSimplifyToleranceMm','.02']]) {
      const field=input(key!); field.value=value!; field.dispatchEvent(new Event('change',{bubbles:true}));
      expect(state.settings[key as keyof typeof state.settings]).toBe(Number(value));
      jobs.at(-1)!.resolve(plan()); await flush();
    }
    const select=root.querySelector<HTMLSelectElement>('[data-plot-setting="closedPathStart"]')!;
    select.value='random'; select.dispatchEvent(new Event('change',{bubbles:true})); jobs.at(-1)!.resolve(plan()); await flush();
    expect(state.settings.closedPathStart).toBe('random'); expect(input('pathRandomSeed').disabled).toBe(false);
    const seed=input('pathRandomSeed'); seed.value='42'; seed.dispatchEvent(new Event('change',{bubbles:true})); jobs.at(-1)!.resolve(plan()); await flush();
    expect(state.settings.pathRandomSeed).toBe(42);
    expect(mocks.prepare).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),expect.objectContaining({pathJoinToleranceMm:.15,pathSimplifyToleranceMm:.02,closedPathStart:'random',pathRandomSeed:42}),expect.anything(),expect.anything());
    const invalid=input('pathRandomSeed'); invalid.value='1.5'; invalid.dispatchEvent(new Event('change',{bubbles:true}));
    expect(state.settings.pathRandomSeed).toBe(42); expect(root.textContent).toContain('Enter a valid value');
    expect(save).toHaveBeenCalled(); expect(plotter.plot).not.toHaveBeenCalled();
  });
  it('shows the simulation counter outside the paper and resets it on Stop', async () => {
    open(); const prepared = plan(); jobs[0]!.resolve(prepared); await flush();
    const signals: unknown[] = [];
    root.querySelector('#paper')!.addEventListener('plot-execution-signal', event => signals.push((event as CustomEvent).detail));
    button('choose-simulation').click(); frame(0); frame(100000);
    const counter = root.querySelector<HTMLElement>('[data-plot-pen-counter]')!;
    expect(counter.hidden).toBe(false); expect(counter.closest('svg')).toBeNull();
    expect(counter.querySelector('[data-pen-down-count]')!.textContent).toBe('1');
    expect(counter.querySelector('[data-pen-up-count]')!.textContent).toBe('2');
    expect(signals.length).toBeGreaterThan(0);
    button('start').click(); button('stop').click();
    expect(counter.querySelector('[data-pen-down-count]')!.textContent).toBe('0');
    workspace.destroy(); expect(root.querySelector('[data-plot-pen-counter]')).toBeNull();
  });
  it('updates the device label after connecting server USB and explains local USB ownership', async () => {
    vi.stubGlobal('location', { hostname: '127.0.0.1' });
    const remote = new NetworkPlotter({ epoch: 'runner', revision: 1, timestamp: 1, connected: false, connecting: false, firmware: null, jobId: null, status: 'idle', progress: { completed: 0, total: 0, state: 'idle' }, position: null, positionTimestamp: null, origin: 'unset', originProfile: null, motorsOn: false, canAdjustPen: false });
    let connected = false, controlling = false;
    vi.spyOn(NetworkPlotter, 'discover').mockResolvedValue(remote);
    vi.spyOn(remote, 'watch').mockResolvedValue(); vi.spyOn(remote, 'disconnect').mockResolvedValue();
    vi.spyOn(remote, 'connected', 'get').mockImplementation(() => connected);
    vi.spyOn(remote, 'firmwareLabel', 'get').mockImplementation(() => connected ? '2.8.1' : null);
    vi.spyOn(remote, 'hasControl', 'get').mockImplementation(() => controlling); remote.networkConnected = true;
    vi.spyOn(remote, 'connect').mockImplementation(async () => { controlling = true; return 'Network plotter · EBB not connected'; });
    vi.spyOn(remote, 'connectEbb').mockImplementation(async () => { connected = true; remote.onConnectionChange(); });
    open(); jobs[0]!.resolve(plan()); await flush(); await flush();
    let select = root.querySelector<HTMLSelectElement>('[data-plot-destination]')!;
    select.value = 'network'; select.dispatchEvent(new Event('change', { bubbles: true })); jobs.at(-1)!.resolve(plan()); await flush();
    button('connect').click(); await flush();
    button('connect-ebb').click(); await flush();
    expect(root.textContent).not.toContain('EBB not connected');
    select = root.querySelector<HTMLSelectElement>('[data-plot-destination]')!;
    select.value = 'machine'; select.dispatchEvent(new Event('change', { bubbles: true })); jobs.at(-1)!.resolve(plan()); await flush();
    expect(button('connect').disabled).toBe(true);
    expect(button('release-server-usb').textContent).toBe('Release server USB');
    expect(root.textContent).toContain('The local Node server owns the EBB');
    expect(plotter.connect).not.toHaveBeenCalled();
  });
  it('offers the Node server destination and gates machine controls behind explicit ownership', async () => {
    const remote = new NetworkPlotter({ epoch: 'runner', revision: 1, timestamp: 1, connected: true, connecting: false, firmware: '2.8.1', jobId: null, status: 'idle', progress: { completed: 0, total: 0, state: 'idle' }, position: null, positionTimestamp: null, origin: 'unset', originProfile: null, motorsOn: false, canAdjustPen: true });
    vi.spyOn(NetworkPlotter, 'discover').mockResolvedValue(remote);
    vi.spyOn(remote, 'watch').mockResolvedValue(); vi.spyOn(remote, 'disconnect').mockResolvedValue();
    vi.spyOn(remote, 'connected', 'get').mockReturnValue(true);
    remote.networkConnected = true;
    let controlling = false;
    vi.spyOn(remote, 'hasControl', 'get').mockImplementation(() => controlling);
    vi.spyOn(remote, 'canAdjustPen', 'get').mockImplementation(() => controlling);
    const connect = vi.spyOn(remote, 'connect').mockImplementation(async () => { controlling = true; return 'Network EBB'; });
    const origin = vi.spyOn(remote, 'setOrigin').mockResolvedValue();
    const releaseUsb = vi.spyOn(remote, 'disconnectEbb').mockResolvedValue();
    const releaseControl = vi.spyOn(remote, 'releaseControl').mockImplementation(async () => { controlling = false; });
    open(); jobs[0]!.resolve(plan()); await flush(); await flush();
    const select = root.querySelector<HTMLSelectElement>('[data-plot-destination]')!;
    expect(select.textContent).toContain('Network plotter');
    expect(select.textContent).toContain('Node server');
    select.value = 'network'; select.dispatchEvent(new Event('change', { bubbles: true }));
    jobs.at(-1)!.resolve(plan()); await flush();
    expect(button('start').disabled).toBe(true); expect(button('connect').textContent).toContain('Take control');
    expect(root.textContent).toContain('Server connected · EBB 2.8.1');
    expect(button('set-origin').disabled).toBe(true); expect(button('pen-up').disabled).toBe(true);
    button('connect').click(); await flush(); expect(connect).toHaveBeenCalledOnce();
    expect(button('set-origin').disabled).toBe(false); expect(button('pen-up').disabled).toBe(false);
    button('set-origin').click(); await flush(); expect(origin).toHaveBeenCalledWith('axidraw');
    expect(button('disconnect-ebb').textContent).toContain('Disconnect EBB');
    button('disconnect-ebb').click(); await flush(); expect(releaseUsb).toHaveBeenCalledWith(expect.objectContaining({ penUp: state.settings.penUp }));
    button('release-control').click(); await flush(); expect(releaseControl).toHaveBeenCalledOnce();
    expect(remote.disconnect).not.toHaveBeenCalled();
    expect(plotter.plot).not.toHaveBeenCalled();
  });
  it('keeps edited pen heights in the machine configuration before testing or disconnecting', async () => {
    open(true); jobs[0]!.resolve(plan()); await flush();
    const configure = vi.spyOn(plotter,'configurePen');
    const input = root.querySelector<HTMLInputElement>('[data-plot-setting="penUp"]')!;
    input.value = '30'; input.dispatchEvent(new Event('change',{bubbles:true}));
    expect(configure).toHaveBeenCalledWith(expect.objectContaining({penUp:30}));
    button('pen-up').click(); await flush(); expect(plotter.setPen).toHaveBeenCalledWith(30);
    expect(plotter.plot).not.toHaveBeenCalled();
  });
  it.each(['penUp', 'penDown', 'speed'] as const)('keeps %s keyboard edits focused and the sidebar in place while updating the plan', async key => {
    open(true); jobs[0]!.resolve(plan()); await flush();
    const scroll = root.querySelector<HTMLElement>('.plot-scroll')!;
    const heights = root.querySelector<HTMLDetailsElement>('[data-section="heights"]')!;
    heights.open = true;
    scroll.scrollTop = 327;
    const input = root.querySelector<HTMLInputElement>(`[data-plot-setting="${key}"]`)!;
    input.focus(); input.value = '31'; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(jobs).toHaveLength(1); // Typing validates without replacing the field.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(jobs).toHaveLength(2);
    expect(root.querySelector('.plot-scroll')).toBe(scroll);
    expect(document.activeElement).toBe(input);
    expect(scroll.scrollTop).toBe(327);
    expect(button('start').disabled).toBe(true);
    expect(root.querySelector<HTMLInputElement>('[data-pen-include]')!.disabled).toBe(true);
    expect(button('only').disabled).toBe(true);
    expect(plotter.plot).not.toHaveBeenCalled();
    const updated = plan(); updated.settings = { ...updated.settings, [key]: 31 };
    jobs[1]!.resolve(updated); await flush();
    expect(root.querySelector(`[data-plot-setting="${key}"]`)).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('31');
    expect(root.querySelector<HTMLElement>('.plot-scroll')!.scrollTop).toBe(327);
    expect(root.querySelector<HTMLDetailsElement>('[data-section="heights"]')!.open).toBe(true);
    // A subsequent spinner/arrow edit commits through the same surviving field.
    input.value = '32'; input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(state.settings[key]).toBe(32); expect(jobs).toHaveLength(3);
    jobs[2]!.resolve(plan()); await flush();
  });
  it('preserves a newer unfinished keyboard value when preparation finishes', async () => {
    open(true); jobs[0]!.resolve(plan()); await flush();
    root.querySelector<HTMLDetailsElement>('[data-section="heights"]')!.open = true;
    const input = root.querySelector<HTMLInputElement>('[data-plot-setting="penDown"]')!;
    input.focus(); input.value = '52';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
    const updated = plan(); updated.settings.penDown = 52;
    jobs[1]!.resolve(updated); await flush();
    expect(document.activeElement).toBe(input); expect(input.value).toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(button('start').disabled).toBe(true);
    expect(state.settings.penDown).toBe(52); expect(plotter.setPen).not.toHaveBeenCalled();
  });
  it('explains resolution-filtered artwork separately from deselected pens', async () => {
    open(true); jobs[0]!.resolve({...plan(),events:[],duration:0,passes:[]}); await flush();
    expect(root.textContent).toContain('No drawing paths remain at the machine’s resolution.');
    expect(root.textContent).not.toContain('Select at least one pen'); expect(button('start').disabled).toBe(true);
  });
  it('downloads a diagnostic log without starting or moving hardware', () => {
    vi.useFakeTimers(); open(true);
    const create = vi.fn(() => 'blob:machine-log'), revoke = vi.fn();
    Object.defineProperty(URL,'createObjectURL',{value:create,configurable:true});
    Object.defineProperty(URL,'revokeObjectURL',{value:revoke,configurable:true});
    const click = vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this: HTMLAnchorElement) {
      expect(this.download).toBe('plot-it-machine-log.json'); expect(this.href).toBe('blob:machine-log');
    });
    button('machine-log').click(); expect(create).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce();
    expect((create.mock.calls[0] as unknown as Blob[])[0]!.type).toBe('application/json');
    expect(plotter.setPen).not.toHaveBeenCalled(); expect(plotter.plot).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000); expect(revoke).toHaveBeenCalledWith('blob:machine-log'); vi.useRealTimers();
    delete (URL as unknown as Record<string,unknown>).createObjectURL; delete (URL as unknown as Record<string,unknown>).revokeObjectURL;
  });
  it('locks editing and selects Plot mode without starting hardware', async () => {
    open(true);
    const sections = root.querySelectorAll('.plot-scroll > section');
    expect(sections[0]!.querySelector('[data-plot-destination]')).not.toBeNull();
    expect(sections[1]!.classList.contains('plot-settings-section')).toBe(true);
    expect(sections[2]!.classList.contains('plot-pens-section')).toBe(true);
    expect(root.querySelector('[data-action="edit-mode"]')!.textContent).toContain('Edit');
    expect(root.querySelector('[data-action="edit-mode"]')!.getAttribute('aria-checked')).toBe('false');
    expect(root.querySelector('[data-action="open-plot"]')!.getAttribute('aria-checked')).toBe('true');
    expect((root.querySelector('[data-action="redo"]') as HTMLElement).inert).toBe(true);
    expect(button('start').disabled).toBe(true);
    jobs[0]!.resolve(plan()); await flush();
    expect(status()).toBe('Ready to plot'); expect(button('start').disabled).toBe(false);
    expect(button('start').textContent).toContain('Start with this pen');
    expect(plotter.plot).not.toHaveBeenCalled(); expect(plotter.connect).not.toHaveBeenCalled();
    workspace.destroy(); expect(root.querySelector('[data-editor]')).not.toBeNull(); expect(exit).toHaveBeenCalledOnce();
  });
  it('shows preparation failures without claiming that artwork is empty, and retries successfully', async () => {
    open(true); jobs[0]!.reject(new Error('Motion planning failed: worker module unavailable')); await flush();
    expect(status()).toBe('Plot needs attention'); expect(root.textContent).toContain('worker module unavailable');
    expect(root.textContent).not.toContain('Add artwork to plot'); expect(button('retry').hidden).toBe(false);
    expect(button('start').disabled).toBe(true); expect(plotter.plot).not.toHaveBeenCalled();
    button('retry').click(); expect(jobs).toHaveLength(2);
    jobs[1]!.resolve(plan()); await flush();
    expect(status()).toBe('Ready to plot'); expect(root.textContent).not.toContain('worker module unavailable');
    expect(button('start').disabled).toBe(false); expect(save).toHaveBeenCalledOnce();
  });
  it('discards the previous plan during re-preparation and prevents starting stale geometry', async () => {
    open(true); jobs[0]!.resolve(plan()); await flush();
    button('all').click();
    expect(button('start').disabled).toBe(true); expect(root.querySelectorAll('.simulation-overlay')).toHaveLength(0);
    expect(root.querySelector('[data-pass-summary]')!.textContent).toBe('0 pens · 0 passes');
    jobs[1]!.reject(new Error('Invalid settings')); await flush();
    expect(button('start').disabled).toBe(true); expect(root.querySelectorAll('.simulation-overlay')).toHaveLength(0);
  });
  it('ignores obsolete progress and plans when settings change twice', async () => {
    open(true);
    const changeSpeed = (value: string) => {
      const input = root.querySelector<HTMLInputElement>('[data-plot-setting="speed"]')!;
      input.value = value; input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    changeSpeed('25'); changeSpeed('30'); expect(jobs).toHaveLength(3);
    expect(jobs[0]!.cancel).toHaveBeenCalledOnce(); expect(jobs[1]!.cancel).toHaveBeenCalledOnce();
    jobs[0]!.progress?.({ label: 'Obsolete result' });
    jobs[2]!.resolve(plan(['#FF0000'])); await flush();
    expect(root.textContent).not.toContain('Obsolete result'); expect(root.querySelector('[data-player-pen]')!.textContent).toBe('Load #FF0000');
    expect(root.querySelectorAll('.simulation-overlay')).toHaveLength(1);
  });
  it('cancels inline and enables re-preparation without accessing the plotter', async () => {
    open(true); button('cancel-plan').click(); await flush();
    expect(jobs[0]!.cancel).toHaveBeenCalledOnce(); expect(root.textContent).toContain('Preview preparation cancelled.');
    expect(button('start').disabled).toBe(true); expect(plotter.plot).not.toHaveBeenCalled();
    button('retry').click(); jobs[1]!.resolve(plan()); await flush(); expect(button('start').disabled).toBe(false);
  });
  it('exiting during preparation cancels work and prevents late changes to the editor', async () => {
    open(); workspace.destroy(); await flush(); jobs[0]!.progress?.({ label: 'Late progress' });
    expect(jobs[0]!.cancel).toHaveBeenCalledOnce(); expect(root.querySelector('[data-editor]')).not.toBeNull();
    expect(root.querySelector('.simulation-overlay')).toBeNull(); expect(root.textContent).not.toContain('Late progress');
    expect(save).not.toHaveBeenCalled(); expect(exit).toHaveBeenCalledOnce();
  });
  it('distinguishes successful empty plans from planner failures', async () => {
    open(true); jobs[0]!.resolve(plan([])); await flush();
    expect(root.textContent).toContain('Add artwork to plot.'); expect(status()).toBe('Ready to plot');
    expect(button('start').disabled).toBe(true); expect(button('retry').hidden).toBe(true);
    expect(root.querySelector('[data-player-error]')!.hasAttribute('hidden')).toBe(true);
  });
  it('explains an excluded pen subset without calling it empty artwork', async () => {
    open(true); const excluded = plan([]);
    excluded.pens = [{ color: '#000000', name: '', sources: ['#000000'], included: false }];
    jobs[0]!.resolve(excluded); await flush();
    expect(root.textContent).toContain('Select at least one pen to plot.'); expect(root.textContent).not.toContain('Add artwork to plot.');
    expect(button('start').disabled).toBe(true);
  });
  it('keeps Edit disabled during manual motion and reports failed motion without a success message', async () => {
    open(true); jobs[0]!.resolve(plan()); await flush();
    const command = deferred<void>(); vi.mocked(plotter.setPen).mockReturnValue(command.promise);
    button('pen-up').click(); expect((root.querySelector('[data-action="edit-mode"]') as HTMLButtonElement).disabled).toBe(true);
    workspace.destroy(); expect(exit).not.toHaveBeenCalled();
    command.reject(new Error('Transport failed')); await flush();
    expect(root.textContent).toContain('Transport failed'); expect(root.textContent).not.toContain('Machine command complete');
    expect((root.querySelector('[data-action="edit-mode"]') as HTMLButtonElement).disabled).toBe(false);
  });
  it('simulation requires Continue for each pen change and never calls hardware', async () => {
    open(); jobs[0]!.resolve(plan(['#000000', '#FF0000', '#000000'])); await flush();
    button('choose-simulation').click(); frame(0); frame(100000);
    expect(button('pause').textContent).toContain('Continue with this pen'); expect(status()).toContain('pass 2 of 3');
    expect(root.querySelector<HTMLInputElement>('[data-pen-hex]')!.disabled).toBe(true);
    frame(200000); expect(status()).toContain('pass 2 of 3');
    button('pause').click(); frame(300000); frame(400000); expect(status()).toContain('pass 3 of 3');
    button('stop').click(); expect(status()).toBe('Stopped · simulation reset');
    expect(root.querySelector('.simulation-marker')!.getAttribute('transform')).toBe('translate(0 0)');
    expect(plotter.plot).not.toHaveBeenCalled(); expect(plotter.connect).not.toHaveBeenCalled(); expect(plotter.setPen).not.toHaveBeenCalled();
  });
  it('keeps USB picker cancellation quiet and permits a later connection attempt', async () => {
    open(); jobs[0]!.resolve(plan()); await flush();
    vi.mocked(plotter.connect).mockRejectedValue(new DOMException('User cancelled', 'NotFoundError'));
    button('connect').click(); await flush();
    expect(root.querySelector('[data-player-error]')!.hasAttribute('hidden')).toBe(true);
    expect(root.textContent).not.toContain('User cancelled'); expect(button('connect').disabled).toBe(false);
    expect(plotter.plot).not.toHaveBeenCalled();
  });
  it('surfaces a failed connection inline and retries without starting hardware', async () => {
    open(); jobs[0]!.resolve(plan()); await flush();
    vi.mocked(plotter.connect).mockRejectedValue(new Error('Serial port already open'));
    button('connect').click(); await flush();
    expect(root.textContent).toContain('Serial port already open'); expect(button('connect').textContent).toBe('Retry connection');
    vi.mocked(plotter.connect).mockImplementation(async () => { vi.spyOn(plotter, 'connected', 'get').mockReturnValue(true); return 'EBB'; });
    button('connect').click(); await flush();
    expect(root.textContent).not.toContain('Serial port already open'); expect(button('start').disabled).toBe(false);
    expect(plotter.plot).not.toHaveBeenCalled();
  });
  it('requires explicit Start and blocks Edit until failed hardware cleanup settles', async () => {
    open(true); jobs[0]!.resolve(plan()); await flush();
    const execution = deferred<void>(); vi.mocked(plotter.plot).mockReturnValue(execution.promise);
    expect(plotter.plot).not.toHaveBeenCalled(); button('start').click();
    expect(plotter.plot).toHaveBeenCalledOnce(); expect((root.querySelector('[data-action="edit-mode"]') as HTMLButtonElement).disabled).toBe(true);
    plotter.onProgress({ completed: 0, total: plan().events.length, state: 'returning' });
    workspace.destroy(); expect(exit).not.toHaveBeenCalled();
    execution.reject(new Error('Return to origin failed')); await flush();
    expect(status()).toBe('Plot needs attention'); expect(root.textContent).toContain('Return to origin failed');
    expect(root.textContent).not.toContain('Stopped · returned to origin');
    expect((root.querySelector('[data-action="edit-mode"]') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('pen timing, statistics, supply and placement controls',()=>{
  it('persists independent pen timing in simulation and replans before playback',async()=>{
    open(); jobs[0]!.resolve(plan()); await flush();
    for(const [key,value] of [['penRateRaise','20'],['penRateLower','30'],['penDelayUpMs','500'],['penDelayDownMs','200'],['penReloadWaitMs','1000']]){
      const input=root.querySelector<HTMLInputElement>(`[data-plot-setting="${key}"]`)!;
      expect(input.disabled).toBe(false); input.value=value!; input.dispatchEvent(new Event('change',{bubbles:true}));
      expect(state.settings[key as keyof typeof state.settings]).toBe(Number(value)); jobs.at(-1)!.resolve(plan()); await flush();
    }
    expect(save).toHaveBeenCalled(); expect(plotter.setPen).not.toHaveBeenCalled();
    expect(root.querySelector('[data-plot-distances]')!.textContent).toMatch(/Drawing 5.0 mm · Travel/);
  });
  it('simulates the placement bounds and follows with the original drawing on Play',async()=>{
    open(); const original=plan(); jobs[0]!.resolve(original); await flush();
    const signals: Array<{penDown:boolean;source:string}> = [];
    root.querySelector('#paper')!.addEventListener('plot-execution-signal',event=>signals.push((event as CustomEvent).detail));
    button('bounds-preview').click(); frame(0); frame(100000);
    expect(signals.every(s=>!s.penDown)).toBe(true); expect(status()).toContain('Bounding box · Complete');
    expect(root.querySelector('[data-plot-distances]')!.textContent).toContain('Drawing 0.0 mm');
    expect(root.querySelector('[data-plot-elapsed]')!.textContent).toContain('Simulation time');
    button('start').click(); frame(100001); frame(200000);
    expect(signals.some(s=>s.penDown)).toBe(true); expect(status()).toBe('Complete'); expect(plotter.plot).not.toHaveBeenCalled();
  });
  it('runs bounds explicitly over USB, keeps the drawing available, and shows power/elapsed',async()=>{
    open(true); const original=plan(); jobs[0]!.resolve(original); await flush();
    vi.spyOn(plotter,'powerStatus','get').mockReturnValue({state:'low',supplyRaw:12,referenceRaw:394,checkedAt:1,message:'Motor supply is low or missing.'});
    vi.spyOn(plotter,'elapsedMs','get').mockReturnValue(72000);
    vi.mocked(plotter.plot).mockImplementation(async sent=>{plotter.onProgress({completed:sent.events.length,total:sent.events.length,state:'finished'});});
    button('bounds-preview').click(); await flush(); await flush();
    expect(plotter.plot).toHaveBeenCalledWith(expect.objectContaining({events:expect.arrayContaining([expect.objectContaining({kind:'xy',penDown:false})])}));
    const sent=vi.mocked(plotter.plot).mock.calls[0]![0]; expect(sent.events.every(e=>!e.penDown)).toBe(true);
    expect(root.querySelector('[data-power-status]')!.textContent).toContain('Supply ADC 12/1023');
    expect(root.querySelector('[data-plot-elapsed]')!.textContent).toContain('Elapsed 1:12');
    button('start').click(); await flush(); expect(vi.mocked(plotter.plot).mock.calls.at(-1)![0]).toEqual(original);
  });
});
