// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FontPicker, fontPickerMarkup, filterFonts, type FontChoice } from './font-picker';
const fonts: FontChoice[] = [
    { id: 'roman', name: 'Roman Simplex', collection: 'Hershey', style: 'serif', drawing: 'stroke', preview: '/fonts/previews/roman.svg' },
    { id: 'script', name: 'Bird Script', collection: 'EMS', style: 'script', drawing: 'stroke', preview: '/fonts/previews/script.svg' },
    { id: 'outline', name: 'Inter', collection: 'Outline fonts', style: 'sans', drawing: 'outline', preview: '/fonts/previews/inter.svg' },
    { id: 'custom', name: 'My mixed font', collection: 'Your fonts', style: 'other', drawing: 'mixed' }
];
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
describe('font picker', () => {
    it('combines text, style, drawing type, and collection without loading font files', () => {
        expect(filterFonts(fonts, { query: 'bird', style: 'script', drawing: 'stroke', collection: 'EMS' }).map(f => f.id)).toEqual(['script']);
        expect(filterFonts(fonts, { query: 'hershey', style: 'all', drawing: 'all', collection: 'all' }).map(f => f.id)).toEqual(['roman']);
        expect(filterFonts(fonts, { query: '', style: 'sans', drawing: 'stroke', collection: 'all' })).toEqual([]);
    });
    it('opens each menu independently, filters without changing the font, and commits exactly once', () => {
        document.body.innerHTML = fontPickerMarkup('roman', 'Roman Simplex') + fontPickerMarkup('outline', 'Inter');
        const wrappers = [...document.querySelectorAll<HTMLElement>('[data-font-picker]')];
        const changed = vi.fn();
        wrappers[0]!.querySelector('input')!.addEventListener('change', changed);
        const picker = new FontPicker(wrappers[0]!, () => fonts);
        picker.open();
        const search = wrappers[0]!.querySelector<HTMLInputElement>('[data-font-search]')!;
        search.value = 'bird';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        expect(document.activeElement).toBe(search);
        expect(wrappers[0]!.querySelectorAll('[role=option]')).toHaveLength(1);
        expect(changed).not.toHaveBeenCalled();
        search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(wrappers[0]!.querySelector<HTMLInputElement>('[data-typography=fontId]')!.value).toBe('script');
        expect(wrappers[1]!.querySelector<HTMLInputElement>('[data-typography=fontId]')!.value).toBe('outline');
        expect(changed).toHaveBeenCalledTimes(1);
        expect(wrappers[0]!.querySelector('[data-font-picker-trigger]')!.getAttribute('aria-expanded')).toBe('false');
        picker.destroy();
    });
    it('Escape cancels keyboard browsing and returns focus without committing', () => {
        document.body.innerHTML = fontPickerMarkup('roman', 'Roman Simplex');
        const wrapper = document.querySelector<HTMLElement>('[data-font-picker]')!, changed = vi.fn();
        wrapper.querySelector('input')!.addEventListener('change', changed);
        const picker = new FontPicker(wrapper, () => fonts);
        picker.open();
        const search = wrapper.querySelector<HTMLInputElement>('[data-font-search]')!;
        search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(changed).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(wrapper.querySelector('[data-font-picker-trigger]'));
        picker.destroy();
    });
    it('hydrates only visible previews and releases observers when closed', async () => {
        let notify!: IntersectionObserverCallback;
        const observe = vi.fn(), disconnect = vi.fn();
        vi.stubGlobal('IntersectionObserver', class {
            constructor(callback: IntersectionObserverCallback) { notify = callback; }
            observe = observe;
            disconnect = disconnect;
            unobserve = vi.fn();
        });
        document.body.innerHTML = fontPickerMarkup('roman', 'Roman Simplex');
        const wrapper = document.querySelector<HTMLElement>('[data-font-picker]')!, custom = vi.fn(async () => 'blob:custom-preview');
        const picker = new FontPicker(wrapper, () => fonts, custom);
        picker.open();
        expect(wrapper.querySelectorAll('img[src]')).toHaveLength(0);
        expect(custom).not.toHaveBeenCalled();
        const images = [...wrapper.querySelectorAll('img')];
        notify([{ target: images[0]!, isIntersecting: true }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
        expect(images[0]!.getAttribute('src')).toBe(fonts[0]!.preview);
        expect(images[1]!.hasAttribute('src')).toBe(false);
        notify([{ target: images[3]!, isIntersecting: true }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
        await Promise.resolve();
        expect(custom).toHaveBeenCalledTimes(1);
        expect(images[3]!.getAttribute('src')).toBe('blob:custom-preview');
        picker.close();
        expect(disconnect).toHaveBeenCalled();
        picker.destroy();
    });
});
