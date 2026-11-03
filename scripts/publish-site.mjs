import './check-runtime.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { publishStaticTree } from './site-publication.mjs';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const remote = 'https://github.com/thierryc/Plot-It.git';
const options = process.argv.slice(2);
const dryRun = options.includes('--dry-run');
const rollbackIndex = options.indexOf('--rollback');
const rollback = rollbackIndex < 0 ? null : options[rollbackIndex + 1];
if (options.some((option, index) => !['--dry-run', '--rollback'].includes(option) && !(rollbackIndex >= 0 && index === rollbackIndex + 1))) throw new Error('Usage: publish-site.mjs [--dry-run] [--rollback <gh-pages-commit>]');
if (rollbackIndex >= 0 && !/^[a-f0-9]{7,40}$/.test(rollback ?? '')) throw new Error('Rollback needs a gh-pages commit hash.');
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
if (!rollback) {
  if (!existsSync(join(root, 'dist-site/release.json'))) throw new Error('Build the site first.');
  const commit = git(['rev-parse', 'HEAD']);
  const built = JSON.parse(readFileSync(join(root, 'dist-site/release.json'), 'utf8'));
  if (built.sourceCommit !== commit || git(['status', '--porcelain'])) throw new Error('Commit all source changes and rebuild the site before publishing.');
  execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'server/site-build.test.ts'], { cwd: root, env: { ...process.env, PLOT_SITE_BUILD_DIR: 'dist-site' }, stdio: 'inherit' });
  // Do not publish a site referring to source that is still only local.
  if (!dryRun && git(['ls-remote', remote, 'refs/heads/main']).split(/\s/)[0] !== commit) throw new Error('Push this source commit to main before publishing.');
}
if (dryRun) { console.info(`Validated ${rollback ? `rollback ${rollback}` : 'dist-site'}; would publish to ${remote} gh-pages. Source checkout is unchanged.`); process.exit(0); }
const result = publishStaticTree({ root, remote, directory: join(root, 'dist-site'), rollback });
console.info(`Published gh-pages ${result.commit}${result.previous ? `\nPrevious release (rollback target): ${result.previous}` : ''}`);
