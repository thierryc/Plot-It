import { attributes, escapeUI, type Attributes } from './html';
import styles from './property-field.module.css';

type Common = { label:string; prefix:string; value:string|number; unit?:string; align?:'left'|'right'; attributes?:Attributes };
export type PropertyFieldOptions = Common & (
  { type?:'number'|'text'; options?:never } |
  { type:'select'; options:ReadonlyArray<{value:string;label:string;disabled?:boolean}> }
);

/** One native control: quiet prefix, aligned value and a fixed trailing unit slot. */
export function propertyField(o:PropertyFieldOptions):string {
  const name = `${o.label}${o.unit ? ` ${o.unit}` : ''}`;
  const attrs = { ...o.attributes, 'aria-label':o.attributes?.['aria-label'] ?? name, title:o.attributes?.title ?? name };
  const control = o.type === 'select'
    ? `<select class="${styles.value} ${styles.select}" ${attributes(attrs)}>${o.options.map(option=>`<option ${attributes({value:option.value,disabled:option.disabled})} ${String(o.value)===option.value?'selected':''}>${escapeUI(option.label)}</option>`).join('')}</select>`
    : `<input class="${styles.value}" type="${o.type??'number'}" ${attributes({...attrs,value:o.value})}>`;
  return `<label class="${styles.property}${o.align==='left' ? ` ${styles['left-aligned']}` : ''}" data-property-field><span class="${styles.prefix}" aria-hidden="true">${escapeUI(o.prefix)}</span>${control}${o.unit ? `<span class="${styles.unit}" aria-hidden="true">${escapeUI(o.unit)}</span>` : ''}</label>`;
}
