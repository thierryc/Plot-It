import { attributes, classes, escapeUI, type Attributes } from './html';
import buttons from './button.module.css';
import checks from './checkbox.module.css';
import fields from './field.module.css';
import inputs from './input.module.css';
import selects from './select.module.css';
import textareas from './textarea.module.css';
import colors from './color.module.css';
import surfaces from './surface.module.css';
import disclosures from './disclosure.module.css';
import overlays from './overlay.module.css';
export type ButtonOptions = { label: string; icon?: string; variant?: 'primary' | 'ghost' | 'danger'; iconOnly?: boolean; className?: string; disabled?: boolean; type?: 'button' | 'submit'; attributes?: Attributes };
/** Content slots accept trusted component markup; labels/values/attributes are escaped. */
export function button(o: ButtonOptions): string {
  return `<button type="${o.type ?? 'button'}" class="${classes('button', buttons.button, o.variant, o.variant && buttons[o.variant], o.iconOnly && 'icon-button', o.iconOnly && buttons['icon-button'], o.className)}" ${attributes({ 'aria-label': o.label, title: o.label, ...o.attributes, disabled: o.disabled ?? o.attributes?.disabled })}>${o.icon ?? ''}${o.iconOnly ? '' : `<span>${escapeUI(o.label)}</span>`}</button>`;
}
export function checkboxInput(label: string, checked: boolean, attrs: Attributes = {}): string {
  return `<input type="checkbox" class="${checks.checkbox}" ${attributes({ ...attrs, 'aria-label': label, checked })}>`;
}
export function checkbox(label: string, checked: boolean, attrs: Attributes = {}): string {
  return `<label class="check ${checks.check}">${checkboxInput(label, checked, attrs)}<span>${escapeUI(label)}</span></label>`;
}
export function field(label: string, control: string, attrs: Attributes = {}): string {
  return `<label class="field ${fields.field}" ${attributes(attrs)}><span>${escapeUI(label)}</span>${control}</label>`;
}
export function input(value: string | number, attrs: Attributes = {}, type: 'text' | 'number' | 'search' | 'file' | 'hidden' = 'text'): string {
  return `<input type="${type}" class="${inputs.input}" ${attributes({ ...attrs, value })}>`;
}
export function numberField(label: string, value: number, unit: string, attrs: Attributes = {}): string {
  return field(label, `<div class="unit-input ${inputs['unit-input']}">${input(value, { ...attrs, 'aria-label': attrs['aria-label'] ?? `${label}${unit ? ` ${unit}` : ''}` }, 'number')}<span>${escapeUI(unit)}</span></div>`);
}
export function select(options: { value: string; label: string; disabled?: boolean }[], value: string, attrs: Attributes = {}): string {
  return `<select class="${selects.select}" ${attributes(attrs)}>${options.map(option => `<option ${attributes({ value: option.value, disabled: option.disabled })} ${option.value === value ? 'selected' : ''}>${escapeUI(option.label)}</option>`).join('')}</select>`;
}
export function textarea(value: string, attrs: Attributes = {}): string { return `<textarea class="${textareas.textarea}" ${attributes(attrs)}>${escapeUI(value)}</textarea>`; }
export function colorField(label: string, value: string, attrs: Attributes = {}): string {
  return `<div class="field ${fields.field} color-field ${colors['color-field']}"><span class="${fields['field-label']}">${escapeUI(label)}</span><div class="color-inputs ${colors['color-inputs']}"><input type="color" class="${colors.color}" ${attributes({ ...attrs, value, 'aria-label': `${label} picker` })}>${input(value, { 'data-color-hex': '', 'aria-label': `${label} hex`, autocomplete: 'off', spellcheck: false, placeholder: '#RRGGBB' })}</div><p class="field-error ${fields['field-error']}" data-color-error role="alert" hidden></p></div>`;
}
export function surface(content: string, className = '', attrs: Attributes = {}): string { return `<div class="surface ${surfaces.surface} ${className}" ${attributes(attrs)}>${content}</div>`; }
export function disclosure(content: string, open: boolean, className = '', attrs: Attributes = {}): string { return `<details class="${disclosures.disclosure} ${className}" ${attributes(attrs)} ${open ? 'open' : ''}>${content}</details>`; }
export function popover(id: string, titleId: string, content: string, className = ''): string { return `<section class="popover ${overlays.popover} ${className}" ${attributes({ id, popover:'auto', role:'dialog', 'aria-labelledby':titleId })}>${content}</section>`; }

export function dialog(id: string, titleId: string, content: string, className = ''): string {
  return `<dialog class="${overlays.dialog} ${className}" ${attributes({ id, 'aria-labelledby': titleId })}>${content}</dialog>`;
}
