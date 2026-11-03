import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { mkdtemp, rm, mkdir, writeFile, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { buildMotionPlan } from '../src/motion-plan';
import { initialState } from '../src/model';
import { JobStore } from './jobs';

async function wait(check: () => boolean | Promise<boolean>) {
  const end = Date.now() + 8000;
  while (!(await check())) { if (Date.now() > end) throw new Error('Process test timed out'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
async function stop(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill(signal); await exited;
}
describe('real OS process isolation', () => {
  it('continues after API death and never replays after runner death', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plot-process-')); const children: ChildProcess[] = [];
    const sockets: WebSocket[] = [];
    try {
      await mkdir(join(dir, 'dist-server')); await writeFile(join(dir, '.nvmrc'), await readFile('.nvmrc'));
      await symlink(resolve('node_modules'), join(dir, 'node_modules'));
      await build({ entryPoints: { main: 'server/main.ts', runner: 'server/test-fixtures/runner.ts' }, outdir: join(dir, 'dist-server'), bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node24' });
      const listener = createServer(); await new Promise<void>(r => listener.listen(0, '127.0.0.1', r));
      const port = (listener.address() as { port: number }).port; await new Promise<void>(r => listener.close(() => r()));
      const url = `http://127.0.0.1:${port}`;
      const env = { ...process.env, PLOT_DATA_DIR: join(dir, 'jobs'), PLOT_SOCKET_DIR: join(dir, 'run'), PLOT_ORIGINS: url, PLOT_HTTP_PORT: String(port) };
      const launch = (entry: string, args: string[] = []) => { const child = fork(join(dir, 'dist-server', entry), args, { env, silent: true }); children.push(child); child.stdout?.resume(); child.stderr?.resume(); return child; };
      let runner = launch('runner.js'); let ready = false, moving = false;
      runner.on('message', (value: any) => { ready ||= value.ready === true; moving ||= value.moving === true; }); await wait(() => ready);
      let api = launch('main.js', ['api']);
      await wait(async () => { try { return (await fetch(url + '/api/v1/status')).ok; } catch { return false; } });
      const ws = new WebSocket(url.replace('http:', 'ws:') + '/api/v1/ws', { origin: url }); sockets.push(ws);
      const messages: any[] = []; ws.on('message', data => messages.push(JSON.parse(data.toString())));
      await new Promise<void>(r => ws.once('open', r));
      const request = async (action: string, params = {}) => { const requestId = randomUUID(); ws.send(JSON.stringify({ version: 1, requestId, action, ...params })); await wait(() => messages.some(m => m.requestId === requestId)); return messages.find(m => m.requestId === requestId); };
      expect((await request('claim')).ok).toBe(true);
      const plan = buildMotionPlan([{ tool: '#000000', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }], initialState.settings);
      const response = await fetch(url + '/api/v1/jobs', { method: 'POST', headers: { Origin: url }, body: JSON.stringify({ version: 1, requestId: randomUUID(), plan }) });
      const { id } = await response.json() as { id: string };
      expect((await request('start', { jobId: id })).ok).toBe(true); await wait(() => moving);
      await stop(api, 'SIGKILL'); expect(runner.exitCode).toBe(null);
      const store = new JobStore(env.PLOT_DATA_DIR);
      await wait(async () => (await store.get(id)).status === 'finished');
      const uncertain = await store.accept({ version: 1, requestId: randomUUID(), plan }); await store.update(uncertain.id, { status: 'running', startRequestId: randomUUID() });
      await stop(runner, 'SIGKILL'); ready = false; moving = false;
      runner = launch('runner.js'); runner.on('message', (value: any) => { ready ||= value.ready === true; moving ||= value.moving === true; }); await wait(() => ready);
      expect((await store.get(uncertain.id)).status).toBe('interrupted'); expect(moving).toBe(false);
      api = launch('main.js', ['api']); await wait(async () => { try { return (await fetch(url + '/api/v1/status')).ok; } catch { return false; } });
      const state = await (await fetch(url + '/api/v1/status')).json() as any; expect(state.snapshot.status).toBe('idle'); expect(state.snapshot.origin).toBe('unset');
    } finally { for (const ws of sockets) ws.terminate(); for (const child of children.reverse()) await stop(child); await rm(dir, { recursive: true, force: true }); }
  }, 20000);
});
