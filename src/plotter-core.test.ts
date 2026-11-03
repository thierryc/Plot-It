import { describe, expect, it } from 'vitest';
import { PlotterCore } from './plotter-core';
import { buildMotionPlan } from './motion-plan';
import { initialState } from './model';
import {PlotterSession,type SessionEvent} from '@thierryc/plotter-core';

import { fakeTransport } from '../server/test-fixtures/fake-ebb';
import { EventEmitter } from 'node:events';
import { LatestChannel } from '../server/ipc';

describe('transport-independent execution', () => {
  it.each(['failed','cancelled'] as const)('invalidates pen confirmation on %s state when failure exchange diagnostics were dropped', async state => {
    const fixture=fakeTransport('3.1.7');
    let deliver!:(event:SessionEvent)=>void;
    const core=new PlotterCore(fixture.transport,{sleep:async()=>{},sessionFactory:async(port,clock,profile)=>{
      const reader=port.readable!.getReader(),writer=port.writable!.getWriter();
      const session=new PlotterSession({read:async()=>{const result=await reader.read();return result.done?null:result.value;},write:bytes=>writer.write(bytes),close:async()=>{await reader.cancel();reader.releaseLock();writer.releaseLock();await port.close();}},clock,profile);
      const subscribe=session.subscribe.bind(session);
      session.subscribe=(observer,options)=>{deliver=observer;return subscribe(observer,options);};
      return session;
    }});
    await core.connect();await core.plot(buildMotionPlan([{tool:'#111',points:[{x:1,y:1},{x:2,y:2}]}],initialState.settings));
    expect(core.executionSignal?.penState).toBe('up');
    let observedPenState:string|undefined;
    core.onSignal=signal=>{observedPenState=signal.penState;};
    // Simulate a retained terminal state after the exchange journal entry was dropped.
    deliver({kind:'state',state,timeMs:0});
    expect(core.diagnosticTrace.some(entry=>entry.phase==='failed')).toBe(false);
    expect(core.executionSignal?.penState).toBe('unknown');expect(observedPenState).toBe('unknown');expect(core.progress.state).toBe('cancelled');
    await core.disconnect();
  });
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
    const points = Array.from({ length: 33 }, (_, i) => ({ x: 30+20 * Math.cos(i * Math.PI / 16), y: 30+20 * Math.sin(i * Math.PI / 16) }));
    const plan = buildMotionPlan([{ tool: '#000000', points }], initialState.settings);
    async function execute(blocked: boolean) {
      let clock = 0, activeEnd = 0, queuedEnd = 0, index = 0, gaps = 0;
      const fixture = fakeTransport('2.8.1', command => {
        if (!command.startsWith('SM,')) return;
        // One active move and one queued move: full FIFO delays its next ACK.
        if (queuedEnd > clock) { clock = Math.max(clock, activeEnd); activeEnd = queuedEnd; }
        if (index && clock > activeEnd) gaps++;
        const end = Math.max(clock, activeEnd) + Number(command.split(',')[1]); index++;
        if (activeEnd <= clock) activeEnd = end; else queuedEnd = end;
        clock += 1; // Firmware processing and reply delivery.
      });
      const sink = new EventEmitter() as EventEmitter & { write(data: string): boolean; destroyed: boolean };
      sink.destroyed = false; sink.write = () => !blocked; const channel = new LatestChannel(sink);
      const core = new PlotterCore(fixture.transport, { sleep: async () => {} });
      core.onProgress = progress => channel.publish(progress);
      await core.connect(); await core.plot(plan); await core.disconnect();
      expect(channel.pendingCount).toBeLessThanOrEqual(1);
      return { commands: fixture.commands, gaps, clock };
    }
    expect(await execute(true)).toEqual(await execute(false));
  });
  it('allows pause and stop while initialization is awaiting an acknowledgement', async () => {
    let core!: PlotterCore;
    const fixture = fakeTransport('2.8.1', command => { if (command === 'CS') { core.pause(); core.stop(); } });
    core = new PlotterCore(fixture.transport);
    await core.connect();
    await core.plot(buildMotionPlan([{ tool: '#000000', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }], initialState.settings));
    expect(fixture.commands.some(c => c.startsWith('SM,'))).toBe(false);
    expect(core.progress.state).toBe('stopped'); await core.disconnect();
  });
});
