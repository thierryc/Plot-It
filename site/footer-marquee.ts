import { mountMarquee, type MarqueeController } from '@ap.cx/gl-marquee';
import styles from './footer-marquee.module.css';

/** Keep the decorative renderer local to the public site, near the viewport. */
export function initializeFooterMarquee() {
  const host = document.querySelector<HTMLElement>('[data-apcx-marquee]');
  const button = document.querySelector<HTMLButtonElement>('[data-marquee-motion]');
  if (!host || !button) return () => {};

  host.classList.add(styles.banner!);
  host.querySelector('[data-marquee-fallback]')?.classList.add(styles.fallback!);
  button.classList.add(styles.motion!);
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = motion.matches;
  let visible = false;
  let active = true;
  let controller: MarqueeController | undefined;

  function unmount() {
    controller?.destroy();
    controller = undefined;
    delete host!.dataset.ready;
  }

  function mount() {
    unmount();
    if (!visible || !active) return;
    try {
      const current = mountMarquee(host!, {
        message: 'Another Planet . Creative eXperience',
        fontFamily: '"Square Bot Sans Footer", sans-serif',
        fontWeight: 400,
        mode: 'footer-banner',
        reducedMotion: paused,
      });
      controller = current;
      void current.ready.then(() => {
        if (controller !== current) return;
        host!.dataset.ready = 'true';
        button!.hidden = false;
        button!.textContent = paused ? 'Play animation' : 'Pause animation';
      }).catch(() => {
        if (controller !== current) return;
        unmount();
        button!.hidden = true;
      });
    } catch {
      // The regular HTML text remains visible if neither canvas backend works.
      button!.hidden = true;
    }
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false;
    mount();
  }, { rootMargin: '300px' });
  observer.observe(host);

  function toggleMotion() { paused = !paused; mount(); }
  function systemMotion() { paused = motion.matches; mount(); }
  function hidePage() { active = false; unmount(); }
  function showPage() { active = true; if (!controller) mount(); }
  button.addEventListener('click', toggleMotion);
  motion.addEventListener('change', systemMotion);
  window.addEventListener('pagehide', hidePage);
  window.addEventListener('pageshow', showPage);

  return () => {
    observer.disconnect();
    unmount();
    button.removeEventListener('click', toggleMotion);
    motion.removeEventListener('change', systemMotion);
    window.removeEventListener('pagehide', hidePage);
    window.removeEventListener('pageshow', showPage);
  };
}
