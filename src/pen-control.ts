import type { PlotSettings } from './model';

// Preserve the existing physical calibration and percentage direction.
export const SERVO_POWER_TIMEOUT_MS = 60_000;
export const SERVO_PIN = 4; // RP4 = RB1, standard pen-lift connector.
export function servoPosition(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Pen height must be between 0 and 100 percent.');
  return Math.round(28000 - 20500 * percent / 100);
}
export function penTransition(from: number | null, to: number, minimumMs = 120): { position: number; rate: number; duration: number } {
  const position = servoPosition(to);
  const distance = from === null ? 100 : Math.abs(from - to);
  const raising = from !== null && position > servoPosition(from);
  // 24 ms PWM period; a full-range sweep takes 200 ms at 100% rate.
  const rate = Math.round(20500 * .24 * (raising ? 75 : 50) / 200);
  const signalTime = distance ? (Math.ceil(20500 * distance / 100 / rate) + 1) * 24 : 0;
  const physicalTime = distance ? 45 + 2.69 * distance : 0;
  return { position, rate, duration: Math.ceil(Math.max(minimumMs, signalTime, physicalTime)) };
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
  configure(settings: Pick<PlotSettings, 'penUp' | 'penDown'>): boolean {
    servoPosition(settings.penUp); servoPosition(settings.penDown);
    if (this.up === settings.penUp && this.down === settings.penDown) return false;
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
