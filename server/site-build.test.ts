import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const directory = process.env.PLOT_SITE_BUILD_DIR;
describe.skipIf(!directory)('hosted production artifact', () => {
  it('resolves every page and its local links without an SPA fallback', () => {
    for (const route of ['', 'app/', 'docs/', 'docs/self-hosted/']) {
      const html = readFileSync(join(directory!, route, 'index.html'), 'utf8');
      const document = new JSDOM(html).window.document;
      expect(document.title).toContain('Plot-it');
      for (const element of document.querySelectorAll('[src], [href]')) {
        const reference = element.getAttribute('src') ?? element.getAttribute('href')!;
        if (!reference.startsWith('/')) continue;
        expect(reference).toMatch(/^\/Plot-It\//);
        const path = reference.split(/[?#]/)[0]!.slice('/Plot-It/'.length);
        expect(existsSync(join(directory!, path, path.endsWith('/') ? 'index.html' : '')), reference).toBe(true);
      }
    }
    expect(readFileSync(join(directory!, '404.html'), 'utf8')).toContain('Page not found');
    expect(existsSync(join(directory!, 'app/sw.js'))).toBe(true);
    expect(existsSync(join(directory!, 'sw.js'))).toBe(false);
    expect(existsSync(join(directory!, 'manifest.webmanifest'))).toBe(false);
  });
  it('ships complete browser assets and corresponding website source', () => {
    expect(existsSync(join(directory!, 'CNAME'))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(directory!, 'app/manifest.webmanifest'), 'utf8'));
    expect(manifest).toMatchObject({start_url: './', scope: './'});
    expect(existsSync(join(directory!, '.nojekyll'))).toBe(true);
    const files = readdirSync(join(directory!, 'assets'), { recursive: true, encoding: 'utf8' });
    expect(files.some(file => file.endsWith('.wasm'))).toBe(true);
    expect(files.some(file => /planner[.-]worker/.test(file))).toBe(true);
    for (const file of files.filter(file => file.endsWith('.js'))) {
      const source = readFileSync(join(directory!, 'assets', file), 'utf8');
      for (const forbidden of ['/api/v1/', 'new WebSocket(', 'node:net']) expect(source).not.toContain(forbidden);
    }
    const archive = execFileSync('tar', ['-tzf', join(directory!, 'plot-it-source.tar.gz')], { encoding: 'utf8' });
    for (const file of ['site/index.html', 'site/app/sw.js', 'scripts/publish-site.mjs', 'docs/SITE_HOSTING.md']) expect(archive).toContain(file);
    for (const name of ['dist-server', 'node_modules', 'package.json', '.github']) expect(existsSync(join(directory!, name))).toBe(false);
  });
});
