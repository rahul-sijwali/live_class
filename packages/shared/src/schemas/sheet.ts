/**
 * Sheet DTO and geometry.
 *
 * Owns: the shape of a sheet record and of its geometry in sheet units. The geometry is
 * computed once on the server when a sheet is created and treated as read-only afterwards,
 * except for `heightUnits`, whose live value lives in the sheet's realtime document.
 */

import { z } from 'zod';

import { LOGICAL_WIDTH, MAX_SHEET_HEIGHT_UNITS } from '../constants.js';
import { QuestionIdSchema, SessionIdSchema, SheetIdSchema } from '../ids.js';
import { IsoDateTimeSchema } from './common.js';

/** Rectangle in sheet units. */
export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
});

/** Parsed rectangle. */
export type Rect = z.infer<typeof RectSchema>;

/** Geometry of a sheet in sheet units (invariant 1: the width is always LOGICAL_WIDTH). */
export const SheetGeometrySchema = z.object({
  widthUnits: z.literal(LOGICAL_WIDTH),
  heightUnits: z.number().positive().max(MAX_SHEET_HEIGHT_UNITS),
  /** Where the question content sits; ink may land anywhere on the sheet. */
  assetBox: RectSchema,
});

/** Parsed sheet geometry. */
export type SheetGeometry = z.infer<typeof SheetGeometrySchema>;

/** A sheet: one page of one question inside one session. */
export const SheetSchema = z.object({
  id: SheetIdSchema,
  sessionId: SessionIdSchema,
  questionId: QuestionIdSchema,
  /** Zero-based page of the question this sheet shows. */
  pageIndex: z.int().min(0),
  /** Zero-based order of the sheet inside the session. */
  position: z.int().min(0),
  geometry: SheetGeometrySchema,
  createdAt: IsoDateTimeSchema,
});

/** Parsed sheet. */
export type Sheet = z.infer<typeof SheetSchema>;
