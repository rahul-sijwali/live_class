/**
 * Stroke record as stored in a sheet's realtime document.
 *
 * Owns: the exact shape of a finished stroke. Records are immutable: editing means
 * deleting and re-adding. Points are a flat array `[x0, y0, p0, x1, y1, p1, …]` in sheet
 * units with pressure in `[0, 1]`; the flat layout keeps the document compact.
 */

import { z } from 'zod';

import { MAX_STROKE_POINTS, MAX_STROKE_SIZE_UNITS, MIN_STROKE_SIZE_UNITS } from '../constants.js';
import { StrokeIdSchema, UserIdSchema } from '../ids.js';
import { BBoxSchema, HexColorSchema } from './common.js';

/** Drawing tools that produce a stroke. The eraser is a tool but produces none. */
export const TOOL_KINDS = ['pen', 'highlighter'] as const;

/** Schema for a stroke-producing tool. */
export const ToolKindSchema = z.enum(TOOL_KINDS);

/** Stroke-producing tool. */
export type ToolKind = z.infer<typeof ToolKindSchema>;

/** Number of values per point in the flat points array (x, y, pressure). */
export const POINT_STRIDE = 3;

/** Flat `[x, y, pressure, …]` array with at least one point. */
export const StrokePointsSchema = z
  .array(z.number())
  .min(POINT_STRIDE)
  .max(MAX_STROKE_POINTS * POINT_STRIDE)
  .refine(
    (points) => points.length % POINT_STRIDE === 0,
    'Points must come in x, y, pressure triples',
  );

/** A finished stroke. */
export const StrokeRecordSchema = z.object({
  id: StrokeIdSchema,
  authorId: UserIdSchema,
  tool: ToolKindSchema,
  color: HexColorSchema,
  /** Nominal width in sheet units; pressure modulates it. */
  sizeUnits: z.number().min(MIN_STROKE_SIZE_UNITS).max(MAX_STROKE_SIZE_UNITS),
  points: StrokePointsSchema,
  /** Bounds including the stroke width, so hit tests can skip far-away strokes. */
  bbox: BBoxSchema,
  /** Creation time as epoch milliseconds; sorts strokes for deterministic rendering. */
  createdAt: z.int().nonnegative(),
});

/** Parsed stroke record. */
export type StrokeRecord = z.infer<typeof StrokeRecordSchema>;

/** Pen style chosen in the toolbar. */
export const StrokeStyleSchema = z.object({
  tool: ToolKindSchema,
  color: HexColorSchema,
  sizeUnits: z.number().min(MIN_STROKE_SIZE_UNITS).max(MAX_STROKE_SIZE_UNITS),
});

/** Pen style. */
export type StrokeStyle = z.infer<typeof StrokeStyleSchema>;
