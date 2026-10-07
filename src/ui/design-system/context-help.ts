import { button } from './components';
import { attributes, escapeUI } from './html';
import { popoverPosition } from './overlays';
import styles from './context-help.module.css';

const info = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/></svg>';
const close = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
/** Content is trusted component markup; identity and accessible labels are escaped. */
export function contextualHelp(id: string, label: string, content: string): string {
  const name = `${label} information`;
  return button({label:name,icon:info,iconOnly:true,variant:'ghost',className:styles.trigger,attributes:{'data-context-help':id,popovertarget:id,'aria-controls':id,'aria-haspopup':'dialog','aria-expanded':false}}) +
    `<div class="${styles.popover}" ${attributes({id,popover:'auto',role:'dialog','aria-label':name,'aria-describedby':`${id}-body`,'data-context-help-popover':true})}><div class="${styles.heading}"><h3>${escapeUI(label)}</h3>${button({label:`Close ${name}`,icon:close,iconOnly:true,variant:'ghost',className:styles.trigger,attributes:{popovertarget:id,popovertargetaction:'hide'}})}</div><div class="${styles.body}" ${attributes({id:`${id}-body`})}>${content}</div></div>`;
}

/** Delegation also handles contextual help added by later view refreshes. */
export function mountContextualHelp(root: HTMLElement): () => void {
  const controller = new AbortController();
  const triggerFor = (overlay: HTMLElement) => root.querySelector<HTMLElement>(`[data-context-help="${CSS.escape(overlay.id)}"]`);
  const position = (overlay: HTMLElement) => {
    const trigger = triggerFor(overlay); if (!trigger) return;
    const point = popoverPosition(trigger.getBoundingClientRect(),{width:overlay.offsetWidth || Math.min(320,innerWidth-24),height:overlay.offsetHeight},{width:innerWidth,height:innerHeight});
    overlay.style.left = `${point.left}px`; overlay.style.top = `${point.top}px`;
  };
  const onToggle = (event: Event) => {
    const overlay = event.target;
    if (!(overlay instanceof HTMLElement) || !overlay.hasAttribute('data-context-help-popover')) return;
    const open = (event as ToggleEvent).newState === 'open';
    const trigger = triggerFor(overlay);
    trigger?.setAttribute('aria-expanded',String(open));
    if (open) {
      position(overlay);
      if (event.type === 'toggle') overlay.querySelector<HTMLElement>('button')?.focus({preventScroll:true});
    } else if (event.type === 'toggle' && (overlay.contains(document.activeElement) || document.activeElement === document.body)) {
      const closed = trigger?.closest<HTMLDetailsElement>('details:not([open])');
      (closed?.querySelector<HTMLElement>('summary') ?? trigger)?.focus({preventScroll:true});
    }
  };
  root.addEventListener('beforetoggle',onToggle,{capture:true,signal:controller.signal});
  root.addEventListener('toggle',onToggle,{capture:true,signal:controller.signal});
  window.addEventListener('resize',()=>root.querySelectorAll<HTMLElement>('[data-context-help-popover]:popover-open').forEach(position),{signal:controller.signal});
  return () => controller.abort();
}
