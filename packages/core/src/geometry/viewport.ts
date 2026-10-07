/**
 * Mapping between CSS pixels on screen and sheet units.
 *
 * Owns: the scale at which a sheet is displayed, the conversion of pointer positions into
 * sheet units and back, and the DOM side of "scale the sheet as a whole" (invariant 1).
 * Does not own drawing or scrolling behaviour.
 *
 * DOM layout contract: `stage` is a block element inside a scrolling container; `sheet` is
 * its only child, laid out at `LOGICAL_WIDTH` CSS px wide and CSS-scaled from the top-left.
 * Transforms do not affect layout, so the stage is given the scaled size explicitly.
 */

import { LOGICAL_WIDTH } from '@live-class/shared';

import { TypedEmitter, type Unsubscribe } from '../events.js';

/** Snapshot of the viewport used for coordinate conversion. */
export interface ViewportState {
  /** CSS pixels per sheet unit; always > 0. */
  readonly scale: number;
  /** `window.devicePixelRatio` at the last refresh. */
  readonly dpr: number;
  /** Top-left of the sheet in client (viewport) CSS pixels. */
  readonly originPx: { readonly x: number; readonly y: number };
}

/** A point in sheet units. */
export interface SheetPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Converts a pointer position in CSS pixels into sheet units so the point can be stored
 * and shared independently of zoom level and device.
 *
 * @param {number} clientX - Pointer X in CSS pixels, from `PointerEvent.clientX`.
 * @param {number} clientY - Pointer Y in CSS pixels, from `PointerEvent.clientY`.
 * @param {ViewportState} viewport - Current sheet origin in pixels and scale in pixels
 *   per sheet unit. `scale` must be greater than 0.
 * @returns {SheetPoint} The point in sheet units. `x` is within `[0, LOGICAL_WIDTH]` when
 *   the pointer is over the sheet and outside that range when it is in the side margin.
 * @throws {RangeError} If `viewport.scale` is 0, negative or `NaN`.
 */
export function toSheetPoint(
  clientX: number,
  clientY: number,
  viewport: ViewportState,
): SheetPoint {
  assertScale(viewport.scale);
  return {
    x: (clientX - viewport.originPx.x) / viewport.scale,
    y: (clientY - viewport.originPx.y) / viewport.scale,
  };
}

/**
 * Converts a point in sheet units back to client CSS pixels.
 *
 * @param {SheetPoint} point - Point in sheet units.
 * @param {ViewportState} viewport - Current origin and scale.
 * @returns {{ x: number; y: number }} Position in client CSS pixels.
 * @throws {RangeError} If `viewport.scale` is 0, negative or `NaN`.
 */
export function toScreenPoint(
  point: SheetPoint,
  viewport: ViewportState,
): { readonly x: number; readonly y: number } {
  assertScale(viewport.scale);
  return {
    x: viewport.originPx.x + point.x * viewport.scale,
    y: viewport.originPx.y + point.y * viewport.scale,
  };
}

/**
 * Computes the fit-to-width scale for a container.
 *
 * @param {number} containerWidthPx - Inner width of the scrolling container in CSS px.
 * @returns {number} CSS pixels per sheet unit, never below a tiny positive floor so a
 *   zero-width container (hidden tab) does not produce a zero scale.
 */
export function fitToWidthScale(containerWidthPx: number): number {
  const width = Number.isFinite(containerWidthPx) ? Math.max(containerWidthPx, 1) : 1;
  return width / LOGICAL_WIDTH;
}

/** Events emitted by `Viewport`. */
export interface ViewportEvents extends Record<string, unknown> {
  /** The scale, origin or sheet height changed. */
  change: ViewportState;
}

/** Elements the viewport manages. */
export interface ViewportElements {
  /** Scrollable element whose inner width decides the scale. */
  readonly container: HTMLElement;
  /** Block that reserves the scaled size inside the container. */
  readonly stage: HTMLElement;
  /** The `LOGICAL_WIDTH`-wide element that is CSS-scaled. */
  readonly sheet: HTMLElement;
}

/**
 * Keeps one mounted sheet scaled to its container and converts coordinates.
 *
 * @remarks Call `dispose()` when the sheet unmounts; it disconnects the resize observer.
 */
