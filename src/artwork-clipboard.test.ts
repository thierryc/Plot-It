// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureClipboardArtwork, decodeClipboardArtwork, encodeClipboardArtwork, freshClipboardItem, isArtworkClipboardTarget, readSvgClipboard, svgFromPaste, writeSvgClipboard } from './artwork-clipboard';
import { defaultFillSettings, type ArtworkItem } from './model';
import { renderItem } from './svg';

const item = (): ArtworkItem => ({ id: 'original', name: 'Editable', markup: '<defs><clipPath id="clip"><rect width="30" height="20"/></clipPath></defs><path clip-path="url(#clip)" d="M0 0L30 20"/>', viewBox: [0, 0, 30, 20], x: 10, y: 15, width: 30, height: 20, rotation: 12, stroke: '#000000', fillSettings: {...defaultFillSettings}, text: { content: 'A😀B', frame: { width: 3, height: 2 }, options: { fontId: 'plot-sans', letterSpacing: .01, wordSpacing: 0, lineHeight: 1.8, align: 'left', kerning: true, ligatures: true, contextual: true, features: '', variations: '', direction: 'auto', language: '', script: '', featureRanges: [{start:1,end:3,tag:'liga',value:0}], variationRanges: [{start:1,end:3,tag:'wght',value:650}] } } });
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32mm" height="22mm" viewBox="9 14 32 22"><path d="M10 15L40 35"/></svg>';
const transfer = (values: Record<string,string>, files: File[] = []) => ({ files, getData: (type: string) => values[type] ?? '' }) as unknown as DataTransfer;

