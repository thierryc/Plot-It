import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { publishStaticTree } from '../scripts/site-publication.mjs';

it('publishes and restores a static release without changing the source checkout or rewriting history', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'plot-it-publish-test-'));
  const source = join(temporary, 'source'), remote = join(temporary, 'pages.git'), artifact = join(temporary, 'artifact');
  const git = (args: string[], cwd = source) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    mkdirSync(source); mkdirSync(artifact);
    git(['init', '-b', 'main']); git(['config', 'user.name', 'Plot-it Test']); git(['config', 'user.email', 'test@example.invalid']);
    writeFileSync(join(source, 'source.txt'), 'unchanged'); git(['add', '.']); git(['commit', '-m', 'Source']);
    git(['init', '--bare', remote]);
    const before = git(['rev-parse', 'HEAD']);
    writeFileSync(join(artifact, 'index.html'), 'first release');
    writeFileSync(join(artifact, '.nojekyll'), '');
    const first = publishStaticTree({ root: source, remote, directory: artifact });
    writeFileSync(join(artifact, 'index.html'), 'second release');
    writeFileSync(join(artifact, 'new.html'), 'new page');
    const second = publishStaticTree({ root: source, remote, directory: artifact });
    expect(second.previous).toBe(first.commit);
    const restored = publishStaticTree({ root: source, remote, rollback: first.commit });
    expect(restored.previous).toBe(second.commit);
    expect(git(['--git-dir', remote, 'show', 'gh-pages:index.html'])).toBe('first release');
    expect(git(['--git-dir', remote, 'ls-tree', '--name-only', 'gh-pages'])).not.toContain('new.html');
    expect(git(['--git-dir', remote, 'rev-list', '--count', 'gh-pages'])).toBe('3');
    expect(git(['rev-parse', 'HEAD'])).toBe(before);
    expect(git(['branch', '--show-current'])).toBe('main');
    expect(git(['status', '--porcelain'])).toBe('');
    expect(readFileSync(join(source, 'source.txt'), 'utf8')).toBe('unchanged');
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
