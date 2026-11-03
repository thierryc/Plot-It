/** Display precision removes binary arithmetic noise without changing saved geometry. */
export function displayTextNumber(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toPrecision(12))) : '';
}
export function textNumericStep(key: string, min = 0, max = 1): number {
  if (key === 'capHeight' || key === 'opsz' || key === 'slnt') return .1;
  if (['letterSpacing', 'wordSpacing', 'lineHeight'].includes(key)) return .01;
  if (key === 'feature' || key === 'ital') return 1;
  const span = Math.abs(max - min);
  return span > 0 ? Math.min(1, 10 ** Math.floor(Math.log10(span / 100))) : .01;
}
/** Custom arrow handling preserves off-grid values and avoids floating point drift. */
export function stepTextNumber(input: HTMLInputElement, direction: number, shift: boolean): void {
  const step = Number(input.dataset.baseStep ?? input.step);
  if (!Number.isFinite(step) || step <= 0) return;
  const value = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : Number(input.dataset.mixedBase??0);
  const min = input.min === '' ? -Infinity : Number(input.min);
  const max = input.max === '' ? Infinity : Number(input.max);
  input.value = displayTextNumber(Math.max(min, Math.min(max, value + direction * step * (shift ? 10 : 1))));
  input.dispatchEvent(new Event('input', {bubbles:true}));
  input.dispatchEvent(new Event('change', {bubbles:true}));
}


export function textNumericAttributes(key: string): Record<string, string | number> {
  const step = textNumericStep(key);
  return {step, 'data-base-step':step, ...(key === 'capHeight' ? {min:.1} : key === 'lineHeight' ? {min:.01} : {})};
}
const boundNumbers = new WeakSet<HTMLInputElement>();
export function bindTextNumericInputs(root: ParentNode): void {
  root.querySelectorAll<HTMLInputElement>('input[type="number"][data-base-step]').forEach(input => {
    if(boundNumbers.has(input))return;boundNumbers.add(input);
    input.addEventListener('keydown',event=>{
      if(event.isComposing||event.ctrlKey||event.metaKey||event.altKey||!['ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();stepTextNumber(input,event.key==='ArrowUp'?1:-1,event.shiftKey);
    });
    input.addEventListener('pointerdown',event=>{input.step=displayTextNumber(Number(input.dataset.baseStep)*(event.shiftKey?10:1));});
    const reset=()=>{input.step=input.dataset.baseStep!;};input.addEventListener('pointerup',reset);input.addEventListener('blur',reset);
  });
}
