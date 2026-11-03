// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { textFontSupportsFill, fillSettingsMarkup } from './fill-controls';
import type { LoadedFont } from '../../typography';
import { defaultFillSettings } from '../../model';
import mixed from '../../test-fonts/openplotfont/mixed.opf.json';

describe('text fill capability and shared controls',()=>{
  it('exposes outlines and explicit OpenPlotFont filled regions, but never closed centerline strokes',()=>{
    const font={id:'mixed',name:'Mixed',features:[],axes:{},openplotfont:structuredClone(mixed)} as LoadedFont;
    expect(textFontSupportsFill(font)).toBe(true);
    const strokeFont={...font,openplotfont:{...font.openplotfont!,glyphs:font.openplotfont!.glyphs.map(glyph=>({...glyph,strokes:glyph.strokes.filter(operation=>operation.kind!=='fill')}))}};
    expect(textFontSupportsFill(strokeFont)).toBe(false);
    expect(textFontSupportsFill({id:'outline',name:'Outline',features:[],axes:{},kind:'outline'})).toBe(true);
    expect(textFontSupportsFill(undefined)).toBe(false);
  });
  it('uses the same settings and units while preserving inspector mode restrictions',()=>{
    const host=document.createElement('div');host.innerHTML=fillSettingsMarkup({...defaultFillSettings,mode:'hatch'},'data-fill-setting',{disabled:true,mixed:true});
    expect(host.querySelector<HTMLSelectElement>('[data-fill-setting="mode"]')!.value).toBe('elements');
    expect(host.querySelector<HTMLInputElement>('[data-fill-setting="gap"]')!.disabled).toBe(true);
    expect(host.querySelector('[data-fill-setting="overlap"]')).toBeNull();
    host.innerHTML=fillSettingsMarkup({...defaultFillSettings,mode:'solid'},'data-text-fill-setting');
    expect(host.querySelector<HTMLInputElement>('[data-text-fill-setting="overlap"]')!.value).toBe('15');
    expect(host.querySelector<HTMLInputElement>('[data-text-fill-setting="width"]')!.step).toBe('0.05');
  });
});
