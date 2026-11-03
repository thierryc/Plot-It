import { publicAssetUrl } from './app-deployment';
import previews from './fonts/previews.json';
import { loadedFonts } from './typography';
import { drawingType } from './font-preview';
import type { FontChoice } from './font-picker';
const bundled = new Map(previews.map(font => [font.id, {...font, preview: publicAssetUrl(font.preview), noticeUrl: font.noticeUrl ? publicAssetUrl(font.noticeUrl) : undefined} as FontChoice]));
export function fontChoices(): FontChoice[] {
    return [bundled.get('plot-sans')!, ...loadedFonts().map(font => bundled.get(font.id) ?? {
            id: font.id, name: font.name, collection: font.bundled ? font.group ?? 'Built-in' : 'Your fonts', style: 'other', drawing: drawingType(font.openplotfont), coverageHint: font.coverageHint, noticeUrl: font.noticeUrl
        })];
}
