import './check-runtime.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [mode, ...extra] = process.argv.slice(2);
if (!['usb', 'network'].includes(mode) || extra.length) {
  console.error('Usage: npm run test:ebb -- <usb | network>');
  process.exit(1);
}
if (mode === 'network') {
  if (!process.env.PLOT_EBB_URL) { console.error('Set PLOT_EBB_URL to the running Pi service origin.'); process.exit(1); }
  try {
    const url = new URL(process.env.PLOT_EBB_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
  } catch { console.error('PLOT_EBB_URL must be an HTTP(S) origin without credentials, a path, query, or fragment.'); process.exit(1); }
}
const root = fileURLToPath(new URL('../', import.meta.url));
const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
  'run', 'server/ebb-hardware.test.ts', '--no-file-parallelism', '--maxWorkers=1', '--testTimeout=10000'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, PLOT_EBB_TEST_MODE: mode },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
