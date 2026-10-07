import { asStrokeId, asUserId, newId, type StrokeRecord } from '@live-class/shared';
import { describe, expect, it } from 'vitest';

import { computeBBox } from './points.js';
import { findStrokesAt, hitTestStroke } from './hit-test.js';

/**
 * Builds a stroke from flat points for tests.
 *
 * @param {number[]} points - Flat points.
 * @param {number} sizeUnits - Width.
 * @returns {StrokeRecord} The stroke.
 */
function make(points: number[], sizeUnits = 2): StrokeRecord {
  return {
    id: asStrokeId(newId()),
    authorId: asUserId(newId()),
    tool: 'pen',
    color: '#000000',
    sizeUnits,
    points,
    bbox: computeBBox(points, sizeUnits),
    createdAt: 1,
  };
}

describe('hitTestStroke', () => {
  const horizontal = make([0, 0, 0.5, 100, 0, 0.5]);

  it('hits points near the line and misses far ones', () => {
    expect(hitTestStroke(horizontal, 50, 3, 4)).toBe(true);
    expect(hitTestStroke(horizontal, 50, 6, 4)).toBe(false); // 6 > 4 + 1
    expect(hitTestStroke(horizontal, 200, 0, 4)).toBe(false);
  });

  it('includes half the stroke width in the reach', () => {
    const thick = make([0, 0, 0.5, 100, 0, 0.5], 20);
    expect(hitTestStroke(thick, 50, 10.5, 1)).toBe(true); // 10.5 ≤ 1 + 20 / 2
    expect(hitTestStroke(thick, 50, 11.5, 1)).toBe(false);
  });

  it('handles a single-point stroke', () => {
    const dot = make([10, 10, 0.5], 2);
    expect(hitTestStroke(dot, 12, 10, 1.5)).toBe(true);
    expect(hitTestStroke(dot, 20, 10, 1.5)).toBe(false);
  });
});

describe('findStrokesAt', () => {
  it('returns every touched stroke in order', () => {
    const a = make([0, 0, 0.5, 100, 0, 0.5]);
    const b = make([0, 50, 0.5, 100, 50, 0.5]);
    const c = make([50, -100, 0.5, 50, 100, 0.5]);
    expect(findStrokesAt([a, b, c], 50, 0, 2)).toEqual([a.id, c.id]);
    expect(findStrokesAt([a, b, c], 500, 500, 2)).toEqual([]);
  });
});
