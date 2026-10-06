import appFontPicker from './font-picker.module.css';
import dsField from '../design-system/field.module.css';
import dsSelect from '../design-system/select.module.css';

import { popoverPosition } from '../design-system/overlays';
import type { DrawingType } from '../../font-preview';
export interface FontChoice {
    id: string;
    name: string;
    collection: string;
    style: string;
    drawing: DrawingType;
    preview?: string;
    coverageHint?: string;
    noticeUrl?: string;
}
export interface FontFilters {
    query: string;
    style: string;
    drawing: string;
    collection: string;
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const drawingLabels: Record<DrawingType, string> = { stroke: 'Centerline strokes', outline: 'Outlines', mixed: 'Mixed strokes & shapes' };
const styleLabels: Record<string, string> = { sans: 'Sans', serif: 'Serif', script: 'Script', blackletter: 'Blackletter', technical: 'Technical', symbols: 'Symbols', decorative: 'Decorative', other: 'Other / unclassified' };
export function filterFonts(fonts: FontChoice[], filters: FontFilters): FontChoice[] {
    const words = filters.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return fonts.filter(font => words.every(word => `${font.name} ${font.collection} ${styleLabels[font.style] ?? font.style} ${drawingLabels[font.drawing]}`.toLocaleLowerCase().includes(word))
        && (filters.style === 'all' || font.style === filters.style) && (filters.drawing === 'all' || font.drawing === filters.drawing) && (filters.collection === 'all' || font.collection === filters.collection));
}
let sequence = 0;
export function fontPickerMarkup(id: string, name: string): string {
    const key = `font-picker-${++sequence}`;
    return `<div class="font-picker ${appFontPicker["font-picker"]} " data-font-picker><span class="font-field-label ${appFontPicker["font-field-label"]} ">Font</span><input type="hidden" data-typography="fontId" data-font-current="${escape(id)}" value="${escape(id)}"><button type="button" class="font-picker-trigger ${appFontPicker["font-picker-trigger"]} " data-font-picker-trigger aria-label="Choose font, ${escape(name)}" aria-haspopup="dialog" aria-expanded="false" aria-controls="${key}"><span data-font-current-name>${escape(name)}</span><span aria-hidden="true">⌄</span></button><div id="${key}" class="font-picker-popup ${appFontPicker["font-picker-popup"]} " data-font-popup popover="auto" role="dialog" aria-label="Choose font" hidden><div class="font-picker-head ${appFontPicker["font-picker-head"]} "><strong>Choose a font</strong><button type="button" class="font-picker-close ${appFontPicker["font-picker-close"]} " data-font-close aria-label="Close font picker">×</button></div><input class="font-search ${appFontPicker["font-search"]}" data-font-search type="search" placeholder="Search fonts…" aria-label="Search fonts" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="${key}-list"><div class="font-filters ${appFontPicker["font-filters"]} "><label class="${dsField["field"]} ">Style<select class="${dsSelect["select"]} " aria-label="Style" data-font-filter="style"><option value="all">All styles</option></select></label><label class="${dsField["field"]} ">Drawing<select class="${dsSelect["select"]} " aria-label="Drawing" data-font-filter="drawing"><option value="all">All types</option></select></label><label class="${dsField["field"]} ">Collection<select class="${dsSelect["select"]} " aria-label="Collection" data-font-filter="collection"><option value="all">All collections</option></select></label></div><div class="font-picker-summary ${appFontPicker["font-picker-summary"]} "><span data-font-count role="status" aria-live="polite"></span><button type="button" data-font-clear>Clear filters</button></div><div id="${key}-list" class="font-results ${appFontPicker["font-results"]} " data-font-results role="listbox" aria-label="Fonts"></div><p class="font-picker-hint ${appFontPicker["font-picker-hint"]} ">Arrow keys to browse · Enter to choose · Escape to cancel</p></div></div>`;
}
/** One shared picker implementation for both inspector and Add Text controls. */
export class FontPicker {
    private controller = new AbortController();
    private observer: IntersectionObserver | null = null;
    private popup: HTMLElement;
    private trigger: HTMLButtonElement;
    private input: HTMLInputElement;
    private search: HTMLInputElement;
    private list: HTMLElement;
    private fonts: FontChoice[] = [];
    private visible: FontChoice[] = [];
    private highlight = -1;
    private opened = false;
    private revision = 0;
    private loading = new WeakSet<HTMLImageElement>();
    constructor(readonly root: HTMLElement, private choices: () => FontChoice[], private customPreview?: (id: string) => Promise<string | undefined>) {
        this.popup = root.querySelector('[data-font-popup]')!;
        this.trigger = root.querySelector('[data-font-picker-trigger]')!;
        this.input = root.querySelector('[data-typography=fontId]')!;
        this.search = root.querySelector('[data-font-search]')!;
        this.list = root.querySelector('[data-font-results]')!;
        const signal = this.controller.signal;
        this.trigger.addEventListener('click', () => this.opened ? this.close() : this.open(), { signal });
        this.popup.querySelector('[data-font-close]')!.addEventListener('click', () => this.close(), { signal });
        this.search.addEventListener('input', () => this.renderResults(), { signal });
        this.popup.addEventListener('change', () => this.renderResults(), { signal });
        this.popup.querySelector('[data-font-clear]')!.addEventListener('click', () => {
            this.search.value = '';
            this.popup.querySelectorAll<HTMLSelectElement>('[data-font-filter]').forEach(select => select.value = 'all');
            this.renderResults();
            this.search.focus();
        }, { signal });
        this.list.addEventListener('click', event => { const row = (event.target as Element).closest<HTMLElement>('[data-font-choice]'); if (row)
            this.choose(row.dataset.fontChoice!); }, { signal });
        this.popup.addEventListener('keydown', event => this.keydown(event), { signal });
        this.popup.addEventListener('toggle', event => { if ((event as ToggleEvent).newState === 'closed')
            this.close(false); }, { signal });
        this.list.addEventListener('scroll', () => { if (!this.observer)
            this.loadVisible(); }, { signal });
        window.addEventListener('resize', () => { if (this.opened)
            this.position(); }, { signal });
    }
    refreshCurrent(): void {
        const current = this.choices().find(font => font.id === this.input.value);
        const name = current?.name ?? 'Unavailable font · load original file';
        this.trigger.querySelector('[data-font-current-name]')!.textContent = name;
        this.trigger.setAttribute('aria-label', `Choose font, ${name}`);
    }
    open(): void {
        if (this.opened)
            return;
        this.opened = true;
        this.fonts = this.choices();
        this.search.value = '';
        for (const key of ['style', 'drawing', 'collection'] as const) {
            const select = this.popup.querySelector<HTMLSelectElement>(`[data-font-filter="${key}"]`)!;
            const values = [...new Set(this.fonts.map(font => font[key]))];
            select.innerHTML = `<option value="all">${key === 'style' ? 'All styles' : key === 'drawing' ? 'All types' : 'All collections'}</option>` + values.map(value => `<option value="${escape(value)}">${escape(key === 'style' ? styleLabels[value] ?? value : key === 'drawing' ? drawingLabels[value as DrawingType] : value)}</option>`).join('');
        }
        this.popup.hidden = false;
        this.trigger.setAttribute('aria-expanded', 'true');
        this.renderResults();
        this.popup.showPopover?.();
        this.position();
        this.search.focus({ preventScroll: true });
    }
    close(returnFocus = true): void {
        if (!this.opened)
            return;
        this.opened = false;
        ++this.revision;
        this.observer?.disconnect();
        this.observer = null;
        this.popup.hidePopover?.();
        this.popup.hidden = true;
        this.trigger.setAttribute('aria-expanded', 'false');
        if (returnFocus && this.trigger.isConnected)
            this.trigger.focus({ preventScroll: true });
    }
    private position(): void {
        const position = popoverPosition(this.trigger.getBoundingClientRect(), { width: this.popup.offsetWidth, height: this.popup.offsetHeight }, { width: innerWidth, height: innerHeight });
        this.popup.style.left = `${position.left}px`;
        this.popup.style.top = `${position.top}px`;
    }
    private renderResults(): void {
        ++this.revision;
        this.observer?.disconnect();
        this.observer = null;
        const value = (key: string) => this.popup.querySelector<HTMLSelectElement>(`[data-font-filter="${key}"]`)!.value;
        this.visible = filterFonts(this.fonts, { query: this.search.value, style: value('style'), drawing: value('drawing'), collection: value('collection') });
        this.highlight = -1;
        this.search.removeAttribute('aria-activedescendant');
        this.popup.querySelector('[data-font-count]')!.textContent = `${this.visible.length} of ${this.fonts.length} fonts`;
        this.list.innerHTML = this.visible.length ? this.visible.map((font, index) => `<div class="font-result ${appFontPicker["font-result"]} " id="${this.list.id}-${index}" role="option" aria-selected="${font.id === this.input.value}" data-font-choice="${escape(font.id)}"><div class="font-result-description ${appFontPicker["font-result-description"]} "><span class="font-result-name ${appFontPicker["font-result-name"]} ">${escape(font.name)}</span><small>${escape(drawingLabels[font.drawing])} · ${escape(font.collection)}</small>${font.coverageHint ? `<span class="font-coverage-badge ${appFontPicker["font-coverage-badge"]} ">Symbols / limited mapping</span>` : ''}</div><img class="font-specimen ${appFontPicker["font-specimen"]} " width="180" height="40" alt="" loading="lazy" decoding="async" data-preview-id="${escape(font.id)}" ${font.preview ? `data-preview-src="${escape(font.preview)}"` : ''}></div>`).join('') : `<p class="font-empty ${appFontPicker["font-empty"]} ">No fonts match. Try fewer filters.</p>`;
        if (typeof IntersectionObserver !== 'undefined') {
            this.observer = new IntersectionObserver(entries => { for (const entry of entries)
                if (entry.isIntersecting) {
                    this.hydrate(entry.target as HTMLImageElement);
                    this.observer?.unobserve(entry.target);
                } }, { root: this.list, rootMargin: '120px' });
            this.list.querySelectorAll('img').forEach(image => this.observer!.observe(image));
        }
        else
            this.loadVisible();
    }
    private loadVisible(): void {
        const bounds = this.list.getBoundingClientRect();
        [...this.list.querySelectorAll('img')].filter(image => { const box = image.getBoundingClientRect(); return box.bottom >= bounds.top - 80 && box.top <= bounds.bottom + 80; }).slice(0, 12).forEach(image => this.hydrate(image));
    }
    private hydrate(image: HTMLImageElement): void {
        if (this.loading.has(image))
            return;
        this.loading.add(image);
        if (image.dataset.previewSrc) {
            image.src = image.dataset.previewSrc;
            return;
        }
        const revision = this.revision;
        void this.customPreview?.(image.dataset.previewId!).then(src => { if (src && this.opened && revision === this.revision && image.isConnected)
            image.src = src; }).catch(() => { });
    }
    private keydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            return;
        }
        if (event.target !== this.search)
            return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!this.visible.length)
                return;
            this.highlight = this.highlight < 0 ? (event.key === 'ArrowDown' ? 0 : this.visible.length - 1) : (this.highlight + (event.key === 'ArrowDown' ? 1 : -1) + this.visible.length) % this.visible.length;
            this.list.querySelectorAll<HTMLElement>('[role=option]').forEach((row, index) => { row.toggleAttribute('data-highlighted', index === this.highlight); row.setAttribute('aria-selected', String(index === this.highlight)); });
            const row = this.list.children[this.highlight] as HTMLElement;
            this.search.setAttribute('aria-activedescendant', row.id);
            row.scrollIntoView?.({ block: 'nearest' });
        }
        else if (event.key === 'Enter') {
            event.preventDefault();
            if (this.highlight >= 0)
                this.choose(this.visible[this.highlight]!.id);
        }
    }
    private choose(id: string): void {
        if (this.input.value === id) {
            this.close();
            return;
        }
        this.input.value = id;
        this.refreshCurrent();
        this.close();
        this.input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    destroy(): void { this.close(false); this.controller.abort(); this.observer?.disconnect(); }
}
