import { describe, expect, it, vi } from 'vitest';

import { TypedEmitter } from './events.js';

describe('TypedEmitter', () => {
  it('delivers payloads to subscribers and supports unsubscribe', () => {
    const emitter = new TypedEmitter<{ tick: number }>();
    const listener = vi.fn();
    const off = emitter.on('tick', listener);
    emitter.emit('tick', 1);
    off();
    emitter.emit('tick', 2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(1);
  });

  it('fires once-listeners a single time', () => {
    const emitter = new TypedEmitter<{ tick: number }>();
    const listener = vi.fn();
    emitter.once('tick', listener);
    emitter.emit('tick', 1);
    emitter.emit('tick', 2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(emitter.listenerCount('tick')).toBe(0);
  });

  it('isolates a throwing listener from the others', () => {
    const emitter = new TypedEmitter<{ tick: number }>();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const second = vi.fn();
    emitter.on('tick', () => {
      throw new Error('boom');
    });
    emitter.on('tick', second);
    emitter.emit('tick', 1);
    expect(second).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('drops all listeners on dispose', () => {
    const emitter = new TypedEmitter<{ tick: number }>();
    const listener = vi.fn();
    emitter.on('tick', listener);
    emitter.dispose();
    emitter.emit('tick', 1);
    expect(listener).not.toHaveBeenCalled();
    expect(emitter.listenerCount('tick')).toBe(0);
  });
});
