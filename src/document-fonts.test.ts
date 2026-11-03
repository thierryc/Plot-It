import { MAX_IMPORT_FONT_BYTES } from './font-limits';
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { createHash, webcrypto } from 'node:crypto';
import { exportDocumentFonts, importDocumentFonts, loadFontFile, findFont, typographyToItem, defaultTextOptions } from './typography';
import { fontChoices } from './font-choices';
import { parsePlotIt, serializePlotIt } from './document-file';
import { initialState } from './model';
import type { FontImportMetadata } from './font-metadata';
import type { EmbeddedFont } from './document-file';

// Exercise real font parsing/geometry; only IndexedDB storage is replaced.
let records: Map<string, {id:string;name:string;bytes:ArrayBuffer;format?:'openplotfont';metadata?:FontImportMetadata}>;
beforeEach(() => {
  records = new Map(); vi.stubGlobal('crypto',webcrypto);
  const db = {close:vi.fn(),transaction: () => {
    const tx: {oncomplete?:()=>void;objectStore?:()=>unknown} = {};
    tx.objectStore = () => ({
      get: (id: string) => { const request: {result:unknown;onsuccess?:()=>void} = {result:records.get(id)}; queueMicrotask(() => request.onsuccess?.()); return request; },
      getAll: () => { const request: {result:unknown;onsuccess?:()=>void} = {result:[...records.values()]}; queueMicrotask(() => request.onsuccess?.()); return request; },
      put: (record: typeof records extends Map<string,infer T> ? T : never) => { records.set(record.id, structuredClone(record)); queueMicrotask(() => tx.oncomplete?.()); }
    }); return tx;
  }};
  vi.stubGlobal('indexedDB',{open: () => { const request: {result:typeof db;onsuccess?:()=>void} = {result:db}; queueMicrotask(() => request.onsuccess?.()); return request; }});
});
afterEach(() => vi.unstubAllGlobals());
function fixture(path: string, format: EmbeddedFont['format']): EmbeddedFont {
  const bytes = readFileSync(new NodeURL(path,import.meta.url));
  return {id:`${format === 'openplotfont' ? 'openplotfont-' : ''}${createHash('sha256').update(bytes).digest('hex')}`,
    name:path.split('/').at(-1)!, format, encoding:'base64',data:bytes.toString('base64')};
}
describe('portable document fonts', () => {
  it('rejects oversized font files before reading or persisting their bytes', async () => {
    const arrayBuffer = vi.fn();
    await expect(loadFontFile({name:'oversized.opf.json',size:MAX_IMPORT_FONT_BYTES + 1,arrayBuffer} as unknown as File)).rejects.toThrow('64 MB');
    expect(arrayBuffer).not.toHaveBeenCalled();expect(records.size).toBe(0);
  });

  it('retains an imported label, attribution, licence and original bytes across fresh reload and document reopen', async () => {
    const bytes = readFileSync(new NodeURL('./test-fonts/openplotfont/mixed.opf.json', import.meta.url));
    const metadata = {displayName:'Private mixed — alpha.2', attribution:'Original author / handwriting author', license:{name:'UPSTREAM-LICENCE.txt',text:'Original licence\r\n© Author\n'}};
    const font = await loadFontFile({name:'private.opf.json',size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer} as File,metadata);
    expect(font.name).toBe(metadata.displayName);
    expect(fontChoices().find(choice=>choice.id===font.id)).toMatchObject({name:metadata.displayName,collection:'Your fonts',drawing:'mixed'});
    // Reimporting the same bytes must not discard their existing licence companion.
    await loadFontFile({name:'private.opf.json',size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer} as File);
    const [embedded] = await exportDocumentFonts([font.id]);
    expect(Buffer.from(embedded!.data,'base64')).toEqual(bytes);
    expect(embedded!.metadata).toEqual(metadata);
    const state = structuredClone(initialState);
    state.items = [typographyToItem('i',8,{...defaultTextOptions,fontId:font.id})];
    const reopened = parsePlotIt(serializePlotIt(state,[embedded!]));
    expect(reopened.fonts[0]).toEqual(embedded);
    expect(reopened.state.items[0]!.markup.replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g,'')).toBe(state.items[0]!.markup);

    vi.resetModules();
    const reloaded = await import('./typography');
    expect(reloaded.findFont(font.id)).toBeUndefined();
    await reloaded.restoreFonts();
    expect(reloaded.findFont(font.id)).toMatchObject({name:metadata.displayName,metadata});
    expect(reloaded.typographyToItem('i',8,{...defaultTextOptions,fontId:font.id}).markup).toBe(state.items[0]!.markup);
    records.clear();
    await reloaded.importDocumentFonts(reopened.fonts);
    expect(await reloaded.exportDocumentFonts([font.id])).toEqual([embedded]);
    expect(reloaded.findFont(font.id)).toMatchObject({name:metadata.displayName,metadata});
  });
  it('rejects invalid companion metadata before importing and when parsing a document', async () => {
    const font = fixture('./test-fonts/openplotfont/mixed.opf.json','openplotfont');
    font.metadata = {license:{name:'license.txt',text:42 as unknown as string}};
    await expect(importDocumentFonts([font])).rejects.toThrow('font metadata');
    expect(records.size).toBe(0);
    const state = structuredClone(initialState);
    state.items = [{id:'text',name:'text',markup:'<path d="M0 0L1 1"/>',viewBox:[0,0,1,1],x:0,y:0,width:1,height:1,rotation:0,stroke:'#000000',text:{content:'i',options:{...defaultTextOptions,fontId:font.id}}}];
    expect(()=>parsePlotIt(serializePlotIt(state,[font]))).toThrow('font metadata');
  });
  it.each(['.opf', '.opf.json', '.OPF', '.OPF.JSON'])('loads and persists an OpenPlotFont file with extension %s', async extension => {
    const bytes = readFileSync(new NodeURL('./test-fonts/openplotfont/mixed.opf.json', import.meta.url));
    const file = { name: 'mixed' + extension, size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer } as File;
    const font = await loadFontFile(file);
    expect(font.openplotfont?.format).toBe('OpenPlotFont');
    const item = typographyToItem('i', 8, {...defaultTextOptions, fontId: font.id});
    expect(item.markup).toContain('data-openplotfont-kind="fill"');
    expect(item.markup).toContain('fill-rule="evenodd"');
    expect((await exportDocumentFonts([font.id]))[0]?.format).toBe('openplotfont');
  });
  it('requires the new file extensions and format identity', async () => {
    const bytes = readFileSync(new NodeURL('./test-fonts/openplotfont/minimal.opf.json', import.meta.url));
    const file = {name: 'minimal.json', size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer} as File;
    await expect(loadFontFile(file)).rejects.toThrow(/\.opf/);
    const oldBytes = Buffer.from(bytes.toString().replace('OpenPlotFont', 'PlotFont'));
    const oldFile = {...file, name: 'minimal.opf', arrayBuffer: async () => Uint8Array.from(oldBytes).buffer} as File;
    await expect(loadFontFile(oldFile)).rejects.toThrow(/expected format OpenPlotFont/);
  });
  it.each([
    ['./test-fonts/Roboto.ttf','opentype'],
    ['./fonts/hershey-roman-simplex.opf.json','openplotfont']
  ] as const)('loads and re-embeds the original bytes and editable text (%s)', async (path,format) => {
    const font = fixture(path,format);
    await importDocumentFonts([font]);
    expect(findFont(font.id)).toBeDefined(); expect(records.has(font.id)).toBe(true);
    const item = typographyToItem('AB',12,{...defaultTextOptions,fontId:font.id});
    expect(item.text?.content).toBe('AB'); expect(item.markup).toContain('<path');
    expect(await exportDocumentFonts([font.id,font.id,'plot-sans','hershey-roman-simplex'])).toEqual([font]);
  });
  it('does not open font storage when only bundled fonts or Plot Sans are used', async () => {
    const open = vi.spyOn(indexedDB,'open');
    expect(await exportDocumentFonts(['plot-sans','hershey-roman-simplex','inter'])).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });
  it('rejects mismatched embedded font identities before saving or registering anything', async () => {
    const font = fixture('./test-fonts/Roboto.ttf','opentype'); font.id = 'f'.repeat(64);
    await expect(importDocumentFonts([font])).rejects.toThrow('does not match');
    expect(records.size).toBe(0); expect(findFont(font.id)).toBeUndefined();
  });
  it('reports a missing custom font instead of silently saving uneditable text', async () => {
    await expect(exportDocumentFonts(['e'.repeat(64)])).rejects.toThrow('missing font');
  });
});
