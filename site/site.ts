import './styles.css';
import { initializeTheme } from '../src/theme';
const theme = initializeTheme(window, document);
const selector = document.querySelector<HTMLSelectElement>('#theme-selector');
if (selector) {
  selector.value = theme.preference;
  selector.addEventListener('change', () => theme.setPreference(selector.value));
}
const hint = document.querySelector<HTMLElement>('[data-browser-hint]');
if (hint && !('serial' in navigator)) hint.textContent = 'Editing and simulation need no installation. Web Serial is unavailable in this browser; use desktop Chrome or Edge for Direct USB plotting.';
