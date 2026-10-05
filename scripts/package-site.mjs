import './check-runtime.mjs';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const directory = resolve('dist-site');
for (const path of ['index.html', 'app/index.html', 'docs/index.html', 'docs/self-hosted/index.html', '404.html']) {
  if (!existsSync(join(directory, path))) throw new Error(`Missing hosted route: ${path}`);
}
for (const file of readdirSync(join(directory, 'assets'), { recursive: true, encoding: 'utf8' }).filter(file => file.endsWith('.js'))) {
  const script = readFileSync(join(directory, 'assets', file), 'utf8');
  if (['/api/v1/', 'new WebSocket(', 'node:net'].some(value => script.includes(value))) throw new Error(`Server code leaked into website: ${file}`);
}
// Vite's public directory is shared with local builds; only the site receives
// an app-scoped worker and manifest.
for (const file of ['sw.js', 'manifest.webmanifest']) rmSync(join(directory, file), { force: true });
for (const file of ['sw.js', 'manifest.webmanifest']) cpSync(resolve('site/app', file), join(directory, 'app', file));
writeFileSync(join(directory, 'CNAME'), 'plot-it.litsquare.com\n');
writeFileSync(join(directory, '.nojekyll'), '');
let sourceCommit = null;
try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Before initial repository publication. */ }
writeFileSync(join(directory, 'release.json'), `${JSON.stringify({ version: JSON.parse(readFileSync('package.json', 'utf8')).version, sourceCommit, builtAt: new Date().toISOString() }, null, 2)}\n`);
mkdirSync('output', { recursive: true });
const archive = resolve('output/plot-it-site.zip');
rmSync(archive, { force: true });
execFileSync('zip', ['-q', '-r', archive, '.'], { cwd: directory });
console.info(`Hosted site: ${directory}\nArchive: ${archive}`);
