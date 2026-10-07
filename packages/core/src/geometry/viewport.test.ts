import { describe, expect, it, vi } from 'vitest';

import { fitToWidthScale, toScreenPoint, toSheetPoint, Viewport } from './viewport.js';

const state = { scale: 0.5, dpr: 2, originPx: { x: 100, y: 50 } };

describe('toSheetPoint / toScreenPoint', () => {
  it('converts client pixels to sheet units using origin and scale', () => {
    expect(toSheetPoint(100, 50, state)).toEqual({ x: 0, y: 0 });
    expect(toSheetPoint(600, 250, state)).toEqual({ x: 1000, y: 400 });
  });

  it('round-trips', () => {
    const p = { x: 123.4, y: 567.8 };
    const screen = toScreenPoint(p, state);
    const back = toSheetPoint(screen.x, screen.y, state);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it('returns values outside [0, 1000] in the side margin', () => {
    expect(toSheetPoint(50, 50, state).x).toBeLessThan(0);
  });

  it('rejects invalid scales', () => {
    expect(() => toSheetPoint(0, 0, { ...state, scale: 0 })).toThrow(RangeError);
    expect(() => toScreenPoint({ x: 0, y: 0 }, { ...state, scale: Number.NaN })).toThrow(
      RangeError,
    );
  });
});

describe('fitToWidthScale', () => {
  it('maps the container width onto the logical width', () => {
    expect(fitToWidthScale(500)).toBe(0.5);
    expect(fitToWidthScale(2000)).toBe(2);
  });

  it('never returns zero for a hidden container', () => {
    expect(fitToWidthScale(0)).toBeGreaterThan(0);
    expect(fitToWidthScale(Number.NaN)).toBeGreaterThan(0);
  });
});

/**
 * Builds the three elements the viewport manages, with a fixed container width.
 *
 * @param {number} width - Container client width in CSS px.
 * @returns {{ container: HTMLElement; stage: HTMLElement; sheet: HTMLElement }} Elements.
 */
function makeElements(width: number) {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: width, configurable: true });
  const stage = document.createElement('div');
  const sheet = document.createElement('div');
  stage.appendChild(sheet);
  container.appendChild(stage);
  document.body.appendChild(container);
  return { container, stage, sheet };
}

describe('Viewport', () => {
  it('scales the sheet to the container width and sizes the stage', () => {
    const elements = makeElements(500);
    const viewport = new Viewport(elements);
    viewport.setSheetHeightUnits(2000);
    expect(elements.sheet.style.transform).toBe('scale(0.5)');
    expect(elements.sheet.style.width).toBe('1000px');
    expect(elements.stage.style.width).toBe('500px');
    expect(elements.stage.style.height).toBe('1000px');
    viewport.dispose();
  });

  it('emits change events and stops after dispose', () => {
    const elements = makeElements(1000);
    const viewport = new Viewport(elements);
    const listener = vi.fn();
    viewport.onChange(listener);
    viewport.setSheetHeightUnits(300);
    expect(listener).toHaveBeenCalledTimes(1);
    viewport.dispose();
    viewport.fitToWidth();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-positive height', () => {
    const viewport = new Viewport(makeElements(1000));
    expect(() => viewport.setSheetHeightUnits(0)).toThrow(RangeError);
    viewport.dispose();
  });

  it('uses the live bounding rect as origin', () => {
    const elements = makeElements(1000);
    elements.sheet.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 1000, height: 100 }) as DOMRect;
    const viewport = new Viewport(elements);
    expect(viewport.toSheetPoint(110, 220)).toEqual({ x: 100, y: 200 });
    viewport.dispose();
  });
});

describe('Viewport extras', () => {
  it('exposes the current scale and height without touching the DOM', () => {
    const elements = makeElements(500);
    const viewport = new Viewport(elements);
    viewport.setSheetHeightUnits(800);
    expect(viewport.currentScale).toBe(0.5);
    expect(viewport.sheetHeightUnits).toBe(800);
    viewport.dispose();
  });
});
