import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareJob } from './plot-job';
import { buildMotionPlan } from './motion-plan';
import { defaultPens } from './pens';
import { initialState } from './model';
import type { PlotPath } from './svg';
const mocks = vi.hoisted(() => ({ fills: vi.fn(), extras: vi.fn(), flatten: vi.fn() }));
vi.mock('./fill-dom', () => ({ awaitFills: mocks.fills, fillPlotPaths: mocks.extras }));
vi.mock('./svg', () => ({ flattenPlotPathsAsync: mocks.flatten,readSourceLayers:()=>[] }));

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: Worker['onmessage'] = null;
  onerror: Worker['onerror'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor(public url: URL, public options: WorkerOptions) { TestWorker.instances.push(this); }
  send(data: unknown) { this.onmessage?.call(this as unknown as Worker, { data } as MessageEvent); }
}
const svg = {querySelector:()=>null} as unknown as SVGSVGElement;
const paths: PlotPath[] = [{ tool: 'rgb(255, 0, 0)', points: [{ x: 15, y: 15 }, { x: 20, y: 15 }] }];
const plan = () => ({ ...buildMotionPlan([{ ...paths[0]!, tool: '#FF0000' }], initialState.settings),
  pens: [{ color: '#FF0000', name: '', sources: ['#FF0000'], included: true }] });
