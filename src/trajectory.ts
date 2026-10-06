import type { Point } from './model';

export interface TrajectoryOptions { acceleration: number; maximumVelocity: number; cornering: number }
export interface TrajectoryBlock { from: Point; to: Point; duration: number; initialSpeed: number; acceleration: number; stopBefore?: boolean }

// The reviewed AxiDraw policy treats ramps with at most four 25 ms slices
// as short moves. Command sampling is a separate, finer-grained operation.
export const SHORT_MOVE_SLICE_SECONDS = .025;

/** Resolve one reachable segment into useful ramps, or a short-move approximation. */
export function planSegment(from: Point, to: Point, initial: number, final: number, options: TrajectoryOptions): TrajectoryBlock[] {
  const { acceleration: a, maximumVelocity: max } = options;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (![from.x, from.y, to.x, to.y, initial, final, a, max].every(Number.isFinite)
    || a <= 0 || max <= 0 || initial < 0 || final < 0 || initial > max + 1e-9 || final > max + 1e-9
    || Math.abs(final * final - initial * initial) > 2 * a * length + 1e-7) throw new Error('Invalid segment rates or coordinates.');
  if (!length) return [];
  const fullRampDistance = (2 * max * max - initial * initial - final * final) / (2 * a);
  const trapezoid = length > fullRampDistance + SHORT_MOVE_SLICE_SECONDS * max && length / max > 4 * SHORT_MOVE_SLICE_SECONDS;
  // Near the triangle/trapezoid crossover, slightly reduce acceleration rather
  // than manufacture a cruise interval too short to be useful.
  const required = Math.abs(final * final - initial * initial) / (2 * length);
  const local = !trapezoid && fullRampDistance > 0 && length >= .9 * fullRampDistance
    ? Math.min(a, Math.max(required, .9 * fullRampDistance / length * a)) : a;
  const peak = Math.min(max, Math.sqrt(local * length + (initial * initial + final * final) / 2));
  const upTime = Math.max(0, (peak - initial) / local), downTime = Math.max(0, (peak - final) / local);
  const stopBefore = initial < 1e-9;
  if (!trapezoid && Math.floor(upTime / SHORT_MOVE_SLICE_SECONDS) + Math.floor(downTime / SHORT_MOVE_SLICE_SECONDS) <= 4) {
    const boosted = (initial + peak) / 2;
    const acceleration = Math.max(-a, Math.min(a, (final * final - boosted * boosted) / (2 * length)));
    const duration = acceleration ? (final - boosted) / acceleration : 0;
    if (duration > 0 && Math.floor(duration / SHORT_MOVE_SLICE_SECONDS) > 1) {
      return [{ from, to, duration, initialSpeed: boosted, acceleration, stopBefore }];
    }
    // A single timed move is more useful than multiple sub-step ramps.
    const speed = Math.max(peak, initial, final);
    return [{ from, to, duration: length / speed, initialSpeed: speed, acceleration: 0, stopBefore }];
  }
  const blocks: TrajectoryBlock[] = [];
  const accelerating = Math.max(0, (peak * peak - initial * initial) / (2 * local));
  const decelerating = Math.max(0, (peak * peak - final * final) / (2 * local));
  let distance = 0, cursor = from;
  const add = (span: number, startSpeed: number, endSpeed: number, acceleration: number) => {
    if (span <= 1e-12) return;
    distance += span;
    const target = { x: from.x + (to.x - from.x) * distance / length, y: from.y + (to.y - from.y) * distance / length };
    blocks.push({ from: cursor, to: target, duration: 2 * span / (startSpeed + endSpeed), initialSpeed: startSpeed, acceleration, stopBefore: !blocks.length && stopBefore });
    cursor = target;
  };
  add(accelerating, initial, peak, local);
  add(Math.max(0, length - accelerating - decelerating), peak, peak, 0);
  add(decelerating, peak, final, -local);
  blocks.at(-1)!.to = to;
  return blocks;
}

/** Original polyline planner: junction limits, reachability, then v² = u² + 2as. */
export function planPolyline(input: Point[], options: TrajectoryOptions, directions: Point[] = input): TrajectoryBlock[] {
  const { acceleration: a, maximumVelocity: max, cornering } = options;
  if (![a, max].every(value => Number.isFinite(value) && value > 0) || !Number.isFinite(cornering) || cornering < 0) throw new Error('Invalid trajectory settings.');
  const points: Point[] = [];
  const source: Point[] = [];
  if (directions.length !== input.length) throw new Error('Invalid trajectory directions.');
  for (let index = 0; index < input.length; index++) {
    const point = input[index]!, direction = directions[index]!;
    if (![point.x, point.y, direction.x, direction.y].every(Number.isFinite)) throw new Error('Invalid trajectory coordinate.');
    const last = points.at(-1);
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 1e-9) { points.push({ ...point }); source.push({ ...direction }); }
  }
  if (points.length < 2) return [];
  const lengths = points.slice(1).map((point, i) => Math.hypot(point.x - points[i]!.x, point.y - points[i]!.y));
  const speeds = new Array<number>(points.length).fill(max * max);
  speeds[0] = speeds[speeds.length - 1] = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = source[i - 1]!, q = source[i]!, r = source[i + 1]!;
    const divisor = Math.hypot(q.x - p.x, q.y - p.y) * Math.hypot(r.x - q.x, r.y - q.y);
    if (!divisor) throw new Error('Invalid trajectory directions.');
    const dot = ((q.x - p.x) * (r.x - q.x) + (q.y - p.y) * (r.y - q.y)) / divisor;
    const half = Math.sqrt(Math.max(0, Math.min(1, (1 + dot) / 2)));
    // A straight junction needs no slowdown; a reversal must come to rest.
    speeds[i] = half > 1 - 1e-10 ? max * max : Math.min(max * max, a * cornering * half / (1 - half));
  }
  for (let i = 1; i < speeds.length; i++) speeds[i] = Math.min(speeds[i]!, speeds[i - 1]! + 2 * a * lengths[i - 1]!);
  for (let i = speeds.length - 2; i >= 0; i--) speeds[i] = Math.min(speeds[i]!, speeds[i + 1]! + 2 * a * lengths[i]!);
  const blocks: TrajectoryBlock[] = [];
  for (let i = 0; i < lengths.length; i++) {
    const from = points[i]!, to = points[i + 1]!;
    const initial = Math.sqrt(speeds[i]!), final = Math.sqrt(speeds[i + 1]!);
    blocks.push(...planSegment(from, to, initial, final, options));
  }
  return blocks;
}
