import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {readDesignSystem} from './read-design-system.mjs';
import {dimensions,motion} from '../src/ui/design-system/foundations';

describe('project design-system handoff',()=>{
  it('keeps JavaScript measurements aligned with authoritative CSS and touch modes',()=>{
    const {metrics}=readDesignSystem(),byName=Object.fromEntries(metrics.map(m=>[m.css,m]));
    for(const [property,token] of Object.entries({sidebarDefault:'--sidebar-default',sidebarTablet:'--sidebar-tablet',field:'--field-height',button:'--action-height',touch:'--touch-target',checkbox:'--checkbox-size',panelPadding:'--panel-padding',fieldGap:'--field-gap',controlGap:'--control-gap',groupGap:'--group-gap',sliderTrack:'--slider-track-size',sliderThumb:'--slider-thumb-size',icon:'--icon-size',iconStroke:'--icon-stroke',textArea:'--text-input-height',editorWidth:'--text-editor-width',editorHeight:'--text-editor-height-default'}))expect(byName[token].desktop).toBe(dimensions[property]);
    for(const name of ['--control-height','--button-height','--slider-hit-size','--toolbar-size'])expect(byName[name].touch).toBe(44);
    const css=readFileSync(new URL('../src/ui/design-system/tokens.css',import.meta.url),'utf8');
    expect(css).toContain(`max-width:${dimensions.mobileMax}px`);
    const workspace=readFileSync(new URL('../src/ui/app/workspace.module.css',import.meta.url),'utf8');
    expect(workspace).toContain(`max-width:${dimensions.tabletMax}px`);
    expect(new Set(metrics.map(m=>m.css)).size).toBe(metrics.length);
  });
  it('exports matching fluorescent semantics while preserving paper UI and theme-specific workspace contrast',()=>{
    const {colors,font}=readDesignSystem(),values=Object.fromEntries(colors.map(c=>[c.css,c]));
    for(const [name,value] of Object.entries({'--accent':'#00E5FF','--warning':'#FF9A00','--error':'#FF3B8D'}))expect([values[name].light,values[name].dark]).toEqual([value,value]);
    for(const name of ['--canvas-ui-ink','--canvas-ui-fill','--canvas-ui-active-fill','--canvas-selection'])expect(values[name].light).toBe(values[name].dark);
    expect(values['--stage']).toMatchObject({light:'#f3f3f3',dark:'#444444'});
    expect(font).toMatchObject({family:'SF Pro',css:'var(--font-ui)'});
  });
  it('keeps semantic motion timing in sync with the progress and surface controllers',()=>{
    const tokens=Object.fromEntries(readDesignSystem().motion.map(t=>[t.css,t.value]));
    for(const[key,css]of Object.entries({panelDuration:'--motion-panel-duration',dialogDuration:'--motion-dialog-duration',exitDuration:'--motion-exit-duration',renderDuration:'--motion-render-duration',progressShowDelay:'--motion-progress-show-delay',progressHideDelay:'--motion-progress-hide-delay',progressMinimum:'--motion-progress-min-visible'}))expect(tokens[css]).toBe(`${motion[key]}ms`);
  });
});
