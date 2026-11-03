import { describe, expect, it, vi } from 'vitest';
import { FontPreviewCache } from './font-preview-cache';
describe('imported font preview cache', () => {
    it('deduplicates rendering and uses persistent specimens without loading fonts', async () => {
        const render = vi.fn(() => '<svg/>'), store = { get: vi.fn(async () => undefined as string | undefined), put: vi.fn(async () => { }) };
        const cache = new FontPreviewCache(render, store);
        const a = cache.get('hash'), b = cache.get('hash');
        expect(a).toBe(b);
        await a;
        expect(await cache.get('hash')).toContain('data:image/svg+xml');
        expect(render).toHaveBeenCalledTimes(1);
        expect(store.put).toHaveBeenCalledOnce();
        const persisted = new FontPreviewCache(render, { ...store, get: async () => '<svg/>' });
        await persisted.get('hash');
        expect(render).toHaveBeenCalledTimes(1);
    });
    it('bounds pending work and tolerates blocked storage', async () => {
        const render = vi.fn(() => '<svg/>'), store = { get: vi.fn(async () => { throw Error('Blocked'); }), put: vi.fn(async () => { throw Error('Blocked'); }) };
        const cache = new FontPreviewCache(render, store);
        const jobs = Array.from({ length: 30 }, (_, i) => cache.get(String(i))), results = await Promise.all(jobs);
        expect(results.filter(Boolean)).toHaveLength(12);
        expect(render).toHaveBeenCalledTimes(12);
    });
});
