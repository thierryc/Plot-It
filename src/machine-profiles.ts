import type { PlotSettings } from './model';

export const MACHINE_PROFILES = [
  { value: 'axidraw', label: 'AxiDraw / EBB', hardware: true },
  { value: 'nextdraw', label: 'Bantam Tools NextDraw', hardware: true },
  { value: 'xylodraw', label: 'XyloDraw', hardware: true },
] as const;
export const NEXTDRAW_MODELS = [
  { value: '8511', label: '8511 · A4' },
  { value: '1117', label: '1117 · A3' },
  { value: '2234', label: '2234 · A1' },
] as const;
export const NEXTDRAW_PREVIEW_NOTE = 'NextDraw brushless pen setup. Requires EBB 3.0.2 or newer; S-curve requires 3.1.7. Calibrate pen heights before drawing.';
export function supportsHardwareProfile(profile: PlotSettings['profile']): boolean {
  return MACHINE_PROFILES.some(option => option.value === profile && option.hardware);
}
export function restoreNextDrawModel(value: unknown): NonNullable<PlotSettings['nextdrawModel']> {
  return value === '1117' || value === '2234' ? value : '8511';
}
/** NextDraw shares the CoreXY XY calibration. This alias is for preview only;
 * its brushless pen configuration must never reach the legacy hardware adapter. */
export function planningProfile(profile: PlotSettings['profile']): 'axidraw' | 'xylodraw' {
  return profile === 'nextdraw' ? 'axidraw' : profile;
}
export function assertHardwareProfile(profile: PlotSettings['profile']): void {
  if (!supportsHardwareProfile(profile)) throw new Error(NEXTDRAW_PREVIEW_NOTE);
}
