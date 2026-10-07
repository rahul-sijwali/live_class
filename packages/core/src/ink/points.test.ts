import { describe, expect, it } from 'vitest';

import {
  bboxContains,
  computeBBox,
  distanceToSegment,
  pointAt,
  pointCount,
  simplifyPoints,
  toTriples,
} from './points.js';

describe('pointCount / pointAt', () => {
  it('counts complete triples only', () => {
    expect(pointCount([])).toBe(0);
    expect(pointCount([1, 2, 3])).toBe(1);
    expect(pointCount([1, 2, 3, 4])).toBe(1);
  });

  it('reads a point and rejects out-of-range indexes', () => {
    expect(pointAt([1, 2, 0.3, 4, 5, 0.6], 1)).toEqual({ x: 4, y: 5, pressure: 0.6 });
    expect(() => pointAt([1, 2, 0.3], 1)).toThrow(RangeError);
  });
});

describe('distanceToSegment', () => {
  it('measures perpendicular distance inside the segment', () => {
    expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
  });

  it('measures distance to the nearest end outside the segment', () => {
    expect(distanceToSegment(-3, 4, 0, 0, 10, 0)).toBe(5);
  });

  it('handles a degenerate segment', () => {
    expect(distanceToSegment(3, 4, 0, 0, 0, 0)).toBe(5);
  });
});

describe('simplifyPoints', () => {
  it('removes collinear points and keeps the ends', () => {
    const line = [0, 0, 0.5, 1, 0, 0.5, 2, 0, 0.5, 3, 0, 0.5];
    expect(simplifyPoints(line, 0.1)).toEqual([0, 0, 0.5, 3, 0, 0.5]);
  });

  it('keeps a point that deviates more than the tolerance, with its pressure', () => {
    const bent = [0, 0, 0.1, 5, 2, 0.9, 10, 0, 0.3];
    expect(simplifyPoints(bent, 1)).toEqual(bent);
    expect(simplifyPoints(bent, 3)).toEqual([0, 0, 0.1, 10, 0, 0.3]);
  });

  it('returns a copy for short strokes and zero tolerance', () => {
    const two = [0, 0, 0.5, 1, 1, 0.5];
    const result = simplifyPoints(two, 2);
    expect(result).toEqual(two);
    expect(result).not.toBe(two);
    expect(simplifyPoints([0, 0, 0.5, 1, 0, 0.5, 2, 0, 0.5], 0)).toHaveLength(9);
  });

  it('handles very long strokes without recursion', () => {
    const points: number[] = [];
    for (let i = 0; i < 50_000; i += 1) points.push(i, Math.sin(i / 50) * 10, 0.5);
    const simplified = simplifyPoints(points, 0.5);
    expect(pointCount(simplified)).toBeLessThan(50_000);
    expect(pointCount(simplified)).toBeGreaterThan(100);
  });

  it('rejects a negative tolerance', () => {
    expect(() => simplifyPoints([0, 0, 0.5], -1)).toThrow(RangeError);
  });
});

describe('computeBBox / bboxContains', () => {
  it('pads the bounds by half the stroke width', () => {
    const bbox = computeBBox([0, 0, 0.5, 10, 20, 0.5], 4);
    expect(bbox).toEqual({ minX: -2, minY: -2, maxX: 12, maxY: 22 });
    expect(bboxContains(bbox, 13, 10, 1)).toBe(true);
    expect(bboxContains(bbox, 14, 10, 1)).toBe(false);
  });

  it('rejects an empty stroke', () => {
    expect(() => computeBBox([], 1)).toThrow(RangeError);
  });
});

describe('toTriples', () => {
  it('converts to nested triples', () => {
    expect(toTriples([1, 2, 0.5, 3, 4, 1])).toEqual([
      [1, 2, 0.5],
      [3, 4, 1],
    ]);
  });
});
