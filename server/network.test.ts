import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import { get as httpsGet } from 'node:https';
import WebSocket from 'ws';
import { validateJob } from '../src/network-protocol';
import { buildMotionPlan } from '../src/motion-plan';
import { initialState } from '../src/model';
import { PlotterCore } from '../src/plotter-core';
import { fakeTransport } from './test-fixtures/fake-ebb';
import { JobStore } from './jobs';
import { LatestChannel } from './ipc';
import { startRunner } from './runner';
import { startApi } from './api';

const job = () => ({ version: 1 as const, requestId: randomUUID(), plan: buildMotionPlan([{ tool: '#000000', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }], initialState.settings) });
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); });

describe('network job contracts', () => {
  it('validates event continuity, settings, schema version and bounded sizes', () => {
    expect(validateJob(job()).version).toBe(1);
    expect(() => validateJob({ ...job(), version: 2 })).toThrow();
    const invalid = job(); invalid.plan.events[1]!.to.x = Infinity;
    expect(() => validateJob(invalid)).toThrow();
    const broken = job(); broken.plan.events[1]!.start += 3;
    expect(() => validateJob(broken)).toThrow();
    expect(() => validateJob(job(), { maxEvents: 1 })).toThrow();
    const badPass = job(); badPass.plan.passes[0]!.end -= .1;
    expect(() => validateJob(badPass)).toThrow();
    const badPen = job(); badPen.plan.events.find(e => e.kind === 'xy' && e.penDown)!.penDown = false;
    expect(() => validateJob(badPen)).toThrow();
  });
  it('atomically deduplicates uploads and rejects reuse for another plan', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plot-jobs-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const store = new JobStore(dir), envelope = job();
    const [a, b] = await Promise.all([store.accept(envelope), store.accept(envelope)]);
    expect(a.id).toBe(b.id);
    const changed = structuredClone(envelope); changed.plan.settings.speed++;
    await expect(store.accept(changed)).rejects.toThrow();
    await store.update(a.id, { status: 'running' });
    await store.recoverInterrupted(); expect((await store.get(a.id)).status).toBe('interrupted');
  });
  it('keeps only the newest unsent snapshot under backpressure', () => {
    const stream = new EventEmitter() as EventEmitter & { write: (data: string) => boolean; destroyed: boolean };
    const written: string[] = []; stream.destroyed = false; stream.write = data => { written.push(data); return false; };
    const channel = new LatestChannel(stream);
    for (let revision = 0; revision < 10000; revision++) channel.publish({ revision });
    expect(written).toHaveLength(1); expect(channel.pendingCount).toBe(1);
    stream.emit('drain'); expect(JSON.parse(written[1]!)).toEqual({ revision: 9999 });
  });
});

