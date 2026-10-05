import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PlotterCore, type SerialPortLike } from '../src/plotter-core';
import type { NetworkSnapshot } from '../src/network-protocol';

// Never detect or open hardware during the ordinary suite. The explicit launcher
// selects exactly one mode; absence of a board in that mode is a failure, not a skip.
const mode = process.env.PLOT_EBB_TEST_MODE;
if (mode && mode !== 'usb' && mode !== 'network') throw new Error('Unknown PLOT_EBB_TEST_MODE');

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('EBB connection check timed out')), 5000);
    })]);
  } finally { clearTimeout(timer!); }
}

describe.skipIf(mode !== 'usb')('deferred physical EBB USB connection', () => {
  let core: PlotterCore;
  let Transport: typeof import('./serial').NodeSerialTransport;
  const extraPorts: SerialPortLike[] = [];
  beforeEach(async () => {
    Transport = (await import('./serial')).NodeSerialTransport;
    core = new PlotterCore(new Transport(process.env.EBB_DEVICE));
    await core.connect();
  }, 10000);
  afterEach(async () => {
    for (const port of extraPorts.splice(0)) await port.close();
    if (core.connected) await core.disconnect();
  });

  it('discovers a real EBB USB device and completes its firmware handshake', async () => {
    const devices = await (await import('serialport')).SerialPort.list();
    expect(devices.some(device => device.vendorId?.toLowerCase() === '04d8' && device.productId?.toLowerCase() === 'fd92')).toBe(true);
    expect(core.connected).toBe(true);
    expect(core.firmwareLabel).toMatch(/^\d+\.\d+\.\d+$/);
    expect(core.originStatus).toBe('unset');
  });

  it('keeps repeated real firmware replies aligned without sending motion commands', async () => {
    for (let query = 0; query < 20; query++) expect(await bounded(core.firmwareVersion())).toContain(core.firmwareLabel!);
    const written = core.diagnosticTrace.filter(entry => entry.phase === 'written');
    expect(written).toHaveLength(21);
    expect(written.every(entry => entry.command === 'V')).toBe(true);
    expect(core.active).toBe(false);
  });

  it('rejects a second serial owner while the executor holds the board', async () => {
    const competitor = await new Transport(process.env.EBB_DEVICE).requestPort();
    extraPorts.push(competitor);
    await expect(competitor.open({ baudRate: 9600 })).rejects.toThrow();
    expect(await bounded(core.firmwareVersion())).toContain(core.firmwareLabel!);
  });

  it('closes and reopens the real serial connection without issuing origin-reset commands', async () => {
    const firmware = core.firmwareLabel;
    for (let cycle = 0; cycle < 3; cycle++) {
      await core.disconnect(); expect(core.connected).toBe(false);
      await core.connect(); expect(core.firmwareLabel).toBe(firmware);
      expect(core.originStatus).toBe('unset');
    }
    expect(core.diagnosticTrace.filter(entry => entry.phase === 'written').every(entry => entry.command === 'V')).toBe(true);
  });
});

describe.skipIf(mode !== 'network')('deferred Pi EBB connection over HTTP/HTTPS', () => {
  const sockets: WebSocket[] = [];
  const origin = () => new URL(process.env.PLOT_EBB_URL!).origin;
  afterEach(() => { for (const socket of sockets.splice(0)) socket.terminate(); });

  it('reports a physical EBB separately from API availability in live HTTP status', async () => {
    const response = await fetch(`${origin()}/api/v1/status`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    const status = await response.json() as { version: number; mode: string; snapshot: NetworkSnapshot };
    expect(status.version).toBe(1); expect(status.mode).toBe('network');
    expect(status.snapshot.connected).toBe(true);
    expect(status.snapshot.firmware).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('delivers authoritative EBB state and advancing revisions to a WebSocket viewer', async () => {
    const url = new URL('/api/v1/ws', origin()); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, { origin: origin(), handshakeTimeout: 5000 }); sockets.push(socket);
    const snapshots = await bounded(new Promise<NetworkSnapshot[]>((resolve, reject) => {
      const received: NetworkSnapshot[] = [];
      socket.on('error', reject);
      socket.on('close', () => reject(new Error('Viewer connection closed before live feedback')));
      socket.on('message', data => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'offline') throw new Error('Pi runner is unavailable');
          if (message.type !== 'snapshot') return;
          received.push(message.snapshot);
          if (received.length === 2) resolve(received);
        } catch (error) { reject(error); }
      });
    }));
    expect(snapshots.every(snapshot => snapshot.connected && /^\d+\.\d+\.\d+$/.test(snapshot.firmware ?? ''))).toBe(true);
    expect(snapshots[1]!.epoch).toBe(snapshots[0]!.epoch);
    expect(snapshots[1]!.revision).toBeGreaterThan(snapshots[0]!.revision);
    expect(socket.extensions).toBe('');
    // Viewer only: no claim, Start, motor, pen or origin commands are sent.
  });
});
