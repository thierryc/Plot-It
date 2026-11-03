import {planPenTransition,servoCommands,servoPulse,machineProfile} from '@thierryc/plotter-core';
import {coreOptions} from './core-settings';
import {penTimingSettings,PEN_TIMING_DEFAULTS} from './pen-settings';
export {penTimingSettings,PEN_TIMING_DEFAULTS} from './pen-settings';
import {initialState} from './model';
import type { PlotSettings } from './model';

// Preserve the existing physical calibration and percentage direction.
export const SERVO_POWER_TIMEOUT_MS = 60_000;
export const SERVO_PIN = 1; // SP uses Port B numbering: B1 is S2's RP4.
export const SERVO_RAISE_RATE = 1845;
export const SERVO_LOWER_RATE = 1230;
export const PEN_UP_SETTLE_MS = 100;
export const PEN_DOWN_SETTLE_MS = 100;
export const LONG_TRAVEL_THRESHOLD_MM = 50;
export const LONG_TRAVEL_SETTLE_MS = 100;
export function travelSettlingDelay(distanceMm: number): number {
  return distanceMm >= LONG_TRAVEL_THRESHOLD_MM ? LONG_TRAVEL_SETTLE_MS : 0;
}
export function servoPosition(percent:number):number {
  if(!Number.isFinite(percent)||percent<0||percent>100)throw new Error('Pen height must be between 0 and 100 percent.');
  return servoPulse(percent,machineProfile('xylodraw'));
}
export type PenSettings = Pick<PlotSettings, 'penUp' | 'penDown' | 'penTimingModel' | keyof typeof PEN_TIMING_DEFAULTS>;
export function servoSetup(up: number, down: number, settings: Partial<PlotSettings> = {}): string[] {
  const options=coreOptions({...initialState.settings,...settings,...penTimingSettings(settings),penUp:up,penDown:down});
  return servoCommands(options.pen,options.profile);
}

/** Thin adapter to the shared protocol transition and selected profile. */
export function penTransition(from:number|null,to:number,up:boolean,minimumMs=0,settings:Partial<PlotSettings>={},reload=false):{position:number;duration:number;command:string} {
  const options=coreOptions({...initialState.settings,...settings,...penTimingSettings(settings)});
  const transition=planPenTransition(from===null?null:servoPulse(from,options.profile),to,up,options.pen,options.profile,reload,minimumMs);
  return{position:transition.targetPulse,duration:transition.durationMs,command:`SP,${up?1:0},${transition.durationMs},${options.profile.servoPin}`};
}