async function started(job: ReturnType<typeof prepareJob>) {
  await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(1));
  return { job, worker: TestWorker.instances[0]! };
}
beforeEach(() => {
  TestWorker.instances = []; vi.stubGlobal('Worker', TestWorker);
  mocks.fills.mockResolvedValue(undefined); mocks.extras.mockReturnValue(new Map());
  mocks.flatten.mockImplementation(async () => structuredClone(paths));
});
afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('plot preparation worker boundary', () => {
  it('waits for fills and snapshots settings, paper and pen assignments before asynchronous work', async () => {
    let finishFills!: () => void;
    mocks.fills.mockReturnValue(new Promise<void>(resolve => { finishFills = resolve; }));
    const settings = structuredClone(initialState.settings), paper = structuredClone(initialState.paper), pens = defaultPens();
    pens.assignments['#FF0000'] = { color: '#000000', name: 'Black pen' };
    const job = prepareJob(svg, paper, settings, undefined, pens);
    settings.speed = 99; paper.width = 500; pens.assignments['#FF0000']!.color = '#0000FF';
    expect(TestWorker.instances).toHaveLength(0); expect(mocks.flatten).not.toHaveBeenCalled();
    finishFills(); const { worker } = await started(job);
    const request = worker.postMessage.mock.calls[0]![0];
    expect(request.settings.speed).toBe(initialState.settings.speed);
    expect(request.paper.width).toBe(initialState.paper.width);
    expect(request.preferences.assignments['#FF0000'].color).toBe('#000000');
    expect(request.paths[0].tool).toBe('#FF0000'); expect(worker.options.type).toBe('module');
    worker.send({ plan: plan() }); await expect(job.promise).resolves.toMatchObject({ pens: [{ color: '#FF0000' }] });
  });
  it('delivers progress, resolves once, and disposes the worker', async () => {
    const progress = vi.fn(), { job, worker } = await started(prepareJob(svg, initialState.paper, initialState.settings, progress));
    const late = worker.onmessage!;
    worker.send({ progress: { label: 'Estimating plot motion', fraction: .5 } });
    const result = plan(); worker.send({ plan: result }); await expect(job.promise).resolves.toBe(result);
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.onmessage).toBeNull();
    late.call(worker as unknown as Worker, { data: { progress: { label: 'Late' } } } as MessageEvent);
    expect(progress.mock.calls.flat()).not.toContainEqual({ label: 'Late' });
    job.cancel(); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('cancels while waiting for fills without creating a worker', async () => {
    let finishFills!: () => void;
    mocks.fills.mockReturnValue(new Promise<void>(resolve => { finishFills = resolve; }));
    const job = prepareJob(svg, initialState.paper, initialState.settings);
    job.cancel(); await expect(job.promise).rejects.toThrow('Planning cancelled');
    finishFills(); await Promise.resolve(); expect(TestWorker.instances).toHaveLength(0);
  });
  it('cancels an active worker and ignores an already queued successful response', async () => {
    const { job, worker } = await started(prepareJob(svg, initialState.paper, initialState.settings));
    const late = worker.onmessage!; job.cancel();
    late.call(worker as unknown as Worker, { data: { plan: plan() } } as MessageEvent);
    await expect(job.promise).rejects.toThrow('Planning cancelled'); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it.each(['fills', 'flatten'] as const)('propagates %s failures without starting a worker', async phase => {
    mocks[phase].mockRejectedValue(new Error('Invalid source geometry'));
    await expect(prepareJob(svg, initialState.paper, initialState.settings).promise).rejects.toThrow('Invalid source geometry');
    expect(TestWorker.instances).toHaveLength(0);
  });
  it('rejects unsupported paints before starting a worker', async () => {
    mocks.flatten.mockResolvedValue([{ ...paths[0], tool: 'url(#gradient)' }]);
    await expect(prepareJob(svg, initialState.paper, initialState.settings).promise).rejects.toThrow('flat RGB');
    expect(TestWorker.instances).toHaveLength(0);
  });
  it('preserves planner validation errors and terminates the failed worker', async () => {
    const { job, worker } = await started(prepareJob(svg, initialState.paper, initialState.settings));
    worker.send({ error: 'Speeds and accelerations must be positive.' });
    await expect(job.promise).rejects.toThrow('Speeds and accelerations'); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('reports the runtime error and allows a fresh retry worker', async () => {
    const { job, worker } = await started(prepareJob(svg, initialState.paper, initialState.settings));
    const preventDefault = vi.fn();
    worker.onerror!.call(worker as unknown as Worker, { message: 'Failed to fetch dynamically imported module', preventDefault } as unknown as ErrorEvent);
    await expect(job.promise).rejects.toThrow('Failed to fetch dynamically imported module');
    expect(preventDefault).toHaveBeenCalledOnce(); expect(worker.terminate).toHaveBeenCalledOnce();
    const retry = prepareJob(svg, initialState.paper, initialState.settings);
    await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(2));
    TestWorker.instances[1]!.send({ plan: plan() }); await expect(retry.promise).resolves.toHaveProperty('events');
  });
  it('rejects unreadable worker messages instead of leaving preparation pending', async () => {
    const { job, worker } = await started(prepareJob(svg, initialState.paper, initialState.settings));
    worker.onmessageerror!.call(worker as unknown as Worker, {} as MessageEvent);
    await expect(job.promise).rejects.toThrow('could not read'); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it.each([null, {}, { plan: { events: [], duration: NaN } }])('rejects malformed results: %j', async response => {
    const { job, worker } = await started(prepareJob(svg, initialState.paper, initialState.settings));
    worker.send(response); await expect(job.promise).rejects.toThrow('invalid response');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('cleans up when posting a request fails', async () => {
    const job = prepareJob(svg, initialState.paper, initialState.settings);
    // Intercept construction before the asynchronous fill/read phase reaches it.
    class BrokenWorker extends TestWorker { postMessage = vi.fn(() => { throw new DOMException('Could not clone', 'DataCloneError'); }); }
    vi.stubGlobal('Worker', BrokenWorker);
    await expect(job.promise).rejects.toThrow('Could not clone');
    expect(TestWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  });
  it('cancels during path sampling before creating a worker', async () => {
    let finish!: (value: PlotPath[]) => void;
    mocks.flatten.mockReturnValue(new Promise<PlotPath[]>(resolve => { finish = resolve; }));
    const job = prepareJob(svg, initialState.paper, initialState.settings);
    await vi.waitFor(() => expect(mocks.flatten).toHaveBeenCalled());
    job.cancel(); await expect(job.promise).rejects.toThrow('Planning cancelled');
    finish(structuredClone(paths)); await Promise.resolve(); await Promise.resolve();
    expect(TestWorker.instances).toHaveLength(0);
  });
  it('reports worker construction failures instead of leaving a pending job', async () => {
    class UnavailableWorker { constructor() { throw new Error('Worker blocked by content security policy'); } }
    vi.stubGlobal('Worker', UnavailableWorker);
    await expect(prepareJob(svg, initialState.paper, initialState.settings).promise).rejects.toThrow('content security policy');
  });
});
