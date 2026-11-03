import type { SerialPortLike } from './plotter-core';

/** Transfer cancellation reaches the original Web Serial streams asynchronously. */
export async function closeTransferredPort(port: SerialPortLike): Promise<void> {
  for (let attempt = 0; port.readable?.locked || port.writable?.locked; attempt++) {
    if (attempt >= 100) throw new Error('USB streams are still locked. Reload the app before reconnecting.');
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  await port.close();
}
