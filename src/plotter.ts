import { PlotterCore, type SerialPortLike } from './plotter-core';
export type { PlotProgress, PlotterTrace, PlotterJobTrace } from './plotter-core';
declare global {
  interface Navigator {
    serial?: {
      addEventListener?(type: 'disconnect', listener: (event: Event) => void): void;
      requestPort(options?: { filters?: Array<{ usbVendorId?: number; usbProductId?: number }> }): Promise<SerialPortLike>;
    };
  }
}
/** Browser facade: firmware and machine execution live in the shared core. */
export class Plotter extends PlotterCore {
  constructor() {
    super({
      get supported() { return typeof navigator !== 'undefined' && Boolean(navigator.serial); },
      requestPort: () => navigator.serial!.requestPort({ filters: [{ usbVendorId: 0x04d8, usbProductId: 0xfd92 }] }),
      addEventListener: (type, listener) => navigator.serial?.addEventListener?.(type, listener),
    });
  }
}
