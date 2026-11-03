// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '../../model';
import { editorViews } from './editor-views';
import * as typography from '../../typography';
import { inspectorSectionMarkup } from './components';

afterEach(()=>vi.restoreAllMocks());
describe('editor section refreshes', () => {
  it('shows only supported stylistic sets with author labels and saved values',()=>{
    vi.spyOn(typography,'findFont').mockReturnValue({id:'test',name:'Test font',features:['kern','ss02','ss04'],axes:{},openplotfont:{version:'0.3',layout:{features:[{tag:'ss02',label:'Alternate hand',recommendedValue:1},{tag:'ss04'}]}}} as typography.LoadedFont);
    const views=editorViews({state:initialState,inspectorSections:new Map(),selectedElement:null,editNodes:false,selectedNode:null,fillStatus:'',fillStats:'',currentFill:()=>{throw new Error('No selection');},liveElement:()=>undefined,elementBounds:()=>null,elementMatrix:()=>{throw new Error('No element');}});
    const host=document.createElement('div');host.innerHTML=views.typographyControls({...typography.defaultTextOptions,fontId:'test',features:'ss02=0, ss04=1'},12);
    expect([...host.querySelectorAll<HTMLElement>('[data-typography-feature]')].map(input=>input.dataset.typographyFeature)).toEqual(['ss02','ss04']);
    expect(host.textContent).toContain('Alternate hand');expect(host.textContent).toContain('Stylistic set 4');
    expect(host.querySelector<HTMLInputElement>('[data-typography-feature=ss02]')!.checked).toBe(false);expect(host.querySelector<HTMLInputElement>('[data-typography-feature=ss04]')!.checked).toBe(true);
    expect(host.querySelector('[data-typography=ligatures]')).toBeNull();expect(host.querySelector('[data-typography=contextual]')).toBeNull();expect(host.querySelector('[data-typography=kerning]')).not.toBeNull();
    vi.spyOn(typography,'findFont').mockReturnValue({id:'other',name:'No features',features:[],axes:{}} as typography.LoadedFont);
    host.innerHTML=views.typographyControls({...typography.defaultTextOptions,fontId:'other'},12);expect(host.querySelector('[data-stylistic-sets]')).toBeNull();expect(host.querySelector('[data-typography-choice]')).toBeNull();
  });
  it('keeps one independently focusable help trigger on initial render and content refresh', () => {
    const views = editorViews({
      state:{...initialState,items:[],selectedId:null}, selectedElement:null,editNodes:false,selectedNode:null,
      inspectorSections:new Map(),fillStatus:'',fillStats:'',
      currentFill:()=>{throw new Error('No selection');},liveElement:()=>undefined,
      elementBounds:()=>null,elementMatrix:()=>{throw new Error('No element');}
    });
    for (const [key,render] of [['objects',views.objectsMarkup],['selection',views.selectionPanelMarkup]] as const) {
      const host=document.createElement('div');
      host.innerHTML=inspectorSectionMarkup(key,render(),true);
      const panel=host.querySelector('details')!;
      for (let refresh=0;refresh<2;refresh++) {
        expect(panel.querySelectorAll('[data-context-help]')).toHaveLength(1);
        expect(panel.querySelector('summary[data-disclosure-heading] > [data-context-help]')?.getAttribute('type')).toBe('button');
        expect(panel.querySelector('summary [data-heading-title]')).not.toBeNull();
        panel.innerHTML=render();
      }
    }
  });
});
