import type { SerialTransport } from '../../src/plotter-core';
import { EventTarget, Event } from '../transport-events';
export function fakeTransport(version = '2.8.1', onCommand?: (command: string) => Promise<void> | void): { transport: SerialTransport; commands: string[]; disconnect(): void } {
  const commands: string[] = [];
  let disconnected = false;
  let input!: ReadableStreamDefaultController<Uint8Array>;
  const port = {
    readable: new ReadableStream<Uint8Array>({ start(c) { input = c; } }),
    writable: new WritableStream<Uint8Array>({ async write(bytes) {
      const command = new TextDecoder().decode(bytes).trim(); commands.push(command);
      await onCommand?.(command);
      if (disconnected) throw new Error('USB disconnected');
      const response = command === 'V' ? `EBB Firmware Version ${version}` : command === 'QS' ? '0,0\r\nOK' : command === 'QG' ? '00' : command === 'QM' ? 'QM,0,0,0,0' : command === 'ES,1' ? '1\r\nOK' : 'OK';
      // Every reply is fragmented, including its CR/LF terminator.
      for (const chunk of [response, '\r', '\n']) input.enqueue(new TextEncoder().encode(chunk));
    } }),
    async open() {}, async close() {}, getInfo: () => ({ usbVendorId: 0x04d8, usbProductId: 0xfd92 }),
  };
  const transport = Object.assign(new EventTarget(), { supported: true, requestPort: async () => port });
  return { commands, transport, disconnect() { disconnected = true; input.error(new Error('USB disconnected')); transport.dispatchEvent(new Event('disconnect', port)); } };
}
