import styles from './footer.module.css';
import { initializeFooterMarquee } from './footer-marquee';

/** Static, accessible footer content shares the PlotFont/AP.CX layout. */
export function initializeFooter() {
  const footer = document.querySelector<HTMLElement>('[data-site-footer]');
  if (!footer) return () => {};
  footer.classList.add(styles.footer!);
  const parts = ['links', 'bottom', 'brand', 'copyright', 'license', 'privacy'] as const;
  for (const part of parts) footer.querySelector(`[data-footer-${part}]`)?.classList.add(styles[part]!);
  return initializeFooterMarquee();
}
