/** EBB v2 integer command limits; see evil-mad.github.io/EggBot/ebb2.html. */
export function validateMotionCommand(command: string): void {
  const [kind, ...parts] = command.split(','), values = parts.map(Number);
  const validIntegers = command.length <= 256 && parts.every(p => /^-?\d+$/.test(p)) && values.every(v => Number.isSafeInteger(v) && v >= -2147483648 && v <= 2147483647);
  if (!validIntegers) throw new Error('Motion command exceeds firmware limits.');
  if (kind === 'LM' && values.length === 6 && values[0]! >= 0 && values[3]! >= 0) return;
  if (kind === 'XM' && values.length === 3) {
    const [ms, a, b] = values as [number, number, number];
    const speed = Math.max(Math.abs(a + b), Math.abs(a - b)) * 1000 / ms;
    if (ms >= 1 && ms <= 16777215 && Math.abs(a) <= 16777215 && Math.abs(b) <= 16777215 && speed <= 25000) return;
  }
  throw new Error('Motion command exceeds firmware limits.');
}
