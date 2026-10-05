import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_EVENTS, MAX_FRAME_BYTES, isId, validateControl, type NetworkSnapshot } from '../src/network-protocol';
import { JobStore } from './jobs';
import { RunnerClient } from './ipc';

export interface ApiOptions { directory: string; socketDirectory: string; port?: number; host?: string; origins?: string[]; allowLoopback?: boolean; maxBytes?: number; maxEvents?: number; staticDirectory?: string; tls?: { cert: Buffer; key: Buffer; port?: number; host?: string } }
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.gz': 'application/gzip', '.png': 'image/png' };
export async function startApi(options: ApiOptions) {
  const store = new JobStore(options.directory, options.maxEvents ?? DEFAULT_MAX_EVENTS);
  const runner = new RunnerClient(join(options.socketDirectory, 'control.sock'), join(options.socketDirectory, 'telemetry.sock'));
  const origins = new Set(options.origins ?? []), hosts = new Set([...origins].map(origin => new URL(origin).host));
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
  let owner: WebSocket | null = null, closed = false, uploading = false;
  const trustedHost = (req: IncomingMessage) => !!req.headers.host && hosts.has(req.headers.host);
  const trustedOrigin = (req: IncomingMessage) => typeof req.headers.origin === 'string' && origins.has(req.headers.origin);
  function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
  const handler = (req: IncomingMessage, res: ServerResponse) => { void (async () => {
    if (!trustedHost(req)) { json(res, 403, { error: 'Untrusted Host' }); return; }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path.startsWith('/api/')) {
      if ((req.headers.origin !== undefined || req.method !== 'GET') && !trustedOrigin(req)) { json(res, 403, { error: 'Untrusted Origin' }); return; }
      if (path === '/api/v1/status' && req.method === 'GET') { json(res, runner.snapshot ? 200 : 503, { version: 1, mode: 'network', snapshot: runner.snapshot }); return; }
      if (path === '/api/v1/jobs' && req.method === 'POST') {
        if (uploading) { json(res, 429, { error: 'Another upload is in progress; retry with the same request ID' }); req.resume(); return; }
        uploading = true;
        try {
        let bytes = 0; const chunks: Buffer[] = [];
        if (Number(req.headers['content-length']) > (options.maxBytes ?? DEFAULT_MAX_BYTES)) { json(res, 413, { error: 'Job exceeds upload limit' }); req.resume(); return; }
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > (options.maxBytes ?? DEFAULT_MAX_BYTES)) { json(res, 413, { error: 'Job exceeds upload limit' }); req.resume(); return; }
          chunks.push(chunk);
        }
        try { const record = await store.accept(JSON.parse(Buffer.concat(chunks).toString())); json(res, 201, { id: record.id, status: record.status }); }
        catch (reason) { json(res, 400, { error: (reason as Error).message }); } return;
        } finally { uploading = false; }
      }
      const id = path.match(/^\/api\/v1\/jobs\/([a-zA-Z0-9_-]+)$/)?.[1];
      if (id && req.method === 'GET') {
        try { const record = await store.get(id); const snapshot = runner.snapshot?.jobId === id ? runner.snapshot : null; json(res, 200, { ...record, ...(snapshot ? { status: snapshot.status, snapshot } : {}) }); }
        catch { json(res, 404, { error: 'Job not found' }); } return;
      }
      json(res, 404, { error: 'Unknown API endpoint' }); return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { error: 'Method not allowed' }); return; }
    if (!options.staticDirectory) { json(res, 404, { error: 'Frontend not configured' }); return; }
    const root = resolve(options.staticDirectory), file = resolve(root, '.' + decodeURIComponent(path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) { json(res, 404, { error: 'Not found' }); return; }
    try {
      if (!(await stat(file)).isFile()) throw new Error('Not a file');
      const data = await readFile(file); res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': /(?:index\.html|sw\.js)$/.test(file) ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : data);
    } catch { json(res, 404, { error: 'Not found' }); }
  })().catch(reason => { if (!res.headersSent) json(res, 500, { error: (reason as Error).message }); else res.destroy(); }); };
  const server = createServer(handler);
  const tlsServer = options.tls ? createHttpsServer(options.tls, handler) : null;
  for (const listener of [server, tlsServer]) listener?.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/v1/ws' || !trustedHost(req) || !trustedOrigin(req)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    if (wss.clients.size >= 16) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  function send(ws: WebSocket, value: unknown) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > MAX_FRAME_BYTES) { ws.terminate(); return; }
    const message = JSON.stringify(value); if (Buffer.byteLength(message) > MAX_FRAME_BYTES) { ws.terminate(); return; }
    ws.send(message);
  }
  const ownership = () => { for (const ws of wss.clients) send(ws, { type: 'ownership', controlling: owner === ws, occupied: owner !== null }); };
  const snapshots = (snapshot: NetworkSnapshot) => { for (const ws of wss.clients) send(ws, { type: 'snapshot', snapshot }); };
  runner.on('snapshot', snapshots); runner.on('offline', () => { for (const ws of wss.clients) send(ws, { type: 'offline' }); });
  const alive = new Set<WebSocket>();
  wss.on('connection', ws => {
    alive.add(ws); ws.on('pong', () => alive.add(ws)); ws.on('error', () => undefined);
    if (runner.snapshot) send(ws, { type: 'snapshot', snapshot: runner.snapshot }); ownership();
    let inFlight = 0;
    const replies = new Map<string, { fingerprint: string; promise: Promise<unknown> }>();
    ws.on('message', (data, binary) => {
      if (binary || ++inFlight > 16) { ws.terminate(); return; }
      void (async () => {
        let requestId = '';
        try {
          const raw = JSON.parse(data.toString());
          if (raw && typeof raw === 'object' && isId(raw.requestId)) requestId = raw.requestId;
          const request = validateControl(raw);
          const fingerprint = JSON.stringify(request); let entry = replies.get(requestId);
          if (entry && entry.fingerprint !== fingerprint) throw new Error('Request ID reused');
          if (!entry) {
            const promise = (async () => {
              if (request.action === 'claim') { if (owner && owner !== ws) throw new Error('Another browser controls the plotter'); owner = ws; ownership(); return { type: 'result', requestId, ok: true }; }
              if (request.action === 'release-control') { if (owner === ws) owner = null; ownership(); return { type: 'result', requestId, ok: true }; }
              if (owner !== ws) throw new Error('Claim control before operating the plotter');
              return runner.request(request);
            })().catch(reason => ({ type: 'result', requestId, ok: false, error: (reason as Error).message }));
            entry = { fingerprint, promise }; replies.set(requestId, entry); if (replies.size > 256) replies.delete(replies.keys().next().value!);
          }
          send(ws, await entry.promise);
        } catch (reason) { send(ws, { type: 'result', requestId: isId(requestId) ? requestId : '', ok: false, error: (reason as Error).message }); }
        finally { inFlight--; }
      })();
    });
    ws.on('close', () => { alive.delete(ws); if (owner === ws) { owner = null; ownership(); } });
  });
  const heartbeat = setInterval(() => { for (const ws of wss.clients) { if (!alive.delete(ws)) ws.terminate(); else ws.ping(); } }, 15000);
  async function close() {
    if (closed) return; closed = true; clearInterval(heartbeat); runner.close();
    for (const ws of wss.clients) ws.terminate(); await new Promise<void>(resolveReady => wss.close(() => resolveReady()));
    server.closeAllConnections(); tlsServer?.closeAllConnections();
    await Promise.all([new Promise<void>(resolveReady => server.close(() => resolveReady())), ...(tlsServer ? [new Promise<void>(resolveReady => tlsServer.close(() => resolveReady()))] : [])]);
  }
  try {
  await new Promise<void>((resolveReady, reject) => { server.once('error', reject); server.listen(options.port ?? 8787, options.host ?? '127.0.0.1', resolveReady); });
  const address = server.address() as AddressInfo;
  const url = `http://${options.host ?? '127.0.0.1'}:${address.port}`;
  if (options.allowLoopback) { origins.add(url); hosts.add(new URL(url).host); }
  if (tlsServer) await new Promise<void>((resolveReady, reject) => { tlsServer.once('error', reject); tlsServer.listen(options.tls!.port ?? 8443, options.tls!.host ?? '0.0.0.0', resolveReady); });
  const tlsUrl = tlsServer ? `https://${options.tls!.host ?? '0.0.0.0'}:${(tlsServer.address() as AddressInfo).port}` : null;
  if (options.allowLoopback && tlsUrl) { origins.add(tlsUrl); hosts.add(new URL(tlsUrl).host); }
  // Startup is still useful without hardware; readiness identifies the runner separately.
  await runner.ready().catch(() => undefined);
  return { server, url, tlsUrl, close };
  } catch (reason) { await close(); throw reason; }
}
