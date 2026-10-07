/**
 * Vitest setup for the core package.
 *
 * jsdom has no canvas, `Path2D` or `ResizeObserver`. This file installs minimal recording
 * stand-ins so modules that touch them can be unit-tested for behaviour (what was drawn,
 * which paths were built) rather than pixels. Nothing here runs in production.
 */

import { vi } from 'vitest';

/** A fake 2D context that records every call so tests can assert on drawing behaviour. */
export interface RecordingContext2D {
  readonly calls: { method: string; args: unknown[] }[];
  readonly props: Record<string, unknown>;
}

/**
 * Creates a recording stand-in for `CanvasRenderingContext2D`.
 *
 * @returns {CanvasRenderingContext2D & RecordingContext2D} A proxy that records method
 *   calls and property writes.
 */
export function createRecordingContext(): CanvasRenderingContext2D & RecordingContext2D {
  const calls: { method: string; args: unknown[] }[] = [];
  const props: Record<string, unknown> = {};
  const target = { calls, props };
  return new Proxy(target, {
    get(_obj, key: string | symbol) {
      if (key === 'calls') return calls;
      if (key === 'props') return props;
      if (typeof key === 'symbol') return undefined;
      if (key in props) return props[key];
      return (...args: unknown[]) => {
        calls.push({ method: key, args });
        if (key === 'measureText') return { width: 10 };
        return undefined;
      };
    },
    set(_obj, key: string | symbol, value: unknown) {
      if (typeof key === 'string') props[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D & RecordingContext2D;
}

const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D & RecordingContext2D>();

HTMLCanvasElement.prototype.getContext = function getContext(
  this: HTMLCanvasElement,
): CanvasRenderingContext2D | null {
  let ctx = contexts.get(this);
  if (!ctx) {
    ctx = createRecordingContext();
    contexts.set(this, ctx);
  }
  return ctx;
} as typeof HTMLCanvasElement.prototype.getContext;

/**
 * Returns the recording context of a canvas created in a test.
 *
 * @param {HTMLCanvasElement} canvas - Canvas whose context to inspect.
 * @returns {RecordingContext2D} The recorded calls and properties.
 * @throws {Error} If the canvas has no recording context.
 */
export function recordingContextOf(canvas: HTMLCanvasElement): RecordingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No recording context');
  return ctx as unknown as RecordingContext2D;
}

/** Minimal Path2D stand-in that records the commands used to build it. */
class FakePath2D {
  readonly commands: { method: string; args: number[] }[] = [];

  moveTo(x: number, y: number): void {
    this.commands.push({ method: 'moveTo', args: [x, y] });
  }

  lineTo(x: number, y: number): void {
    this.commands.push({ method: 'lineTo', args: [x, y] });
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.commands.push({ method: 'quadraticCurveTo', args: [cpx, cpy, x, y] });
  }

  arc(x: number, y: number, r: number, start: number, end: number): void {
    this.commands.push({ method: 'arc', args: [x, y, r, start, end] });
  }

  closePath(): void {
    this.commands.push({ method: 'closePath', args: [] });
  }
}

if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as { Path2D?: unknown }).Path2D = FakePath2D;
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  };
}

if (typeof globalThis.PointerEvent === 'undefined') {
  (globalThis as { PointerEvent?: unknown }).PointerEvent = class extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly pressure: number;
    readonly isPrimary: boolean;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
      this.pressure = init.pressure ?? 0.5;
      this.isPrimary = init.isPrimary ?? true;
    }
  };
}

if (typeof HTMLElement.prototype.setPointerCapture !== 'function') {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
}
