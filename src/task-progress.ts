export interface TaskProgress { label: string; fraction?: number }
/** Worker telemetry is throttled so dense jobs do not flood the main thread. */
export function progressReporter(send: (progress: TaskProgress) => void): (progress: TaskProgress) => void {
  let lastTime = -Infinity;
  return progress => {
    const now = performance.now();
    if (progress.fraction === 1 || now - lastTime >= 50) {
      send(progress); lastTime = now;
    }
  };
}
