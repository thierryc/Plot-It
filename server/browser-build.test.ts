import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.env.PLOT_BROWSER_BUILD_DIR;
describe.skipIf(!directory)('locally built GitHub Pages distribution', () => {
  it('serves a portable server root with GitHub processing disabled and complete static assets', () => {
    expect(existsSync(join(directory!, 'CNAME'))).toBe(false);
    expect(existsSync(join(directory!, '.nojekyll'))).toBe(true);
    const html = readFileSync(join(directory!, 'index.html'), 'utf8');
    const references = [...html.matchAll(/(?:src|href)="(\/[^"\s]+)"/g)].map(match => match[1]!);
    expect(references.length).toBeGreaterThan(2);
    for (const reference of references) expect(existsSync(join(directory!, reference))).toBe(true);
    expect(existsSync(join(directory!, 'plot-it-source.tar.gz'))).toBe(true);
  });
  it('contains no server discovery, WebSocket plotter client or Node server runtime', () => {
    const files = readdirSync(join(directory!, 'assets')).filter(file => file.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const script = readFileSync(join(directory!, 'assets', file), 'utf8');
      expect(script).not.toContain('/api/v1/');
      expect(script).not.toContain('new WebSocket(');
      expect(script).not.toContain('node:net');
    }
    for (const name of ['dist-server', 'node_modules', 'package.json', '.github']) expect(existsSync(join(directory!, name))).toBe(false);
  });
});
