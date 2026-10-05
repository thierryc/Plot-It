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
  root.innerHTML = `<header class="top-actions"><div class="mode-switch" role="group" aria-label="Workspace mode"><button data-action="edit-mode" aria-pressed="true">Edit</button><button data-action="open-plot" aria-pressed="false">Plot</button></div><button data-action="undo">Undo</button><button data-action="redo">Redo</button></header>
    <main><aside class="tool-rail"></aside><button class="canvas-size-button"></button><svg id="paper"><g id="artwork-layer"></g></svg><aside class="inspector"><section data-editor>Editing controls</section></aside></main>`;
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
  it('marks a physical observation without issuing a pen test or starting a plot', () => {
    open(true); const mark = vi.spyOn(plotter,'markPenMovement');
    button('mark-pen-movement').click(); expect(mark).toHaveBeenCalledOnce();
    expect(plotter.setPen).not.toHaveBeenCalled(); expect(plotter.plot).not.toHaveBeenCalled();
    expect(root.textContent).toContain('Pen movement marked in the machine log.');
  });
  it('locks editing and selects Plot mode without starting hardware', async () => {
    open(true);
    expect(root.querySelector('[data-action="edit-mode"]')!.textContent).toContain('Edit');
    expect(root.querySelector('[data-action="edit-mode"]')!.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('[data-action="open-plot"]')!.getAttribute('aria-pressed')).toBe('true');
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
