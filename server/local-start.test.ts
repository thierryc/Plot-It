import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { startLocal } from '../scripts/start-local.mjs';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'plot-local-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'dist')); await mkdir(join(root, 'dist-server'));
  await writeFile(join(root, 'dist/index.html'), '<h1>Local test</h1>');
  // Child processes model service lifecycle only; no serial adapter or USB path.
  await writeFile(join(root, 'dist-server/main.js'), `
    const { createServer } = require('node:http');
    if (process.argv[2] === 'runner') {
      if (process.env.FIXTURE_RUNNER_FAIL) setTimeout(() => process.exit(7), 350);
      setInterval(() => {}, 1000);
    } else {
      createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ version: 1, mode: 'network', snapshot: { connectionPolicy: process.env.PLOT_CONNECTION_POLICY, connected: false } }));
      }).listen(Number(process.env.PLOT_HTTP_PORT), '127.0.0.1');
    }
    process.on('SIGTERM', () => process.exit(0));
  `);
  const listener = createServer();
  await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  return { root, port, env: { ...process.env, PLOT_HTTP_PORT: String(port), PLOT_CONNECTION_POLICY: 'auto' } };
}

describe('local service launcher', () => {
  it('requires a local build before creating services', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plot-no-build-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    await expect(startLocal({ root })).rejects.toThrow('Build the local app first');
  });
  it('starts a discoverable API, overrides inherited automatic USB connection, and stops its children', async () => {
    const options = await fixture(); const messages: string[] = [];
    const local = await startLocal({ ...options, ready: (message: string) => messages.push(message) });
    cleanup.push(async () => { local.stop(); await local.closed; });
    const status = await (await fetch(`${local.address}/api/v1/status`)).json();
    expect(status.snapshot).toEqual({ connectionPolicy: 'manual', connected: false });
    expect(messages.join('')).toContain(local.address);
    local.stop(); expect(await local.closed).toBe(0);
    await expect(fetch(`${local.address}/api/v1/status`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
  });
  it('stops the peer service when the runner fails', async () => {
    const options = await fixture();
    const local = await startLocal({ ...options, env: { ...options.env, FIXTURE_RUNNER_FAIL: '1' }, ready: () => {} });
    cleanup.push(async () => { local.stop(); await local.closed; });
    expect(await local.closed).toBe(7);
    await expect(fetch(`${local.address}/api/v1/status`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
  });
  it('rejects an occupied app port without launching children', async () => {
    const options = await fixture(); const listener = createServer();
    await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(options.port, '127.0.0.1', resolve); });
    cleanup.push(() => new Promise<void>(resolve => listener.close(() => resolve())));
    await expect(startLocal(options)).rejects.toThrow('EADDRINUSE');
  });
});
