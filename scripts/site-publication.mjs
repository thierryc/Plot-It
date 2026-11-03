import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/** Publish a new tree in a disposable checkout; rollback appends history. */
export function publishStaticTree({ root, remote, directory, rollback = null }) {
  const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const temporary = mkdtempSync(join(tmpdir(), 'plot-it-pages-'));
  try {
    const exists = Boolean(git(['ls-remote', '--heads', remote, 'gh-pages']));
    if (exists) git(['clone', '--single-branch', '--branch', 'gh-pages', remote, temporary]);
    else {
      if (rollback) throw new Error('No published branch to roll back.');
      git(['init', '-b', 'gh-pages'], temporary);
      git(['remote', 'add', 'origin', remote], temporary);
    }
    const name = git(['config', 'user.name']), email = git(['config', 'user.email']);
    if (!name || !email) throw new Error('Configure Git author name and email first.');
    git(['config', 'user.name', name], temporary); git(['config', 'user.email', email], temporary);
    const previous = exists ? git(['rev-parse', 'HEAD'], temporary) : null;
    if (rollback) {
      const target = git(['rev-parse', '--verify', `${rollback}^{commit}`], temporary);
      git(['merge-base', '--is-ancestor', target, 'HEAD'], temporary);
      git(['read-tree', '--reset', '-u', target], temporary);
    } else {
      for (const file of readdirSync(temporary)) if (file !== '.git') rmSync(join(temporary, file), { recursive: true, force: true });
      for (const file of readdirSync(directory)) cpSync(join(directory, file), join(temporary, file), { recursive: true });
      git(['add', '--all'], temporary);
    }
    if (git(['status', '--porcelain'], temporary)) {
      git(['commit', '-m', rollback ? `Restore website from ${rollback}` : `Publish website from ${git(['rev-parse', '--short', 'HEAD'])}`], temporary);
      git(['push', 'origin', 'HEAD:gh-pages'], temporary);
    }
    return { commit: git(['rev-parse', 'HEAD'], temporary), previous };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
