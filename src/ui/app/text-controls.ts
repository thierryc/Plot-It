import { icon } from '../../icons';
import { attributes, escapeUI, type Attributes } from '../design-system';
import styles from './field.module.css';

/** Shared presentation; each surface retains its own draft/change contract. */
export function featureToggleMarkup(label: string, value: number | undefined, off: Attributes, on: Attributes, row: Attributes = {}, source = ''): string {
  return `<div class="${styles['type-toggle']}" ${attributes(row)}><span>${escapeUI(label)}</span>${source}<div role="group" aria-label="${escapeUI(label)}">${[0, 1].map(choice => `<button type="button" ${attributes({...(choice ? on : off), 'aria-label':`${choice ? 'Enable' : 'Disable'} ${label}`, 'aria-pressed':value === undefined ? false : choice ? value > 0 : value === 0})}>${icon(choice ? 'check' : 'minus')}</button>`).join('')}</div>${value === undefined ? '<small>Mixed</small>' : ''}</div>`;
}
