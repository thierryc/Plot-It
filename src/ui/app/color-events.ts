import { parseHexColor } from '../../colors';
export function bindColorControls(root: ParentNode, callbacks: { locked:()=>boolean; finishEdit:()=>void }): void {
  root.querySelectorAll<HTMLElement>('.color-field').forEach(field => {
    const picker = field.querySelector<HTMLInputElement>('input[type=color]')!;
    const hex = field.querySelector<HTMLInputElement>('[data-color-hex]')!;
    const error = field.querySelector<HTMLElement>('[data-color-error]')!;
    const clearError = () => { hex.removeAttribute('aria-invalid'); hex.setCustomValidity(''); error.hidden = true; };
    const apply = () => {
      if (callbacks.locked()) return;
      try {
        const value = parseHexColor(hex.value); clearError(); hex.value = value;
        if (picker.value.toUpperCase() === value) return;
        picker.value = value;
        picker.dispatchEvent(new Event('change', {bubbles:true}));
      } catch (cause) {
        hex.setAttribute('aria-invalid', 'true');
        error.textContent = (cause as Error).message; error.hidden = false;
      }
    };
    picker.addEventListener('input', () => { clearError(); hex.value = picker.value.toUpperCase(); });
    picker.addEventListener('change', () => { clearError(); hex.value = picker.value.toUpperCase(); });
    hex.addEventListener('change', apply);
    hex.addEventListener('blur', () => { apply(); callbacks.finishEdit(); });
    hex.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); apply(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hex.value = picker.value.toUpperCase(); clearError(); }
    });
  });
}
