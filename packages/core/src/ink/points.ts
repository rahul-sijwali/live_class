/**
 * Pure maths over flat stroke point arrays `[x, y, pressure, …]` in sheet units.
 *
 * Owns: simplification, bounding boxes and distance helpers. No DOM, no state. Everything
 * here is hot-path code for drawing, so functions avoid allocating per point where they can.
 */

import { type BBox, POINT_STRIDE } from '@live-class/shared';

/** One stroke point. */
export interface StrokePoint {
  readonly x: number;
  readonly y: number;
  /** Pen pressure in `[0, 1]`; `0.5` for devices without pressure. */
  readonly pressure: number;
}

/**
 * Number of points in a flat array.
 *
 * @param {readonly number[]} points - Flat `[x, y, pressure, …]` array.
 * @returns {number} Point count (array length divided by the stride).
 */
export function pointCount(points: readonly number[]): number {
  return Math.floor(points.length / POINT_STRIDE);
}

/**
 * Reads one point out of a flat array.
 *
 * @param {readonly number[]} points - Flat `[x, y, pressure, …]` array.
 * @param {number} index - Zero-based position of the wanted point within the array.
 * @returns {StrokePoint} The x, y and pressure at that position.
 * @throws {RangeError} If `index` is out of range.
 */
export function pointAt(points: readonly number[], index: number): StrokePoint {
  const offset = index * POINT_STRIDE;
  const x = points[offset];
  const y = points[offset + 1];
  const pressure = points[offset + 2];
  if (x === undefined || y === undefined || pressure === undefined) {
    throw new RangeError(`Point index ${index} is out of range`);
  }
  return { x, y, pressure };
}

/**
 * Euclidean distance between two points.
 *
 * @param {number} ax - X coordinate of the first point, in sheet units.
 * @param {number} ay - Y coordinate of the first point, in sheet units.
 * @param {number} bx - X coordinate of the second point, in sheet units.
 * @param {number} by - Y coordinate of the second point, in sheet units.
 * @returns {number} Straight-line distance in sheet units.
 */
export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/**
 * Shortest distance from a point to a line segment.
 *
 * @param {number} px - Point x.
 * @param {number} py - Point y.
 * @param {number} ax - Segment start x.
 * @param {number} ay - Segment start y.
 * @param {number} bx - Segment end x.
 * @param {number} by - Segment end y.
 * @returns {number} Distance from `(px, py)` to the closest point on the segment.
 */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(px, py, ax, ay);
  // Project the point onto the segment and clamp to its ends.
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return distance(px, py, ax + t * dx, ay + t * dy);
}

/**
 * Simplifies a polyline with the Ramer–Douglas–Peucker algorithm, keeping the pressure of
 * surviving points. The first and last points are always kept.
 *
 * @param {readonly number[]} points - Flat `[x, y, pressure, …]` array.
 * @param {number} toleranceUnits - Maximum deviation allowed, in sheet units; `0` keeps
 *   every point.
 * @returns {number[]} A new flat array with the surviving points in order.
 * @throws {RangeError} If `toleranceUnits` is negative or not finite.
 * @remarks Iterative (explicit stack) so very long strokes cannot overflow the call stack.
 */
export function simplifyPoints(points: readonly number[], toleranceUnits: number): number[] {
  if (!Number.isFinite(toleranceUnits) || toleranceUnits < 0) {
    throw new RangeError(`toleranceUnits must be a non-negative number, got ${toleranceUnits}`);
  }
  const count = pointCount(points);
  if (count <= 2 || toleranceUnits === 0) return points.slice(0, count * POINT_STRIDE);

  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const stack: [number, number][] = [[0, count - 1]];

  while (stack.length > 0) {
    const range = stack.pop();
    if (!range) break;
    const [start, end] = range;
    if (end - start < 2) continue;
    const ax = points[start * POINT_STRIDE] ?? 0;
    const ay = points[start * POINT_STRIDE + 1] ?? 0;
    const bx = points[end * POINT_STRIDE] ?? 0;
    const by = points[end * POINT_STRIDE + 1] ?? 0;
    let farthest = -1;
    let farthestDistance = 0;
    for (let i = start + 1; i < end; i += 1) {
      const px = points[i * POINT_STRIDE] ?? 0;
      const py = points[i * POINT_STRIDE + 1] ?? 0;
      const d = distanceToSegment(px, py, ax, ay, bx, by);
      if (d > farthestDistance) {
        farthestDistance = d;
        farthest = i;
      }
    }
    if (farthest !== -1 && farthestDistance > toleranceUnits) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }

  const result: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (keep[i] === 1) {
      const offset = i * POINT_STRIDE;
      result.push(points[offset] ?? 0, points[offset + 1] ?? 0, points[offset + 2] ?? 0);
    }
  }
  return result;
}

/**
 * Computes the bounding box of a stroke, padded by half its width so the box contains the
 * rendered ink and can be used for hit-test rejection.
 *
 * @param {readonly number[]} points - Flat `[x, y, pressure, …]` array with ≥ 1 point.
 * @param {number} sizeUnits - Stroke width in sheet units.
 * @returns {BBox} The padded bounds.
 * @throws {RangeError} If `points` holds no complete point.
 */
export function computeBBox(points: readonly number[], sizeUnits: number): BBox {
  const count = pointCount(points);
  if (count === 0) throw new RangeError('Cannot compute the bounds of an empty stroke');
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i += 1) {
    const x = points[i * POINT_STRIDE] ?? 0;
    const y = points[i * POINT_STRIDE + 1] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const pad = sizeUnits / 2;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/**
 * Whether a bounding box contains a point, after growing it by a radius.
 *
 * @param {BBox} bbox - Bounds to test.
 * @param {number} x - Point x.
 * @param {number} y - Point y.
 * @param {number} radius - Extra distance allowed around the box.
 * @returns {boolean} True if the point is inside the grown box.
 */
export function bboxContains(bbox: BBox, x: number, y: number, radius: number): boolean {
  return (
    x >= bbox.minX - radius &&
    x <= bbox.maxX + radius &&
    y >= bbox.minY - radius &&
    y <= bbox.maxY + radius
  );
}

/**
 * Converts a flat array into perfect-freehand's input format.
 *
 * @param {readonly number[]} points - Flat `[x, y, pressure, …]` array.
 * @returns {number[][]} Array of `[x, y, pressure]` triples.
 */
export function toTriples(points: readonly number[]): number[][] {
  const count = pointCount(points);
  const triples: number[][] = new Array<number[]>(count);
  for (let i = 0; i < count; i += 1) {
    const offset = i * POINT_STRIDE;
    triples[i] = [points[offset] ?? 0, points[offset + 1] ?? 0, points[offset + 2] ?? 0.5];
  }
  return triples;
}
