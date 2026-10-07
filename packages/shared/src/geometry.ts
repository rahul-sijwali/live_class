/**
 * Pure sheet geometry in sheet units.
 *
 * Owns: how a page's intrinsic size becomes a sheet (margins + asset box + height) and how
 * the height grows. Used by the server when a sheet is created and by the client when it
 * renders. Invariant 1: the width is always `LOGICAL_WIDTH`; nothing here ever reflows.
 */

import {
  DEFAULT_MARGIN_BOTTOM_UNITS,
  DEFAULT_MARGIN_TOP_UNITS,
  LOGICAL_WIDTH,
  MAX_SHEET_HEIGHT_UNITS,
} from './constants.js';
import { type PageSize } from './schemas/asset.js';
import { type Rect, type SheetGeometry } from './schemas/sheet.js';

/** Blank space above and below the question content, in sheet units. */
export interface Margins {
  readonly topUnits: number;
  readonly bottomUnits: number;
}

/** Margins used unless a caller asks for something else. */
export const DEFAULT_MARGINS: Margins = {
  topUnits: DEFAULT_MARGIN_TOP_UNITS,
  bottomUnits: DEFAULT_MARGIN_BOTTOM_UNITS,
};

/**
 * Scales a page's intrinsic height to sheet units at full logical width.
 *
 * @param {PageSize} page - Intrinsic page size in its own units (pixels or PDF points).
 * @returns {number} Height in sheet units when the page is `LOGICAL_WIDTH` units wide.
 * @throws {RangeError} If either dimension is not a positive finite number.
 */
export function pageHeightUnits(page: PageSize): number {
  if (!isPositiveFinite(page.width) || !isPositiveFinite(page.height)) {
    throw new RangeError(`Page size must be positive and finite, got ${page.width}×${page.height}`);
  }
  return (LOGICAL_WIDTH * page.height) / page.width;
}

/**
 * Computes a sheet's geometry from a page size and margins.
 *
 * @param {PageSize} page - Intrinsic page size in its own units.
 * @param {Margins} margins - Blank space above and below the content, in sheet units.
 * @returns {SheetGeometry} Width `LOGICAL_WIDTH`, the content box, and the total height
 *   clamped to `MAX_SHEET_HEIGHT_UNITS`.
 * @throws {RangeError} If the page size or margins are invalid.
 * @example
 *   computeSheetGeometry({ width: 1920, height: 1080 })
 *   // => { widthUnits: 1000, heightUnits: 1282.5, assetBox: { x: 0, y: 120, w: 1000, h: 562.5 } }
 */
export function computeSheetGeometry(
  page: PageSize,
  margins: Margins = DEFAULT_MARGINS,
): SheetGeometry {
  if (!isNonNegativeFinite(margins.topUnits) || !isNonNegativeFinite(margins.bottomUnits)) {
    throw new RangeError('Margins must be non-negative finite numbers');
  }
  const contentHeight = pageHeightUnits(page);
  const assetBox: Rect = { x: 0, y: margins.topUnits, w: LOGICAL_WIDTH, h: contentHeight };
  const heightUnits = Math.min(
    MAX_SHEET_HEIGHT_UNITS,
    margins.topUnits + contentHeight + margins.bottomUnits,
  );
  return { widthUnits: LOGICAL_WIDTH, heightUnits, assetBox };
}

/**
 * Computes geometry for a text page whose height is already in sheet units (measured in the
 * browser, or provisional before measurement).
 *
 * @param {number} contentHeightUnits - Rendered height of the text block in sheet units.
 * @param {Margins} margins - Blank space above and below the content.
 * @returns {SheetGeometry} Geometry with the text block as the asset box.
 * @throws {RangeError} If the height is not positive and finite.
 */
export function computeTextSheetGeometry(
  contentHeightUnits: number,
  margins: Margins = DEFAULT_MARGINS,
): SheetGeometry {
  if (!isPositiveFinite(contentHeightUnits)) {
    throw new RangeError(`Text height must be positive and finite, got ${contentHeightUnits}`);
  }
  return computeSheetGeometry({ width: LOGICAL_WIDTH, height: contentHeightUnits }, margins);
}

/**
 * Returns a copy of the geometry with extra blank space below the content.
 *
 * @param {SheetGeometry} geometry - Current geometry.
 * @param {number} extraUnits - Space to add, in sheet units; must be non-negative.
 * @returns {SheetGeometry} New geometry; the height never exceeds `MAX_SHEET_HEIGHT_UNITS`.
 * @throws {RangeError} If `extraUnits` is negative or not finite.
 */
export function extendSheetHeight(geometry: SheetGeometry, extraUnits: number): SheetGeometry {
  if (!isNonNegativeFinite(extraUnits)) {
    throw new RangeError(`extraUnits must be a non-negative finite number, got ${extraUnits}`);
  }
  return {
    ...geometry,
    heightUnits: Math.min(MAX_SHEET_HEIGHT_UNITS, geometry.heightUnits + extraUnits),
  };
}

/**
 * Applies a live height (from the sheet's realtime document) to a stored geometry. The
 * height can never be smaller than the content's bottom edge, so content is never cut off.
 *
 * @param {SheetGeometry} geometry - Geometry as stored when the sheet was created.
 * @param {number} heightUnits - Live height in sheet units.
 * @returns {SheetGeometry} Geometry with the clamped live height.
 */
export function withLiveHeight(geometry: SheetGeometry, heightUnits: number): SheetGeometry {
  const contentBottom = geometry.assetBox.y + geometry.assetBox.h;
  const safeHeight = Number.isFinite(heightUnits) ? heightUnits : geometry.heightUnits;
  return {
    ...geometry,
    heightUnits: Math.min(MAX_SHEET_HEIGHT_UNITS, Math.max(contentBottom, safeHeight)),
  };
}

/**
 * Checks whether a value is a positive finite number.
 *
 * @param {number} value - Number to check.
 * @returns {boolean} True if `value > 0` and finite.
 */
function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Checks whether a value is a non-negative finite number.
 *
 * @param {number} value - Number to check.
 * @returns {boolean} True if `value >= 0` and finite.
 */
function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
