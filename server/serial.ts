import { SerialPort } from 'serialport';
import { EventTarget, Event } from './transport-events';
import type { SerialTransport, SerialPortLike } from '../src/plotter-core';

/** USB CDC transport only. GPIO UART settings do not apply to an EBB. */
export class NodeSerialTransport extends EventTarget implements SerialTransport {
  readonly supported = true;
  constructor(private readonly device?: string) { super(); }
  async requestPort(): Promise<SerialPortLike> {
    let path = this.device;
    if (!path) {
      const devices = (await SerialPort.list()).filter(p => p.vendorId?.toLowerCase() === '04d8' && p.productId?.toLowerCase() === 'fd92');
      if (devices.length !== 1) throw new Error(devices.length ? 'Configure EBB_DEVICE: multiple EBB boards detected' : 'No EBB USB device found');
      path = devices[0]!.path;
    }
    const serial = new SerialPort({ path, baudRate: 9600, autoOpen: false, lock: true, highWaterMark: 16384 });
    let deliberateClose = false, input: ReadableStreamDefaultController<Uint8Array> | null = null;
    const port: SerialPortLike = {
      readable: new ReadableStream<Uint8Array>({
        start(controller) { input = controller; },
        pull() { serial.resume(); },
        cancel() { input = null; serial.pause(); },
      }, { highWaterMark: 16384, size: bytes => bytes.byteLength }),
      writable: new WritableStream<Uint8Array>({
        write(data) { return new Promise<void>((resolve, reject) => serial.write(Buffer.from(data), error => error ? reject(error) : resolve())); },
      }),
      open(options) {
        if (options.baudRate !== 9600) return Promise.reject(new Error('Unexpected EBB baud setting'));
        return new Promise<void>((resolve, reject) => serial.open(error => error ? reject(error) : resolve()));
      },
      close() { deliberateClose = true; return new Promise<void>((resolve, reject) => { if (!serial.isOpen) resolve(); else serial.close(error => error ? reject(error) : resolve()); }); },
      getInfo: () => ({ usbVendorId: 0x04d8, usbProductId: 0xfd92 }),
    };
    serial.on('data', (bytes: Buffer) => { if (input) { input.enqueue(bytes); if ((input.desiredSize ?? 0) <= 0) serial.pause(); } });
    serial.on('error', error => { input?.error(error); input = null; });
    serial.on('close', () => {
      if (input) { input.close(); input = null; }
      if (!deliberateClose) this.dispatchEvent(new Event('disconnect', port));
    });
    return port;
  }
}
