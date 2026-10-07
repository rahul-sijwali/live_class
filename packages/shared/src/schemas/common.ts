/**
 * Small schemas reused by the other schema modules.
 *
 * Owns: primitive formats (ISO timestamps, colours, tags). Does not own domain objects.
 */

import { z } from 'zod';

import { MAX_TAG_LENGTH } from '../constants.js';

/** ISO 8601 timestamp with offset, the only date format used over the wire. */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

/** Six-digit hex colour, lower or upper case. */
export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb colour');

/**
 * A question tag: letters, digits, spaces, hyphens and underscores. Trimmed and lower-cased
 * so "Algebra " and "algebra" are the same tag.
 */
export const TagSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_TAG_LENGTH)
  .regex(/^[\p{L}\p{N} _-]+$/u, 'Tags may contain letters, digits, spaces, - and _')
  .transform((value) => value.toLowerCase());

/** Axis-aligned bounding box in sheet units. */
export const BBoxSchema = z.object({
  minX: z.number(),
  minY: z.number(),
  maxX: z.number(),
  maxY: z.number(),
});

/** Parsed bounding box. */
export type BBox = z.infer<typeof BBoxSchema>;

/** A response that only confirms success. */
export const OkResponseSchema = z.object({ ok: z.literal(true) });
