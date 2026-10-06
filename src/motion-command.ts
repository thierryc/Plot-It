export const EBB_MAX_STEP_RATE = 25000;
// Leave the same small margin below the hardware ceiling as the Python driver.
export const COMPILED_MAX_STEP_RATE = 24995;
export const COMPILED_MIN_STEP_RATE = 2;

/** EBB v2 integer command limits; see evil-mad.github.io/EggBot/ebb2.html. */
export function validateMotionCommand(command: string): void {
  const [kind, ...parts] = command.split(','), values = parts.map(Number);
  const validIntegers = command.length < 64 && parts.every(p => /^-?\d+$/.test(p)) && values.every(v => Number.isSafeInteger(v) && v >= -2147483648 && v <= 2147483647);
  if (!validIntegers) throw new Error('Motion command exceeds firmware limits.');
  if (kind === 'XM' && values.length === 3) {
    const [ms, a, b] = values as [number, number, number];
    const rates = [Math.abs(a + b), Math.abs(a - b)].map(steps => steps * 1000 / ms);
    if (ms >= 1 && ms <= 16777215 && [a, b, a + b, a - b].every(steps => Math.abs(steps) <= 16777215) && rates.every(rate => rate === 0 || rate >= 1.31 && rate <= EBB_MAX_STEP_RATE)) return;
  }
  throw new Error('Motion command exceeds firmware limits.');
}
