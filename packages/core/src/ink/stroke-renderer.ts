/**
 * Turns strokes into pixels on a 2D canvas.
 *
 * Owns: the perfect-freehand outline, the `Path2D` cache per committed stroke, and the
 * fill style per tool. Does not own canvases or their sizing (`InkLayer`), nor coordinate
 * conversion: callers pass a context already scaled so that one unit equals one sheet unit.
 */

import { getStroke, type StrokeOptions } from 'perfect-freehand';

import { type StrokeId, type StrokeRecord, type StrokeStyle } from '@live-class/shared';

import { pointCount, toTriples } from './points.js';

/** Opacity used for the highlighter so the question stays readable underneath. */
export const HIGHLIGHTER_ALPHA = 0.35;

/** Default perfect-freehand settings shared by every tool. */
const BASE_OPTIONS: Omit<StrokeOptions, 'size'> = {
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.4,
  easing: (t) => t,
};

/**
 * Computes the outline polygon of a stroke with perfect-freehand.
 *
 * @param {readonly number[]} points - Flat `[x, y, pressure, …]` array in sheet units.
 * @param {StrokeStyle} style - Tool, colour and width.
 * @param {boolean} complete - True for a finished stroke (adds the end cap).
 * @returns {number[][]} Outline as `[x, y]` pairs in sheet units; empty for no points.
 */
export function strokeOutline(
  points: readonly number[],
  style: StrokeStyle,
  complete: boolean,
): number[][] {
  if (pointCount(points) === 0) return [];
  const triples = toTriples(points);
  // Mice report a constant 0.5; let perfect-freehand fake pressure from speed for them.
  const simulatePressure = triples.every((p) => p[2] === 0.5);
  const options: StrokeOptions = {
    ...BASE_OPTIONS,
    size: style.sizeUnits,
    simulatePressure,
    last: complete,
    // Highlighters are flat: no thinning, square-ish caps.
    ...(style.tool === 'highlighter'
      ? { thinning: 0, start: { cap: true }, end: { cap: true } }
      : {}),
  };
  return getStroke(triples, options);
}

/**
 * Builds a `Path2D` from an outline using quadratic curves between midpoints, which gives a
 * smooth closed shape without visible corners.
 *
 * @param {number[][]} outline - Outline as `[x, y]` pairs.
 * @returns {Path2D} Closed path; empty when the outline has fewer than two points.
 */
export function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D();
  const first = outline[0];
  if (!first || outline.length < 2) {
    if (first) path.arc(first[0] ?? 0, first[1] ?? 0, 0.5, 0, Math.PI * 2);
    return path;
  }
  path.moveTo(first[0] ?? 0, first[1] ?? 0);
  for (let i = 0; i < outline.length; i += 1) {
    const current = outline[i] ?? first;
    const next = outline[(i + 1) % outline.length] ?? first;
    const cx = current[0] ?? 0;
    const cy = current[1] ?? 0;
    path.quadraticCurveTo(cx, cy, (cx + (next[0] ?? 0)) / 2, (cy + (next[1] ?? 0)) / 2);
  }
  path.closePath();
  return path;
}

/**
 * Applies a tool's fill style to a context.
 *
 * @param {CanvasRenderingContext2D} ctx - Target context.
 * @param {StrokeStyle} style - Tool and colour.
 * @returns {void} Nothing.
 */
export function applyStyle(ctx: CanvasRenderingContext2D, style: StrokeStyle): void {
  ctx.fillStyle = style.color;
  ctx.globalAlpha = style.tool === 'highlighter' ? HIGHLIGHTER_ALPHA : 1;
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Renders strokes onto canvases, caching the path of each committed stroke.
 *
 * @remarks The cache is bounded; when full, the oldest entries are evicted. A stroke whose
 * record changes identity must be invalidated by id (records are immutable, so this only
 * happens on delete).
 */
export class StrokeRenderer {
  private readonly cache = new Map<StrokeId, Path2D>();
  private readonly cacheLimit: number;

  /**
   * Creates a renderer.
   *
   * @param {{ cacheLimit?: number }} options - `cacheLimit` bounds the number of cached
   *   paths (default 10 000).
   */
  constructor(options: { readonly cacheLimit?: number } = {}) {
    this.cacheLimit = options.cacheLimit ?? 10_000;
  }

  /**
   * Returns the cached path for a committed stroke, building it on first use.
   *
   * @param {StrokeRecord} stroke - Committed stroke.
   * @returns {Path2D} Path in sheet units.
   */
  pathFor(stroke: StrokeRecord): Path2D {
    const cached = this.cache.get(stroke.id);
    if (cached) return cached;
    const path = outlineToPath(strokeOutline(stroke.points, stroke, true));
    if (this.cache.size >= this.cacheLimit) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(stroke.id, path);
    return path;
  }

  /**
   * Drops the cached path of a stroke (call when the stroke is deleted).
   *
   * @param {StrokeId} id - Identifier of the stroke whose path should be forgotten.
   * @returns {void} Nothing.
   */
  invalidate(id: StrokeId): void {
    this.cache.delete(id);
  }

  /**
   * Drops every cached path.
   *
   * @returns {void} Nothing.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Number of cached paths; useful for tests and diagnostics.
   *
   * @returns {number} How many stroke paths are held in memory right now.
   */
  get cacheSize(): number {
    return this.cache.size;
  }

  /**
   * Draws one committed stroke.
   *
   * @param {CanvasRenderingContext2D} ctx - Context scaled to sheet units.
   * @param {StrokeRecord} stroke - Committed stroke.
   * @returns {void} Nothing.
   */
  drawStroke(ctx: CanvasRenderingContext2D, stroke: StrokeRecord): void {
    applyStyle(ctx, stroke);
    ctx.fill(this.pathFor(stroke));
  }

  /**
   * Draws every stroke in order.
   *
   * @param {CanvasRenderingContext2D} ctx - Context scaled to sheet units.
   * @param {Iterable<StrokeRecord>} strokes - Strokes in render order.
   * @returns {void} Nothing.
   */
  drawAll(ctx: CanvasRenderingContext2D, strokes: Iterable<StrokeRecord>): void {
    for (const stroke of strokes) this.drawStroke(ctx, stroke);
  }

  /**
   * Draws an in-progress stroke (local or a peer's) without caching.
   *
   * @param {CanvasRenderingContext2D} ctx - Context scaled to sheet units.
   * @param {readonly number[]} points - Flat `[x, y, pressure, …]` array so far.
   * @param {StrokeStyle} style - Tool, colour and width.
   * @returns {void} Nothing.
   */
  drawLive(ctx: CanvasRenderingContext2D, points: readonly number[], style: StrokeStyle): void {
    if (pointCount(points) === 0) return;
    applyStyle(ctx, style);
    ctx.fill(outlineToPath(strokeOutline(points, style, false)));
  }
}
