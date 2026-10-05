export type GestureSample = Pick<PointerEvent, 'clientX' | 'clientY' | 'shiftKey' | 'altKey'>;
export type GestureEnd = 'release' | 'interrupted' | 'escape' | 'cancel' | 'error';

export interface GestureOptions<Snapshot> {
  /** Viewport-only rollback policy. Artwork keeps valid movement on interruption. */
  cancelOnInterrupt?: boolean;
  animationFrame?: boolean;
  /** Cheap raw-input processing, before frame coalescing (e.g. rotation unwrap). */
  onSample?(sample: GestureSample): void;
  snapshot(): Snapshot;
  restore(snapshot: Snapshot): void;
  onStart(): void;
  onMove(sample: GestureSample): void;
  onFinish(reason: GestureEnd, redraw: boolean): void;
  onError(error: unknown): void;
}

/** Owns one transformation, including the interval before movement begins. */
export class GestureController {
  private session?: { finish(reason: GestureEnd, redraw?: boolean): void };

  get active(): boolean { return !!this.session; }

  finish(redraw = true): void { this.session?.finish('interrupted', redraw); }

  start<Snapshot>(svg: SVGSVGElement, event: PointerEvent, options: GestureOptions<Snapshot>): boolean {
    if (this.active) return false;
    const document = svg.ownerDocument, window = document.defaultView;
    let original: Snapshot;
    try {
      if (!window) throw new Error('The drawing window is unavailable.');
      original = options.snapshot();
    } catch (error) { options.onError(error); return false; }

    let started = false, ended = false, engaged = false;
    let pending: GestureSample | undefined, frame: number | undefined;
    const cancelFrame = () => { if (frame !== undefined) window!.cancelAnimationFrame(frame); frame = undefined; };
    const flush = () => { cancelFrame(); const sample = pending; pending = undefined; if (sample) apply(sample); };
    let last: GestureSample = { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey };
    const listeners: [EventTarget, string, EventListener][] = [];
    const finish = (reason: GestureEnd, redraw = true) => {
      if (ended) return;
      if (reason === 'release' || reason === 'interrupted') flush();
      if (ended) return;
      cancelFrame(); pending = undefined;
      ended = true;
      this.session = undefined;
      for (const [target, type, listener] of listeners) target.removeEventListener(type, listener, true);
      let captureError: unknown;
      try { if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId); }
      catch (error) { captureError = error; }
      if (reason === 'escape' || reason === 'cancel' || (reason === 'error' && options.cancelOnInterrupt)) {
        try { options.restore(original); } catch (error) { options.onError(error); }
      }
      try { options.onFinish(reason, redraw); } catch (error) { options.onError(error); }
      if (captureError) options.onError(captureError);
    };
    this.session = { finish };

    const apply = (sample: GestureSample) => {
      if (ended) return;
      let previous: Snapshot;
      try { previous = options.snapshot(); }
      catch (error) { finish('error'); options.onError(error); return; }
      try {
        if (![sample.clientX, sample.clientY].every(Number.isFinite)) throw new Error('Pointer coordinates must be finite.');
        if (!started && !engaged && Math.hypot(sample.clientX - event.clientX, sample.clientY - event.clientY) < 2) return;
        if (!started) {
          // Mouse clicks must keep their original target for click/double-click.
          if (event.pointerType === 'mouse') svg.setPointerCapture(event.pointerId);
          started = true; options.onStart();
        }
        if (ended) return;
        options.onMove(sample);
        last = { clientX: sample.clientX, clientY: sample.clientY, shiftKey: sample.shiftKey, altKey: sample.altKey };
      } catch (error) {
        let failure = error;
        let restored = true;
        try { options.restore(previous); }
        catch (restoreError) {
          restored = false;
          failure = new AggregateError([error, restoreError], 'Could not restore the last valid gesture position.');
        }
        // A failed rollback must never commit a partially applied preview.
        finish(restored ? 'error' : 'cancel'); options.onError(failure);
      }
    };
    const receive = (sample: GestureSample) => {
      if (ended) return;
      try {
        if (![sample.clientX, sample.clientY].every(Number.isFinite)) throw new Error('Pointer coordinates must be finite.');
        if (!engaged && !started && Math.hypot(sample.clientX - event.clientX, sample.clientY - event.clientY) < 2) return;
        engaged = true;
        options.onSample?.(sample);
        last = { clientX: sample.clientX, clientY: sample.clientY, shiftKey: sample.shiftKey, altKey: sample.altKey };
        if (!options.animationFrame) { apply(last); return; }
        pending = last;
        if (frame === undefined) frame = window!.requestAnimationFrame(() => { frame = undefined; const sample = pending; pending = undefined; if (sample && !ended) apply(sample); });
      } catch (error) { finish('error'); options.onError(error); }
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      receive(next);
      if (next.pointerType === 'mouse' && !(next.buttons & 1)) finish('release');
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      receive(next); finish('release');
    };
    const interrupted = (next: PointerEvent) => { if (next.pointerId === event.pointerId) finish(options.cancelOnInterrupt ? 'cancel' : 'interrupted'); };
    const key = (next: KeyboardEvent) => {
      if (next.key === 'Escape' && next.type === 'keydown') {
        next.preventDefault(); next.stopPropagation(); finish('escape');
      } else if ((next.key === 'Shift' || next.key === 'Alt') && (started || engaged)) {
        receive({ ...last, [next.key === 'Shift' ? 'shiftKey' : 'altKey']: next.type === 'keydown' });
      }
    };
    // Capturing listeners also see field blur; only losing the window ends a drag.
    const blur = (next: Event) => { if (next.target === next.currentTarget) finish(options.cancelOnInterrupt ? 'cancel' : 'interrupted'); };
    const visibility = () => { if (document.visibilityState === 'hidden') finish(options.cancelOnInterrupt ? 'cancel' : 'interrupted'); };
    const listen = (target: EventTarget, type: string, listener: EventListener) => {
      target.addEventListener(type, listener, true);
      listeners.push([target, type, listener]);
    };
    try {
      listen(document, 'pointermove', move as EventListener);
      listen(document, 'pointerup', up as EventListener);
      listen(document, 'pointercancel', interrupted as EventListener);
      listen(document, 'lostpointercapture', interrupted as EventListener);
      listen(document, 'keydown', key as EventListener);
      listen(document, 'keyup', key as EventListener);
      listen(document, 'visibilitychange', visibility);
      listen(window!, 'blur', blur);
      // Override implicit touch/pen capture before it becomes active, avoiding
      // a capture-loss notification when the first movement starts.
      if (event.pointerType !== 'mouse') svg.setPointerCapture(event.pointerId);
    } catch (error) { finish('error'); options.onError(error); return false; }
    return true;
  }
}
