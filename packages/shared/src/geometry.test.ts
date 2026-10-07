import { describe, expect, it } from 'vitest';

import { LOGICAL_WIDTH, MAX_SHEET_HEIGHT_UNITS } from './constants.js';
import {
  computeSheetGeometry,
  computeTextSheetGeometry,
  extendSheetHeight,
  pageHeightUnits,
  withLiveHeight,
} from './geometry.js';

describe('pageHeightUnits', () => {
  it('scales the page to the logical width', () => {
    expect(pageHeightUnits({ width: 2000, height: 1000 })).toBe(500);
    expect(pageHeightUnits({ width: 500, height: 1000 })).toBe(2000);
  });

  it('rejects non-positive or non-finite sizes', () => {
    expect(() => pageHeightUnits({ width: 0, height: 10 })).toThrow(RangeError);
    expect(() => pageHeightUnits({ width: 10, height: Number.NaN })).toThrow(RangeError);
    expect(() => pageHeightUnits({ width: Number.POSITIVE_INFINITY, height: 10 })).toThrow(
      RangeError,
    );
  });
});

describe('computeSheetGeometry', () => {
  it('places the content between the margins at full width', () => {
    const geometry = computeSheetGeometry(
      { width: 1920, height: 1080 },
      { topUnits: 100, bottomUnits: 300 },
    );
    expect(geometry.widthUnits).toBe(LOGICAL_WIDTH);
    expect(geometry.assetBox).toEqual({ x: 0, y: 100, w: 1000, h: 562.5 });
    expect(geometry.heightUnits).toBe(100 + 562.5 + 300);
  });

  it('uses the default margins', () => {
    const geometry = computeSheetGeometry({ width: 1000, height: 1000 });
    expect(geometry.assetBox.y).toBe(120);
    expect(geometry.heightUnits).toBe(120 + 1000 + 600);
  });

  it('clamps very tall sheets', () => {
    const geometry = computeSheetGeometry({ width: 1, height: 100 });
    expect(geometry.heightUnits).toBe(MAX_SHEET_HEIGHT_UNITS);
  });

  it('rejects negative margins', () => {
    expect(() =>
      computeSheetGeometry({ width: 1, height: 1 }, { topUnits: -1, bottomUnits: 0 }),
    ).toThrow(RangeError);
  });
});

describe('computeTextSheetGeometry', () => {
  it('treats the measured height as the content height', () => {
    const geometry = computeTextSheetGeometry(250, { topUnits: 50, bottomUnits: 50 });
    expect(geometry.assetBox).toEqual({ x: 0, y: 50, w: 1000, h: 250 });
    expect(geometry.heightUnits).toBe(350);
  });

  it('rejects a zero height', () => {
    expect(() => computeTextSheetGeometry(0)).toThrow(RangeError);
  });
});

describe('extendSheetHeight', () => {
  const base = computeSheetGeometry({ width: 1000, height: 500 });

  it('adds space below and keeps the content box', () => {
    const extended = extendSheetHeight(base, 400);
    expect(extended.heightUnits).toBe(base.heightUnits + 400);
    expect(extended.assetBox).toEqual(base.assetBox);
    expect(base.heightUnits).toBe(1220); // input not mutated
  });

  it('clamps at the maximum height', () => {
    expect(extendSheetHeight(base, 1e9).heightUnits).toBe(MAX_SHEET_HEIGHT_UNITS);
  });

  it('rejects negative additions', () => {
    expect(() => extendSheetHeight(base, -1)).toThrow(RangeError);
  });
});

describe('withLiveHeight', () => {
  const base = computeSheetGeometry({ width: 1000, height: 500 });

  it('applies a larger live height', () => {
    expect(withLiveHeight(base, 3000).heightUnits).toBe(3000);
  });

  it('never cuts off the content', () => {
    expect(withLiveHeight(base, 10).heightUnits).toBe(base.assetBox.y + base.assetBox.h);
  });

  it('ignores non-finite values', () => {
    expect(withLiveHeight(base, Number.NaN).heightUnits).toBe(base.heightUnits);
  });
});
