import { attributes, classes, escapeUI, type Attributes } from './html';
import styles from './feedback.module.css';

export function feedback(text: string, tone: 'warning' | 'error', attrs: Attributes = {}, className = ''): string {
  return `<p class="${classes(styles.feedback,className)}" ${attributes({'data-feedback':tone,role:tone==='error'?'alert':'status',...attrs})}>${escapeUI(text)}</p>`;
}
/** Uses a CSS icon so existing textContent updates never remove the status symbol. */
export function decorateFeedback(node: HTMLElement, tone: 'warning' | 'error'): void {
  node.classList.add(styles.feedback!); node.dataset.feedback = tone;
  node.setAttribute('role', tone === 'error' ? 'alert' : 'status');
}
