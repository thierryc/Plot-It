import { unavailablePower } from './ebb-power';
import type { PenSettings } from './pen-control';
import { initialState, type PlotSettings, type Point } from './model';
import type { MotionPlan } from './motion-plan';
import type { PlotProgress, PlotterTrace, PlotterJobTrace } from './plotter-core';
import type { PlotSignal } from './plot-signals';
import type { PlotDestination } from './plot-destination';
import { terminalStatus, type ControlAction, type ControlResult, type JobRecord, type NetworkSnapshot } from './network-protocol';

/** Same-origin destination. Network disconnection never cancels server execution. */
export class NetworkPlotter implements PlotDestination {
  onConnectionChange = () => {};
  onProgress: (progress: PlotProgress) => void = () => {};
  onPosition: ((position: Point) => void) | null = null;
  onSignal: (signal: PlotSignal) => void = () => {};
  get executionSignal(): PlotSignal | null { return this.snapshot.signal ?? null; }
  onError: (message: string) => void = () => {};
  private socket: WebSocket | null = null;
  private opening: Promise<void> | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private controlling = false;
  private settings = structuredClone(initialState.settings);
  private pending = new Map<string, { resolve: (result: ControlResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private watchers = new Set<() => void>();
  private trace: PlotterTrace[] = [];
  private penTrace: PlotterTrace[] = [];
  private jobTrace: PlotterJobTrace | null = null;
  networkConnected = false;
  lastError = '';
  constructor(private snapshot: NetworkSnapshot) {}
  static async discover(): Promise<NetworkPlotter | null> {
    try {
      const response = await fetch('/api/v1/status', { cache: 'no-store', signal: AbortSignal.timeout(2000) });
      if (!response.ok && response.status !== 503) return null;
      const status = await response.json();
      return status.version === 1 && status.mode === 'network' ? new NetworkPlotter(status.snapshot ?? {
        epoch: 'unavailable', revision: 0, timestamp: Date.now(), connected: false, connecting: false, firmware: null,
        jobId: null, status: 'idle', progress: { completed: 0, total: 0, state: 'idle' }, position: null,
        positionTimestamp: null, origin: 'unset', originProfile: null, motorsOn: false, canAdjustPen: false,
      }) : null;
    } catch { return null; }
  }
  get supported() { return true; }
  get connected() { return this.networkConnected && this.snapshot.connected; }
  get connecting() { return this.opening !== null || this.snapshot.connecting; }
  get powerStatus() { return this.snapshot.power ?? unavailablePower(); }
  get elapsedMs() { return this.snapshot.elapsedMs ?? 0; }
  async checkPowerSupply() { await this.request('check-power'); return this.powerStatus; }
  get firmwareLabel() { return this.snapshot.firmware; }
  get active() { return this.snapshot.jobId !== null && !terminalStatus(this.snapshot.status) && this.snapshot.status !== 'idle'; }
  get progress(): PlotProgress {
    const state = this.snapshot.status === 'running' ? 'plotting' : this.snapshot.status === 'failed' || this.snapshot.status === 'interrupted' ? 'cancelled' : this.snapshot.status === 'pending' || this.snapshot.status === 'starting' ? 'plotting' : this.snapshot.status;
    return { ...this.snapshot.progress, state };
  }
  get canAdjustPen() { return this.connected && this.controlling && this.snapshot.canAdjustPen; }
  get originAvailable() { return this.connected && this.snapshot.origin !== 'unset' && !this.active; }
  get originStatus() { return this.snapshot.origin; }
  get motorsOn() { return this.snapshot.motorsOn; }
  get hasControl() { return this.controlling; }
  get currentJobId() { return this.snapshot.jobId; }
  hasOrigin(profile: PlotSettings['profile']) { return this.connected && this.snapshot.origin !== 'unset' && this.snapshot.originProfile === profile; }
  get diagnosticTrace() { return this.trace; }
  get diagnosticPenTrace() { return this.penTrace; }
  get diagnosticJobTrace() { return this.jobTrace; }
  configurePen(settings: PenSettings) { this.settings = { ...this.settings, ...settings }; }
  invalidateOrigin() { this.background('invalidate-origin'); }
  pause() { this.background('pause'); }
  resume() { this.background(this.snapshot.status === 'tool-change' ? 'continue' : 'resume'); }
  stop() { this.background('stop'); }
  cancel() { this.background('cancel'); }
  private background(action: ControlAction) { void this.request(action).catch(error => this.report(error)); }
  private report(error: unknown) { this.lastError = error instanceof Error ? error.message : String(error); this.onError(this.lastError); }
  private async open() {
    if (this.networkConnected) return;
    if (this.opening) return this.opening;
    this.disposed = false;
    this.opening = new Promise<void>((resolve, reject) => {
      const url = new URL('/api/v1/ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = this.socket = new WebSocket(url);
      let ready = false;
      const timer = setTimeout(() => { reject(new Error('Network connection timed out')); socket.close(); }, 5000);
      socket.onopen = () => { this.networkConnected = true; this.onConnectionChange(); };
      socket.onmessage = event => {
        try {
          if (typeof event.data !== 'string' || event.data.length > 65536) throw new Error('Invalid network frame');
          const message = JSON.parse(event.data);
          if (message.type === 'result') {
            const pending = this.pending.get(message.requestId); if (pending) { this.pending.delete(message.requestId); clearTimeout(pending.timer); pending.resolve(message); }
          } else if (message.type === 'snapshot') {
            const next = message.snapshot as NetworkSnapshot;
            if (!ready) { ready = true; clearTimeout(timer); resolve(); }
            if (next.epoch === this.snapshot.epoch && next.revision <= this.snapshot.revision) return;
            const freshPosition = next.positionTimestamp !== this.snapshot.positionTimestamp || next.epoch !== this.snapshot.epoch || next.jobId !== this.snapshot.jobId;
            const freshSignal = next.signal && (next.epoch !== this.snapshot.epoch || next.jobId !== this.snapshot.jobId || next.signal.eventIndex !== this.snapshot.signal?.eventIndex || next.signal.phase !== this.snapshot.signal?.phase);
            const changed = !this.networkConnected || next.connected !== this.snapshot.connected || next.connecting !== this.snapshot.connecting || next.jobId !== this.snapshot.jobId || next.status !== this.snapshot.status || next.canAdjustPen !== this.snapshot.canAdjustPen || next.motorsOn !== this.snapshot.motorsOn || next.origin !== this.snapshot.origin || next.error !== this.snapshot.error || JSON.stringify(next.power) !== JSON.stringify(this.snapshot.power);
            this.networkConnected = true; this.snapshot = next; if (changed) this.onConnectionChange();
            if (next.position && freshPosition) this.onPosition?.(next.position);
            if (freshSignal) this.onSignal(next.signal!);
            this.onProgress(this.progress); for (const watcher of this.watchers) watcher();
          } else if (message.type === 'ownership') { this.controlling = message.controlling; this.onConnectionChange(); }
          else if (message.type === 'offline') { this.networkConnected = false; this.controlling = false; this.snapshot = { ...this.snapshot, revision: -1 }; this.onConnectionChange(); this.report(new Error('Runner connection lost. Check job state after reconnecting.')); }
        } catch (error) { this.report(error); socket.close(); }
      };
      socket.onerror = () => { if (!ready) { clearTimeout(timer); reject(new Error('Could not reach the network plotter')); } };
      socket.onclose = () => {
        clearTimeout(timer); this.networkConnected = false; this.controlling = false; this.opening = null;
        if (!ready) reject(new Error('Network connection closed'));
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Connection lost; command outcome is unknown.')); } this.pending.clear();
        this.onConnectionChange(); if (!this.disposed) this.reconnect = setTimeout(() => { void this.open().catch(error => this.report(error)); }, 1000);
      };
    });
    try { await this.opening; } finally { this.opening = null; this.onConnectionChange(); }
  }
  async connect() {
    await this.open(); await this.request('claim'); this.controlling = true; this.onConnectionChange();
    return `Network plotter · EBB ${this.firmwareLabel ?? 'not connected'}`;
  }
  async watch() { await this.open(); }
  async connectEbb() { await this.request('connect-ebb'); }
  async disconnectEbb(settings: PlotSettings = this.settings) { await this.request('disconnect-ebb', { settings }); }
  async releaseControl() { await this.request('release-control'); this.controlling = false; this.onConnectionChange(); }
  async disconnect() {
    this.disposed = true; if (this.reconnect) clearTimeout(this.reconnect);
    this.socket?.close(); this.socket = null; this.networkConnected = false; this.controlling = false;
  }
  private async request(action: ControlAction | 'claim' | 'release-control', params: object = {}) {
    if (!this.networkConnected || !this.socket || this.socket.readyState !== 1) throw new Error('Network plotter is unavailable');
    if (action !== 'claim' && !this.controlling) throw new Error('Claim control before operating the plotter');
    if (this.pending.size >= 16 || this.socket.bufferedAmount > 65536) throw new Error('Network control channel is busy');
    const requestId = crypto.randomUUID();
    const result = await new Promise<ControlResult>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('Control timed out; check job state before retrying.')); }, 10000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ version: 1, requestId, action, ...params }));
    });
    if (!result.ok) throw new Error(result.error ?? 'Control rejected'); return result.value;
  }
  async firmwareVersion() { return this.firmwareLabel ?? ''; }
  async setPen(percent: number) { await this.request('pen', { percent, settings: this.settings }); }
  async setOrigin(profile: PlotSettings['profile'] = 'axidraw') { await this.request('set-origin', { profile }); }
  async ensureOrigin(profile: PlotSettings['profile']) { if (!this.hasOrigin(profile)) await this.setOrigin(profile); }
  async returnToOrigin(settings: PlotSettings) { await this.request('return-origin', { settings }); }
  async engageMotors() { await this.request('engage'); }
  async disengageMotors(penUp = this.settings.penUp) { await this.request('release', { settings: { ...this.settings, penUp } }); }
  async refreshDiagnostics() {
    type Diagnostics = { entries: PlotterTrace[]; penTransitions: PlotterTrace[]; job: PlotterJobTrace | null; download?: string };
    let result = await this.request('diagnostics') as Diagnostics;
    if (result.download) {
      if (!/^\/api\/v1\/jobs\/[a-zA-Z0-9_-]+\/diagnostics$/.test(result.download)) throw new Error('Invalid diagnostics URL');
      const response = await fetch(result.download, { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not download plot diagnostics');
      result = await response.json() as Diagnostics;
    }
    this.trace = result.entries; this.penTrace = result.penTransitions; this.jobTrace = result.job;
  }
  async activePlan(): Promise<MotionPlan | null> {
    if (!this.snapshot.jobId) return null;
    const response = await fetch(`/api/v1/jobs/${this.snapshot.jobId}`, { cache: 'no-store' }); if (!response.ok) throw new Error('Could not recover active job');
    return ((await response.json()) as JobRecord).plan;
  }
  async plot(plan: MotionPlan) {
    this.settings = { ...plan.settings };
    const response = await fetch('/api/v1/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, requestId: crypto.randomUUID(), plan }) });
    const record = await response.json(); if (!response.ok) throw new Error(record.error ?? 'Job upload failed');
    await this.request('start', { jobId: record.id }); await this.waitForJob(record.id);
  }
  async waitForJob(jobId = this.snapshot.jobId) {
    if (!jobId) throw new Error('No active job');
    const epoch = this.snapshot.epoch;
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        if (this.snapshot.epoch !== epoch) { this.watchers.delete(check); reject(new Error('Runner restarted. Execution is uncertain; establish origin and prepare a new job.')); return; }
        if (this.snapshot.jobId !== jobId) return;
        if (!terminalStatus(this.snapshot.status)) return;
        this.watchers.delete(check);
        if (this.snapshot.status === 'failed' || this.snapshot.status === 'interrupted') reject(new Error(this.snapshot.error ?? 'Job requires recovery'));
        else resolve();
      };
      this.watchers.add(check); check();
    });
  }
}
