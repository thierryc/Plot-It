import type { PlotSettings, Point } from './model';
import { DEFAULT_MACHINE_ROTATION } from './model';
import { machinePoint } from './motion';

/** Position describes the fixed rail, viewed from above the paper. The diagram
 * uses the inverse of the same rotation that compiles hardware motion. */
export const PLOTTER_POSITIONS = [
  { rotation: 90, label: 'Main rail on the right' },
  { rotation: 180, label: 'Main rail above the paper' },
  { rotation: 270, label: 'Main rail on the left' },
  { rotation: 0, label: 'Main rail below the paper' },
] as const;

export function setupModel(value: unknown): NonNullable<PlotSettings['axidrawModel']> {
  return value === 'v3-a3' ? value : 'v3-a4';
}

export function setupSize(settings: PlotSettings): { width: number; height: number } {
  // Overall dimensions, rather than usable travel. Rotated to match the Figma
  // drawing with its main rail vertical. XyloDraw size supplied by the user.
  if (settings.profile === 'xylodraw') return { width: 558.8, height: 635 };
  return setupModel(settings.axidrawModel) === 'v3-a3'
    ? { width: 469.9, height: 660.4 } : { width: 406.4, height: 546.1 };
}

export function setupAngle(settings: PlotSettings): number {
  return 90 - (settings.machineRotation ?? DEFAULT_MACHINE_ROTATION);
}

export function setupPen(point: Point, settings: PlotSettings): Point {
  return machinePoint(point, ((360 - setupAngle(settings)) % 360) as PlotSettings['machineRotation']);
}
