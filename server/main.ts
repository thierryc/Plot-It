import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PlotterCore } from '../src/plotter-core';
import { checkRuntime } from './runtime';
import { NodeSerialTransport } from './serial';
import { startRunner } from './runner';
import { startApi } from './api';

// Bundled files reside in dist-server; the release pin remains at its parent.
console.info('Runtime', checkRuntime());
const mode = process.argv[2], directory = resolve(process.env.PLOT_DATA_DIR ?? './network-data/jobs'), socketDirectory = resolve(process.env.PLOT_SOCKET_DIR ?? './network-data/run');
function positive(value: string | undefined, fallback: number) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('Configuration limit must be a positive integer'); return parsed;
}
const maxEvents = positive(process.env.PLOT_MAX_EVENTS, 100000);
let service: { close(): Promise<void> };
if (mode === 'runner') {
  const connectionPolicy = process.env.PLOT_CONNECTION_POLICY ?? 'manual';
  if (connectionPolicy !== 'manual' && connectionPolicy !== 'auto') throw new Error('PLOT_CONNECTION_POLICY must be manual or auto');
  service = await startRunner({ directory, socketDirectory, maxEvents, connectionPolicy, core: new PlotterCore(new NodeSerialTransport(process.env.EBB_DEVICE), { precompile: true, positionBudgetMs: 30 }) });
}
else if (mode === 'api') {
  const origins = (process.env.PLOT_ORIGINS ?? 'http://127.0.0.1:8787,http://localhost:8787').split(',').map(value => new URL(value.trim()).origin);
  const cert = process.env.PLOT_TLS_CERT, key = process.env.PLOT_TLS_KEY;
  if (Boolean(cert) !== Boolean(key)) throw new Error('Configure both PLOT_TLS_CERT and PLOT_TLS_KEY');
  service = await startApi({ directory, socketDirectory, maxEvents, maxBytes: positive(process.env.PLOT_MAX_BYTES, 32 * 1024 * 1024), host: '127.0.0.1', port: positive(process.env.PLOT_HTTP_PORT, 8787), origins,
    staticDirectory: resolve(process.env.PLOT_STATIC_DIR ?? './dist'), ...(cert && key ? { tls: { cert: await readFile(cert), key: await readFile(key), port: 8443 } } : {}) });
} else throw new Error('Usage: node dist-server/main.js runner|api');
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { if (!stopping) { stopping = true; void service.close().then(() => process.exit(0), error => { console.error(error); process.exit(1); }); } });