export class Viewport {
  private readonly emitter = new TypedEmitter<ViewportEvents>();
  private readonly elements: ViewportElements;
  private readonly resizeObserver: ResizeObserver | null;
  private scale = fitToWidthScale(LOGICAL_WIDTH);
  private heightUnits = 1;
  private disposed = false;

  /**
   * Creates a viewport for the given elements and fits the sheet to the container width.
   *
   * @param {ViewportElements} elements - Container, stage and sheet elements (see the
   *   module comment for the layout contract).
   */
  constructor(elements: ViewportElements) {
    this.elements = elements;
    const { sheet } = elements;
    sheet.style.width = `${LOGICAL_WIDTH}px`;
    sheet.style.transformOrigin = '0 0';
    sheet.style.position = 'absolute';
    sheet.style.left = '0';
    sheet.style.top = '0';
    elements.stage.style.position = 'relative';
    elements.stage.style.overflow = 'hidden';
    this.resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            this.fitToWidth();
          });
    this.resizeObserver?.observe(elements.container);
    this.fitToWidth();
  }

  /**
   * Current conversion state. The origin is read live from the DOM, so it is correct even
   * while the container scrolls.
   *
   * @returns {ViewportState} Scale, device pixel ratio and sheet origin.
   */
  get state(): ViewportState {
    const rect = this.elements.sheet.getBoundingClientRect();
    return {
      scale: this.scale,
      dpr: typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
      originPx: { x: rect.left, y: rect.top },
    };
  }

  /**
   * Current sheet height.
   *
   * @returns {number} Height in sheet units as last set by `setSheetHeightUnits`.
   */
  get sheetHeightUnits(): number {
    return this.heightUnits;
  }

  /**
   * Current scale without touching the DOM (cheaper than `state` in hot paths).
   *
   * @returns {number} CSS pixels per sheet unit.
   */
  get currentScale(): number {
    return this.scale;
  }

  /**
   * Sets the live sheet height and resizes the stage to match.
   *
   * @param {number} heightUnits - Sheet height in sheet units; must be positive.
   * @returns {void} Nothing.
   * @throws {RangeError} If `heightUnits` is not a positive finite number.
   */
  setSheetHeightUnits(heightUnits: number): void {
    if (!Number.isFinite(heightUnits) || heightUnits <= 0) {
      throw new RangeError(`heightUnits must be positive, got ${heightUnits}`);
    }
    this.heightUnits = heightUnits;
    this.elements.sheet.style.height = `${heightUnits}px`;
    this.applyScale();
  }

  /**
   * Recomputes the scale from the container's current inner width and applies it.
   *
   * @returns {void} Nothing.
   */
  fitToWidth(): void {
    if (this.disposed) return;
    this.scale = fitToWidthScale(this.elements.container.clientWidth);
    this.applyScale();
  }

  /**
   * Converts a pointer position to sheet units using the live state.
   *
   * @param {number} clientX - Pointer X in CSS px.
   * @param {number} clientY - Pointer Y in CSS px.
   * @returns {SheetPoint} The point in sheet units.
   */
  toSheetPoint(clientX: number, clientY: number): SheetPoint {
    return toSheetPoint(clientX, clientY, this.state);
  }

  /**
   * Subscribes to viewport changes.
   *
   * @param {(state: ViewportState) => void} listener - Called after each change.
   * @returns {Unsubscribe} Function that removes the listener.
   */
  onChange(listener: (state: ViewportState) => void): Unsubscribe {
    return this.emitter.on('change', listener);
  }

  /**
   * Stops observing the container and releases listeners.
   *
   * @returns {void} Nothing.
   */
  dispose(): void {
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.emitter.dispose();
  }

  /**
   * Writes the transform and stage size for the current scale and height.
   *
   * @returns {void} Nothing.
   */
  private applyScale(): void {
    const { sheet, stage } = this.elements;
    sheet.style.transform = `scale(${this.scale})`;
    stage.style.width = `${LOGICAL_WIDTH * this.scale}px`;
    stage.style.height = `${this.heightUnits * this.scale}px`;
    this.emitter.emit('change', this.state);
  }
}

/**
 * Validates a scale value.
 *
 * @param {number} scale - CSS pixels per sheet unit.
 * @returns {void} Nothing.
 * @throws {RangeError} If `scale` is 0, negative or not finite.
 */
function assertScale(scale: number): void {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError(`Viewport scale must be a positive number, got ${scale}`);
  }
}
