export function escapeUI(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
export type Attributes = Partial<Record<`data-${string}` | `aria-${string}` | 'id' | 'title' | 'role' | 'name' | 'value' | 'min' | 'max' | 'step' | 'required' | 'disabled' | 'checked' | 'hidden' | 'placeholder' | 'autocomplete' | 'spellcheck' | 'maxlength' | 'accept' | 'rows' | 'multiple' | 'popovertarget' | 'popovertargetaction' | 'popover' | 'tabindex' | 'formnovalidate', string | number | boolean>>;
const booleanAttributes = new Set(['required', 'disabled', 'checked', 'hidden', 'multiple', 'formnovalidate']);
export function attributes(values: Attributes = {}): string {
  return Object.entries(values).map(([key, value]) => {
    if (value === undefined || !/^(data-[\w-]+|aria-[\w-]+|[a-z]+)$/.test(key) || /^on/i.test(key) || key === 'style') return '';
    if (booleanAttributes.has(key)) return value ? key : '';
    return `${key}="${escapeUI(String(value))}"`;
  }).filter(Boolean).join(' ');
}
/** Keep semantic hooks separate from explicit CSS Module ownership. */
export function classes(...values: (string | false | undefined)[]): string { return values.filter(Boolean).join(' '); }
