// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectionMarkup } from './ui/app/plot-views';
import { PlotWorkspace } from './plot-workspace';
import { Plotter } from './plotter';
import { NetworkPlotter } from './network-plotter';
import { buildMotionPlan, motionPlanFromProgram, type MotionPlan } from './motion-plan';
import { initialState, type AppState } from './model';
import { defaultPens } from './pens';
import { checkpointAt, resumeAtDistance } from '@thierryc/plotter-core';
import type { TaskProgress } from './task-progress';
import { eventSignal, indexPenCounts } from './plot-signals';
const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock('./plot-job', () => ({ prepareJob: mocks.prepare }));
vi.mock('./machine-log-export', () => ({machineLogBlob: vi.fn(async () => new Blob(['{}'], {type:'application/json'}))}));
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
function canvasConnection() {
  let host = root.querySelector<HTMLElement>('[data-canvas-connection]');
  if (!host) { host = document.createElement('div'); host.setAttribute('data-canvas-connection',''); root.append(host); }
  const connection = workspace.connection;
  const render = () => {
    host!.innerHTML = connectionMarkup({connectionTarget:connection.target,plotter:connection.plotter,network:connection.network,localPlotter:connection.localPlotter,settings:state.settings,locked:connection.locked,manualBusy:connection.busy,busy:connection.busy,serverOwnsLocalUsb:connection.serverOwnsLocalUsb});
    host!.querySelector('select')!.addEventListener('change', event => connection.select((event.target as HTMLSelectElement).value));
    host!.querySelectorAll<HTMLButtonElement>('[data-plot-action]').forEach(button => button.addEventListener('click', () => { void connection.run(button.dataset.plotAction!); }));
  };
  connection.subscribe(render); render();
}
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
  root.innerHTML = `<header class="top-actions"><div class="mode-switch" role="radiogroup" aria-label="Workspace mode" data-segmented><button data-action="canvas-mode" role="radio" aria-checked="false" tabindex="-1">Canvas</button><button data-action="edit-mode" role="radio" aria-checked="true" tabindex="0">Edit</button><button data-action="open-plot" role="radio" aria-checked="false" tabindex="-1">Plot</button></div><button data-action="undo" data-edit-control>Undo</button><button data-action="redo" data-edit-control>Redo</button></header>
    <footer data-ui="status"><span data-connection-status>Web Serial ready</span><span>1 object</span></footer><main><div data-ui="drawing-toolbar" data-edit-control></div><button class="canvas-size-button" data-edit-control></button><svg id="paper"><g id="artwork-layer"></g></svg><aside class="inspector" data-ui="inspector"><section data-editor>Editing controls</section></aside></main>`;
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
  it('adds the completed distance to the prepared resume offset', async () => {
    state.settings.startAtMm = 100;
    const full = buildMotionPlan([{tool:'#000000',points:[{x:15,y:15},{x:215,y:15}]}], state.settings);
    const prepared = { ...motionPlanFromProgram(resumeAtDistance(full.executable!, 100), state.settings), pens:plan().pens };
    const record = prepared.executable!.records.findIndex(record => record.kind === 'motor' && record.penDown);
    const checkpoint = checkpointAt(prepared.executable!, record);
    open(); jobs[0]!.resolve(prepared); await flush();
    vi.spyOn(plotter, 'completedCheckpoint', 'get').mockReturnValue(checkpoint);
    // Only the prepared plan's offset belongs to the matched executable.
    state.settings.startAtMm = 900;
    button('resume-checkpoint').click();
    expect(state.settings.startAtMm).toBe(100 + checkpoint.drawingMm);
    expect(mocks.prepare.mock.calls.at(-1)![2].startAtMm).toBe(100 + checkpoint.drawingMm);
  });
  it('clears a layer validation error after correcting the layer value', async () => {
    const prepared = { ...plan(), layers: [{id:'layer', name:'Layer', paths:[]}] };
    open(true); jobs[0]!.resolve(prepared); await flush();
    const speed = root.querySelector<HTMLInputElement>('[data-layer-setting="speedPercent"]')!;
    speed.value = '200'; speed.dispatchEvent(new Event('change', {bubbles:true}));
    expect(button('start').disabled).toBe(true);
    expect(root.textContent).toContain('Enter a valid layer setting.');
    speed.value = '50'; speed.dispatchEvent(new Event('change', {bubbles:true}));
    jobs.at(-1)!.resolve(prepared); await flush();
    expect(state.settings.layerOverrides?.layer?.speedPercent).toBe(50);
    expect(root.textContent).not.toContain('Enter a valid layer setting.');
    expect(button('start').disabled).toBe(false);
    expect(button('choose-simulation').disabled).toBe(false);
  });
  it('uses the current network checkpoint without downloading diagnostics and rejects mismatched drawings', async () => {
    const prepared = plan();
    const record = prepared.executable!.records.findIndex(record => record.kind === 'motor' && record.penDown);
    const checkpoint = checkpointAt(prepared.executable!, record);
    const remote = new NetworkPlotter({epoch:'runner',revision:1,timestamp:1,connected:false,connecting:false,firmware:null,jobId:null,status:'idle',progress:{completed:0,total:0,state:'idle'},position:null,positionTimestamp:null,origin:'unset',originProfile:null,motorsOn:false,canAdjustPen:false,checkpoint});
    vi.spyOn(NetworkPlotter, 'discover').mockResolvedValue(remote);
    vi.spyOn(remote, 'watch').mockResolvedValue(); vi.spyOn(remote, 'disconnect').mockResolvedValue();
    const diagnostics = vi.spyOn(remote, 'diagnosticJobTrace', 'get');
    open(); jobs[0]!.resolve(prepared); await flush(); await flush();
    workspace.connection.select('network');
    expect(remote.diagnosticJobTrace).toBeNull(); diagnostics.mockClear();
    button('resume-checkpoint').click();
    expect(state.settings.startAtMm).toBe(checkpoint.drawingMm);
    expect(diagnostics).not.toHaveBeenCalled();
    jobs.at(-1)!.resolve(prepared); await flush();
    vi.spyOn(remote, 'completedCheckpoint', 'get').mockReturnValue({...checkpoint, programDigest:'different-drawing'});
    const count = jobs.length;
    button('resume-checkpoint').click();
    expect(jobs).toHaveLength(count);
    expect(root.textContent).toContain('Checkpoint does not match this prepared drawing');
  });
  it('uses the Canvas NextDraw settings and offers hardware controls and simulation', async () => {
    state.settings.profile = 'nextdraw'; state.settings.nextdrawModel = '2234';
    open(true); jobs[0]!.resolve({...plan(),settings:{...state.settings}}); await flush();
    expect(root.querySelector('[data-plot-setting="profile"]')).toBeNull();
    expect(root.querySelector('[data-connection-section]')).toBeNull();
    expect(root.querySelector('[data-section="motors"]')).not.toBeNull();
    expect(root.querySelector('[data-section="pen"]')).not.toBeNull();
    expect(button('start').disabled).toBe(false); expect(button('choose-simulation').disabled).toBe(false);
    expect(status()).toBe('Ready to plot');
    button('choose-simulation').click(); frame(0);
    expect(status()).toBe('Simulating');
    expect(plotter.connect).not.toHaveBeenCalled(); expect(plotter.plot).not.toHaveBeenCalled(); expect(plotter.setPen).not.toHaveBeenCalled();
    button('stop').click();
  });
  it('keeps native section states and summary focus through preparation refreshes', async () => {
    open();
    const section = (name: string) => root.querySelector<HTMLDetailsElement>(`.plot-scroll > details[data-section="${name}"]`)!;
    expect(root.querySelector('.plot-sidebar-head')).toBeNull();
    expect(root.querySelector('[data-plot-action="back"]')).toBeNull();
    expect(root.querySelector('.plot-sidebar h2')).toBeNull();
    expect(['pen', 'plot-settings', 'pens'].every(name => section(name).open)).toBe(true);
    expect(root.querySelector<HTMLDetailsElement>('[data-section="advanced"]')!.open).toBe(false);
    section('pen').open = false;
    section('plot-settings').open = false;
    section('plot-settings').querySelector<HTMLElement>('summary')!.focus();
    jobs[0]!.resolve(plan()); await flush();
    expect(section('pen').open).toBe(false);
    expect(section('plot-settings').open).toBe(false);
    expect(document.activeElement).toBe(section('plot-settings').querySelector('summary'));
    workspace.connection.select('machine'); await flush();
    expect(section('motors').open).toBe(true);
    expect(section('pen').open).toBe(false);
    expect(section('diagnostics').open).toBe(false);
    expect(section('pen').open).toBe(false);
    expect(section('plot-settings').open).toBe(false);
  });
  it('opens the pen passes when playback begins from a collapsed pen section', async () => {
    open(); jobs[0]!.resolve(plan()); await flush();
    root.querySelector<HTMLDetailsElement>('[data-section="pens"]')!.open = false;
    button('choose-simulation').click(); frame(0);
    expect(root.querySelector<HTMLDetailsElement>('[data-section="pens"]')!.open).toBe(true);
    expect(root.querySelector('[data-section="passes"]')).toBeNull();
    expect(root.querySelector('[data-pass-index]')).not.toBeNull();
    expect(root.querySelector('[data-plot-pens-title]')!.textContent).toBe('Pen passes');
    button('stop').click();
  });

  it('separates Position, Pen and Diagnostics with advanced pen timing collapsed', async () => {
    open(true); jobs[0]!.resolve(plan(['#000000', '#ff0000'])); await flush();
    const motors = root.querySelector<HTMLDetailsElement>('[data-section="motors"]')!;
    const pen = root.querySelector<HTMLDetailsElement>('[data-section="pen"]')!;
    const diagnostics = root.querySelector<HTMLDetailsElement>('[data-section="diagnostics"]')!;
    expect(root.querySelector('[data-section="machine"]')).toBeNull();
    expect(motors.querySelector('[data-plot-action="engage"]')).toBe(button('engage'));
    expect(motors.querySelector('[data-plot-action="pen-up"]')).toBeNull();
    expect(pen.querySelector('[data-section="pen-timing"]')).not.toBeNull();
    expect(root.querySelector('[data-section="pens"] [data-section="path-optimization"]')).not.toBeNull();
    expect(pen.querySelector('[data-plot-action="pen-up"]')).toBe(button('pen-up'));
    expect(button('pen-up').textContent).toBe('Up');
    expect(button('pen-up').getAttribute('aria-label')).toBe('Pen up');
    expect(button('pen-down').getAttribute('aria-label')).toBe('Pen down');
    expect(pen.querySelectorAll('[data-pen-heights] input')).toHaveLength(2);
    expect(pen.querySelector('[data-plot-setting="penUp"]')!.getAttribute('aria-label')).toBe('Pen up height %');
    expect(pen.querySelector('[data-plot-setting="penDown"]')!.getAttribute('aria-label')).toBe('Pen down height %');
    expect(pen.querySelector('[data-plot-action="machine-log"]')).toBeNull();
    expect(diagnostics.querySelector('[data-plot-action="machine-log"]')).toBe(button('machine-log'));
    expect(diagnostics.textContent).toContain('Firmware');
    expect(diagnostics.open).toBe(false);
    expect(root.querySelectorAll('[data-pass-index]')).toHaveLength(2);
    expect(root.textContent).not.toContain('Your current pen position will be used');
    motors.open = false; diagnostics.open = true;
    diagnostics.querySelector<HTMLElement>('summary')!.focus();
    const speed = root.querySelector<HTMLInputElement>('[data-plot-setting="speed"]')!;
    speed.value = '36'; speed.dispatchEvent(new Event('change', {bubbles:true}));
    jobs.at(-1)!.resolve(plan(['#000000', '#ff0000'])); await flush();
    expect(root.querySelector<HTMLDetailsElement>('[data-section="motors"]')!.open).toBe(false);
    expect(root.querySelector<HTMLDetailsElement>('[data-section="diagnostics"]')!.open).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('[data-section="diagnostics"] > summary'));
    expect(plotter.plot).not.toHaveBeenCalled(); expect(plotter.setPen).not.toHaveBeenCalled();
  });

  it('keeps destination setup in Canvas and preview actions in the Plot footer', async () => {
    open(); jobs[0]!.resolve(plan()); await flush();
    expect(root.querySelector('[data-plot-destination]')).toBeNull();
    expect(root.querySelector('[data-action="canvas-connection"]')).not.toBeNull();
    expect(button('choose-simulation').closest('.plot-player')).not.toBeNull();
    expect(button('bounds-preview').closest('.plot-player')).not.toBeNull();
  });
  it('retains the selected connection after simulation and requires a separate hardware Start', async () => {
    open(true); jobs[0]!.resolve(plan()); await flush();
    button('choose-simulation').click(); frame(0); frame(100000);
    expect(workspace.connection.target).toBe('machine');
    expect(plotter.plot).not.toHaveBeenCalled(); expect(plotter.connect).not.toHaveBeenCalled();
    expect(button('start').disabled).toBe(false); expect(button('start').textContent).toContain('Start with this pen');
    button('start').click(); await flush();
    expect(plotter.plot).not.toHaveBeenCalled();
    jobs.at(-1)!.resolve(plan()); await flush(); await flush();
    expect(plotter.plot).toHaveBeenCalledOnce();
  });
  it.each(['finished', 'stopped'] as const)('prepares a clean hardware job after %s simulation and ignores its stale frame', async ending => {
    open(true); const original = plan(); jobs[0]!.resolve(original); await flush();
    button('choose-simulation').click(); frame(0);
    const staleFrame = frame;
    if (ending === 'finished') frame(100000); else button('stop').click();
    const before = structuredClone(original);
    const execution = deferred<void>(); vi.mocked(plotter.plot).mockReturnValue(execution.promise);
    button('start').click(); await flush();
    expect(jobs).toHaveLength(2); expect(plotter.plot).not.toHaveBeenCalled();
    expect(root.querySelector('.simulation-overlay')).toBeNull();
    const fresh = plan(); jobs[1]!.resolve(fresh); await flush(); await flush();
    expect(plotter.plot).toHaveBeenCalledWith(fresh);
    staleFrame(200000);
    expect(status()).toBe('Plotting'); expect(original).toEqual(before);
    expect(plotter.setPen).not.toHaveBeenCalled(); expect(plotter.connect).not.toHaveBeenCalled();
    execution.resolve(); await flush(); await flush();
    button('start').click(); await flush();
    expect(jobs).toHaveLength(2); expect(plotter.plot).toHaveBeenCalledTimes(2);
  });
  it('does not start hardware when preparation after simulation is cancelled', async () => {
    open(true); jobs[0]!.resolve(plan()); await flush();
    button('choose-simulation').click(); button('stop').click(); button('start').click();
    button('cancel-plan').click(); await flush(); await flush();
    expect(plotter.plot).not.toHaveBeenCalled();
  });
  it('keeps hardware pen controls disabled during paused simulation', async () => {
    open(true); vi.spyOn(plotter,'canAdjustPen','get').mockReturnValue(true);
    jobs[0]!.resolve(plan()); await flush(); button('choose-simulation').click(); frame(0); button('pause').click();
    expect(status()).toContain('Paused'); expect(button('pen-up').disabled).toBe(true);
    button('pen-up').click(); expect(plotter.setPen).not.toHaveBeenCalled(); expect(plotter.plot).not.toHaveBeenCalled();
    button('stop').click();
  });
  it('shows the pen icon in the bottom-left status during simulation and raises it when paused', async () => {
    open(); const prepared = plan(); jobs[0]!.resolve(prepared); await flush();
    const indicator = root.querySelector<HTMLElement>('[data-ui=status] [data-player-pen-state]')!;
    expect(indicator.hidden).toBe(true);
    button('choose-simulation').click(); frame(0);
    expect(indicator.hidden).toBe(false); expect(indicator.getAttribute('aria-label')).toBe('Pen up');
    const down = prepared.events.find(event => event.kind === 'pen' && event.penDown)!;
    frame((down.start + down.duration / 2) * 1000);
    expect(indicator.getAttribute('aria-label')).toBe('Pen down');
    expect(indicator.querySelector('[data-pen-body]')!.getAttribute('transform')).toBe('translate(0 10)');
    button('pause').click(); expect(indicator.getAttribute('aria-label')).toBe('Pen up');
    button('stop').click(); expect(indicator.hidden).toBe(true);
    expect(plotter.plot).not.toHaveBeenCalled(); expect(plotter.setPen).not.toHaveBeenCalled();
  });
  it('uses confirmed hardware pen signals rather than queued progress for the status icon', async () => {
    open(true); const prepared = plan(); jobs[0]!.resolve(prepared); await flush();
    const execution = deferred<void>(); vi.mocked(plotter.plot).mockReturnValue(execution.promise);
    const indicator = root.querySelector<HTMLElement>('[data-player-pen-state]')!;
    button('start').click(); frame(0);
    expect(indicator.hidden).toBe(false); expect(indicator.getAttribute('aria-label')).toBe('Pen state unknown');
    const down = prepared.events.findIndex(event => event.kind === 'pen' && event.penDown);
    plotter.onSignal(eventSignal(prepared, indexPenCounts(prepared), down, 'started', 1000));
    plotter.onProgress({ state: 'plotting', completed: prepared.events.length - 1, total: prepared.events.length }); frame(100);
    expect(indicator.getAttribute('aria-label')).toBe('Pen state unknown');
    plotter.onSignal(eventSignal(prepared, indexPenCounts(prepared), down, 'settled', 1100)); frame(200);
    expect(indicator.getAttribute('aria-label')).toBe('Pen down');
    // State transitions alone are not evidence of a physical lift.
    plotter.onProgress({ state: 'paused', completed: down + 1, total: prepared.events.length }); frame(300);
    expect(indicator.getAttribute('aria-label')).toBe('Pen down');
    plotter.onProgress({ state: 'returning', completed: down + 1, total: prepared.events.length }); frame(400);
    expect(indicator.getAttribute('aria-label')).toBe('Pen down');
    plotter.onProgress({ state: 'cancelled', completed: down + 1, total: prepared.events.length }); frame(500);
    expect(indicator.getAttribute('aria-label')).toBe('Pen state unknown');
    execution.resolve(); await flush(); frame(600);
    expect(indicator.hidden).toBe(true);
  });
  it('moves process metrics to the canvas status and keeps live announcements limited to state changes', async () => {
    open(); jobs[0]!.resolve(plan()); await flush();
    const canvas = root.querySelector('[data-ui=status]')!;
    expect(canvas.querySelector('[data-plot-distances]')!.textContent).toContain('Drawing');
    expect(root.querySelector('.plot-player [data-plot-distances]')).toBeNull();
    expect(root.querySelector('.plot-player [data-player-time]')).toBeNull();
    expect(canvas.querySelector('[data-player-status]')!.getAttribute('aria-live')).toBe('polite');
    expect(canvas.querySelector('[data-player-time]')!.parentElement!.getAttribute('aria-live')).toBe('off');
    button('choose-simulation').click(); frame(0);
    expect(status()).toBe('Simulating'); expect(canvas.querySelector<HTMLElement>('[data-plot-distances]')!.hidden).toBe(true);
    button('stop').click(); workspace.destroy(); expect(canvas.querySelector('[data-plot-canvas-status]')).toBeNull();
  });

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
    expect(mocks.prepare).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),expect.objectContaining({pathJoinToleranceMm:.15,pathSimplifyToleranceMm:.02,closedPathStart:'random',pathRandomSeed:42}),expect.anything(),expect.anything(),false);
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
    button('choose-simulation').click(); button('stop').click();
    expect(counter.querySelector('[data-pen-down-count]')!.textContent).toBe('0');
    workspace.destroy(); expect(root.querySelector('[data-plot-pen-counter]')).toBeNull();
  });
  it('preserves Direct USB ownership when the combined network Connect action is used', async () => {
    vi.stubGlobal('location', {hostname:'127.0.0.1'});
    const remote = new NetworkPlotter({epoch:'runner',revision:1,timestamp:1,connected:false,connecting:false,firmware:null,jobId:null,status:'idle',progress:{completed:0,total:0,state:'idle'},position:null,positionTimestamp:null,origin:'unset',originProfile:null,motorsOn:false,canAdjustPen:false});
    let controlled=false;
    vi.spyOn(NetworkPlotter,'discover').mockResolvedValue(remote);
    vi.spyOn(remote,'watch').mockResolvedValue(); vi.spyOn(remote,'disconnect').mockResolvedValue();
    vi.spyOn(remote,'hasControl','get').mockImplementation(()=>controlled);
    vi.spyOn(remote,'connect').mockImplementation(async()=>{controlled=true; return 'Network plotter';});
    const connectEbb=vi.spyOn(remote,'connectEbb').mockResolvedValue();
    open(true); jobs[0]!.resolve(plan()); await flush(); await flush();
    canvasConnection();
    const select=root.querySelector<HTMLSelectElement>('[data-plot-destination]')!;
    select.value='network'; select.dispatchEvent(new Event('change',{bubbles:true})); jobs.at(-1)!.resolve(plan()); await flush();
    button('connect').click(); await flush();
    expect(connectEbb).not.toHaveBeenCalled(); expect(root.textContent).toContain('Disconnect Direct USB');
    expect(plotter.plot).not.toHaveBeenCalled();
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
    canvasConnection();
    let select = root.querySelector<HTMLSelectElement>('[data-plot-destination]')!;
    select.value = 'network'; select.dispatchEvent(new Event('change', { bubbles: true })); jobs.at(-1)!.resolve(plan()); await flush();
    button('connect').click(); await flush();
    expect(state.settings.motionFirmware).toBe('2.8.1');jobs.at(-1)!.resolve(plan());await flush();
    await flush();
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
    canvasConnection();
    const select = root.querySelector<HTMLSelectElement>('[data-plot-destination]')!;
    expect(select.textContent).toContain('Network plotter');
    expect(select.textContent).toContain('Node server');
    select.value = 'network'; select.dispatchEvent(new Event('change', { bubbles: true }));
    jobs.at(-1)!.resolve(plan()); await flush();
    expect(button('start').disabled).toBe(true); expect(button('connect').textContent).toContain('Connect');
    expect(root.textContent).toContain('Server connected · Plotter connected');
    expect(root.querySelector('[data-section="diagnostics"]')!.textContent).toContain('EBB 2.8.1');
    expect(button('set-origin').disabled).toBe(true); expect(button('pen-up').disabled).toBe(true);
    button('connect').click(); await flush(); expect(connect).toHaveBeenCalledOnce();
    expect(state.settings.motionFirmware).toBe('2.8.1');jobs.at(-1)!.resolve(plan());await flush();
    expect(button('set-origin').disabled).toBe(false); expect(button('pen-up').disabled).toBe(false);
    button('set-origin').click(); await flush(); expect(origin).toHaveBeenCalledWith('axidraw');
    expect(button('disconnect-ebb').textContent).toContain('Disconnect');
    button('disconnect-ebb').click(); await flush(); expect(releaseUsb).toHaveBeenCalledWith(expect.objectContaining({ penUp: state.settings.penUp }));
    button('release-control').click(); await flush(); expect(releaseControl).toHaveBeenCalledOnce();
    expect(remote.disconnect).not.toHaveBeenCalled();
    expect(plotter.plot).not.toHaveBeenCalled();
  });
  it('observes an already-running network job without starting or disconnecting it', async () => {
    const remote = new NetworkPlotter({epoch:'runner',revision:1,timestamp:1,connected:true,connecting:false,firmware:'2.8.1',jobId:'running',status:'running',progress:{completed:1,total:10,state:'plotting'},position:null,positionTimestamp:null,origin:'unset',originProfile:null,motorsOn:true,canAdjustPen:false});
    vi.spyOn(NetworkPlotter,'discover').mockResolvedValue(remote);
    vi.spyOn(remote,'watch').mockResolvedValue();
    vi.spyOn(remote,'active','get').mockReturnValue(true);
    vi.spyOn(remote,'connected','get').mockReturnValue(true);
    vi.spyOn(remote,'activePlan').mockResolvedValue(plan());
    const running = deferred<void>(), wait = vi.spyOn(remote,'waitForJob').mockReturnValue(running.promise);
    const start = vi.spyOn(remote,'plot').mockResolvedValue(), disconnect = vi.spyOn(remote,'disconnect').mockResolvedValue();
    open(); await flush(); await flush(); workspace.connection.select('network'); await flush(); await flush();
    expect(wait).toHaveBeenCalledOnce(); expect(start).not.toHaveBeenCalled();
    expect(workspace.canLeave).toBe(false); workspace.destroy(); expect(exit).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
    vi.spyOn(remote,'active','get').mockReturnValue(false); running.resolve(); await flush(); await flush();
    expect(workspace.canLeave).toBe(true); workspace.destroy(); expect(exit).toHaveBeenCalledOnce();
    expect(disconnect).not.toHaveBeenCalled();
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
    const heights = root.querySelector<HTMLDetailsElement>('[data-section="pen"]')!;
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
    expect(root.querySelector<HTMLDetailsElement>('[data-section="pen"]')!.open).toBe(true);
    // A subsequent spinner/arrow edit commits through the same surviving field.
    input.value = '32'; input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(state.settings[key]).toBe(32); expect(jobs).toHaveLength(3);
    jobs[2]!.resolve(plan()); await flush();
  });
  it('preserves a newer unfinished keyboard value when preparation finishes', async () => {
    open(true); jobs[0]!.resolve(plan()); await flush();
    root.querySelector<HTMLDetailsElement>('[data-section="pen"]')!.open = true;
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
  it('downloads a diagnostic log without starting or moving hardware', async () => {
    vi.useFakeTimers(); open(true);
    const create = vi.fn(() => 'blob:machine-log'), revoke = vi.fn();
    Object.defineProperty(URL,'createObjectURL',{value:create,configurable:true});
    Object.defineProperty(URL,'revokeObjectURL',{value:revoke,configurable:true});
    const click = vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this: HTMLAnchorElement) {
      expect(this.download).toBe('plot-it-machine-log.json'); expect(this.href).toBe('blob:machine-log');
    });
    button('machine-log').click(); await flush(); expect(create).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce();
    expect((create.mock.calls[0] as unknown as Blob[])[0]!.type).toBe('application/json');
    expect(plotter.setPen).not.toHaveBeenCalled(); expect(plotter.plot).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000); expect(revoke).toHaveBeenCalledWith('blob:machine-log'); vi.useRealTimers();
    delete (URL as unknown as Record<string,unknown>).createObjectURL; delete (URL as unknown as Record<string,unknown>).revokeObjectURL;
  });
  it('locks editing and selects Plot mode without starting hardware', async () => {
    open(true);
    const sections = root.querySelectorAll('.plot-scroll > details');
    expect(sections[0]!.getAttribute('data-section')).toBe('pen');
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
    canvasConnection();
    const destination = root.querySelector<HTMLSelectElement>('[data-plot-destination]')!;
    destination.value = 'machine'; destination.dispatchEvent(new Event('change',{bubbles:true})); jobs.at(-1)!.resolve(plan()); await flush();
    vi.mocked(plotter.connect).mockRejectedValue(new DOMException('User cancelled', 'NotFoundError'));
    button('connect').click(); await flush();
    expect(root.querySelector('[data-player-error]')!.hasAttribute('hidden')).toBe(true);
    expect(root.textContent).not.toContain('User cancelled'); expect(button('connect').disabled).toBe(false);
    expect(plotter.plot).not.toHaveBeenCalled();
  });
  it('surfaces a failed connection inline and retries without starting hardware', async () => {
    open(); jobs[0]!.resolve(plan()); await flush();
    canvasConnection();
    const destination = root.querySelector<HTMLSelectElement>('[data-plot-destination]')!;
    destination.value = 'machine'; destination.dispatchEvent(new Event('change',{bubbles:true})); jobs.at(-1)!.resolve(plan()); await flush();
    vi.mocked(plotter.connect).mockRejectedValue(new Error('Serial port already open'));
    button('connect').click(); await flush();
    expect(root.textContent).toContain('Serial port already open'); expect(button('connect').textContent).toContain('Connect');
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
  it('simulates the placement bounds and follows with the original drawing on Simulate',async()=>{
    open(); const original=plan(); jobs[0]!.resolve(original); await flush();
    const signals: Array<{penDown:boolean;source:string}> = [];
    root.querySelector('#paper')!.addEventListener('plot-execution-signal',event=>signals.push((event as CustomEvent).detail));
    button('bounds-preview').click(); frame(0); frame(100000);
    expect(signals.every(s=>!s.penDown)).toBe(true); expect(status()).toContain('Bounds preview · Complete');
    expect(root.querySelector('[data-plot-distances]')!.textContent).toContain('Drawing 0.0 mm');
    expect(root.querySelector('[data-player-time]')!.textContent).toContain('100%');
    button('choose-simulation').click(); frame(100001); frame(200000);
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


it('places Relax plotter in Position and locks it during the command', async () => {
  open(true);
  const operation=deferred<void>(),relax=vi.spyOn(plotter,'relax').mockReturnValue(operation.promise);
  const control=button('relax');
  expect(control.closest('[data-section="motors"]')).not.toBeNull();
  control.click();await flush();
  expect(relax).toHaveBeenCalledOnce();expect(button('relax').disabled).toBe(true);
  operation.resolve();await flush();
  expect(button('relax').disabled).toBe(false);
  expect(root.textContent).toContain('Plotter relaxed. Motors and servo released.');
});

describe('Dynamic motion comparison workspace',()=>{
  it('explains periodic comparison limits while keeping Dynamic plotting available', async () => {
    state.settings.motionPreference = 'scurve'; state.settings.motionStrategy = 'dynamic'; state.settings.workloadMode = 'periodic';
    open(true); jobs[0]!.resolve(plan()); await flush();
    expect(button('compare-motion').disabled).toBe(true);
    expect(root.querySelector('[data-comparison-unavailable]')!.textContent).toContain('periodic checkpoint positions can differ');
    const strategy = root.querySelector<HTMLSelectElement>('[data-plot-setting="motionStrategy"]')!;
    expect(strategy.querySelector<HTMLOptionElement>('[value="dynamic"]')!.disabled).toBe(false);
    expect(button('start').disabled).toBe(false); expect(button('choose-simulation').disabled).toBe(false);
    // The action guard also rejects a stale or externally re-enabled control.
    button('compare-motion').disabled = false; button('compare-motion').click(); expect(jobs).toHaveLength(1);
    const workload = root.querySelector<HTMLSelectElement>('[data-plot-setting="workloadMode"]')!;
    workload.value = 'continuous'; workload.dispatchEvent(new Event('change', {bubbles:true}));
    jobs.at(-1)!.resolve(plan()); await flush();
    expect(button('compare-motion').disabled).toBe(false);
    expect(root.querySelector('[data-comparison-unavailable]')).toBeNull();
  });
  it('keeps Standard as the default and explains unavailable Dynamic without changing backend',async()=>{
    open();jobs[0]!.resolve(plan());await flush();
    const select=root.querySelector<HTMLSelectElement>('[data-plot-setting="motionStrategy"]')!;
    expect(select.value).toBe('standard');expect(select.querySelector<HTMLOptionElement>('[value="dynamic"]')!.disabled).toBe(true);
    expect(root.querySelector('[data-dynamic-unavailable]')!.textContent).toContain('T3');expect(root.querySelector('[data-plot-action="compare-motion"]')).toBeNull();
  });
  it('prepares the comparison explicitly, selects without execution and discards it on a settings change',async()=>{
    state.settings.motionPreference='scurve';open(true);jobs[0]!.resolve(plan());await flush();
    button('compare-motion').click();expect(mocks.prepare.mock.calls.at(-1)![5]).toBe(true);
    const standard=plan(),dynamic=plan();jobs.at(-1)!.resolve({...standard,comparison:{standard,dynamic}});await flush();
    expect(root.querySelector('dialog')).not.toBeNull();expect(plotter.plot).not.toHaveBeenCalled();expect(plotter.setPen).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('[data-compare-action="dynamic"]')!.click();expect(state.settings.motionStrategy).toBe('dynamic');expect(state.settings.dynamicCurveAcceleration).toBe(Math.min(100,state.settings.drawAcceleration/2));expect(state.settings.dynamicAnticipationMm).toBe(3);expect(root.querySelector('dialog')).toBeNull();expect(plotter.plot).not.toHaveBeenCalled();expect(mocks.prepare.mock.calls.at(-1)![5]).toBe(false);
    jobs.at(-1)!.resolve(dynamic);await flush();button('compare-motion').click();jobs.at(-1)!.resolve({...standard,comparison:{standard,dynamic}});await flush();
    const speed=root.querySelector<HTMLInputElement>('[data-plot-setting="speed"]')!;speed.value='20';speed.dispatchEvent(new Event('change',{bubbles:true}));expect(root.querySelector('dialog')).toBeNull();
  });
  it('invalidates an open comparison when firmware compatibility changes',async()=>{
    state.settings.motionPreference='scurve';open();jobs[0]!.resolve(plan());await flush();button('compare-motion').click();const standard=plan();jobs.at(-1)!.resolve({...standard,comparison:{standard,dynamic:plan()}});await flush();
    expect(root.querySelector('dialog')).not.toBeNull();state.settings.motionFirmware='3.1.6';workspace.connectionChanged();expect(root.querySelector('dialog')).toBeNull();expect(button('compare-motion').disabled).toBe(true);expect(plotter.plot).not.toHaveBeenCalled();
  });
  it('rejects a stale comparison after settings invalidate its worker',async()=>{
    state.settings.motionPreference='scurve';open();jobs[0]!.resolve(plan());await flush();button('compare-motion').click();const stale=jobs.at(-1)!;
    // A late worker result can arrive even after cancellation.
    stale.cancel.mockImplementation(()=>undefined);
    const speed=root.querySelector<HTMLInputElement>('[data-plot-setting="speed"]')!;speed.value='21';speed.dispatchEvent(new Event('change',{bubbles:true}));
    const standard=plan();stale.resolve({...standard,comparison:{standard,dynamic:plan()}});await flush();expect(root.querySelector('dialog')).toBeNull();
    jobs.at(-1)!.resolve(plan());await flush();expect(root.querySelector('dialog')).toBeNull();
  });
});
