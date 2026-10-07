import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const read = (path: string) => readFileSync(path, 'utf8');
describe('hosted site contract', () => {
  it('has direct HTML routes, shared navigation and project attribution', () => {
    for (const path of ['index.html', 'docs/index.html', 'docs/self-hosted/index.html', '404.html']) {
      const html = read(`site/${path}`);
      expect(html).toContain('href="%BASE_URL%app/"');
      expect(html).toContain('href="%BASE_URL%docs/"');
      expect(html).toContain('Another Planet Creative eXperience');
      expect(html).toContain('https://ap.cx/');
      expect(html).toContain('Alpha · Active development');
      const document = new JSDOM(html).window.document;
      expect(document.querySelector('#main')?.getAttribute('tabindex')).toBe('-1');
      const banner = document.querySelector('footer [data-apcx-marquee]');
      expect(banner?.getAttribute('aria-hidden')).toBe('true');
      expect(banner?.textContent).toContain('Another Planet . Creative eXperience');
      expect(document.querySelector('[data-marquee-motion]')?.getAttribute('aria-controls')).toBe(banner?.id);
    }
    expect(read('site/app/index.html')).toContain('../../src/main.ts');
    expect(read('index.html')).not.toContain('site/site');
  });
  it('publishes honest hardware status and primary sources', () => {
    const html = read('site/docs/index.html');
    for (const content of ['I do not own an AxiDraw or NextDraw', 'compatibility not established', 'untested', 'https://www.axidraw.com/', 'https://bantamtools.com/collections/nextdraw-merge-bundles', 'https://www.schmalzhaus.com/EBB/', 'https://github.com/thierryc/OpenPlotFont', '2026-10-05']) expect(html).toContain(content);
    expect(read('site/docs/self-hosted/index.html')).toContain('hardware acceptance is pending');
    expect(existsSync('.github/ISSUE_TEMPLATE/hardware-report.yml')).toBe(true);
  });
  it.each(['/', '/Plot-It/'])('limits worker fallback and cache deletion to the hosted app at %s', async base => {
    const listeners: Record<string, (event: any) => void> = {};
    const deleted: string[] = [];
    const caches = { keys: async () => ['plot-it-site-app-old', 'other-app-cache'], delete: vi.fn(async (key: string) => { deleted.push(key); }), open: vi.fn(), match: vi.fn(async () => undefined) };
    runInNewContext(read('site/app/sw.js'), { self: { location: { origin: 'https://thierryc.github.io', href: `https://thierryc.github.io${base}app/sw.js` }, addEventListener: (type: string, fn: any) => { listeners[type] = fn; }, clients: { claim: vi.fn() }, skipWaiting: vi.fn() }, caches, URL, Response, fetch: vi.fn(async () => { throw new Error('offline'); }) });
    let pending: Promise<any>;
    listeners.activate!({ waitUntil: (promise: Promise<any>) => { pending = promise; } });
    await pending!;
    expect(deleted).toEqual(['plot-it-site-app-old']);
    for (const path of ['/', '/docs/', '/api/v1/status', '/missing/']) {
      const respondWith = vi.fn();
      listeners.fetch!({ request: { method: 'GET', url: `https://thierryc.github.io${base}${path.slice(1)}`, mode: 'navigate' }, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
    listeners.fetch!({ request: { method: 'GET', url: `https://thierryc.github.io${base}app/`, mode: 'navigate' }, respondWith: (promise: Promise<any>) => { pending = promise; } });
    await pending!;
    expect(caches.match).toHaveBeenCalledWith(base + 'app/');
    expect(JSON.parse(read('site/app/manifest.webmanifest'))).toMatchObject({ start_url: './', scope: './' });
  });
});
