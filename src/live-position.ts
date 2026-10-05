import type { Point } from './model';
import type { MotionPlan } from './motion-plan';

/** Locate measured carriage position only within already queued plan motion. */
export function positionPlanTime(plan: MotionPlan, position: Point, minimumTime: number, queuedTime: number): number {
  let bestTime = minimumTime, bestDistance = Infinity;
  for (const event of plan.events) {
    if (event.start > queuedTime) break;
    if (event.kind !== 'xy' || event.start + event.duration < minimumTime) continue;
    const dx = event.to.x - event.from.x, dy = event.to.y - event.from.y;
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const fraction = Math.max(0, Math.min(1, ((position.x - event.from.x) * dx + (position.y - event.from.y) * dy) / (length * length)));
    const distance = fraction * length;
    const speed = Math.sqrt(Math.max(0, event.initialSpeed ** 2 + 2 * event.acceleration * distance));
    const seconds = event.initialSpeed + speed > 1e-9 ? 2 * distance / (event.initialSpeed + speed) : event.duration * fraction;
    const time = event.start + Math.max(0, Math.min(event.duration, seconds));
    if (time < minimumTime - 1e-6 || time > queuedTime + 1e-6) continue;
    const error = Math.hypot(position.x - (event.from.x + dx * fraction), position.y - (event.from.y + dy * fraction));
    // At crossings, prefer the first matching segment ahead of current progress.
    if (error < bestDistance - .05) { bestDistance = error; bestTime = time; }
  }
  return Math.max(minimumTime, Math.min(queuedTime, bestTime));
}
