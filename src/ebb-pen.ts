import { PenState, penTransition, servoSetup } from './pen-control';

export interface PenIO {
  command(command: string): Promise<void>;
  queued(durationMs: number): void;
  sleep(durationMs: number): Promise<void>;
  now(): number;
}

/** EBB SP pen control. Configuration is changed only at stationary boundaries. */
export class EbbPen {
  private configuration = '';
  constructor(private state: PenState, private io: PenIO) {}
  reset(): void { this.configuration = ''; }

  async configure(down = this.state.down): Promise<void> {
    const key = `${this.state.up}/${down}/${this.state.timing.penRateRaise}/${this.state.timing.penRateLower}`;
    if (key === this.configuration) return;
    for (const command of servoSetup(this.state.up, down, this.state.timing)) await this.io.command(command);
    this.configuration = key;
  }

  async move(target: number, minimumMs: number, force: boolean): Promise<void> {
    const from = this.state.current(this.io.now());
    if (!force && from === target) return;
    const up = target === this.state.up;
    // Manual intermediate heights use a temporary Down endpoint. A subsequent
    // plot transition reinstates the configured calibration before issuing SP.
    const down = up ? this.state.down : target;
    const transition = penTransition(from, target, up, minimumMs, this.state.timing);
    await this.configure(down);
    this.state.requested = target;
    await this.io.command(transition.command);
    this.state.accept(target, this.io.now());
    this.io.queued(transition.duration);
    // Like the Python feeder, overlap host pacing with the firmware's delay.
    // The caller still checks queue idle before allowing the next XY section.
    if (transition.hostWaitMs) await this.io.sleep(transition.hostWaitMs);
  }
}
