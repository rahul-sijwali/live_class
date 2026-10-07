/**
 * Vitest setup for the React package: jest-dom matchers and the same browser stand-ins the
 * core package uses (canvas, Path2D, ResizeObserver, PointerEvent).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

HTMLCanvasElement.prototype.getContext = function getContext(): CanvasRenderingContext2D | null {
  return new Proxy({} as CanvasRenderingContext2D, {
    get: (_target, key) =>
      typeof key === 'string' && key !== 'then' ? () => undefined : undefined,
    set: () => true,
  });
} as typeof HTMLCanvasElement.prototype.getContext;

if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as { Path2D?: unknown }).Path2D = class {
    moveTo(): void {
      /* no-op */
    }
    lineTo(): void {
      /* no-op */
    }
    quadraticCurveTo(): void {
      /* no-op */
    }
    arc(): void {
      /* no-op */
    }
    closePath(): void {
      /* no-op */
    }
  };
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  };
}

if (typeof HTMLElement.prototype.setPointerCapture !== 'function') {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
}

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    setTimeout(() => callback(performance.now()), 16) as unknown as number;
  globalThis.cancelAnimationFrame = (handle: number): void => {
    clearTimeout(handle);
  };
}
