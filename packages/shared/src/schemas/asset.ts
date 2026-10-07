/**
 * Uploaded file (asset) DTO.
 *
 * Owns: the shape of an asset as returned by the API. Assets are immutable once created
 * (invariant 5); a changed file is a new asset.
 */

import { z } from 'zod';

import { ALLOWED_UPLOAD_MIME_TYPES } from '../constants.js';
import { AssetIdSchema } from '../ids.js';
import { IsoDateTimeSchema } from './common.js';

/** Accepted MIME types, detected from file content. */
export const AssetMimeSchema = z.enum(ALLOWED_UPLOAD_MIME_TYPES);

/** Accepted MIME type. */
export type AssetMime = z.infer<typeof AssetMimeSchema>;

/** Width and height of one page in that page's own pixel/point units. */
export const PageSizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

/** Intrinsic size of a page. */
export type PageSize = z.infer<typeof PageSizeSchema>;

/** An uploaded, validated file. */
export const AssetSchema = z.object({
  id: AssetIdSchema,
  mime: AssetMimeSchema,
  /** File size in bytes. */
  bytes: z.int().positive(),
  /** Intrinsic size of each page: one entry for images and GIFs, one per page for PDFs. */
  pageSizes: z.array(PageSizeSchema).min(1),
  /** Hex SHA-256 of the file content, used for de-duplication. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** API path that streams the file (relative to the API base URL). */
  url: z.string().min(1),
  /** API path of a PNG thumbnail, or null when none could be made (PDFs). */
  thumbnailUrl: z.string().min(1).nullable(),
  createdAt: IsoDateTimeSchema,
});

/** Parsed asset. */
export type Asset = z.infer<typeof AssetSchema>;
