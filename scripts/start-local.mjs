import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

/** Launch only the built local installation; never claim USB on startup. */
export async function startLocal({ root = projectRoot, env = process.env, ready = console.info, timeoutMs = 10000 } = {}) {
  for (const file of ['dist/index.html', 'dist-server/main.js']) {
    if (!existsSync(resolve(root, file))) throw new Error('Build the local app first: scripts/node-lts.sh --npm run build');
  }
  const port = Number(env.PLOT_HTTP_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PLOT_HTTP_PORT must be between 1 and 65535.');
  // Fail before starting a runner if another installation already owns the URL.
  await new Promise((accept, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(accept));
  });
  const address = `http://127.0.0.1:${port}`;
  const childEnv = { ...env, PLOT_CONNECTION_POLICY: 'manual', PLOT_ORIGINS: env.PLOT_ORIGINS ?? `${address},http://localhost:${port}` };
  const children = new Set();
  let stopping = false, exitCode = 0, killTimer;
  let finish;
  const closed = new Promise(accept => { finish = accept; });
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true; exitCode = code;
    for (const child of children) child.kill('SIGTERM');
    killTimer = setTimeout(() => {
      console.error('Local services did not stop within 30 seconds; terminating remaining processes.');
      exitCode = 1;
      for (const child of children) child.kill('SIGKILL');
    }, 30000);
    killTimer.unref();
    if (!children.size) { clearTimeout(killTimer); finish(exitCode); }
  };
  for (const mode of ['runner', 'api']) {
    const child = spawn(process.execPath, [resolve(root, 'dist-server/main.js'), mode], { cwd: root, env: childEnv, stdio: 'inherit' });
    children.add(child);
    child.once('error', error => { console.error(`Could not start ${mode}: ${error.message}`); stop(1); });
    child.once('close', (code, signal) => {
      children.delete(child);
      if (!stopping) { console.error(`${mode} exited (${signal ?? code}); stopping the local installation.`); stop(code || 1); }
      if (!children.size) { clearTimeout(killTimer); finish(exitCode); }
    });
  }
  const onSignal = () => stop();
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  closed.then(() => { process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); });
  let available = false;
  const deadline = Date.now() + timeoutMs;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(`${address}/api/v1/status`, { signal: AbortSignal.timeout(500) });
      const status = response.ok ? await response.json() : null;
      if (status?.version === 1 && status.mode === 'network' && status.snapshot) { available = true; break; }
    } catch { /* Services are still opening their listener/socket. */ }
    await Promise.race([closed, new Promise(accept => setTimeout(accept, 100))]);
  }
  if (!stopping && !available) { console.error(`Local API/runner did not become ready at ${address}. Check service errors and PLOT_ORIGINS.`); stop(1); }
  if (!stopping) {
    try { ready(`Plot-it local app: ${address}\nAPI and runner ready. USB connection is manual. Finish or stop a drawing before Ctrl+C.`); }
    catch (error) { stop(1); await closed; throw error; }
  }
  return { address, stop, closed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await import('./check-runtime.mjs');
    const local = await startLocal();
    process.exitCode = await local.closed;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
