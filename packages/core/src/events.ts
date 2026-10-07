/**
 * A small typed event emitter.
 *
 * Owns: subscribe/unsubscribe/emit with compile-time checked event names and payloads.
 * Every class in core that emits events composes one of these instead of extending
 * `EventTarget`, so listeners are strongly typed and disposal is explicit.
 */

/** Map of event name to payload type. */
export type EventMap = Record<string, unknown>;

/** Function returned by `on` that removes the listener. */
export type Unsubscribe = () => void;

/** Listener for one event. */
export type Listener<T> = (payload: T) => void;

/**
 * Typed publish/subscribe for in-process events.
 *
 * @template Events - Map of event names to payload types.
 * @example
 *   const emitter = new TypedEmitter<{ ready: void; error: Error }>();
 *   const off = emitter.on('error', (e) => console.error(e));
 *   emitter.emit('error', new Error('x'));
 *   off();
 */
export class TypedEmitter<Events extends EventMap> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();
  private disposed = false;

  /**
   * Subscribes to an event.
   *
   * @param {K} event - Event name.
   * @param {Listener<Events[K]>} listener - Called with the payload each time the event fires.
   * @returns {Unsubscribe} Function that removes this listener.
   */
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /**
   * Subscribes to the next occurrence of an event only.
   *
   * @param {K} event - Event name.
   * @param {Listener<Events[K]>} listener - Called once with the payload.
   * @returns {Unsubscribe} Function that removes the listener before it fires.
   */
  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  /**
   * Emits an event to every listener. Listener errors are isolated so one failing listener
   * does not stop the others; they are reported through `console.error`.
   *
   * @param {K} event - Event name.
   * @param {Events[K]} payload - Payload passed to each listener.
   * @returns {void} Nothing.
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    if (this.disposed) return;
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of Array.from(set)) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch (error) {
        console.error(`Listener for "${String(event)}" threw`, error);
      }
    }
  }

  /**
   * Number of listeners for an event; useful in tests to assert cleanup.
   *
   * @param {keyof Events} event - Name of the event whose subscribers are counted.
   * @returns {number} How many listeners are currently subscribed.
   */
  listenerCount(event: keyof Events): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /**
   * Removes every listener and ignores further emits.
   *
   * @returns {void} Nothing.
   */
  dispose(): void {
    this.listeners.clear();
    this.disposed = true;
  }
}
