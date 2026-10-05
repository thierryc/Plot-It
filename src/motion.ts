import type { Point, PlotSettings } from "./model";
import { DEFAULT_MACHINE_ROTATION, MACHINE_ORIENTATION_VERSION } from './model';

/** Upgrade the old Standard (0°) while retaining already chosen corrections. */
export function restoreMachineOrientation(settings?: { machineRotation?: unknown; machineOrientationVersion?: unknown }): Pick<PlotSettings, 'machineRotation' | 'machineOrientationVersion'> {
  const value = settings?.machineRotation;
  const valid = typeof value === 'number' && [0, 90, 180, 270].includes(value);
  const rotation = valid && (value !== 0 || settings?.machineOrientationVersion === MACHINE_ORIENTATION_VERSION)
    ? value as NonNullable<PlotSettings['machineRotation']> : DEFAULT_MACHINE_ROTATION;
  return { machineRotation: rotation, machineOrientationVersion: MACHINE_ORIENTATION_VERSION };
}

/** Display rotations relative to the standard, retaining absolute values in storage. */
export const MACHINE_ORIENTATIONS = [
  { rotation: 90, label: 'Standard' },
  { rotation: 180, label: 'Rotate 90° clockwise' },
  { rotation: 270, label: 'Rotate 180°' },
  { rotation: 0, label: 'Rotate 90° counterclockwise' },
] as const;

export interface QuantizedMove {
  durationMs: number;
  deltaSteps: Point;
  targetSteps: Point;
}

/** Rotate around the physical origin, without translating or changing artwork. */
export function machinePoint(point: Point, rotation: PlotSettings['machineRotation'] = DEFAULT_MACHINE_ROTATION): Point {
  switch (rotation) {
    case 90: return { x: 0 - point.y, y: point.x };
    case 180: return { x: 0 - point.x, y: 0 - point.y };
    case 270: return { x: point.y, y: 0 - point.x };
    default: return { ...point };
  }
}

export function canvasPoint(point: Point, rotation: PlotSettings['machineRotation'] = DEFAULT_MACHINE_ROTATION): Point {
  return machinePoint(point, ((360 - rotation) % 360) as PlotSettings['machineRotation']);
}

export function profileStepsPerMm(profile: PlotSettings["profile"]): number {
  const fullStepsPerMm = profile === "xylodraw" ? 6.25 : 5;
  return fullStepsPerMm * 8; // EBB EM mode 2: 1/8 microsteps.
}

export function quantizeAbsoluteMove(
  fromMm: Point,
  toMm: Point,
  currentSteps: Point,
  speedMmPerSecond: number,
  stepsPerMm: number,
  rotation: PlotSettings['machineRotation'] = DEFAULT_MACHINE_ROTATION
): QuantizedMove {
  const distanceMm = Math.hypot(toMm.x - fromMm.x, toMm.y - fromMm.y);
  const machine = machinePoint(toMm, rotation);
  const targetSteps = {
    x: Math.round(machine.x * stepsPerMm) + 0,
    y: Math.round(machine.y * stepsPerMm) + 0
  };
  return {
    durationMs: Math.max(10, Math.round((distanceMm / Math.max(1, speedMmPerSecond)) * 1000)),
    deltaSteps: {
      x: targetSteps.x - currentSteps.x,
      y: targetSteps.y - currentSteps.y
    },
    targetSteps
  };
}
