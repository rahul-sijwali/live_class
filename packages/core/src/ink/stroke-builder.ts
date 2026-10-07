/**
 * Collects pointer samples into a finished `StrokeRecord`.
 *
 * Owns: the life of one stroke from pointer-down to pointer-up: jitter filtering,
 * point-count limits, simplification and bounding box. Does not own rendering, syncing or
 * permissions. Invariant 2: the committed record is simplified, so the shared document
 * stays small.
 */

import {
  asStrokeId,
  asUserId,
  MAX_STROKE_POINTS,
  newId,
  POINT_STRIDE,
  STROKE_MIN_POINT_DISTANCE_UNITS,
  STROKE_SIMPLIFY_TOLERANCE_UNITS,
  type StrokeRecord,
  type StrokeStyle,
  type UserId,
} from '@live-class/shared';

import { computeBBox, distance, pointCount, simplifyPoints, type StrokePoint } from './points.js';

/** Tunables for a `StrokeBuilder`; defaults come from shared constants. */
export interface StrokeBuilderOptions {
  /** Points closer than this to the previous kept point are dropped (sheet units). */
  readonly minPointDistanceUnits?: number;
  /** Simplification tolerance applied on `end()` (sheet units). */
  readonly simplifyToleranceUnits?: number;
  /** Hard cap on points in the committed record. */
  readonly maxPoints?: number;
  /** Clock, injectable for tests. Returns epoch milliseconds. */
  readonly now?: () => number;
  /** Id factory, injectable for tests. */
  readonly createId?: () => string;
}

/**
 * Builds one stroke at a time from raw pointer positions in sheet units.
 *
 * @example
 *   builder.begin(style, authorId, firstPoint);
 *   builder.addPoint(nextPoint);
 *   const record = builder.end();
 */
export class StrokeBuilder {
  private readonly minPointDistanceUnits: number;
  private readonly simplifyToleranceUnits: number;
  private readonly maxPoints: number;
  private readonly now: () => number;
  private readonly createId: () => string;
  private raw: number[] = [];
  private activeStyle: StrokeStyle | null = null;
  private authorId: UserId | null = null;
  private startedAt = 0;

  /**
   * Creates a builder.
   *
   * @param {StrokeBuilderOptions} options - Optional tunables and injectable clock/id.
   */
  constructor(options: StrokeBuilderOptions = {}) {
    this.minPointDistanceUnits = options.minPointDistanceUnits ?? STROKE_MIN_POINT_DISTANCE_UNITS;
    this.simplifyToleranceUnits = options.simplifyToleranceUnits ?? STROKE_SIMPLIFY_TOLERANCE_UNITS;
    this.maxPoints = options.maxPoints ?? MAX_STROKE_POINTS;
    this.now = options.now ?? (() => Date.now());
    this.createId = options.createId ?? newId;
  }

  /**
   * Whether a stroke is in progress.
   *
   * @returns {boolean} True between `begin()` and `end()`/`cancel()`.
   */
  get isActive(): boolean {
    return this.activeStyle !== null;
  }

  /**
   * The style of the stroke in progress.
   *
   * @returns {StrokeStyle | null} Style, or null when idle.
   */
  get style(): StrokeStyle | null {
    return this.activeStyle;
  }

  /**
   * Raw points of the stroke in progress, for live rendering and awareness streaming.
   *
   * @returns {readonly number[]} Flat `[x, y, pressure, …]` array (live reference; do not
   *   mutate).
   */
  get points(): readonly number[] {
    return this.raw;
  }

  /**
   * Starts a stroke.
   *
   * @param {StrokeStyle} style - Tool, colour and width.
   * @param {UserId} authorId - The drawing user.
   * @param {StrokePoint} point - First point in sheet units.
   * @returns {void} Nothing.
   * @throws {Error} If a stroke is already in progress.
   */
  begin(style: StrokeStyle, authorId: UserId, point: StrokePoint): void {
    if (this.activeStyle) throw new Error('StrokeBuilder.begin called while a stroke is active');
    this.activeStyle = style;
    this.authorId = authorId;
    this.startedAt = this.now();
    this.raw = [point.x, point.y, clampPressure(point.pressure)];
  }

  /**
   * Adds a point to the stroke in progress. Points too close to the previous kept point
   * are ignored (pointer jitter). When the raw buffer grows past twice the cap it is
   * simplified in place so memory stays bounded on very long strokes.
   *
   * @param {StrokePoint} point - Point in sheet units.
   * @returns {boolean} True if the point was kept.
   * @throws {Error} If no stroke is in progress.
   */
  addPoint(point: StrokePoint): boolean {
    if (!this.activeStyle) throw new Error('StrokeBuilder.addPoint called with no active stroke');
    const count = pointCount(this.raw);
    const lastX = this.raw[(count - 1) * POINT_STRIDE] ?? 0;
    const lastY = this.raw[(count - 1) * POINT_STRIDE + 1] ?? 0;
    if (distance(lastX, lastY, point.x, point.y) < this.minPointDistanceUnits) return false;
    this.raw.push(point.x, point.y, clampPressure(point.pressure));
    if (count + 1 > this.maxPoints * 2) {
      this.raw = simplifyPoints(this.raw, this.simplifyToleranceUnits);
    }
    return true;
  }

  /**
   * Finishes the stroke and returns the record to commit.
   *
   * @returns {StrokeRecord} Simplified, capped and bounded stroke record.
   * @throws {Error} If no stroke is in progress.
   */
  end(): StrokeRecord {
    if (!this.activeStyle || !this.authorId) {
      throw new Error('StrokeBuilder.end called with no active stroke');
    }
    let points = simplifyPoints(this.raw, this.simplifyToleranceUnits);
    // Raise the tolerance until the cap holds; a few iterations suffice in practice.
    let tolerance = this.simplifyToleranceUnits;
    while (pointCount(points) > this.maxPoints) {
      tolerance = tolerance === 0 ? 0.5 : tolerance * 2;
      points = simplifyPoints(points, tolerance);
    }
    const record: StrokeRecord = {
      id: asStrokeId(this.createId()),
      authorId: asUserId(this.authorId),
      tool: this.activeStyle.tool,
      color: this.activeStyle.color,
      sizeUnits: this.activeStyle.sizeUnits,
      points,
      bbox: computeBBox(points, this.activeStyle.sizeUnits),
      createdAt: this.startedAt,
    };
    this.reset();
    return record;
  }

  /**
   * Abandons the stroke in progress (for example on `pointercancel`).
   *
   * @returns {void} Nothing.
   */
  cancel(): void {
    this.reset();
  }

  /**
   * Clears all in-progress state.
   *
   * @returns {void} Nothing.
   */
  private reset(): void {
    this.raw = [];
    this.activeStyle = null;
    this.authorId = null;
    this.startedAt = 0;
  }
}

/**
 * Clamps pressure into `[0, 1]`, substituting `0.5` for missing or invalid values.
 *
 * @param {number} pressure - Raw pressure from the pointer event.
 * @returns {number} Pressure in `[0, 1]`.
 */
function clampPressure(pressure: number): number {
  if (!Number.isFinite(pressure)) return 0.5;
  return Math.min(1, Math.max(0, pressure));
}
