import type { ArtworkItem, FillSettings } from '../../model';
import type { LoadedFont } from '../../typography';
import { checkbox, propertyField } from '../design-system';
import styles from './field.module.css';

const fillCapabilities = new WeakMap<object, boolean>();
/** Closed stroke contours remain strokes; only explicit filled regions qualify. */
export function textFontSupportsFill(font: LoadedFont | undefined, item?: ArtworkItem): boolean {
  if (font?.openplotfont) {
    let supported = fillCapabilities.get(font.openplotfont);
    if (supported === undefined) {
      supported = font.openplotfont.glyphs.some(glyph => glyph.strokes.some(operation => operation.kind === 'fill'));
      fillCapabilities.set(font.openplotfont, supported);
    }
    return supported;
  }
  if (font) return font.kind === 'outline' || !!font.face;
  return !!item && /data-opentype-outline="1"|data-openplotfont-kind="fill"/.test(item.markup);
}

/** Shared plot-fill controls; each surface owns its change/commit transaction. */
export function fillSettingsMarkup(settings: FillSettings, attribute: 'data-fill-setting' | 'data-text-fill-setting', options: {disabled?: boolean; modeDisabled?: boolean; mixed?: boolean} = {}): string {
  const numeric = (key: keyof FillSettings, label: string, prefix: string, unit: string, min: number, max: number, step: number, value: number) => propertyField({label,prefix,unit,value,attributes:{[attribute]:key,min,max,step,...(attribute==='data-text-fill-setting'?{'data-base-step':step}:{}),disabled:options.disabled}});
  return `<div class="${styles['fill-settings']}">${propertyField({label:'Fill mode',prefix:'Fill',type:'select',value:options.mixed?'elements':settings.mode,attributes:{[attribute]:'mode',disabled:options.modeDisabled},options:[...(options.mixed?[{value:'elements',label:'Element fills',disabled:true}]:[]),...(['none','solid','hatch','crosshatch'] as const).map(value=>({value,label:{none:'None',solid:'Solid',hatch:'Hatch',crosshatch:'Crosshatch'}[value]}))]})}
    <div class="${styles['two-col']}">${numeric('width','Drawn line width','W','mm',.05,20,.05,settings.width)}${numeric('angle','Angle','Deg','°',-360,360,1,settings.angle)}</div>
    ${settings.mode==='solid'||settings.mode==='none'?numeric('overlap','Overlap','Overlap','%',0,80,1,Number((settings.overlap*100).toPrecision(12))):numeric('gap','Clear gap','Gap','mm',0,100,.1,settings.gap)}
    <div class="${styles['two-col']}">${checkbox('Boundary',settings.outline,{[attribute]:'outline','aria-label':'Draw boundary',disabled:options.disabled})}${checkbox('Connect',settings.connect,{[attribute]:'connect','aria-label':'Connect strokes',disabled:options.disabled})}</div></div>`;
}
