/**
 * Validation of uploaded files before anything is stored.
 *
 * Owns: type detection by content, size and dimension limits, PDF page counting and the
 * rejection of PDFs carrying JavaScript, launch actions or embedded files. Pure: takes a
 * buffer, returns facts or throws an `AppError` with an upload code (CLAUDE.md §8).
 */

import { createHash } from 'node:crypto';

import { fileTypeFromBuffer } from 'file-type';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import sharp from 'sharp';

import {
  ALLOWED_UPLOAD_MIME_TYPES,
  AppError,
  type AssetMime,
  MAX_IMAGE_DIMENSION_PX,
  MAX_PDF_PAGES,
  MIN_IMAGE_DIMENSION_PX,
  type PageSize,
  type QuestionKind,
} from '@live-class/shared';

/** Limits applied to an upload. */
export interface UploadLimits {
  readonly maxBytes: number;
  readonly maxPdfPages?: number;
  readonly maxImageDimensionPx?: number;
}

/** Facts established about a valid upload. */
export interface ValidatedUpload {
  readonly mime: AssetMime;
  /** Question kind this file can back. */
  readonly kind: Exclude<QuestionKind, 'text'>;
  readonly pageSizes: readonly PageSize[];
  readonly sha256: string;
  readonly bytes: number;
}

/** PDF dictionary keys and name values that indicate active content we refuse. */
const FORBIDDEN_PDF_NAMES = new Set([
  'JS',
  'JavaScript',
  'Launch',
  'EmbeddedFile',
  'EmbeddedFiles',
  'RichMedia',
  'XFA',
  'GoToR',
  'ImportData',
  'SubmitForm',
]);

/**
 * Validates an uploaded file.
 *
 * @param {Buffer} buffer - Complete file contents.
 * @param {UploadLimits} limits - Size and content limits.
 * @returns {Promise<ValidatedUpload>} Detected type, page sizes and hash.
 * @throws {AppError} `UPLOAD_TOO_LARGE` over the byte limit; `UPLOAD_TYPE_NOT_ALLOWED` for
 *   anything but PNG, JPEG, GIF or PDF (detected by content); `UPLOAD_LIMITS_EXCEEDED`
 *   for bad dimensions, too many pages, encrypted PDFs or PDFs with active content.
 */
