import { afterEach, expect, it, vi } from 'vitest';
import { closeTransferredPort } from './serial-port-close';

afterEach(() => vi.useRealTimers());

it('waits for cancellation to unlock both original streams before closing USB', async () => {
  vi.useFakeTimers();
  const readable = new ReadableStream<Uint8Array>(), writable = new WritableStream<Uint8Array>();
  const reader = readable.getReader(), writer = writable.getWriter();
  const close = vi.fn(async () => {
    if (readable.locked || writable.locked) throw new Error('Cannot cancel a locked stream');
  });
  const port = { readable, writable, close, open: async () => {}, getInfo: () => ({}) };
  const operation = closeTransferredPort(port);
  setTimeout(() => reader.releaseLock(), 10);
  setTimeout(() => writer.releaseLock(), 30);
  await vi.advanceTimersByTimeAsync(20);
  expect(close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10); await operation;
  expect(close).toHaveBeenCalledOnce();
});

it('reports an unreleased transfer without calling SerialPort.close on locked streams', async () => {
  vi.useFakeTimers();
  const readable = new ReadableStream<Uint8Array>(), reader = readable.getReader();
  const close = vi.fn(async () => {});
  const operation = closeTransferredPort({ readable, writable: null, close, open: async () => {}, getInfo: () => ({}) });
  const failed = expect(operation).rejects.toThrow('still locked');
  await vi.advanceTimersByTimeAsync(1000); await failed;
  expect(close).not.toHaveBeenCalled(); reader.releaseLock();
});
