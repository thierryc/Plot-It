// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkPlotter } from './network-plotter';
import type { NetworkSnapshot } from './network-protocol';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const snapshot: NetworkSnapshot = { epoch: 'test-runner', revision: 1, timestamp: 1, connected: true, connecting: false, firmware: '2.8.1', jobId: null, status: 'idle', progress: { completed: 0, total: 0, state: 'idle' }, position: null, positionTimestamp: null, origin: 'unset', originProfile: null, motorsOn: false, canAdjustPen: true };
class FakeSocket {
  static current: FakeSocket; readyState = 1;
  onopen: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null;
  sent: any[] = [];
  constructor() { FakeSocket.current = this; queueMicrotask(() => { this.onopen?.(); this.receive({ type: 'snapshot', snapshot }); }); }
  send(text: string) { const request = JSON.parse(text); this.sent.push(request); queueMicrotask(() => this.receive({ type: 'result', requestId: request.requestId, ok: true })); }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}
afterEach(() => { vi.unstubAllGlobals(); });
describe('network destination', () => {
  it('claims control separately from opening USB and releases USB separately from viewing', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const plotter = new NetworkPlotter(snapshot); await plotter.connect();
    expect(FakeSocket.current.sent.map(r => r.action)).toEqual(['claim']);
    await plotter.connectEbb(); await plotter.disconnectEbb(); await plotter.releaseControl();
    expect(FakeSocket.current.sent.map(r => r.action)).toEqual(['claim', 'connect-ebb', 'disconnect-ebb', 'release-control']);
    expect(plotter.networkConnected).toBe(true); expect(plotter.hasControl).toBe(false);
    await plotter.disconnect();
  });
  it('sends edited pen calibration and refreshes controls when cleanup settles', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const plotter = new NetworkPlotter(snapshot); await plotter.connect();
    plotter.configurePen({ penUp: 30, penDown: 52 }); await plotter.setPen(52);
    expect(FakeSocket.current.sent.at(-1).settings).toMatchObject({ penUp: 30, penDown: 52 });
    FakeSocket.current.receive({ type: 'snapshot', snapshot: { ...snapshot, revision: 2, canAdjustPen: false, status: 'stopped' } });
    const changed = vi.fn(); plotter.onConnectionChange = changed;
    FakeSocket.current.receive({ type: 'snapshot', snapshot: { ...snapshot, revision: 3, canAdjustPen: true, status: 'stopped' } });
    expect(changed).toHaveBeenCalledOnce(); expect(plotter.canAdjustPen).toBe(true);
    await plotter.disconnect();
  });
  it('does not treat a repeated cached counter sample as a fresh observation', async () => {
    vi.stubGlobal('WebSocket', FakeSocket); const plotter = new NetworkPlotter(snapshot); await plotter.watch();
    const observe = vi.fn(); plotter.onPosition = observe;
    for (const revision of [2, 3]) FakeSocket.current.receive({ type: 'snapshot', snapshot: { ...snapshot, revision, position: { x: 1, y: 2 }, positionTimestamp: 100 } });
    expect(observe).toHaveBeenCalledTimes(1);
    FakeSocket.current.receive({ type: 'snapshot', snapshot: { ...snapshot, revision: 4, position: { x: 1, y: 2 }, positionTimestamp: 200 } });
    expect(observe).toHaveBeenCalledTimes(2); await plotter.disconnect();
  });
  it('discovers the Pi even while its independent runner is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ version: 1, mode: 'network', snapshot: null }) })));
    const plotter = await NetworkPlotter.discover();
    expect(plotter).not.toBeNull(); expect(plotter?.connected).toBe(false);
  });
  it('reconnects as a viewer without replaying Start or claiming ownership', async () => {
    vi.useFakeTimers(); vi.stubGlobal('WebSocket', FakeSocket);
    const plotter = new NetworkPlotter(snapshot); await plotter.connect();
    FakeSocket.current.receive({ type: 'snapshot', snapshot: { ...snapshot, revision: 2, jobId: 'job', status: 'running' } });
    const completed = plotter.waitForJob(); FakeSocket.current.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.current.sent).toEqual([]); expect(plotter.hasControl).toBe(false);
    FakeSocket.current.receive({ type: 'snapshot', snapshot: { ...snapshot, revision: 3, jobId: 'job', status: 'tool-change', progress: { completed: 1, total: 3, state: 'tool-change', tool: '#ff0000' } } });
    expect(plotter.progress.state).toBe('tool-change');
    FakeSocket.current.receive({ type: 'snapshot', snapshot: { ...snapshot, revision: 4, jobId: 'job', status: 'finished' } });
    await completed; await plotter.disconnect(); vi.useRealTimers();
  });
  it('claims explicitly and distinguishes requested pause from settled pause', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const plotter = new NetworkPlotter(snapshot);
    await plotter.connect(); expect(FakeSocket.current.sent[0].action).toBe('claim');
    plotter.cancel(); await Promise.resolve(); expect(FakeSocket.current.sent.at(-1).action).toBe('cancel');
    const received: string[] = []; plotter.onProgress = progress => received.push(progress.state);
    FakeSocket.current.receive({ type: 'snapshot', snapshot: { ...snapshot, revision: 2, jobId: 'job', status: 'pausing', progress: { completed: 1, total: 3, state: 'plotting' } } });
    FakeSocket.current.receive({ type: 'snapshot', snapshot: { ...snapshot, revision: 3, jobId: 'job', status: 'paused', progress: { completed: 1, total: 3, state: 'paused' } } });
    expect(received).toEqual(['pausing', 'paused']);
    FakeSocket.current.receive({ type: 'snapshot', snapshot: { ...snapshot, revision: 2 } }); expect(plotter.active).toBe(true);
    await plotter.disconnect();
  });
  it('does not present lost network connectivity as a USB failure or successful completion', async () => {
    vi.stubGlobal('WebSocket', FakeSocket); const plotter = new NetworkPlotter(snapshot); await plotter.connect();
    FakeSocket.current.close(); expect(plotter.networkConnected).toBe(false); expect(plotter.connected).toBe(false);
    expect(plotter.firmwareLabel).toBe('2.8.1'); await plotter.disconnect();
  });
  it('never caches API data or falls back to HTML for a live status request', () => {
    const listeners = new Map<string, (event: any) => void>(); const fetch = vi.fn();
    runInNewContext(readFileSync('public/sw.js', 'utf8'), { self: { addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback), location: { origin: 'https://plot.local' } }, URL, fetch });
    const respondWith = vi.fn();
    listeners.get('fetch')!({ request: { method: 'GET', url: 'https://plot.local/api/v1/status' }, respondWith });
    expect(respondWith).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});
