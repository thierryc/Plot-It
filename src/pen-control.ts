import {penDuration,servoCommands,servoPulse,machineProfile} from '@thierryc/plotter-core';
import {coreOptions} from './core-settings';
import {initialState} from './model';
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
export function servoPosition(percent:number):number {
  if(!Number.isFinite(percent)||percent<0||percent>100)throw new Error('Pen height must be between 0 and 100 percent.');
  return servoPulse(percent,machineProfile('xylodraw'));
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
  const options=coreOptions({...initialState.settings,...settings,penUp:up,penDown:down});
  return servoCommands(options.pen,options.profile);
}

/** Independent raise/lower rates, with the Python driver's timing model. */
export function penTransition(from: number | null, to: number, up: boolean, minimumMs = 0, settings: Partial<PlotSettings> = {}, reload = false): { position: number; duration: number; command: string; hostWaitMs: number } {
  penTimingSettings(settings);
  if (!Number.isFinite(minimumMs) || minimumMs < 0 || minimumMs > 65535) throw new Error('Invalid pen settling time.');
  const options=coreOptions({...initialState.settings,...settings});
  const position=servoPosition(to),duration=Math.max(Math.ceil(minimumMs),penDuration(from,to,up,options.pen,reload));
  return {position,duration,command:`SP,${up?1:0},${duration},${SERVO_PIN}`,hostWaitMs:duration>50?duration-30:0};
}
