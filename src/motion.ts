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

/** Absolute XM lattice coordinates; rounding deltas separately causes drift. */
export function quantizePoint(point: Point, settings: PlotSettings): Point {
  const machine = machinePoint(point, settings.machineRotation), scale = profileStepsPerMm(settings.profile);
  return { x: Math.round(machine.x * scale) + 0, y: Math.round(machine.y * scale) + 0 };
}

export interface StepVertex { requested: Point; position: Point }

/** Keep source directions alongside reachable endpoints so rounding adds no false corners. */
export function stepPathVertices(points: Point[], settings: PlotSettings): StepVertex[] {
  const source: Point[] = [];
  // Remove only redundant points on the same straight segment. Otherwise a
  // densely sampled diagonal would become a long staircase on the step grid.
  for (const point of points) {
    if (![point.x, point.y].every(Number.isFinite)) throw new Error('Invalid trajectory coordinate.');
    const last = source.at(-1);
    if (last && point.x === last.x && point.y === last.y) continue;
    while (source.length > 1) {
      const a = source.at(-2)!, b = source.at(-1)!;
      const ux = b.x - a.x, uy = b.y - a.y, vx = point.x - b.x, vy = point.y - b.y;
      if (ux * vx + uy * vy <= 0 || Math.abs(ux * vy - uy * vx) > 1e-12 * Math.hypot(ux,uy) * Math.hypot(vx,vy)) break;
      source.pop();
    }
    source.push(point);
  }
  const result: StepVertex[] = [];
  let previous: Point | undefined;
  const scale = profileStepsPerMm(settings.profile);
  for (const point of source) {
    const steps = quantizePoint(point, settings);
    if (previous && steps.x === previous.x && steps.y === previous.y) continue;
    result.push({ requested: { ...point }, position: canvasPoint({ x: steps.x / scale, y: steps.y / scale }, settings.machineRotation) });
    previous = steps;
  }
  return result;
}

/** Plan distances from the reachable step endpoints, retaining cumulative tiny moves. */
export function roundStepPath(points: Point[], settings: PlotSettings): Point[] {
  return stepPathVertices(points, settings).map(vertex => vertex.position);
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
