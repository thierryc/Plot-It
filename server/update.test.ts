import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { startRunner } from './runner';
import { RunnerClient } from './ipc';
import { JobStore } from './jobs';
import { fakeTransport } from './test-fixtures/fake-ebb';
import { PlotterCore } from '../src/plotter-core';
import { validateControl } from '../src/network-protocol';
import { buildMotionPlan } from '../src/motion-plan';
import { initialState } from '../src/model';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
async function fixture() {
  const directory = await mkdtemp('/tmp/pi-update-'); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const core = new PlotterCore(fakeTransport().transport);
  const runner = await startRunner({ directory, socketDirectory: directory, core }); cleanup.push(() => runner.close());
  const client = new RunnerClient(join(directory, 'control.sock'), join(directory, 'telemetry.sock')); cleanup.push(async () => client.close()); await client.ready();
  return { directory, core, request: (action: any, params = {}) => client.request({ version: 1, requestId: randomUUID(), action, ...params }) };
}
it('keeps update reservations out of the public network protocol', () => {
  for (const action of ['prepare-update', 'cancel-update']) {
    const request = { version: 1, requestId: randomUUID(), action };
    expect(() => validateControl(request)).toThrow('Unsupported');
    expect(validateControl(request, { allowUpdateReservation: true }).action).toBe(action);
  }
});
it('wins a start race during asynchronous job loading and permits work after cancellation', async () => {
  const { directory, request } = await fixture();
  const record = await new JobStore(directory).accept({ version: 1, requestId: randomUUID(), plan: buildMotionPlan([{ tool: '#000000', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }], initialState.settings) });
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const original = JobStore.prototype.get;
  vi.spyOn(JobStore.prototype, 'get').mockImplementationOnce(async function (this: JobStore, id) { entered(); await gate; return original.call(this, id); });
  const start = request('start', { jobId: record.id }); await started;
  expect((await request('prepare-update')).ok).toBe(true);
  release(); expect(await start).toMatchObject({ ok: false, error: 'Plotter is busy' });
  expect((await request('connect-ebb')).ok).toBe(false);
  expect((await request('cancel-update')).ok).toBe(true);
  expect((await request('connect-ebb')).ok).toBe(true);
});
it('refuses an update until manual calibration and all active work settle', async () => {
  const { core, request } = await fixture();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  vi.spyOn(core, 'setPen').mockImplementationOnce(async () => { entered(); await gate; });
  const pen = request('pen', { percent: 50 }); await started;
  expect((await request('prepare-update')).ok).toBe(false);
  release(); await pen;
  const active = vi.spyOn(core, 'active', 'get').mockReturnValue(true);
  expect((await request('prepare-update')).ok).toBe(false);
  active.mockRestore();
  expect((await request('prepare-update')).ok).toBe(true);
});
