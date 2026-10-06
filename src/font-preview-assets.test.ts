import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadedFonts } from './typography';
import previews from './fonts/previews.json';
describe('bundled font specimens', () => {
    it('covers every bundled choice with immutable, bounded SVG geometry', () => {
        expect(previews.map(font => font.id)).toEqual(['plot-sans', ...loadedFonts().map(font => font.id)]);
        let bytes = 0;
        for (const font of previews) {
            const svg = readFileSync(`public${font.preview}`, 'utf8');
            bytes += Buffer.byteLength(svg);
            expect(svg.length, font.id).toBeLessThanOrEqual(128000);
            expect(svg, font.id).toContain('<path');
            expect(svg, font.id).not.toMatch(/<(?:text|script|foreignObject)|(?:href|onload)=/);
            expect(font.preview).toContain(createHash('sha256').update(svg).digest('hex').slice(0, 16));
            expect(font.noticeUrl || font.id === 'plot-sans', font.id).toBeTruthy();
        }
        expect(bytes).toBeLessThan(512 * 1024);
        expect(previews.filter(font => font.drawing === 'outline').map(font => font.id)).toEqual(['inter', 'inter-italic', 'square-bot-sans']);
    });
});
