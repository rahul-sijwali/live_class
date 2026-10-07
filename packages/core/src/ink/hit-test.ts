/**
 * Eraser hit-testing against committed strokes.
 *
 * Owns: "is this point on that stroke?" Does not own permissions (who may erase) or
 * deletion (the sheet document).
 */

import { POINT_STRIDE, type StrokeId, type StrokeRecord } from '@live-class/shared';

import { bboxContains, distance, distanceToSegment, pointCount } from './points.js';

/**
 * Whether a point lies within `radiusUnits` of a stroke's ink.
 *
 * @param {StrokeRecord} stroke - Committed stroke.
 * @param {number} x - Test point x in sheet units.
 * @param {number} y - Test point y in sheet units.
 * @param {number} radiusUnits - Eraser radius in sheet units.
 * @returns {boolean} True if the eraser touches the stroke.
 */
export function hitTestStroke(
  stroke: StrokeRecord,
  x: number,
  y: number,
  radiusUnits: number,
): boolean {
  if (!bboxContains(stroke.bbox, x, y, radiusUnits)) return false;
  const reach = radiusUnits + stroke.sizeUnits / 2;
  const count = pointCount(stroke.points);
  const points = stroke.points;
  if (count === 1) {
    return distance(x, y, points[0] ?? 0, points[1] ?? 0) <= reach;
  }
  for (let i = 0; i < count - 1; i += 1) {
    const offset = i * POINT_STRIDE;
    const ax = points[offset] ?? 0;
    const ay = points[offset + 1] ?? 0;
    const bx = points[offset + POINT_STRIDE] ?? 0;
    const by = points[offset + POINT_STRIDE + 1] ?? 0;
    if (distanceToSegment(x, y, ax, ay, bx, by) <= reach) return true;
  }
  return false;
}

/**
 * Finds every stroke the eraser touches at a point.
 *
 * @param {Iterable<StrokeRecord>} strokes - Candidate strokes.
 * @param {number} x - Eraser x in sheet units.
 * @param {number} y - Eraser y in sheet units.
 * @param {number} radiusUnits - Eraser radius in sheet units.
 * @returns {StrokeId[]} Ids of touched strokes, in iteration order.
 */
export function findStrokesAt(
  strokes: Iterable<StrokeRecord>,
  x: number,
  y: number,
  radiusUnits: number,
): StrokeId[] {
  const hits: StrokeId[] = [];
  for (const stroke of strokes) {
    if (hitTestStroke(stroke, x, y, radiusUnits)) hits.push(stroke.id);
  }
  return hits;
}
