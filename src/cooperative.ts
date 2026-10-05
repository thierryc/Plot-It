/** Yield main-thread work in small slices, checking cancellation on every checkpoint. */
export class WorkSlice {
  private deadline = performance.now() + 8;
  constructor(private readonly cancelled: () => boolean = () => false) {}
  check(): void { if (this.cancelled()) throw new Error('Task cancelled.'); }
  checkpoint(): Promise<void> | undefined {
    this.check();
    if (performance.now() < this.deadline) return;
    return this.yield();
  }
  async yield(delay = 0): Promise<void> {
    this.check();
    await new Promise<void>(resolve => setTimeout(resolve, delay));
    this.check(); this.deadline = performance.now() + 8;
  }
}