async function connect(url: string) {
  const ws = new WebSocket(url.replace(/^http/, 'ws') + '/api/v1/ws', { origin: url });
  const messages: any[] = []; ws.on('message', data => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  cleanup.push(async () => { ws.terminate(); });
  return { ws, messages, async request(action: string, params: object = {}) {
    const requestId = randomUUID(); ws.send(JSON.stringify({ version: 1, requestId, action, ...params }));
    await wait(() => messages.some(m => m.type === 'result' && m.requestId === requestId));
    return messages.find(m => m.type === 'result' && m.requestId === requestId);
  } };
}
async function wait(check: () => boolean) {
  const until = Date.now() + 4000;
  while (!check()) { if (Date.now() > until) throw new Error('Timed out waiting for state'); await new Promise(r => setTimeout(r, 5)); }
}

describe('isolated runner and API', () => {
  it('reports invalid pen settings immediately with the original request ID', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plot-pen-validation-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const runner = await startRunner({ directory: dir, socketDirectory: dir, core: new PlotterCore(fakeTransport().transport) }); cleanup.push(() => runner.close());
    const api = await startApi({ directory: dir, socketDirectory: dir, port: 0, allowLoopback: true }); cleanup.push(() => api.close());
    const client = await connect(api.url); await client.request('claim');
    const result = await client.request('pen', { percent: 52, settings: { ...initialState.settings, penUp: NaN } });
    expect(result.ok).toBe(false); expect(result.error).toContain('penUp');
    expect((await client.request('connect-ebb')).ok).toBe(true);
  });
  it('waits for a manual pen command to settle before runner shutdown closes USB', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plot-manual-shutdown-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const fixture = fakeTransport('2.8.1', async command => { if (command.startsWith('S2,')) await gate; });
    const core = new PlotterCore(fixture.transport);
    const runner = await startRunner({ directory: dir, socketDirectory: dir, core, connectionPolicy: 'auto' }); cleanup.push(() => runner.close());
    const api = await startApi({ directory: dir, socketDirectory: dir, port: 0, allowLoopback: true }); cleanup.push(() => api.close()); cleanup.push(async () => release());
    const client = await connect(api.url); await client.request('claim');
    client.ws.send(JSON.stringify({ version: 1, requestId: randomUUID(), action: 'pen', percent: 52, settings: initialState.settings }));
    await wait(() => fixture.commands.some(c => c.startsWith('S2,')));
    let finished = false; const closing = runner.close().finally(() => { finished = true; });
    // Attach immediately so an incorrect early rejection is captured by the test.
    const observed = closing.then(() => null, error => error);
    await new Promise(resolve => setTimeout(resolve, 20));
    const closedEarly = finished; release();
    await expect(observed).resolves.toBeNull(); expect(closedEarly).toBe(false);
    expect(core.connected).toBe(false);
    expect(core.diagnosticPenTrace.some(entry => entry.phase === 'settled')).toBe(true);
  });
  it('leaves USB free on startup and releases it on demand without reopening it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plot-manual-connect-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const fixture = fakeTransport(), core = new PlotterCore(fixture.transport);
    const runner = await startRunner({ directory: dir, socketDirectory: dir, core, connectionPolicy: 'manual' }); cleanup.push(() => runner.close());
    const api = await startApi({ directory: dir, socketDirectory: dir, port: 0, allowLoopback: true }); cleanup.push(() => api.close());
    expect(core.connected).toBe(false); expect(fixture.commands).toEqual([]);
    const client = await connect(api.url);
    expect((await client.request('connect-ebb')).ok).toBe(false);
    await client.request('claim'); expect(core.connected).toBe(false);
    expect((await client.request('connect-ebb')).ok).toBe(true); expect(core.connected).toBe(true);
    await client.request('set-origin', { profile: 'axidraw' });
    expect((await client.request('disconnect-ebb', { settings: initialState.settings })).ok).toBe(true);
    expect(core.connected).toBe(false); expect(core.originStatus).toBe('unset');
    expect(fixture.commands).toContain('EM,0,0');
    const count = fixture.commands.length;
    await new Promise(resolve => setTimeout(resolve, 5100));
    expect(fixture.commands).toHaveLength(count);
  }, 10000);
  it('applies idle pen calibration after Stop and refuses USB handoff during a pen wait', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plot-pen-control-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const fixture = fakeTransport(), core = new PlotterCore(fixture.transport, { precompile: true });
    const runner = await startRunner({ directory: dir, socketDirectory: dir, core, connectionPolicy: 'auto' }); cleanup.push(() => runner.close());
    const api = await startApi({ directory: dir, socketDirectory: dir, port: 0, allowLoopback: true }); cleanup.push(() => api.close());
    const client = await connect(api.url); await client.request('claim');
    const envelope = job(); envelope.plan = buildMotionPlan([{ tool: '#000000', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, { tool: '#ff0000', points: [{ x: 0, y: 0 }, { x: 0, y: 10 }] }], initialState.settings);
    const record = await new JobStore(dir).accept(envelope);
    await client.request('start', { jobId: record.id }); await wait(() => runner.snapshot().status === 'tool-change');
    expect((await client.request('disconnect-ebb', { settings: initialState.settings })).ok).toBe(false);
    await client.request('stop'); await wait(() => runner.snapshot().status === 'stopped');
    const settings = { ...initialState.settings, penUp: 30, penDown: 52 };
    expect((await client.request('pen', { percent: 52, settings })).ok).toBe(true);
    expect(fixture.commands).toContain('SC,4,21850');
    expect(fixture.commands).toContain('SC,5,17340');
    expect((await client.request('pen', { percent: 30, settings })).ok).toBe(true);
    expect(core.canAdjustPen).toBe(true);
  });
  it('marks USB loss as interrupted and invalidates origin without replay', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plot-usb-loss-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const fixture = fakeTransport('2.8.1', async command => { if (command.startsWith('LM,')) await gate; });
    const core = new PlotterCore(fixture.transport, { precompile: true });
    const runner = await startRunner({ connectionPolicy: 'auto', directory: dir, socketDirectory: dir, core }); cleanup.push(() => runner.close());
    const api = await startApi({ directory: dir, socketDirectory: dir, port: 0, allowLoopback: true }); cleanup.push(() => api.close()); cleanup.push(async () => release());
    const record = await new JobStore(dir).accept(job()); const client = await connect(api.url); await client.request('claim'); await client.request('start', { jobId: record.id });
    await wait(() => fixture.commands.some(c => c.startsWith('LM,'))); fixture.disconnect(); release();
    await wait(() => !core.active);
    expect(runner.snapshot().status).toBe('interrupted'); expect(core.originStatus).toBe('unset');
    const moves = fixture.commands.filter(c => c.startsWith('LM,')).length;
    expect((await client.request('start', { jobId: record.id })).ok).toBe(true);
    expect(fixture.commands.filter(c => c.startsWith('LM,'))).toHaveLength(moves);
  });
  it('keeps motors engaged at each pen change until explicit Continue', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plot-pens-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const fixture = fakeTransport(), core = new PlotterCore(fixture.transport, { precompile: true });
    const runner = await startRunner({ connectionPolicy: 'auto', directory: dir, socketDirectory: dir, core }); cleanup.push(() => runner.close());
    const api = await startApi({ directory: dir, socketDirectory: dir, port: 0, allowLoopback: true }); cleanup.push(() => api.close());
    const plan = buildMotionPlan([{ tool: '#000000', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, { tool: '#ff0000', points: [{ x: 0, y: 0 }, { x: 0, y: 10 }] }], initialState.settings);
    const record = await new JobStore(dir).accept({ version: 1, requestId: randomUUID(), plan });
    const client = await connect(api.url); await client.request('claim'); await client.request('start', { jobId: record.id });
    await wait(() => runner.snapshot().status === 'tool-change');
    expect(core.motorsOn).toBe(true); expect(fixture.commands).not.toContain('EM,0,0');
    expect((await client.request('continue')).ok).toBe(true);
    await wait(() => runner.snapshot().status === 'finished'); expect(core.motorsOn).toBe(false);
  });
  it('rejects manual motion while an accepted start is being persisted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plot-start-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const runner = await startRunner({ connectionPolicy: 'auto', directory: dir, socketDirectory: dir, core: new PlotterCore(fakeTransport().transport) }); cleanup.push(() => runner.close());
    const api = await startApi({ directory: dir, socketDirectory: dir, port: 0, allowLoopback: true }); cleanup.push(() => api.close());
    const record = await new JobStore(dir).accept(job()); const client = await connect(api.url); await client.request('claim');
    let persisting = false, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); cleanup.push(async () => release());
    const original = JobStore.prototype.update;
    vi.spyOn(JobStore.prototype, 'update').mockImplementation(async function (id, fields) { if (fields.status === 'starting') { persisting = true; await gate; } return original.call(this, id, fields); });
    const start = client.request('start', { jobId: record.id }); await wait(() => persisting);
    expect((await client.request('set-origin', { profile: 'axidraw' })).ok).toBe(false);
    release(); expect((await start).ok).toBe(true);
  });
  it('serves live HTTPS and WSS from the configured LAN origin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plot-tls-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-subj', '/CN=localhost'], { stdio: 'ignore' });
    const runner = await startRunner({ connectionPolicy: 'auto', directory: dir, socketDirectory: dir, core: new PlotterCore(fakeTransport().transport) }); cleanup.push(() => runner.close());
    const api = await startApi({ directory: dir, socketDirectory: dir, port: 0, allowLoopback: true, tls: { key: await readFile(join(dir, 'key.pem')), cert: await readFile(join(dir, 'cert.pem')), port: 0, host: '127.0.0.1' } }); cleanup.push(() => api.close());
    const url = api.tlsUrl!;
    const response = await new Promise<{ status?: number; cache?: string }>((resolve, reject) => { httpsGet(url + '/api/v1/status', { rejectUnauthorized: false }, res => { res.resume(); resolve({ status: res.statusCode, cache: res.headers['cache-control'] }); }).on('error', reject); });
    expect(response).toEqual({ status: 200, cache: 'no-store' });
    const ws = new WebSocket(url.replace('https:', 'wss:') + '/api/v1/ws', { origin: url, rejectUnauthorized: false }); cleanup.push(async () => ws.terminate());
    await new Promise<void>((resolve, reject) => { ws.once('message', data => { expect(JSON.parse(data.toString()).type).toBe('snapshot'); resolve(); }); ws.once('error', reject); });
    expect(ws.extensions).toBe('');
  });
  it('owns controls, survives API restart, deduplicates Start, and settles before completion', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plot-network-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const fixture = fakeTransport('2.8.1', async command => { if (command.startsWith('LM,')) await gate; });
    const core = new PlotterCore(fixture.transport, { precompile: true });
    const runner = await startRunner({ connectionPolicy: 'auto', directory: dir, socketDirectory: dir, core }); cleanup.push(() => runner.close());
    let api = await startApi({ directory: dir, socketDirectory: dir, port: 0, host: '127.0.0.1', allowLoopback: true });
    cleanup.push(() => api.close()); const url = api.url;
    const a = await connect(url), b = await connect(url);
    expect((await a.request('claim')).ok).toBe(true);
    expect((await b.request('claim')).ok).toBe(false);
    const envelope = job();
    const upload = await fetch(url + '/api/v1/jobs', { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' }, body: JSON.stringify(envelope) });
    expect(upload.status).toBe(201); const accepted = await upload.json() as { id: string };
    expect((await b.request('start', { jobId: accepted.id })).ok).toBe(false);
    expect((await a.request('start', { jobId: accepted.id })).ok).toBe(true);
    await wait(() => fixture.commands.some(c => c.startsWith('LM,')));
    expect(core.active).toBe(true);
    expect((await a.request('return-origin', { settings: envelope.plan.settings })).ok).toBe(false);
    expect((await a.request('invalidate-origin')).ok).toBe(false);
    const before = fixture.commands.length;
    expect((await a.request('start', { jobId: accepted.id })).ok).toBe(true);
    expect(fixture.commands.length).toBe(before);
    await api.close();
    expect(core.active).toBe(true);
    api = await startApi({ directory: dir, socketDirectory: dir, port: 0, host: '127.0.0.1', allowLoopback: true });
    const c = await connect(api.url); await wait(() => c.messages.some(m => m.type === 'snapshot' && m.snapshot.jobId === accepted.id));
    expect((await c.request('claim')).ok).toBe(true);
    expect((await c.request('pause')).ok).toBe(true);
    expect(core.progress.state).not.toBe('finished');
    expect((await c.request('stop')).ok).toBe(true); release();
    await wait(() => c.messages.some(m => m.type === 'snapshot' && m.snapshot.status === 'stopped'));
    expect(core.active).toBe(false); expect(core.originStatus).toBe('unset');
    const response = await fetch(api.url + '/api/v1/status'); expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await c.request('start', { jobId: accepted.id })).ok).toBe(true); expect(core.active).toBe(false);
  });
  it('rejects untrusted hosts, origins and oversized uploads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plot-origin-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const runner = await startRunner({ connectionPolicy: 'auto', directory: dir, socketDirectory: dir, core: new PlotterCore(fakeTransport().transport) }); cleanup.push(() => runner.close());
    const api = await startApi({ directory: dir, socketDirectory: dir, port: 0, host: '127.0.0.1', allowLoopback: true, maxBytes: 32 }); cleanup.push(() => api.close());
    expect((await fetch(api.url + '/api/v1/jobs', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' })).status).toBe(403);
    expect((await fetch(api.url + '/api/v1/jobs', { method: 'POST', headers: { Origin: api.url }, body: 'x'.repeat(33) })).status).toBe(413);
    const hostStatus = await new Promise(resolve => { const req = httpRequest(api.url + '/api/v1/status', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.end(); });
    expect(hostStatus).toBe(403);
  });
  it('admits only one streamed upload while live controls stay responsive', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plot-upload-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const runner = await startRunner({ connectionPolicy: 'auto', directory: dir, socketDirectory: dir, core: new PlotterCore(fakeTransport().transport) }); cleanup.push(() => runner.close());
    const api = await startApi({ directory: dir, socketDirectory: dir, port: 0, allowLoopback: true }); cleanup.push(() => api.close());
    const upload = httpRequest(api.url + '/api/v1/jobs', { method: 'POST', headers: { Origin: api.url, 'Content-Type': 'application/json' } });
    upload.on('error', () => undefined); cleanup.push(async () => { upload.destroy(); }); upload.write('{');
    await new Promise(r => setTimeout(r, 30));
    const client = await connect(api.url); expect((await client.request('claim')).ok).toBe(true);
    expect((await client.request('set-origin', { profile: 'axidraw' })).ok).toBe(true);
    expect((await fetch(api.url + '/api/v1/jobs', { method: 'POST', headers: { Origin: api.url }, body: JSON.stringify(job()) })).status).toBe(429);
    upload.destroy();
  });
});