beforeEach(() => { document.body.innerHTML = ''; window.getSelection()?.removeAllRanges(); });
describe('artwork clipboard', () => {
  it('round-trips editable text, axes, ranges, transforms and fill without changing the original', () => {
    const original = item(), before = JSON.stringify(original);
    const encoded = encodeClipboardArtwork({ item: original, svg });
    const result = decodeClipboardArtwork(encoded);
    expect(result.native).toBe(true); expect({...result.item, markup: original.markup}).toEqual(original);
    expect(result.item.markup).toContain('clip-path="url(#clip)" d="M0 0L30 20"');
    expect(JSON.stringify(original)).toBe(before);
    expect(decodeClipboardArtwork(encoded, false).item.text).toBeUndefined();
    expect(decodeClipboardArtwork(encoded, false).item.width).toBe(32);
  });
  it('escapes source text and validates embedded editable geometry', () => {
    const original = item(); original.text!.content = '</metadata><script>alert(1)</script>';
    original.text!.options!.featureRanges = []; original.text!.options!.variationRanges = [];
    original.markup += '<script>alert(1)</script><path onclick="bad()" d="M0 0L1 1"/>';
    const encoded = encodeClipboardArtwork({ item: original, svg });
    expect(new DOMParser().parseFromString(encoded,'image/svg+xml').querySelector('script')).toBeNull();
    const result = decodeClipboardArtwork(encoded);
    expect(result.item.markup).not.toMatch(/script|onclick/);
    expect(result.item.text!.content).toBe(original.text!.content);
  });
  it('falls back to portable artwork for damaged native metadata, stripping the payload', () => {
    const source = svg.replace('<path', '<metadata data-plot-it-clipboard="1">{"broken":true}</metadata><path');
    const result = decodeClipboardArtwork(source);
    expect(result.native).toBe(false); expect(result.item.markup).not.toContain('metadata');
    expect(() => decodeClipboardArtwork('<svg>broken')).toThrow('valid SVG');
    expect(() => decodeClipboardArtwork('x'.repeat(32*1024*1024+1))).toThrow('32 MB');
  });
  it('gives pasted objects independent IDs, references, and typography data', () => {
    const original = item(), copy = freshClipboardItem(original,{x:15,y:20});
    expect(copy.id).not.toBe(original.id); expect(copy.markup).not.toContain('id="clip"');
    expect(copy.markup).toContain(`url(#${copy.id}-0)`);
    copy.text!.options!.variationRanges![0]!.value = 900;
    expect(original.text!.options!.variationRanges![0]!.value).toBe(650);
    expect(copy).toMatchObject({x:15,y:20,rotation:12,width:30,height:20});
  });
  it('exports only a selected object and never includes paper or selection handles', () => {
    const original = item();
    document.body.innerHTML = `<svg><rect id="paper-background"/><g id="artwork-layer" stroke="currentColor">${renderItem(original)}${renderItem({...original,id:'other'})}</g><circle class="handle"/></svg>`;
    const scene = document.querySelector('svg')!, before = scene.outerHTML;
    const result = captureClipboardArtwork(scene,original,null,{x:10,y:15,width:30,height:20});
    expect(result.svg).not.toMatch(/data-item-id|paper-background|class="handle"/);
    expect(new DOMParser().parseFromString(result.svg,'image/svg+xml').querySelectorAll('path')).toHaveLength(1);
    expect(scene.outerHTML).toBe(before);
    expect(result.item.text).toEqual(original.text);
  });
  it('copies a nested element with ancestor transforms, definitions and only its generated fill', () => {
    const original = item(); original.text = undefined;
    original.markup = '<defs><clipPath id="clip"><rect width="30" height="20"/></clipPath></defs><g transform="translate(2 3)" clip-path="url(#clip)"><path data-fill-path-key="one" d="M0 0L1 1"/><path data-fill-path-key="two" d="M2 2L3 3"/></g><g data-generated-fill data-fill-path-key="one"><path d="M4 4L5 5"/></g><g data-generated-fill data-fill-path-key="two"><path d="M6 6L7 7"/></g>';
    document.body.innerHTML = `<svg><g id="artwork-layer">${renderItem(original)}</g></svg>`;
    const result = captureClipboardArtwork(document.querySelector('svg')!,original,0,{x:10,y:15,width:30,height:20});
    expect(result.svg).toContain('translate(2 3)'); expect(result.svg).toContain('clipPath');
    expect(result.svg).toContain('M4 4L5 5'); expect(result.svg).not.toMatch(/M2 2L3 3|M6 6L7 7/);
    expect(result.item.text).toBeUndefined(); expect(result.item.fillSettings).toBeUndefined();
  });
  it('accepts SVG source, XML declarations, HTML SVG and SVG files; ignores ordinary text', async () => {
    expect(svgFromPaste(transfer({'text/plain':svg}))).toBe(svg);
    expect(svgFromPaste(transfer({'text/plain':'<?xml version="1.0"?><!DOCTYPE svg>'+svg}))).toContain('<!DOCTYPE svg>');
    expect(svgFromPaste(transfer({'text/html':`<div>${svg}</div>`}))).toContain('<svg');
    const file = {name:'drawing.svg',type:'image/svg+xml',size:svg.length,text:async()=>svg} as File;
    expect(await svgFromPaste(transfer({},[file]))).toBe(svg);
    expect(svgFromPaste(transfer({'text/plain':'ordinary text'}))).toBeUndefined();
  });
  it('leaves text controls, dialogs, rich text and selected UI text to native clipboard behavior', () => {
    const app = document.createElement('main'); document.body.append(app);
    app.innerHTML = '<div tabindex="0"></div><input><textarea></textarea><div contenteditable><span>editing</span></div><div role="dialog"><button>Setting</button></div><p>Selected UI text</p>';
    expect(isArtworkClipboardTarget(app.firstElementChild,app)).toBe(true);
    for (const target of app.querySelectorAll('input,textarea,[contenteditable] span,button')) expect(isArtworkClipboardTarget(target,app)).toBe(false);
    const range = document.createRange();range.selectNodeContents(app.querySelector('p')!);window.getSelection()!.addRange(range);
    expect(isArtworkClipboardTarget(app.firstElementChild,app)).toBe(false);
  });
  it('starts a multi-format write before asynchronous font/fill preparation completes', async () => {
    let resolve!:(value:string)=>void;
    const source = new Promise<string>(r=>resolve=r);
    class Item { static supports(type:string){return type==='image/svg+xml';} constructor(public data:Record<string,Promise<Blob>>){} }
    const write = vi.fn(async(_items:ClipboardItem[])=>{}), clipboard = {write} as unknown as Clipboard;
    const result = writeSvgClipboard(source,clipboard,Item as unknown as typeof ClipboardItem);
    expect(write).toHaveBeenCalledOnce();
    expect(Object.keys((write.mock.calls[0]![0][0] as unknown as Item).data)).toEqual(['text/plain','image/svg+xml']);
    resolve(svg); expect(await result).toBe('svg');
  });
  it('falls back to SVG source when vector clipboard writing fails', async () => {
    class Item { static supports(){return true;} constructor(public data:Record<string,Promise<Blob>>){} }
    const write = vi.fn().mockRejectedValueOnce(new Error('SVG unavailable')).mockResolvedValueOnce(undefined);
    expect(await writeSvgClipboard(svg,{write} as unknown as Clipboard,Item as unknown as typeof ClipboardItem)).toBe('text');
    expect(Object.keys(write.mock.calls[1]![0][0].data)).toEqual(['text/plain']);
  });
  it('prefers vector data when reading and reports unsupported clipboard contents', async () => {
    const clipboard = { read: async()=>[{types:['text/plain','image/svg+xml'],getType:async(type:string)=>({size:svg.length,text:async()=>type==='image/svg+xml'?svg:'ordinary text'})}] } as unknown as Clipboard;
    expect(await readSvgClipboard(clipboard)).toBe(svg);
    await expect(readSvgClipboard({readText:async()=> 'hello'} as unknown as Clipboard)).rejects.toThrow('No SVG');
  });
});
