import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';

/** Check distributed bytes, including the independently downloadable source. */
export function expectDistributionNotices(directory: string): void {
  const notices = readdirSync('public/licenses').filter(file => file.endsWith('.txt'));
  expect(notices).toEqual(expect.arrayContaining([
    'axi.txt', 'apcx-gl-marquee.txt', 'lucide.txt', 'harfbuzzjs.txt',
    'harfbuzz.txt', 'boost-1.0.txt', 'clipper.txt', 'plotink.txt', 'nextdraw-homing.txt',
  ]));
  const archive = join(directory, 'plot-it-source.tar.gz');
  const extracted = mkdtempSync(join(tmpdir(), 'plot-build-notices-'));
  try {
    execFileSync('tar', ['-xzf', archive, '-C', extracted, 'public/licenses', '.gitignore']);
    for (const file of notices) {
      const source = readFileSync(join('public/licenses', file));
      expect(source.byteLength, file).toBeGreaterThan(100);
      expect(readFileSync(join(directory, 'licenses', file)), file).toEqual(source);
      expect(readFileSync(join(extracted, 'public/licenses', file)), file).toEqual(source);
    }
    expect(readFileSync(join(extracted, '.gitignore'))).toEqual(readFileSync('.gitignore'));
  } finally {
    rmSync(extracted, { recursive: true, force: true });
  }
}
