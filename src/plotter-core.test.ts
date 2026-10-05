import { describe, expect, it } from 'vitest';
import { PlotterCore } from './plotter-core';
import { buildMotionPlan } from './motion-plan';
import { initialState } from './model';

import { fakeTransport } from '../server/test-fixtures/fake-ebb';
import { EventEmitter } from 'node:events';
import { LatestChannel } from '../server/ipc';

describe('transport-independent execution', () => {
  it('bounds malformed serial replies before they enter diagnostics or telemetry', async () => {
    const port = {
      readable: new ReadableStream<Uint8Array>({ start(input) { input.enqueue(new TextEncoder().encode('x'.repeat(65537) + '\r\n')); } }),
      writable: new WritableStream<Uint8Array>({ write() {} }),
      async open() {}, async close() {}, getInfo: () => ({ usbVendorId: 0x04d8, usbProductId: 0xfd92 }),
    };
    const core = new PlotterCore({ supported: true, requestPort: async () => port });
    await expect(core.connect()).rejects.toThrow('response limit');
    expect(core.connected).toBe(false);
  });
  it('feeds a simulated one-slot motion FIFO equally with a blocked telemetry consumer', async () => {
    const points = Array.from({ length: 33 }, (_, i) => ({ x: 20 * Math.cos(i * Math.PI / 16), y: 20 * Math.sin(i * Math.PI / 16) }));
    const plan = buildMotionPlan([{ tool: '#000000', points }], initialState.settings);
    const moves = plan.events.filter(event => event.kind === 'xy');
    async function execute(blocked: boolean) {
      let clock = 0, activeEnd = 0, queuedEnd = 0, index = 0, gaps = 0;
      const fixture = fakeTransport('2.8.1', command => {
        if (!command.startsWith('LM,')) return;
        // One active move and one queued move: full FIFO delays its next ACK.
        if (queuedEnd > clock) { clock = Math.max(clock, activeEnd); activeEnd = queuedEnd; }
        if (index && clock > activeEnd && moves[index]!.initialSpeed > 0) gaps++;
        const end = Math.max(clock, activeEnd) + moves[index++]!.duration * 1000;
        if (activeEnd <= clock) activeEnd = end; else queuedEnd = end;
        clock += 1; // Firmware processing and reply delivery.
      });
      const sink = new EventEmitter() as EventEmitter & { write(data: string): boolean; destroyed: boolean };
      sink.destroyed = false; sink.write = () => !blocked; const channel = new LatestChannel(sink);
      const core = new PlotterCore(fixture.transport, { precompile: true });
      core.onProgress = progress => channel.publish(progress);
      await core.connect(); await core.plot(plan); await core.disconnect();
      expect(channel.pendingCount).toBeLessThanOrEqual(1);
      return { commands: fixture.commands, gaps, clock };
    }
    expect(await execute(true)).toEqual(await execute(false));
  });
  it.each(['2.4.6', '2.8.1'])('executes the same commands when precompiled on firmware %s', async version => {
    const plan = buildMotionPlan([{ tool: '#000000', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }], initialState.settings);
    const direct = fakeTransport(version), prepared = fakeTransport(version);
    const a = new PlotterCore(direct.transport), b = new PlotterCore(prepared.transport, { precompile: true });
    await a.connect(); await b.connect(); await a.plot(plan); await b.plot(plan);
    expect(prepared.commands).toEqual(direct.commands);
    expect(b.active).toBe(false); expect(b.originStatus).toBe('unset');
    await a.disconnect(); await b.disconnect();
  });
  it('allows pause and stop while initialization is awaiting an acknowledgement', async () => {
    let core!: PlotterCore;
    const fixture = fakeTransport('2.8.1', command => { if (command === 'CS') { core.pause(); core.stop(); } });
    core = new PlotterCore(fixture.transport, { precompile: true });
    await core.connect();
    await core.plot(buildMotionPlan([{ tool: '#000000', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }], initialState.settings));
    expect(fixture.commands.some(c => c.startsWith('LM,'))).toBe(false);
    expect(core.progress.state).toBe('stopped'); await core.disconnect();
  });
});
