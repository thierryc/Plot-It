// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { initialState } from '../../model';
import { editorViews } from './editor-views';
import { inspectorSectionMarkup } from './components';

describe('editor section refreshes', () => {
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
        expect(panel.querySelector('summary [data-context-help]')).toBeNull();
        panel.innerHTML=render();
      }
    }
  });
});
