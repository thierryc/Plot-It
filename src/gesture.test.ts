// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GestureController, type GestureOptions } from './gesture';

function pointer(type: string, values: Partial<PointerEvent> = {}): PointerEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 20, buttons: 1, ...values });
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId ?? 1 },
    pointerType: { value: values.pointerType ?? 'mouse' }
  });
  return event as PointerEvent;
}

function fixture() {
  const controller = new GestureController();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  let captured = false;
  const capture = vi.fn(() => { captured = true; });
  const release = vi.fn(() => {
    captured = false;
    // Cleanup must precede the capture-loss notification, even if synchronous.
    svg.dispatchEvent(pointer('lostpointercapture'));
  });
  Object.assign(svg, { setPointerCapture: capture, hasPointerCapture: () => captured, releasePointerCapture: release });
  const geometry = { x: 0, y: 0 }, changes: { x: number; y: number }[] = [];
  const options: GestureOptions<typeof geometry> = {
    snapshot: vi.fn(() => ({ ...geometry })),
    restore: vi.fn(snapshot => Object.assign(geometry, snapshot)),
    onStart: vi.fn(),
    onMove: vi.fn(sample => {
      geometry.x = sample.clientX - 10;
      geometry.y = sample.shiftKey ? 0 : sample.clientY - 20;
    }),
    onFinish: vi.fn(reason => {
      expect(controller.active).toBe(false);
      if (reason !== 'escape' && (geometry.x || geometry.y)) changes.push({ ...geometry });
    }),
    onError: vi.fn()
  };
  const start = () => controller.start(svg, pointer('pointerdown'), options);
  const dispatch = (type: string, values: Partial<PointerEvent> = {}) => document.dispatchEvent(pointer(type, values));
  return { controller, svg, geometry, changes, options, start, dispatch, capture, release };
}

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('gesture termination', () => {
  it('applies the release coordinates and finishes exactly once', () => {
    const f = fixture(); f.start();
    f.dispatch('pointermove', { clientX: 15, clientY: 23 });
    f.dispatch('pointerup', { clientX: 30, clientY: 35, buttons: 0 });
    f.dispatch('lostpointercapture'); f.dispatch('pointercancel'); f.controller.finish();
    expect(f.geometry).toEqual({ x: 20, y: 15 });
    expect(f.changes).toEqual([{ x: 20, y: 15 }]);
    expect(f.options.onFinish).toHaveBeenCalledExactlyOnceWith('release', true);
    expect(f.release).toHaveBeenCalledOnce();
  });

  it('accepts release-only movement at the two-pixel threshold', () => {
    const f = fixture(); f.start();
    f.dispatch('pointerup', { clientX: 12, buttons: 0 });
    expect(f.geometry.x).toBe(2);
    expect(f.options.onStart).toHaveBeenCalledOnce();
    expect(f.changes).toHaveLength(1);
  });

  it.each([0, 1.9])('does not change geometry for a click or movement of %s pixels', distance => {
    const f = fixture(); f.start();
    f.dispatch('pointermove', { clientX: 10 + distance });
    f.dispatch('pointerup', { clientX: 10 + distance, buttons: 0 });
    expect(f.options.onStart).not.toHaveBeenCalled();
    expect(f.options.onMove).not.toHaveBeenCalled();
    expect(f.capture).not.toHaveBeenCalled();
    expect(f.changes).toHaveLength(0);
    expect(f.controller.active).toBe(false);
  });

  it('does not create a change when movement returns to its origin', () => {
    const f = fixture(); f.start(); f.dispatch('pointermove', { clientX: 40 });
    f.dispatch('pointerup', { buttons: 0 });
    expect(f.geometry).toEqual({ x: 0, y: 0 });
    expect(f.changes).toHaveLength(0);
  });

  it.each(['pointercancel', 'lostpointercapture'])('preserves the last position on %s, including a document-targeted event', type => {
    const f = fixture(); f.start(); f.dispatch('pointermove', { clientX: 35, clientY: 26 });
    f.svg.remove(); f.dispatch(type, { clientX: 999, clientY: 999 });
    expect(f.geometry).toEqual({ x: 25, y: 6 });
    expect(f.changes).toEqual([{ x: 25, y: 6 }]);
    expect(f.options.onFinish).toHaveBeenCalledExactlyOnceWith('interrupted', true);
    expect(f.controller.active).toBe(false);
  });

  it('preserves completed movement on window blur', () => {
    const f = fixture(); f.start(); f.dispatch('pointermove', { clientX: 15 });
    window.dispatchEvent(new Event('blur'));
    expect(f.geometry.x).toBe(5); expect(f.changes).toHaveLength(1);
    expect(f.controller.active).toBe(false);
  });

  it('does not confuse an inspector field losing focus with window blur', () => {
    const f = fixture(), input = document.createElement('input'); document.body.append(input); input.focus();
    f.start(); input.blur();
    expect(f.controller.active).toBe(true); expect(f.options.onFinish).not.toHaveBeenCalled();
    f.dispatch('pointerup', { clientX: 20, buttons: 0 });
    expect(f.geometry.x).toBe(10); expect(f.changes).toHaveLength(1);
  });

  it('finishes only when the document becomes hidden', () => {
    const f = fixture(); f.start(); f.dispatch('pointermove', { clientX: 15 });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(f.controller.active).toBe(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(f.geometry.x).toBe(5); expect(f.changes).toHaveLength(1);
    expect(f.controller.active).toBe(false);
  });

  it('applies a button-released mouse sample when pointer-up was missed', () => {
    const f = fixture(); f.start(); f.dispatch('pointermove', { clientX: 15 });
    f.dispatch('pointermove', { clientX: 25, buttons: 2 });
    expect(f.geometry.x).toBe(15);
    expect(f.options.onFinish).toHaveBeenCalledExactlyOnceWith('release', true);
    f.dispatch('pointerup', { clientX: 99, buttons: 0 });
    expect(f.geometry.x).toBe(15);
  });

  it('does not use mouse button recovery for a pen', () => {
    const f = fixture(); f.start();
    f.dispatch('pointermove', { clientX: 15, pointerType: 'pen', buttons: 0 });
    expect(f.controller.active).toBe(true); f.controller.finish();
  });

  it('Escape restores the starting snapshot and does not propagate to editing shortcuts', () => {
    const f = fixture(); f.start(); f.dispatch('pointermove', { clientX: 15 });
    const shortcut = vi.fn(); window.addEventListener('keydown', shortcut);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(escape); window.removeEventListener('keydown', shortcut);
    expect(f.geometry).toEqual({ x: 0, y: 0 });
    expect(f.changes).toHaveLength(0);
    expect(escape.defaultPrevented).toBe(true); expect(shortcut).not.toHaveBeenCalled();
    expect(f.options.onFinish).toHaveBeenCalledExactlyOnceWith('escape', true);
  });

  it('tracks Shift changes at the last successful position', () => {
    const f = fixture(); f.start(); f.dispatch('pointermove', { clientX: 20, clientY: 24 });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    expect(f.geometry).toEqual({ x: 10, y: 0 });
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    expect(f.geometry).toEqual({ x: 10, y: 4 });
    f.dispatch('pointerup', { clientX: 20, clientY: 24, shiftKey: true });
    expect(f.geometry).toEqual({ x: 10, y: 0 });
    expect(f.options.onStart).toHaveBeenCalledOnce();
  });

  it('ignores unrelated pointer movement and every unrelated termination event', () => {
    const f = fixture(); f.start();
    for (const type of ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
      f.dispatch(type, { pointerId: 999, clientX: 99, buttons: 0 });
    }
    expect(f.geometry.x).toBe(0); expect(f.controller.active).toBe(true);
    expect(f.options.onFinish).not.toHaveBeenCalled();
    f.controller.finish();
  });

  it('owns the session before movement and rejects overlapping starts', () => {
    const f = fixture(); expect(f.start()).toBe(true); expect(f.controller.active).toBe(true);
    expect(f.controller.start(f.svg, pointer('pointerdown', { pointerId: 2 }), f.options)).toBe(false);
    expect(f.capture).not.toHaveBeenCalled();
    f.dispatch('pointermove', { clientX: 15 });
    expect(f.capture).toHaveBeenCalledOnce();
    f.controller.finish(false);
    expect(f.options.onFinish).toHaveBeenCalledExactlyOnceWith('interrupted', false);
    expect(f.start()).toBe(true); f.controller.finish();
    expect(f.options.onFinish).toHaveBeenCalledTimes(2);
  });

  it('removes all document and window listeners before completion', () => {
    const addDocument = vi.spyOn(document, 'addEventListener'), removeDocument = vi.spyOn(document, 'removeEventListener');
    const addWindow = vi.spyOn(window, 'addEventListener'), removeWindow = vi.spyOn(window, 'removeEventListener');
    const f = fixture(); f.start(); f.controller.finish();
    for (const call of addDocument.mock.calls) expect(removeDocument.mock.calls).toContainEqual(call);
    for (const call of addWindow.mock.calls) expect(removeWindow.mock.calls).toContainEqual(call);
    f.dispatch('pointermove', { clientX: 99 });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    window.dispatchEvent(new Event('blur'));
    expect(f.options.onMove).not.toHaveBeenCalled(); expect(f.options.onFinish).toHaveBeenCalledOnce();
  });
});

describe('gesture failures', () => {
  it('cleans up failed mouse capture when movement starts and allows another session', () => {
    const f = fixture(), error = new Error('Capture failed'); f.capture.mockImplementationOnce(() => { throw error; });
    expect(f.start()).toBe(true); f.dispatch('pointermove', { clientX: 15 }); expect(f.controller.active).toBe(false);
    expect(f.options.onFinish).toHaveBeenCalledExactlyOnceWith('error', true);
    expect(f.options.onError).toHaveBeenCalledWith(error);
    f.dispatch('pointermove', { clientX: 99 }); expect(f.options.onMove).not.toHaveBeenCalled();
    expect(f.start()).toBe(true); f.controller.finish();
  });

  it('captures touch/pen immediately and cleans up an initial capture failure', () => {
    const f = fixture(), error = new Error('Capture failed');
    f.capture.mockImplementationOnce(() => { throw error; });
    expect(f.controller.start(f.svg, pointer('pointerdown', { pointerType: 'touch' }), f.options)).toBe(false);
    expect(f.controller.active).toBe(false); expect(f.options.onError).toHaveBeenCalledWith(error);
    expect(f.controller.start(f.svg, pointer('pointerdown', { pointerType: 'pen' }), f.options)).toBe(true);
    expect(f.capture).toHaveBeenCalledTimes(2); f.controller.finish();
  });

  it('restores a failed sample and saves the preceding successful position', () => {
    const f = fixture(), error = new Error('Invalid geometry'); f.start();
    f.dispatch('pointermove', { clientX: 15, clientY: 23 });
    vi.mocked(f.options.onMove).mockImplementationOnce(() => { f.geometry.x = 999; throw error; });
    f.dispatch('pointerup', { clientX: 30, buttons: 0 });
    expect(f.geometry).toEqual({ x: 5, y: 3 });
    expect(f.changes).toEqual([{ x: 5, y: 3 }]);
    expect(f.options.onFinish).toHaveBeenCalledExactlyOnceWith('error', true);
    expect(f.options.onError).toHaveBeenCalledWith(error);
  });

  it('cancels rather than committing a partial preview if restoring the last good sample fails', () => {
    const f = fixture(); f.start(); f.dispatch('pointermove', { clientX: 15 });
    vi.mocked(f.options.onMove).mockImplementationOnce(() => { f.geometry.x = 999; throw Error('Preview failed'); });
    vi.mocked(f.options.restore).mockImplementationOnce(() => { throw Error('Restore failed'); });
    f.dispatch('pointermove', { clientX: 30 });
    expect(f.geometry).toEqual({ x: 0, y: 0 });
    expect(f.changes).toHaveLength(0);
    expect(f.options.onFinish).toHaveBeenCalledExactlyOnceWith('cancel', true);
    expect(f.options.onError).toHaveBeenCalledWith(expect.any(AggregateError));
  });

  it('cleans up when the movement-start callback fails', () => {
    const f = fixture(), error = new Error('Preview failed');
    vi.mocked(f.options.onStart).mockImplementationOnce(() => { throw error; });
    f.start(); f.dispatch('pointermove', { clientX: 15 });
    expect(f.controller.active).toBe(false); expect(f.changes).toHaveLength(0);
    expect(f.options.onMove).not.toHaveBeenCalled();
    expect(f.options.onError).toHaveBeenCalledWith(error);
  });

  it('reports snapshot failure without retaining a session', () => {
    const f = fixture(), error = new Error('Snapshot failed');
    vi.mocked(f.options.snapshot).mockImplementationOnce(() => { throw error; });
    expect(f.start()).toBe(false); expect(f.controller.active).toBe(false);
    expect(f.capture).not.toHaveBeenCalled(); expect(f.options.onError).toHaveBeenCalledWith(error);
  });

  it('rejects nonfinite release coordinates and preserves valid geometry', () => {
    const f = fixture(); f.start(); f.dispatch('pointermove', { clientX: 15 });
    // MouseEvent constructors reject nonfinite coordinates; emulate a faulty sample.
    const up = pointer('pointerup'); Object.defineProperty(up, 'clientX', { value: NaN }); document.dispatchEvent(up);
    expect(f.geometry.x).toBe(5); expect(f.controller.active).toBe(false);
    expect(f.options.onError).toHaveBeenCalledOnce();
  });

  it('still completes if capture release throws', () => {
    const f = fixture(), error = new Error('Release failed'); f.release.mockImplementationOnce(() => { throw error; });
    f.start(); f.dispatch('pointerup', { clientX: 20 });
    expect(f.controller.active).toBe(false); expect(f.changes).toEqual([{ x: 10, y: 0 }]);
    expect(f.options.onFinish).toHaveBeenCalledOnce(); expect(f.options.onError).toHaveBeenCalledWith(error);
  });

  it('cleans up before a failing completion callback', () => {
    const f = fixture(), error = new Error('Save failed');
    vi.mocked(f.options.onFinish).mockImplementationOnce(() => { throw error; });
    f.start(); f.dispatch('pointermove', { clientX: 15 }); f.controller.finish();
    expect(f.controller.active).toBe(false); expect(f.release).toHaveBeenCalledOnce();
    expect(f.options.onError).toHaveBeenCalledWith(error);
    expect(f.start()).toBe(true); f.controller.finish();
  });

  it('does not continue moving after a reentrant completion during setup of movement', () => {
    const f = fixture(); vi.mocked(f.options.onStart).mockImplementationOnce(() => f.controller.finish(false));
    f.start(); f.dispatch('pointermove', { clientX: 20 });
    expect(f.options.onMove).not.toHaveBeenCalled(); expect(f.options.onFinish).toHaveBeenCalledOnce();
  });
});

 describe('viewport cancellation', () => {
  it.each(['pointercancel','lostpointercapture'])('restores original geometry on %s for cancellable viewport gestures', type => {
    const f = fixture(); f.options.cancelOnInterrupt = true; f.start(); f.dispatch('pointermove',{clientX:40}); f.dispatch(type);
    expect(f.geometry).toEqual({x:0,y:0}); expect(f.changes).toHaveLength(0);
    expect(f.options.onFinish).toHaveBeenCalledExactlyOnceWith('cancel',true);
  });
  it('updates Alt at the last pointer position without another move or accumulated error', () => {
    const f=fixture(); let alt=false;
    vi.mocked(f.options.onMove).mockImplementation(sample=>{ alt=sample.altKey; f.geometry.x=sample.clientX-10; });
    f.start(); f.dispatch('pointermove',{clientX:40});
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Alt'})); expect(alt).toBe(true); expect(f.geometry.x).toBe(30);
    document.dispatchEvent(new KeyboardEvent('keyup',{key:'Alt'})); expect(alt).toBe(false); expect(f.geometry.x).toBe(30);
    f.dispatch('pointerup',{clientX:40}); expect(f.options.onStart).toHaveBeenCalledOnce();
  });
});

describe('animation-frame previews', () => {
  function scheduled() {
    const f=fixture(), callbacks=new Map<number,FrameRequestCallback>();let next=0;
    const request=vi.spyOn(window,'requestAnimationFrame').mockImplementation(callback=>{callbacks.set(++next,callback);return next;});
    const cancel=vi.spyOn(window,'cancelAnimationFrame').mockImplementation(id=>{callbacks.delete(id);});
    f.options.animationFrame=true;
    const tick=()=>{const queued=[...callbacks.values()];callbacks.clear();queued.forEach(callback=>callback(0));};
    return {...f,callbacks,request,cancel,tick};
  }
  it('coalesces pointer bursts and modifiers into one latest update per frame',()=>{
    const f=scheduled();f.start();
    for(let i=0;i<50;i++)f.dispatch('pointermove',{clientX:20+i,clientY:30});
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift'}));
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Alt'}));
    expect(f.request).toHaveBeenCalledOnce();expect(f.options.onMove).not.toHaveBeenCalled();
    f.tick();expect(f.options.onMove).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({clientX:69,shiftKey:true,altKey:true}));
    expect(f.geometry).toEqual({x:59,y:0});f.controller.finish();
  });
  it.each(['release','interrupted'])('flushes the final sample synchronously on %s',reason=>{
    const f=scheduled();f.start();f.dispatch('pointermove',{clientX:30});
    if(reason==='release')f.dispatch('pointerup',{clientX:50,buttons:0});else f.controller.finish();
    expect(f.geometry.x).toBe(reason==='release'?40:20);expect(f.options.onMove).toHaveBeenCalledOnce();
    expect(f.callbacks.size).toBe(0);f.tick();expect(f.options.onMove).toHaveBeenCalledOnce();
  });
  it('processes every raw rotation angle even when only one frame is drawn',async()=>{
    const {angleStep}=await import('./editor-modifiers');const f=scheduled();let previous=170,angle=0;
    f.options.onSample=sample=>{angle+=angleStep(previous,sample.clientX);previous=sample.clientX;};
    f.start();for(const clientX of [179,-179,-100,0,100,179,-179])f.dispatch('pointermove',{clientX});
    expect(angle).toBe(371);expect(f.options.onMove).not.toHaveBeenCalled();f.tick();expect(f.options.onMove).toHaveBeenCalledOnce();f.controller.finish();
  });
  it.each(['pointercancel', 'lostpointercapture', 'blur', 'hidden'])('saves artwork once on %s and removes pending frame callbacks', reason => {
    const f = scheduled(); f.options.cancelOnInterrupt = false; f.start();
    f.dispatch('pointermove', { clientX: 30 }); f.tick();
    f.dispatch('pointermove', { clientX: 50 }); const late = [...f.callbacks.values()];
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    else if (reason === 'hidden') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    } else f.dispatch(reason);
    expect(f.geometry.x).toBe(40); expect(f.changes).toEqual([{ x: 40, y: 0 }]);
    expect(f.options.onFinish).toHaveBeenCalledExactlyOnceWith('interrupted', true);
    expect(f.callbacks.size).toBe(0); late.forEach(callback => callback(1));
    f.dispatch('pointerup', { clientX: 99, buttons: 0 });
    expect(f.geometry.x).toBe(40); expect(f.changes).toHaveLength(1);
  });
  it('saves the preceding successful frame after a preview error without replaying queued frames', () => {
    const f = scheduled(); f.options.cancelOnInterrupt = false; f.start();
    f.dispatch('pointermove', { clientX: 30 }); f.tick();
    vi.mocked(f.options.onMove).mockImplementationOnce(() => { f.geometry.x = 999; throw Error('Bad preview'); });
    f.dispatch('pointermove', { clientX: 50 }); f.tick();
    expect(f.geometry.x).toBe(20); expect(f.changes).toEqual([{ x: 20, y: 0 }]);
    expect(f.options.onFinish).toHaveBeenCalledExactlyOnceWith('error', true);
    expect(f.callbacks.size).toBe(0); expect(f.controller.active).toBe(false);
  });
  it.each(['pointercancel','lostpointercapture','escape','blur'])('cancels queued frames and restores on %s',reason=>{
    const f=scheduled();f.options.cancelOnInterrupt=true;f.start();f.dispatch('pointermove',{clientX:30});f.tick();
    f.dispatch('pointermove',{clientX:50});const late=[...f.callbacks.values()];
    if(reason==='escape')document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
    else if(reason==='blur')window.dispatchEvent(new Event('blur'));else f.dispatch(reason);
    expect(f.geometry.x).toBe(0);expect(f.callbacks.size).toBe(0);late.forEach(callback=>callback(1));expect(f.geometry.x).toBe(0);
    expect(f.options.onFinish).toHaveBeenCalledOnce();
  });
  it('cleans up pending frames after preview or raw-processing errors',()=>{
    for(const raw of [true,false]){
      const f=scheduled();f.options.cancelOnInterrupt=true;
      const fail=()=>{throw Error('bad preview');};if(raw)f.options.onSample=fail;else f.options.onMove=fail;
      f.start();f.dispatch('pointermove',{clientX:30});f.tick();expect(f.controller.active).toBe(false);
      expect(f.callbacks.size).toBe(0);expect(f.geometry.x).toBe(0);expect(f.options.onError).toHaveBeenCalled();
    }
  });
  it('keeps Option-click below the drag threshold unscheduled',()=>{
    const f=scheduled();f.start();f.dispatch('pointerup',{clientX:11,altKey:true,buttons:0});
    expect(f.request).not.toHaveBeenCalled();expect(f.options.onStart).not.toHaveBeenCalled();
  });
});
