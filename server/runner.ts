import { createServer, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdir, chmod, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { PlotterCore } from '../src/plotter-core';
import { isId, validateControl, validateJob, terminalStatus, type ControlRequest, type ControlResult, type NetworkSnapshot, type JobStatus } from '../src/network-protocol';
import { JobStore } from './jobs';
import { LatestChannel, readFrames } from './ipc';

export interface RunnerOptions { directory: string; socketDirectory: string; core: PlotterCore; maxEvents?: number; connectionPolicy?: 'manual' | 'auto' }
export async function startRunner(options: RunnerOptions) {
  const { core } = options, store = new JobStore(options.directory, options.maxEvents);
  await mkdir(options.socketDirectory, { recursive: true, mode: 0o700 });
  // A second runner must not unlink a live socket and acquire the same hardware.
  const { connect } = await import('node:net');
  const controlPath = join(options.socketDirectory, 'control.sock'), telemetryPath = join(options.socketDirectory, 'telemetry.sock');
  const existing = await new Promise<boolean>(resolve => { const socket = connect(controlPath); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); });
  if (existing) throw new Error('Another runner owns the control socket');
  const interrupted = await store.recoverInterrupted();
  let recoveryRequired = interrupted > 0;
  const epoch = randomUUID();
  await unlink(controlPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await unlink(telemetryPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  let jobId: string | null = null, status: NetworkSnapshot['status'] = 'idle', error: string | undefined;
  let position: NetworkSnapshot['position'] = null, positionTimestamp: number | null = null, revision = 0;
  let starting = false, task: Promise<void> | null = null, closed = false, manualBusy = false;
  let preparation: Promise<void> | null = null;
  let manualCompletion: Promise<void> | null = null;
  const connectionPolicy = options.connectionPolicy ?? 'manual';
  let connectionDesired = connectionPolicy === 'auto', connecting: Promise<void> | null = null;
  const controls = new Set<Socket>(), channels = new Map<Socket, LatestChannel>();
  let persistence = Promise.resolve();
  const persist = () => {
    if (!jobId || status === 'idle') return;
    const id = jobId, fields = { status: status as JobStatus, ...(error ? { error } : {}) };
    persistence = persistence.then(() => store.update(id, fields)).then(() => undefined).catch(reason => { error = `Could not persist job state: ${String(reason)}`; });
  };
  const snapshot = (): NetworkSnapshot => ({ epoch, revision: ++revision, timestamp: Date.now(), connected: core.connected, connecting: core.connecting, firmware: core.firmwareLabel,
    jobId, status, progress: core.progress, position, positionTimestamp, origin: core.originStatus,
    originProfile: core.hasOrigin('axidraw') ? 'axidraw' : core.hasOrigin('xylodraw') ? 'xylodraw' : null, motorsOn: core.motorsOn, canAdjustPen: core.canAdjustPen, connectionPolicy, connectionDesired, ...(error ? { error: error.slice(0, 4096) } : {}) });
  const publish = () => { const current = snapshot(); for (const channel of channels.values()) channel.publish(current); };
  core.onProgress = progress => {
    const next = progress.state === 'plotting' ? 'running' : progress.state === 'cancelled' ? 'failed' : progress.state;
    if (next !== 'idle' && next !== status) { status = next; publish(); persist(); }
  };
  core.onPosition = observed => { position = observed; positionTimestamp = Date.now(); };
  core.onConnectionChange = publish;
  const connectDevice = async () => {
    if (connecting) return connecting;
    if (closed || !connectionDesired || core.connected || core.active || starting || manualBusy) return;
    connecting = core.connect().then(() => { error = undefined; }, reason => { error = (reason as Error).message; throw reason; }).finally(() => { connecting = null; publish(); });
    return connecting;
  };
  const results = new Map<string, { fingerprint: string; promise: Promise<ControlResult> }>();
  async function execute(request: ControlRequest & { clientRequestId?: string }): Promise<unknown> {
    if (closed) throw new Error('Runner is shutting down');
    if (request.action === 'start') {
      if (request.jobId === jobId) return { jobId, status, duplicate: true };
      if (starting || task || core.active || manualBusy || connecting) throw new Error('Plotter is busy');
      const record = await store.get(request.jobId!);
      // Started jobs are immutable execution identities, including terminal jobs.
      if (record.startRequestId) return { jobId: record.id, status: record.status, duplicate: true };
      if (starting || task || core.active || manualBusy || connecting) throw new Error('Plotter is busy');
      if (!core.connected) throw new Error('EBB is not connected');
      if (recoveryRequired) throw new Error('Interrupted execution: explicitly establish origin before starting a new job');
      starting = true;
      let prepared!: () => void; preparation = new Promise<void>(resolve => { prepared = resolve; });
      try {
        validateJob(record, { maxEvents: options.maxEvents });
        await persistence;
        await store.update(record.id, { status: 'starting', startRequestId: request.clientRequestId ?? request.requestId });
        if (closed) { await store.update(record.id, { status: 'interrupted' }); throw new Error('Runner shut down during preparation'); }
        jobId = record.id; status = 'starting'; error = undefined; position = null; positionTimestamp = null; publish();
        task = core.plot(record.plan).catch(reason => {
          status = core.connected ? 'failed' : 'interrupted';
          if (status === 'interrupted') recoveryRequired = true;
          error = (reason as Error).message; publish(); persist();
        }).finally(() => { task = null; starting = false; publish(); });
        return { jobId };
      } catch (reason) { starting = false; throw reason; }
      finally { prepared(); preparation = null; }
    }
    if (request.action === 'pause') {
      if (!task || terminalStatus(status) || status === 'stopping' || status === 'returning') throw new Error('No pausable job');
      core.pause(); if (!['paused', 'tool-change'].includes(status)) status = 'pausing'; publish(); return;
    }
    if (request.action === 'resume' || request.action === 'continue') {
      if (!task || !['paused', 'tool-change'].includes(status)) throw new Error('Wait until the plotter is paused');
      core.resume(); return;
    }
    if (request.action === 'stop') {
      if (!task) throw new Error('No active job'); core.stop(); status = 'stopping'; publish(); return;
    }
    if (request.action === 'cancel') {
      if (!task) throw new Error('No active job'); core.cancel(); status = 'stopping'; error = 'Execution was cancelled; origin is uncertain'; publish(); return;
    }
    if (request.action === 'connect-ebb') {
      if (starting || task || core.active || manualBusy || connecting) throw new Error('Wait until the plotter is idle before connecting');
      connectionDesired = true; await connectDevice(); publish(); return;
    }
    if (starting && !task || manualBusy) throw new Error('Plotter is busy preparing or handling a manual command');
    manualBusy = true;
    let settled!: () => void; manualCompletion = new Promise<void>(resolve => { settled = resolve; });
    try {
    if (request.action === 'disconnect-ebb') {
      if (starting || task || core.active || connecting) throw new Error('Wait until the job has stopped before releasing server USB');
      if (core.connected) {
        core.configurePen(request.settings!);
        await core.disengageMotors(request.settings!.penUp);
        await core.disconnect();
      }
      connectionDesired = false; error = undefined;
    }
    else if (request.action === 'pen') {
      // An active plan owns its calibration, including settled pen-change waits.
      if (!core.active && request.settings) core.configurePen(request.settings);
      await core.setPen(request.percent!, true);
    }
    else if (request.action === 'set-origin') { await core.setOrigin(request.profile!); recoveryRequired = false; }
    else if (request.action === 'return-origin') await core.returnToOrigin(request.settings!);
    else if (request.action === 'engage') await core.engageMotors();
    else if (request.action === 'release') await core.disengageMotors(request.settings!.penUp);
    else if (request.action === 'invalidate-origin') core.invalidateOrigin();
    else if (request.action === 'mark') core.markPenMovement();
    else if (request.action === 'diagnostics') {
      if (core.active || starting) throw new Error('Download diagnostics after plotting has stopped');
      const trace = core.diagnosticJobTrace;
      return { entries: core.diagnosticTrace.slice(-20), penTransitions: core.diagnosticPenTrace.slice(-20), job: trace ? { ...trace, plannedPenEvents: trace.plannedPenEvents.slice(-20), entries: trace.entries.slice(-20), droppedEntries: trace.droppedEntries + Math.max(0, trace.entries.length - 20) } : null };
    } else throw new Error('Unsupported runner command');
    publish();
    } finally { manualBusy = false; settled(); manualCompletion = null; publish(); }
  }
  const controlServer = createServer(socket => {
    if (controls.size >= 4) { socket.destroy(); return; } controls.add(socket);
    let pending = 0;
    socket.on('error', () => undefined); socket.on('close', () => controls.delete(socket));
    readFrames(socket, raw => {
      if (++pending > 16) { socket.destroy(); return; }
      void (async () => {
        let requestId = '';
        try {
          if (raw && typeof raw === 'object' && isId((raw as { requestId?: unknown }).requestId)) requestId = (raw as { requestId: string }).requestId;
          const request = validateControl(raw) as ControlRequest & { clientRequestId?: string };
          const id = request.clientRequestId ?? requestId;
          const fingerprint = JSON.stringify({ ...request, requestId: undefined, clientRequestId: undefined });
          let entry = results.get(id);
          if (entry && entry.fingerprint !== fingerprint) throw new Error('Control request ID reused for different command');
          if (!entry) {
            const promise = execute(request).then(value => ({ type: 'result' as const, requestId, ok: true, value }), reason => ({ type: 'result' as const, requestId, ok: false, error: (reason as Error).message }));
            entry = { fingerprint, promise }; results.set(id, entry);
            if (results.size > 256) results.delete(results.keys().next().value!);
          }
          const result = { ...await entry.promise, requestId };
          let message = JSON.stringify(result) + '\n';
          if (Buffer.byteLength(message) > 65536) message = JSON.stringify({ type: 'result', requestId, ok: false, error: 'Result exceeds control frame limit' }) + '\n';
          if (!socket.destroyed && socket.writableLength < 65536) socket.write(message); else socket.destroy();
        } catch (reason) { if (!socket.destroyed) socket.write(JSON.stringify({ type: 'result', requestId, ok: false, error: (reason as Error).message }) + '\n'); }
        finally { pending--; }
      })();
    });
  });
  const telemetryServer = createServer(socket => {
    if (channels.size >= 4) { socket.destroy(); return; }
    const channel = new LatestChannel(socket); channels.set(socket, channel);
    socket.on('error', () => undefined); socket.on('close', () => channels.delete(socket)); channel.publish(snapshot());
  });
  await Promise.all([new Promise<void>((resolve, reject) => { controlServer.once('error', reject); controlServer.listen(controlPath, resolve); }), new Promise<void>((resolve, reject) => { telemetryServer.once('error', reject); telemetryServer.listen(telemetryPath, resolve); })]);
  await chmod(controlPath, 0o600); await chmod(telemetryPath, 0o600);
  await connectDevice().catch(() => undefined);
  const telemetryTimer = setInterval(publish, 200), deviceTimer = setInterval(() => { void connectDevice().catch(() => undefined); }, 5000);
  return { snapshot, async close() {
    closed = true; clearInterval(telemetryTimer); clearInterval(deviceTimer);
    await preparation;
    await connecting?.catch(() => undefined);
    if (task) { core.cancel(); await task; }
    await manualCompletion;
    await persistence;
    for (const socket of controls) socket.destroy(); for (const socket of channels.keys()) socket.destroy();
    await Promise.all([new Promise<void>(resolve => controlServer.close(() => resolve())), new Promise<void>(resolve => telemetryServer.close(() => resolve()))]);
    if (core.connected) await core.disconnect(); await unlink(controlPath).catch(() => undefined); await unlink(telemetryPath).catch(() => undefined);
  } };
}
