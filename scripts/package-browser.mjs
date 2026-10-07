import './check-runtime.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const directory = resolve('dist-browser');
if (!existsSync(join(directory, 'index.html'))) throw new Error('Build the browser distribution first.');
for (const file of readdirSync(join(directory, 'assets')).filter(file => file.endsWith('.js'))) {
  const script = readFileSync(join(directory, 'assets', file), 'utf8');
  if (script.includes('/api/v1/') || script.includes('new WebSocket(') || script.includes('node:net')) throw new Error(`Server code leaked into browser distribution: ${file}`);
}
rmSync(join(directory, 'CNAME'), { force: true });
writeFileSync(join(directory, '.nojekyll'), '');
mkdirSync('output', { recursive: true });
const archive = resolve('output/plot-it-browser.zip');
rmSync(archive, { force: true });
execFileSync('zip', ['-q', '-r', archive, '.'], { cwd: directory });
console.info(`Browser-only GitHub Pages files: ${directory}\nArchive: ${archive}`);