export async function validateUpload(
  buffer: Buffer,
  limits: UploadLimits,
): Promise<ValidatedUpload> {
  if (buffer.byteLength === 0) throw new AppError('UPLOAD_TYPE_NOT_ALLOWED', 'The file is empty');
  if (buffer.byteLength > limits.maxBytes) {
    throw new AppError(
      'UPLOAD_TOO_LARGE',
      `File is ${buffer.byteLength} bytes; the limit is ${limits.maxBytes}`,
    );
  }
  const detected = await fileTypeFromBuffer(buffer);
  const mime = detected?.mime;
  if (!mime || !(ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new AppError(
      'UPLOAD_TYPE_NOT_ALLOWED',
      `Unsupported file type${mime ? ` (${mime})` : ''}; upload PNG, JPEG, GIF or PDF`,
    );
  }
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const bytes = buffer.byteLength;
  if (mime === 'application/pdf') {
    const pageSizes = await inspectPdf(buffer, limits.maxPdfPages ?? MAX_PDF_PAGES);
    return { mime, kind: 'pdf', pageSizes, sha256, bytes };
  }
  const size = await inspectImage(buffer, limits.maxImageDimensionPx ?? MAX_IMAGE_DIMENSION_PX);
  return {
    mime: mime as AssetMime,
    kind: mime === 'image/gif' ? 'gif' : 'image',
    pageSizes: [size],
    sha256,
    bytes,
  };
}

/**
 * Reads an image's dimensions (first frame for GIFs) and checks them.
 *
 * @param {Buffer} buffer - Image bytes.
 * @param {number} maxDimension - Largest allowed side in pixels.
 * @returns {Promise<PageSize>} Width and height in pixels.
 * @throws {AppError} `UPLOAD_LIMITS_EXCEEDED` when undecodable or out of range.
 */
async function inspectImage(buffer: Buffer, maxDimension: number): Promise<PageSize> {
  let width: number | undefined;
  let height: number | undefined;
  try {
    const metadata = await sharp(buffer, { pages: 1 }).metadata();
    width = metadata.width;
    height = metadata.height;
  } catch (error) {
    throw new AppError('UPLOAD_LIMITS_EXCEEDED', 'The image could not be decoded', {
      cause: error,
    });
  }
  if (!width || !height)
    throw new AppError('UPLOAD_LIMITS_EXCEEDED', 'The image has no dimensions');
  if (width < MIN_IMAGE_DIMENSION_PX || height < MIN_IMAGE_DIMENSION_PX) {
    throw new AppError('UPLOAD_LIMITS_EXCEEDED', `Image is too small (${width}×${height})`);
  }
  if (width > maxDimension || height > maxDimension) {
    throw new AppError(
      'UPLOAD_LIMITS_EXCEEDED',
      `Image is too large (${width}×${height}); max side is ${maxDimension}`,
    );
  }
  return { width, height };
}

/**
 * Parses a PDF, counts pages, reads page sizes and refuses active content.
 *
 * @param {Buffer} buffer - PDF bytes.
 * @param {number} maxPages - Largest allowed page count.
 * @returns {Promise<PageSize[]>} Width and height of each page in PDF points.
 * @throws {AppError} `UPLOAD_LIMITS_EXCEEDED` for unparsable, encrypted, oversized or
 *   active-content PDFs.
 */
async function inspectPdf(buffer: Buffer, maxPages: number): Promise<PageSize[]> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(buffer, { updateMetadata: false, ignoreEncryption: false });
  } catch (error) {
    const encrypted = error instanceof Error && /encrypt/i.test(error.message);
    throw new AppError(
      'UPLOAD_LIMITS_EXCEEDED',
      encrypted ? 'Encrypted PDFs are not supported' : 'The PDF could not be parsed',
      { cause: error },
    );
  }
  // pdf-lib parses lazily: a damaged file can pass `load` and then blow up on first access,
  // so every read below is treated as "could not be parsed" unless it is our own error.
  let pageCount: number;
  let pageSizes: PageSize[];
  let activeContent: boolean;
  try {
    pageCount = document.getPageCount();
    pageSizes = document.getPages().map((page) => {
      const { width, height } = page.getSize();
      return { width, height };
    });
    activeContent = hasActiveContent(document);
  } catch (error) {
    throw new AppError('UPLOAD_LIMITS_EXCEEDED', 'The PDF could not be parsed', { cause: error });
  }
  if (pageCount === 0) throw new AppError('UPLOAD_LIMITS_EXCEEDED', 'The PDF has no pages');
  if (pageCount > maxPages) {
    throw new AppError(
      'UPLOAD_LIMITS_EXCEEDED',
      `The PDF has ${pageCount} pages; the limit is ${maxPages}`,
    );
  }
  if (activeContent) {
    throw new AppError(
      'UPLOAD_LIMITS_EXCEEDED',
      'PDFs with scripts, launch actions or embedded files are not allowed',
    );
  }
  if (pageSizes.some((page) => !(page.width > 0) || !(page.height > 0))) {
    throw new AppError('UPLOAD_LIMITS_EXCEEDED', 'The PDF has a page with no size');
  }
  return pageSizes;
}

/**
 * Walks every object in the PDF looking for keys or names that denote active content.
 * Works on compressed object streams too because pdf-lib has already parsed them.
 *
 * @param {PDFDocument} document - Parsed PDF.
 * @returns {boolean} True if any forbidden key or name value is present.
 */
export function hasActiveContent(document: PDFDocument): boolean {
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (dictHasForbidden(object)) return true;
  }
  return dictHasForbidden(document.catalog);
}

/**
 * Checks one dictionary (recursively through nested direct dictionaries).
 *
 * @param {unknown} object - Any PDF object.
 * @returns {boolean} True when a forbidden key or name value is found.
 */
function dictHasForbidden(object: unknown): boolean {
  if (!(object instanceof PDFDict)) return false;
  for (const [key, value] of object.entries()) {
    if (FORBIDDEN_PDF_NAMES.has(key.decodeText())) return true;
    if (value instanceof PDFName && FORBIDDEN_PDF_NAMES.has(value.decodeText())) return true;
    if (value instanceof PDFDict && dictHasForbidden(value)) return true;
  }
  return false;
}
