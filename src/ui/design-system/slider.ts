import { attributes, escapeUI, type Attributes } from './html';
import styles from './slider.module.css';
import inputs from './input.module.css';

export interface SliderRowOptions {
  label: string; value: number | undefined; fallback: number; min: number; max: number; step: number;
  rangeAttributes?: Attributes; valueAttributes?: Attributes; mixedAttributes?: Attributes;
}
/** Native controls retain their owning surface's value, focus and debounce contracts. */
export function sliderRow(o: SliderRowOptions): string {
  const mixed = o.value === undefined;
  return `<div class="${styles.row}"><input class="${styles.slider}" type="range" ${attributes({min:o.min,max:o.max,step:o.step,'data-base-step':o.step,value:o.value??o.fallback,'aria-label':o.label,...(mixed?{'aria-valuetext':'Mixed'}:{}),...o.rangeAttributes})}><div class="${styles.caption}"><span>${escapeUI(o.label)}${mixed?` <small ${attributes(o.mixedAttributes??{})}>Mixed</small>`:''}</span><input class="${inputs.input} ${styles.value}" type="number" ${attributes({min:o.min,max:o.max,step:o.step,'data-base-step':o.step,value:mixed?'':o.value,'aria-label':`${o.label} value`,...(mixed?{placeholder:'Mixed','data-mixed-base':o.fallback}:{}),...o.valueAttributes})}></div></div>`;
}

export const sliderClass = styles.slider;
export function axisLabel(tag: string): string {
  return ({wght:'Weight',wdth:'Width',ital:'Italic',slnt:'Slant',opsz:'Optical size',GRAD:'Grade'} as Record<string,string>)[tag] ?? tag;
}
