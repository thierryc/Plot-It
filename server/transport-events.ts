/** Transport events use a port as target, matching Web Serial disconnect events. */
export class Event {
  constructor(readonly type: string, readonly target: unknown) {}
}
export class EventTarget {
  private listeners = new Map<string, Set<(event: globalThis.Event) => void>>();
  addEventListener(type: string, listener: (event: globalThis.Event) => void) {
    let set = this.listeners.get(type); if (!set) { set = new Set(); this.listeners.set(type, set); } set.add(listener);
  }
  dispatchEvent(event: Event) { for (const listener of this.listeners.get(event.type) ?? []) listener(event as unknown as globalThis.Event); }
}
