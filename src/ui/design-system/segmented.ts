import { attributes, classes, escapeUI, type Attributes } from './html';
import styles from './segmented.module.css';

export interface SegmentOption { label: string; selected: boolean; attributes: Attributes; }

/** Single-choice button group; mount its keyboard behavior with mountSegmentedControls. */
export function segmentedControl(label: string, options: SegmentOption[]): string {
  const selected = options.findIndex(option => option.selected && !option.attributes.disabled);
  const entry = selected >= 0 ? selected : options.findIndex(option => !option.attributes.disabled);
  return `<div class="${classes('mode-switch', styles['mode-switch'])}" ${attributes({role:'radiogroup', 'aria-label':label, 'data-segmented':''})}>${options.map((option, index) => `<button type="button" class="${classes(styles.segment)}" ${attributes({...option.attributes, role:'radio', 'aria-checked':index===entry, tabindex:index===entry ? 0 : -1})}><span>${escapeUI(option.label)}</span></button>`).join('')}</div>`;
}

/** Native click/Space/Enter activation plus one Tab stop and arrow/Home/End selection. */
export class SegmentedControl {
  private controller = new AbortController();
  private observer: MutationObserver;
  constructor(private group: HTMLElement) {
    this.sync();
    this.observer = new MutationObserver(() => this.sync());
    this.observer.observe(group, {subtree:true, attributes:true, attributeFilter:['disabled','hidden','inert','aria-checked']});
    const signal = this.controller.signal;
    group.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[role=radio]') : null;
      if (target && this.enabled.includes(target)) this.select(target);
    }, {signal});
    group.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const controls = this.enabled;
      const current = controls.indexOf(document.activeElement as HTMLButtonElement);
      if (current < 0 || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const rtl = getComputedStyle(group).direction === 'rtl';
      const backward = event.key === 'ArrowUp' || event.key === (rtl ? 'ArrowRight' : 'ArrowLeft');
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (current + (backward ? -1 : 1) + controls.length) % controls.length;
      const target = controls[index]!;
      if (target.getAttribute('aria-checked') !== 'true') target.click();
      // Application activation may replace this view; its new view owns focus then.
      if (target.isConnected) target.focus({preventScroll:true});
    }, {signal});
  }
  private get controls(): HTMLButtonElement[] {
    return [...this.group.querySelectorAll<HTMLButtonElement>('[role=radio]')].filter(node => node.closest('[data-segmented]') === this.group);
  }
  private get enabled(): HTMLButtonElement[] {
    return this.controls.filter(node => !node.disabled && !node.hidden && !node.closest('[hidden],[inert]'));
  }
  private select(target: HTMLButtonElement): void {
    for (const control of this.controls) {
      const checked = String(control === target);
      if (control.getAttribute('aria-checked') !== checked) control.setAttribute('aria-checked', checked);
      const tabIndex = control === target ? 0 : -1;
      if (control.tabIndex !== tabIndex) control.tabIndex = tabIndex;
    }
  }
  /** Resynchronize after application-driven selection or disabled-state changes. */
  sync(): void {
    const controls = this.enabled;
    const selected = controls.find(node => node.getAttribute('aria-checked') === 'true') ?? controls[0];
    if (selected) this.select(selected);
    else for (const control of this.controls) control.tabIndex = -1;
  }
  destroy(): void { this.controller.abort(); this.observer.disconnect(); }
}

export function mountSegmentedControls(root: ParentNode): () => void {
  const controls = [...root.querySelectorAll<HTMLElement>('[data-segmented]')].map(group => new SegmentedControl(group));
  return () => controls.forEach(control => control.destroy());
}
