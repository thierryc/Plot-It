import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const fixture = vi.hoisted(() => ({ serial: null as any }));
vi.mock('serialport', () => ({ SerialPort: class extends EventEmitter {
  isOpen = false; pauses = 0; resumes = 0;
  constructor() { super(); fixture.serial = this; }
  open(done: () => void) { this.isOpen = true; done(); }
  close(done: () => void) { this.isOpen = false; this.emit('close'); done(); }
  write(_data: unknown, done: () => void) { done(); }
  pause() { this.pauses++; }
  resume() { this.resumes++; }
} }));
import { NodeSerialTransport } from './serial';
describe('Node serial adapter', () => {
  it('applies bounded byte backpressure to the readable stream', async () => {
    const port = await new NodeSerialTransport('/dev/test-ebb').requestPort(); await port.open({ baudRate: 9600 });
    fixture.serial.emit('data', Buffer.alloc(20000)); expect(fixture.serial.pauses).toBeGreaterThan(0);
    const resumes = fixture.serial.resumes; const reader = port.readable!.getReader();
    expect((await reader.read()).value?.byteLength).toBe(20000);
    await Promise.resolve(); expect(fixture.serial.resumes).toBeGreaterThan(resumes);
    await reader.cancel(); reader.releaseLock(); await port.close();
  });
});
