/**
 * Question content rendering: one view class per question kind behind a shared interface.
 *
 * Owns: putting the question's content into the sheet's asset box at `LOGICAL_WIDTH` and
 * reporting its measured size. Does not own ink, geometry decisions or data fetching
 * beyond loading the asset URL it is given.
 */

import { type PageSize, type Question } from '@live-class/shared';

/** Something that renders a question page into an element. */
export interface QuestionView {
  /**
   * Renders into `host` and resolves once the content is laid out and measured.
   *
   * @param {HTMLElement} host - Empty element sized to the asset box width.
   * @returns {Promise<PageSize>} Intrinsic size: for images the pixel size, for text the
   *   rendered size at `LOGICAL_WIDTH`.
   */
  mount(host: HTMLElement): Promise<PageSize>;
  /**
   * Called when the display scale changes so raster content can re-render crisply.
   *
   * @param {number} scale - CSS pixels per sheet unit.
   * @param {number} dpr - Device pixel ratio.
   * @returns {void} Nothing.
   */
  onScaleChange?(scale: number, dpr: number): void;
  /**
   * Releases resources (decoders, object URLs, listeners).
   *
   * @returns {void} Nothing.
   */
  dispose(): void;
}

/** Inputs needed to construct a view. */
export interface QuestionViewInput {
  readonly question: Question;
  /** Zero-based page for PDFs; ignored otherwise. */
  readonly pageIndex: number;
  /** Absolute URL of the asset file, when the question has one. */
  readonly assetUrl: string | null;
  /** Bearer token to send when fetching the asset (PDF only; images use cookies/URL). */
  readonly getToken?: () => string | Promise<string>;
}

/** Factory signature so the controller can be tested with a fake. */
export type QuestionViewFactory = (input: QuestionViewInput) => QuestionView;
