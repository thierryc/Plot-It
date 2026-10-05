// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { initialState, defaultFillSettings } from './model';
import { defaultPens } from './pens';
import { DOCUMENT_ACCEPT, isPlotItDocumentFile, parsePlotIt, serializePlotIt } from './document-file';
import { calibrationSheet } from './calibration';
import { defaultTextOptions } from './typography';
import { documentFilename } from './document-name';

const document = () => {
  const state = structuredClone(initialState);
  state.items = [calibrationSheet(state.paper, state.settings.margin)];
  state.items[0]!.fillSettings = {...defaultFillSettings, mode: 'hatch'};
  state.pens = {...defaultPens(), assignments: {'#000000': {color:'#FF0000',name:'Fine red'}}, order:['#FF0000'], mode:'source'};
  return state;
};
const file = () => JSON.parse(serializePlotIt(document()));
describe('.plit.json documents', () => {
  it('restores setup models without changing saved orientation or older documents', () => {
    const data = file(); data.document.settings.axidrawModel = 'v3-a3'; data.document.settings.machineRotation = 270;
    expect(parsePlotIt(JSON.stringify(data)).state.settings).toMatchObject({ axidrawModel: 'v3-a3', machineRotation: 270 });
    delete data.document.settings.axidrawModel;
    expect(parsePlotIt(JSON.stringify(data)).state.settings).toMatchObject({ axidrawModel: 'v3-a4', machineRotation: 270 });
  });
  it('persists plot names with legacy defaults and safe download filenames', () => {
    const state = document(); state.documentName = 'My <plot> / 2026';
    expect(parsePlotIt(serializePlotIt(state)).state.documentName).toBe(state.documentName);
    const data = file(); delete data.document.documentName;
    expect(parsePlotIt(JSON.stringify(data)).state.documentName).toBe('Untitled plot');
    data.document.documentName = 42;
    expect(() => parsePlotIt(JSON.stringify(data))).toThrow('document name');
    expect(documentFilename(state.documentName)).toBe('My -plot- - 2026');
    expect(documentFilename('   ')).toBe('Untitled plot');
  });
  it('accepts both document extensions, including uppercase, without matching other suffixes', () => {
    for (const name of ['drawing.plit', 'drawing.plit.json', 'DRAWING.PLIT', 'DRAWING.PLIT.JSON']) expect(isPlotItDocumentFile(name)).toBe(true);
    for (const name of ['drawing.json', 'drawing.svg', 'drawing.plit.json.bak', 'drawing.plitx']) expect(isPlotItDocumentFile(name)).toBe(false);
    expect(DOCUMENT_ACCEPT.split(',')).toContain('.plit');
    expect(DOCUMENT_ACCEPT.split(',')).toContain('.plit.json');
  });
  it('round-trips editable geometry, custom paper, fills, preferences and text settings', () => {
    const state = document(); state.paper = {name:'Custom',width:223,height:311}; state.paperColor = '#c0ffee';
    state.items[0]!.text = {content:'Full text\nwith "quotes"', format:'plotfont', options:{...defaultTextOptions, features:'liga=0',variations:'wght=700'}};
    const restored = parsePlotIt(serializePlotIt(state)).state;
    expect(restored.paper).toEqual(state.paper); expect(restored.paperColor).toBe(state.paperColor);
    expect(restored.items[0]!.text).toEqual(state.items[0]!.text); expect(restored.items[0]!.fillSettings).toEqual(state.items[0]!.fillSettings);
    expect(restored.pens).toEqual(state.pens); expect(restored.settings).toEqual(state.settings);
    expect(restored.items[0]!.viewBox).toEqual(state.items[0]!.viewBox);
    expect(restored.items[0]!.markup.match(/<path/g)).toHaveLength(state.items[0]!.markup.match(/<path/g)!.length);
  });
  it('saves empty documents without session state and does not mutate the source', () => {
    const state = structuredClone(initialState), before = structuredClone(state); state.selectedId = 'session-only'; state.zoom = 1.5;
    const saved = JSON.parse(serializePlotIt(state));
    expect(Object.keys(saved.document).sort()).toEqual(['documentName','items','paper','paperColor','pens','settings']);
    const restored = parsePlotIt(JSON.stringify(saved)).state;
    expect(restored.items).toEqual([]); expect(restored.selectedId).toBeNull(); expect(restored.zoom).toBe(1);
    expect({...state, selectedId:before.selectedId,zoom:before.zoom}).toEqual(before);
  });
  it('uses backward-compatible defaults for optional settings, pens and fonts', () => {
    const data = file(); delete data.document.settings; delete data.document.pens; delete data.fonts;
    const result = parsePlotIt(JSON.stringify(data));
    expect(result.state.settings).toEqual(initialState.settings); expect(result.state.pens).toEqual(defaultPens()); expect(result.fonts).toEqual([]);
  });
  it('upgrades old orientation and ignores disabled pen-change pauses', () => {
    const data = file(); data.document.settings.machineRotation=0; delete data.document.settings.machineOrientationVersion;
    data.document.settings.pauseOnToolChange=false;
    const {settings} = parsePlotIt(JSON.stringify(data)).state;
    expect(settings.machineRotation).toBe(90); expect(settings.pauseOnToolChange).toBe(true);
  });
  it('sanitizes executable geometry while preserving imported colors and protected ordering', () => {
    const data = file(); data.document.items[0].markup = '<g data-plotfont-order="true"><script>alert(1)</script><foreignObject/><path onload="bad()" stroke="red" data-plotfont-kind="stroke" d="M0 0L10 10"/><use href="https://example.com/remote.svg"/></g>';
    const markup = parsePlotIt(JSON.stringify(data)).state.items[0]!.markup;
    expect(markup).not.toMatch(/script|foreignObject|onload|https:/); expect(markup).toContain('stroke="red"'); expect(markup).toContain('data-plotfont-kind="stroke"');
  });
  it.each(['not json', '{', '[]', '{}'])('rejects invalid files without changing the existing state (%s)', source => {
    const state = document(), before = structuredClone(state);
    expect(() => parsePlotIt(source)).toThrow(); expect(state).toEqual(before);
  });
  it.each([
    (data: ReturnType<typeof file>) => { data.version=2; },
    (data: ReturnType<typeof file>) => { data.units='in'; },
    (data: ReturnType<typeof file>) => { data.document.paper.width=-5; },
    (data: ReturnType<typeof file>) => { data.document.paperColor='invalid'; },
    (data: ReturnType<typeof file>) => { data.document.settings.speed=0; },
    (data: ReturnType<typeof file>) => { data.document.items[0].viewBox=[0,0,0,10]; },
    (data: ReturnType<typeof file>) => { data.document.items.push(data.document.items[0]); },
    (data: ReturnType<typeof file>) => { data.document.items[0].id='bad" onload="bad'; },
    (data: ReturnType<typeof file>) => { data.document.items[0].markup='<broken'; },
    (data: ReturnType<typeof file>) => { data.document.items[0].fillSettings.overlap=1; }
  ])('rejects malformed dimensions, IDs, geometry and settings', change => {
    const data = file(); change(data); expect(() => parsePlotIt(JSON.stringify(data))).toThrow();
  });
  it('retains embedded custom fonts and rejects invalid or unrelated font records', () => {
    const state = document(), id = 'a'.repeat(64);
    state.items[0]!.text = {content:'A',options:{...defaultTextOptions,fontId:id}};
    const font = {id,name:'Custom.ttf',format:'opentype' as const,encoding:'base64' as const,data:'AAEC'};
    expect(parsePlotIt(serializePlotIt(state,[font])).fonts).toEqual([font]);
    expect(() => parsePlotIt(serializePlotIt(state,[{...font,data:'not base64!'}]))).toThrow('font');
    expect(() => parsePlotIt(serializePlotIt(state,[{...font,id:'b'.repeat(64)}]))).toThrow('font');
  });
});
