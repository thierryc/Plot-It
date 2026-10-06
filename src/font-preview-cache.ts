import { defaultTextOptions, findFont, fontTextOptions, initializeTypography, typographyToItem } from './typography';
import { previewSVG, specimenText } from './font-preview';
export interface PreviewStore {
    get(key: string): Promise<string | undefined>;
    put(key: string, svg: string): Promise<void>;
}
export class FontPreviewCache {
    private ready = new Map<string, string>();
    private pending = new Map<string, Promise<string | undefined>>();
    private queue: (() => Promise<void>)[] = [];
    private running = false;
    constructor(private render: (id: string) => Promise<string> | string, private store?: PreviewStore) { }
    get(id: string): Promise<string | undefined> {
        const key = `specimen-v1:${id}`;
        const cached = this.ready.get(key);
        if (cached) {
            this.ready.delete(key);
            this.ready.set(key, cached);
            return Promise.resolve(cached);
        }
        const pending = this.pending.get(key);
        if (pending)
            return pending;
        if (this.pending.size >= 12)
            return Promise.resolve(undefined);
        const promise = new Promise<string | undefined>(resolve => this.queue.push(async () => {
            try {
                let svg = await this.store?.get(key).catch(() => undefined);
                if (!svg) {
                    svg = await this.render(id);
                    if (svg.length > 128000)
                        throw new Error('Specimen too large.');
                    await this.store?.put(key, svg).catch(() => { });
                }
                if (svg.length > 128000)
                    throw new Error('Stored specimen too large.');
                const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
                this.ready.set(key, url);
                while (this.ready.size > 32)
                    this.ready.delete(this.ready.keys().next().value!);
                resolve(url);
            }
            catch {
                resolve(undefined);
            }
            finally {
                this.pending.delete(key);
            }
        }));
        this.pending.set(key, promise);
        void this.drain();
        return promise;
    }
    private async drain(): Promise<void> {
        if (this.running)
            return;
        this.running = true;
        try {
            while (this.queue.length) {
                await new Promise(resolve => setTimeout(resolve, 0));
                await this.queue.shift()!();
            }
        }
        finally {
            this.running = false;
        }
    }
}
function storedPreviews(): PreviewStore {
    let db: Promise<IDBDatabase> | undefined;
    const database = () => db ??= new Promise((resolve, reject) => {
        const request = indexedDB.open('plot-it-font-previews', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('previews', { keyPath: 'key' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    return {
        async get(key) { const connection = await database(); return new Promise((resolve, reject) => { const request = connection.transaction('previews').objectStore('previews').get(key); request.onsuccess = () => resolve(request.result?.svg); request.onerror = () => reject(request.error); }); },
        async put(key, svg) {
            const connection = await database();
            await new Promise<void>((resolve, reject) => {
                const transaction = connection.transaction('previews', 'readwrite'), store = transaction.objectStore('previews');
                store.put({ key, svg, time: Date.now() });
                const request = store.getAll();
                request.onsuccess = () => {
                    const entries = request.result as {
                        key: string;
                        time: number;
                    }[];
                    entries.sort((a, b) => b.time - a.time).slice(32).forEach(entry => store.delete(entry.key));
                };
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
                transaction.onabort = () => reject(transaction.error);
            });
        }
    };
}
export const customFontPreviews = new FontPreviewCache(async (id) => {
    const font = findFont(id);
    if (!font || font.bundled)
        throw new Error('Custom preview requires an imported font.');
    await initializeTypography();
    return previewSVG(typographyToItem(specimenText(font.plotfont), 8, fontTextOptions(font, defaultTextOptions)));
}, storedPreviews());
