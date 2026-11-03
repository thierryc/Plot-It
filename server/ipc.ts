import { EventEmitter } from 'node:events';
import { connect, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { MAX_FRAME_BYTES, type ControlRequest, type ControlResult, type NetworkSnapshot } from '../src/network-protocol';

interface WritableChannel extends EventEmitter { write(data: string): boolean; destroyed: boolean }
/** At most one unsent snapshot. Drain never runs in the executor's call path. */
export class LatestChannel {
  private blocked = false; private pending: string | null = null;
  constructor(private stream: WritableChannel) { stream.on('drain', this.drain); stream.on('error', () => { this.pending = null; }); }
  get pendingCount() { return this.pending === null ? 0 : 1; }
  publish(value: unknown) {
    if (this.stream.destroyed) return;
    const message = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(message) > MAX_FRAME_BYTES) throw new Error('IPC snapshot too large');
    if (this.blocked) { this.pending = message; return; }
    this.blocked = !this.stream.write(message);
  }
  private drain = () => { this.blocked = false; const pending = this.pending; this.pending = null; if (pending && !this.stream.destroyed) this.blocked = !this.stream.write(pending); };
}
export function readFrames(socket: Socket, receive: (value: unknown) => void, maxBytes = MAX_FRAME_BYTES) {
  let buffer = Buffer.alloc(0);
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const separator = buffer.indexOf(10);
      if (separator < 0) { if (buffer.length > maxBytes) socket.destroy(new Error('IPC frame exceeds limit')); return; }
      if (separator > maxBytes) { socket.destroy(new Error('IPC frame exceeds limit')); return; }
      const line = buffer.subarray(0, separator); buffer = buffer.subarray(separator + 1);
      try { receive(JSON.parse(line.toString())); } catch { socket.destroy(new Error('Invalid IPC message')); return; }
    }
  });
}
export class RunnerClient extends EventEmitter {
  snapshot: NetworkSnapshot | null = null;
  private control: Socket | null = null; private telemetry: Socket | null = null;
  private pending = new Map<string, { resolve: (r: ControlResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private closed = false; private reconnect: ReturnType<typeof setTimeout> | null = null;
  constructor(private controlPath: string, private telemetryPath: string) { super(); this.open(); }
  private open() {
    if (this.closed) return;
    const control = this.control = connect(this.controlPath), telemetry = this.telemetry = connect(this.telemetryPath);
    readFrames(control, value => {
      const result = value as ControlResult; const entry = this.pending.get(result.requestId);
      if (entry) { clearTimeout(entry.timer); this.pending.delete(result.requestId); entry.resolve(result); }
    });
    readFrames(telemetry, value => { this.snapshot = value as NetworkSnapshot; this.emit('snapshot', this.snapshot); });
    const disconnect = () => {
      if (this.control !== control) return;
      this.control = null; this.telemetry = null; control.destroy(); telemetry.destroy(); this.snapshot = null;
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Runner connection lost; command result unknown.')); } this.pending.clear();
      this.emit('offline'); if (!this.closed) this.reconnect = setTimeout(() => this.open(), 500);
    };
    control.on('error', () => undefined); telemetry.on('error', () => undefined); control.on('close', disconnect); telemetry.on('close', disconnect);
  }
  async ready(timeout = 5000) {
    if (this.snapshot) return;
    await new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { this.off('snapshot', done); reject(new Error('Runner unavailable')); }, timeout);
      this.once('snapshot', done);
    });
  }
  request(request: ControlRequest): Promise<ControlResult> {
    if (!this.control || this.control.connecting || this.control.destroyed) return Promise.reject(new Error('Runner unavailable'));
    if (this.pending.size >= 16 || this.control.writableLength > MAX_FRAME_BYTES) return Promise.reject(new Error('Control channel busy'));
    const wireId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(wireId); reject(new Error('Control timed out; check current state before retrying.')); }, 10000);
      this.pending.set(wireId, { resolve: result => resolve({ ...result, requestId: request.requestId }), reject, timer });
      this.control!.write(JSON.stringify({ ...request, clientRequestId: request.requestId, requestId: wireId }) + '\n');
    });
  }
  close() { this.closed = true; if (this.reconnect) clearTimeout(this.reconnect); this.control?.destroy(); this.telemetry?.destroy(); }
}
