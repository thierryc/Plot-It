import { describe, expect, it } from 'vitest';
import { parsePlotFont } from '@thierryc/plotfont';
import source from './fonts/hershey-roman-simplex.plotfont.json?raw';
import { drawingType, specimenText, previewSVG } from './font-preview';
import { defaultTextOptions, typographyToItem } from './typography';
describe('cached font specimens', () => {
    it('uses supported text or actual private-use drawings instead of missing glyphs', () => {
        const font = parsePlotFont(source);
        expect(specimenText(font)).toBe('Aa 012');
        const symbols = { ...font, glyphs: font.glyphs.slice(1, 5).map((g, i) => ({ ...g, unicodes: [(0xe000 + i).toString(16)] })) };
        expect([...specimenText(symbols)].every(char => char.codePointAt(0)! >= 0xe000)).toBe(true);
    });
    it('classifies geometry and produces an image with the original stroke paths', () => {
        const font = parsePlotFont(source);
        expect(drawingType(font)).toBe('stroke');
        const legacy = { ...font, glyphs: font.glyphs.map(g => ({ ...g, strokes: g.strokes.map(op => op.kind === 'stroke' ? { closed: op.closed, commands: op.commands } : op) })) };
        expect(drawingType(legacy)).toBe('stroke');
        const mixed = { ...font, glyphs: [{ ...font.glyphs[0]!, strokes: [{ kind: 'fill' as const, fillRule: 'nonzero' as const, contours: [font.glyphs[1]!.strokes[0]! as {
                                    closed: boolean;
                                    commands: import('@thierryc/plotfont').PlotCommand[];
                                }] }, ...font.glyphs[1]!.strokes] }] };
        expect(drawingType(mixed)).toBe('mixed');
        const item = typographyToItem('Aa 012', 8, defaultTextOptions), svg = previewSVG(item);
        expect(svg).toContain('<svg');
        expect(svg).toContain(item.markup);
        expect(svg).not.toContain('<text');
        expect(svg.length).toBeLessThan(100000);
    });
});
