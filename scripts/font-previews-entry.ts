import { readFileSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { findFont, loadedFonts, ensureFontLoaded, initializeTypography, typographyToItem, defaultTextOptions, fontTextOptions } from '../src/typography';
import { drawingType, specimenText, previewSVG } from '../src/font-preview';
// @ts-ignore Build-only reviewed metadata module.
import { fontStyles } from './font-styles.mjs';
const folder = 'public/fonts/previews';
mkdirSync(folder, { recursive: true });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
globalThis.fetch = async (input: string | URL | Request) => {
    const url = String(input).split('?')[0]!;
    if (!url.startsWith('/fonts/'))
        throw new Error('Build previews read local font assets only.');
    return new Response(readFileSync(`public${url}`));
};
await initializeTypography();
const entries = [];
for (const id of ['plot-sans', ...loadedFonts().map(f => f.id)]) {
    if (id !== 'plot-sans')
        await ensureFontLoaded(id);
    const font = findFont(id), sample = id === 'plot-sans' ? 'PLOT 012' : specimenText(font?.plotfont);
    const options = font ? fontTextOptions(font, defaultTextOptions) : { ...defaultTextOptions, fontId: id };
    const svg = previewSVG(typographyToItem(sample, 8, options));
    const digest = hash(svg), file = `${id}-${digest.slice(0, 16)}.svg`;
    writeFileSync(`${folder}/${file}`, svg);
    entries.push({ id, name: font?.name ?? 'Plot Sans · single line', collection: font?.group ?? 'Built-in', style: fontStyles[id] ?? 'other', drawing: id === 'plot-sans' ? 'stroke' : drawingType(font?.plotfont), preview: `/fonts/previews/${file}`, sample, coverageHint: font?.coverageHint ?? '', noticeUrl: font?.noticeUrl });
}
const keep = new Set(entries.map(e => e.preview.split('/').at(-1)));
for (const file of readdirSync(folder))
    if (file.endsWith('.svg') && !keep.has(file))
        unlinkSync(`${folder}/${file}`);
writeFileSync('src/fonts/previews.json', JSON.stringify(entries, null, 2) + '\n');
console.log(`Generated ${entries.length} static font previews (${entries.reduce((sum, e) => sum + readFileSync('public' + e.preview).length, 0)} bytes).`);
