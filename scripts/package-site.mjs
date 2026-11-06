import './check-runtime.mjs';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
const directory = resolve('dist-site');
for (const path of ['index.html', 'app/index.html', 'docs/index.html', 'docs/self-hosted/index.html', 'macos/index.html', 'docs/macos/index.html', 'contributors/index.html', '404.html']) {
  if (!existsSync(join(directory, path))) throw new Error(`Missing hosted route: ${path}`);
}
// Keep the initial HTML download links current even before client JavaScript loads.
const macRelease = JSON.parse(readFileSync('site/macos/release.json', 'utf8'));
const macPage = join(directory, 'macos/index.html');
const macDocument = new JSDOM(readFileSync(macPage, 'utf8'));
for (const [selector, value] of [
  ['#mac-downloads a[href$="/PlotIt-MCP-universal.dmg"]', macRelease.universalUrl],
  ['#mac-checksums', macRelease.checksumsUrl], ['#mac-notes', macRelease.releaseNotesUrl],
]) {
  const link = macDocument.window.document.querySelector(selector);
  if (!link) throw new Error(`Missing Mac release link: ${selector}`);
  if (macRelease.available) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid Mac release link');
    link.setAttribute('href', url.href);
  } else link.remove();
}
writeFileSync(macPage, macDocument.serialize());
macDocument.window.close();
for (const file of readdirSync(join(directory, 'assets'), { recursive: true, encoding: 'utf8' }).filter(file => file.endsWith('.js'))) {
  const script = readFileSync(join(directory, 'assets', file), 'utf8');
  if (['/api/v1/', 'new WebSocket(', 'node:net'].some(value => script.includes(value))) throw new Error(`Server code leaked into website: ${file}`);
}
// Vite's public directory is shared with local builds; only the site receives
// an app-scoped worker and manifest.
for (const file of ['sw.js', 'manifest.webmanifest']) rmSync(join(directory, file), { force: true });
for (const file of ['sw.js', 'manifest.webmanifest']) cpSync(resolve('site/app', file), join(directory, 'app', file));
rmSync(join(directory, 'CNAME'), { force: true });
writeFileSync(join(directory, '.nojekyll'), '');
let sourceCommit = null;
try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Before initial repository publication. */ }
writeFileSync(join(directory, 'release.json'), `${JSON.stringify({ version: JSON.parse(readFileSync('package.json', 'utf8')).version, sourceCommit, builtAt: new Date().toISOString() }, null, 2)}\n`);
mkdirSync('output', { recursive: true });
const archive = resolve('output/plot-it-site.zip');
rmSync(archive, { force: true });
execFileSync('zip', ['-q', '-r', archive, '.'], { cwd: directory });
console.info(`Hosted site: ${directory}\nArchive: ${archive}`);
