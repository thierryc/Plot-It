import type { PlotSettings } from './model';

// Preserve the existing physical calibration and percentage direction.
export const SERVO_POWER_TIMEOUT_MS = 60_000;
export const SERVO_PIN = 1; // SP uses Port B numbering: B1 is S2's RP4.
export const SERVO_RAISE_RATE = 1845;
export const SERVO_LOWER_RATE = 1230;
export const PEN_UP_SETTLE_MS = 150;
export const PEN_DOWN_SETTLE_MS = 50;
export const LONG_TRAVEL_THRESHOLD_MM = 50;
export const LONG_TRAVEL_SETTLE_MS = 100;
export function travelSettlingDelay(distanceMm: number): number {
  return distanceMm >= LONG_TRAVEL_THRESHOLD_MM ? LONG_TRAVEL_SETTLE_MS : 0;
}
export function servoPosition(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Pen height must be between 0 and 100 percent.');
  return Math.round(28000 - 20500 * percent / 100);
}
export const PEN_TIMING_DEFAULTS = { penRateRaise: 75, penRateLower: 50, penDelayUpMs: 150, penDelayDownMs: 0, penReloadWaitMs: 0 };
export type PenSettings = Pick<PlotSettings, 'penUp' | 'penDown' | keyof typeof PEN_TIMING_DEFAULTS>;
export function penTimingSettings(settings: Partial<PlotSettings> = {}): typeof PEN_TIMING_DEFAULTS {
  const result = { ...PEN_TIMING_DEFAULTS };
  for (const key of Object.keys(result) as Array<keyof typeof result>) {
    const value = settings[key] === undefined ? result[key] : settings[key];
    const rate = key === 'penRateRaise' || key === 'penRateLower';
    if (typeof value !== 'number' || !Number.isInteger(value) || value < (rate ? 1 : key === 'penReloadWaitMs' ? 0 : -500) || value > (rate ? 100 : 10000)) throw new Error(`Invalid ${key}.`);
    result[key] = value;
  }
  return result;
}
export function servoSetup(up: number, down: number, settings: Partial<PlotSettings> = {}): string[] {
  const timing = penTimingSettings(settings);
  return [`SC,4,${servoPosition(up)}`, `SC,5,${servoPosition(down)}`,
    `SC,11,${Math.round(24.6 * timing.penRateRaise)}`, `SC,12,${Math.round(24.6 * timing.penRateLower)}`, 'SC,8,8', 'SC,9,3'];
}

/** Independent raise/lower rates, with the Python driver's timing model. */
export function penTransition(from: number | null, to: number, up: boolean, minimumMs = 0, settings: Partial<PlotSettings> = {}, reload = false): { position: number; duration: number; command: string; hostWaitMs: number } {
  const timing = penTimingSettings(settings);
  const position = servoPosition(to);
  const distance = from === null ? 100 : Math.abs(from - to);
  if (!Number.isFinite(minimumMs) || minimumMs < 0 || minimumMs > 65535) throw new Error('Invalid pen settling time.');
  const mechanical = distance < .9 ? 0 : 45 + 2.69 * distance;
  const sweep = distance < .9 ? 0 : 200 * distance / (up ? timing.penRateRaise : timing.penRateLower);
  // Leave a quiet interval after the modeled lift, before carriage motion.
  // A plan's minimum already contains this interval; do not add it twice.
  const modeled = Math.max(1, Math.ceil(Math.hypot(mechanical ** 2, sweep ** 2) ** .5));
  const duration = Math.max(1, Math.ceil(minimumMs), modeled + (up ? timing.penDelayUpMs : PEN_DOWN_SETTLE_MS + timing.penDelayDownMs) + (reload ? timing.penReloadWaitMs : 0));
  return { position, duration, command: `SP,${up ? 1 : 0},${duration},${SERVO_PIN}`, hostWaitMs: duration > 50 ? duration - 30 : 0 };
}

/** Commanded state, not a sensor reading. Settled means the queue has drained. */
export class PenState {
  up = 50;
  down = 60;
  requested: number | null = null;
  acknowledged: number | null = null;
  settled: number | null = null;
  private acceptedAt = -Infinity;
  powerHeld = false;
  timing = { ...PEN_TIMING_DEFAULTS };
  configure(settings: PenSettings): boolean {
    const timing = penTimingSettings(settings);
    servoPosition(settings.penUp); servoPosition(settings.penDown);
    if (this.up === settings.penUp && this.down === settings.penDown && JSON.stringify(this.timing) === JSON.stringify(timing)) return false;
    this.timing = timing;
    this.up = settings.penUp; this.down = settings.penDown; this.invalidate(); return true;
  }
  invalidate(): void { this.requested = this.acknowledged = this.settled = null; this.acceptedAt = -Infinity; }
  current(now: number): number | null {
    if (!this.powerHeld && now - this.acceptedAt >= SERVO_POWER_TIMEOUT_MS) this.invalidate();
    return this.acknowledged;
  }
  accept(target: number, now: number): void { this.acknowledged = target; this.acceptedAt = now; }
  settle(): void { this.settled = this.acknowledged; }
}
