/**
 * The two canvases on top of a sheet and the pointer handling that draws on them.
 *
 * Owns: canvas creation and sizing (crisp at any scale, bounded memory), pointer-event
 * interpretation via `decidePointerAction`, the local stroke in progress, redrawing the
 * committed strokes when the set changes, and painting peers' live pens. Does not own
 * the stroke list itself (the sheet document), permissions, or awareness transport: it
 * emits events and the `SheetController` wires them.
 *
 * Layering: `committed` canvas (all finished strokes, redrawn only when the set changes)
 * below the `live` canvas (local in-progress stroke + remote pens, redrawn per frame).
 * Both are children of the CSS-scaled sheet element; their backing stores are sized to
 * device pixels so the CSS transform never blurs them (see `resize`).
 */

import {
  ERASER_RADIUS_UNITS,
  type StrokeId,
  type StrokeRecord,
  type StrokeStyle,
  type UserId,
} from '@live-class/shared';

import { TypedEmitter, type Unsubscribe } from '../events.js';
import { type Viewport, type ViewportState } from '../geometry/viewport.js';
import { findStrokesAt } from './hit-test.js';
import {
  type ActiveTool,
  cursorForTool,
  decidePointerAction,
  type PointerAction,
} from './pointer-policy.js';
import { type StrokePoint } from './points.js';
import { StrokeBuilder } from './stroke-builder.js';
import { type StrokeRenderer } from './stroke-renderer.js';

/** A peer's in-progress stroke as painted on the live canvas. */
export interface LivePenView {
  readonly points: readonly number[];
  readonly style: StrokeStyle;
}

/** Events emitted by `InkLayer`. */
export interface InkLayerEvents extends Record<string, unknown> {
  /** The local user finished a stroke; the controller commits it to the document. */
  strokeCommitted: StrokeRecord;
  /** The eraser touched these strokes; the controller checks permissions and deletes. */
  eraseRequested: { readonly ids: readonly StrokeId[] };
  /** The local in-progress stroke changed (`null` when the pen lifts). */
  livePenChanged: LivePenView | null;
  /** A finger (or pan tool) dragged; the controller scrolls the container by these deltas. */
  scrollRequested: { readonly deltaX: number; readonly deltaY: number };
}

/** Construction options. */
export interface InkLayerOptions {
  /** The local user; written into every committed stroke. */
  readonly authorId: UserId;
  /** Initial pen style. */
  readonly style: StrokeStyle;
  /** Initial tool (default `pen`). */
  readonly tool?: ActiveTool;
  /** Whether a finger draws instead of scrolling (default false). */
  readonly fingerDraws?: boolean;
  /** Whether input is disabled (default false). */
  readonly readOnly?: boolean;
  /** Eraser radius in sheet units. */
  readonly eraserRadiusUnits?: number;
  /** Upper bound on backing-store pixels per canvas (memory guard; default 8 M). */
  readonly maxBackingPixels?: number;
  /** Clock, injectable for tests. */
  readonly now?: () => number;
  /** Frame scheduler, injectable for tests (defaults to `requestAnimationFrame`). */
  readonly requestFrame?: (callback: () => void) => number;
  /** Frame canceller matching `requestFrame`. */
  readonly cancelFrame?: (handle: number) => void;
}

/** Default memory guard: 8 M pixels ≈ 32 MB per canvas. */
const DEFAULT_MAX_BACKING_PIXELS = 8_000_000;

/**
 * Canvas layer that captures ink on one sheet.
 *
 * @remarks Call `mount()` after construction and `dispose()` on unmount.
 */
export class InkLayer {
  private readonly emitter = new TypedEmitter<InkLayerEvents>();
  private readonly sheet: HTMLElement;
  private readonly viewport: Viewport;
  private readonly renderer: StrokeRenderer;
  private readonly builder: StrokeBuilder;
  private readonly committedCanvas: HTMLCanvasElement;
  private readonly liveCanvas: HTMLCanvasElement;
  private readonly authorId: UserId;
  private readonly eraserRadiusUnits: number;
  private readonly maxBackingPixels: number;
  private readonly now: () => number;
  private readonly requestFrame: (callback: () => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly remotePens = new Map<string, LivePenView>();
  private readonly unsubscribeViewport: Unsubscribe;

  private style: StrokeStyle;
  private tool: ActiveTool;
  private fingerDraws: boolean;
  private readOnly: boolean;
  private strokes: readonly StrokeRecord[] = [];
  private lastPenInputAt: number | null = null;
  private activePointerId: number | null = null;
  private activeAction: PointerAction = 'ignore';
  private erasedThisGesture = new Set<StrokeId>();
  private lastClient: { x: number; y: number } | null = null;
  private viewportState: ViewportState | null = null;
  private pendingFrame: number | null = null;
  /** Device pixels per sheet unit for the current backing store. */
  private pixelsPerUnit = 1;
  private mounted = false;
  private disposed = false;

  /**
   * Creates the layer; call `mount()` to add the canvases to the sheet.
   *
   * @param {HTMLElement} sheet - The CSS-scaled sheet element the canvases cover.
   * @param {Viewport} viewport - Viewport of that sheet, for scale and coordinates.
   * @param {StrokeRenderer} renderer - Shared renderer (path cache).
   * @param {InkLayerOptions} options - User, style and tunables.
   */
  constructor(
    sheet: HTMLElement,
    viewport: Viewport,
    renderer: StrokeRenderer,
    options: InkLayerOptions,
  ) {
    this.sheet = sheet;
    this.viewport = viewport;
    this.renderer = renderer;
    this.authorId = options.authorId;
    this.style = options.style;
    this.tool = options.tool ?? 'pen';
    this.fingerDraws = options.fingerDraws ?? false;
    this.readOnly = options.readOnly ?? false;
    this.eraserRadiusUnits = options.eraserRadiusUnits ?? ERASER_RADIUS_UNITS;
    this.maxBackingPixels = options.maxBackingPixels ?? DEFAULT_MAX_BACKING_PIXELS;
    this.now = options.now ?? (() => Date.now());
    this.requestFrame =
      options.requestFrame ??
      ((callback) =>
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(callback)
          : (setTimeout(callback, 16) as unknown as number));
    this.cancelFrame =
      options.cancelFrame ??
      ((handle) => {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
        else clearTimeout(handle);
      });
    this.builder = new StrokeBuilder({ now: this.now });
    this.committedCanvas = createCanvas('lc-ink-committed');
    this.liveCanvas = createCanvas('lc-ink-live');
    this.committedCanvas.style.pointerEvents = 'none';
    this.liveCanvas.style.touchAction = 'none';
    this.unsubscribeViewport = viewport.onChange(() => {
      this.resize();
    });
  }

  /**
   * Adds the canvases to the sheet and starts listening for pointer events.
   *
   * @returns {void} Nothing.
   */
  mount(): void {
    if (this.mounted || this.disposed) return;
    this.mounted = true;
    this.sheet.appendChild(this.committedCanvas);
    this.sheet.appendChild(this.liveCanvas);
    this.liveCanvas.addEventListener('pointerdown', this.onPointerDown);
    this.liveCanvas.addEventListener('pointermove', this.onPointerMove);
    this.liveCanvas.addEventListener('pointerup', this.onPointerUp);
    this.liveCanvas.addEventListener('pointercancel', this.onPointerCancel);
    this.liveCanvas.addEventListener('lostpointercapture', this.onPointerCancel);
    this.liveCanvas.addEventListener('contextmenu', preventDefault);
    this.applyCursor();
    this.resize();
  }

  /**
   * Subscribes to a layer event.
   *
   * @param {K} event - Event name.
   * @param {(payload: InkLayerEvents[K]) => void} listener - Called with the payload each time the event fires.
   * @returns {Unsubscribe} Function that removes the listener.
   */
  on<K extends keyof InkLayerEvents>(
    event: K,
    listener: (payload: InkLayerEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  /**
   * Selects the tool used by the next gesture.
   *
   * @param {ActiveTool} tool - Pen, highlighter, eraser or pan.
   * @returns {void} Nothing.
   */
  setTool(tool: ActiveTool): void {
    this.tool = tool;
    this.applyCursor();
  }

  /**
   * The tool the next gesture will use.
   *
   * @returns {ActiveTool} Pen, highlighter, eraser or pan.
   */
  get currentTool(): ActiveTool {
    return this.tool;
  }

  /**
   * Sets the pen style for the next stroke. The stroke in progress keeps its style.
   *
   * @param {StrokeStyle} style - Tool, colour and width.
   * @returns {void} Nothing.
   */
  setStyle(style: StrokeStyle): void {
    this.style = style;
  }

  /**
   * Chooses how a touch gesture is interpreted: as ink or as scrolling.
   *
   * @param {boolean} fingerDraws - True makes a touch gesture draw with the active tool;
   *   false (the default) lets it scroll the sheet.
   * @returns {void} Nothing.
   */
  setFingerDraws(fingerDraws: boolean): void {
    this.fingerDraws = fingerDraws;
  }

  /**
   * Enables or disables input. Disabling cancels any stroke in progress.
   *
   * @param {boolean} readOnly - True to disable drawing and erasing.
   * @returns {void} Nothing.
   */
  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
    if (readOnly && this.builder.isActive) this.cancelGesture();
    this.applyCursor();
  }

  /**
   * Replaces the committed strokes and repaints the committed canvas.
   *
   * @param {readonly StrokeRecord[]} strokes - Strokes in render order.
   * @returns {void} Nothing.
   */
  setStrokes(strokes: readonly StrokeRecord[]): void {
    const previous = new Set(this.strokes.map((s) => s.id));
    for (const stroke of strokes) previous.delete(stroke.id);
    for (const removed of previous) this.renderer.invalidate(removed);
    this.strokes = strokes;
    this.drawCommitted();
  }

  /**
   * Shows or clears a peer's in-progress stroke on the live canvas.
   *
   * @param {string} peerKey - Stable key for the peer connection.
   * @param {LivePenView | null} pen - Points and style so far, or null to clear.
   * @returns {void} Nothing.
   */
  setRemotePen(peerKey: string, pen: LivePenView | null): void {
    if (pen === null) this.remotePens.delete(peerKey);
    else this.remotePens.set(peerKey, pen);
    this.scheduleLiveFrame();
  }

  /**
   * Removes the canvases and every listener. Safe to call twice.
   *
   * @returns {void} Nothing.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.builder.isActive) this.builder.cancel();
    if (this.pendingFrame !== null) this.cancelFrame(this.pendingFrame);
    this.unsubscribeViewport();
    this.liveCanvas.removeEventListener('pointerdown', this.onPointerDown);
    this.liveCanvas.removeEventListener('pointermove', this.onPointerMove);
    this.liveCanvas.removeEventListener('pointerup', this.onPointerUp);
    this.liveCanvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.liveCanvas.removeEventListener('lostpointercapture', this.onPointerCancel);
    this.liveCanvas.removeEventListener('contextmenu', preventDefault);
    this.committedCanvas.remove();
    this.liveCanvas.remove();
    this.remotePens.clear();
    this.emitter.dispose();
  }

  // --- sizing and painting ------------------------------------------------------------

  /**
   * Sizes both canvases for the current scale, height and device pixel ratio, then repaints.
   * CSS size is the unscaled sheet size (the sheet's transform scales it); the backing
   * store matches device pixels so the result is crisp, within the memory guard.
   *
   * @returns {void} Nothing.
   */
  private resize(): void {
    if (!this.mounted || this.disposed) return;
    const state = this.viewport.state;
    const heightUnits = this.viewport.sheetHeightUnits;
    const widthUnits = this.sheet.clientWidth || 1000;
    let pixelsPerUnit = state.scale * state.dpr;
    const wanted = widthUnits * heightUnits * pixelsPerUnit * pixelsPerUnit;
    if (wanted > this.maxBackingPixels) {
      pixelsPerUnit *= Math.sqrt(this.maxBackingPixels / wanted);
    }
    this.pixelsPerUnit = pixelsPerUnit;
    for (const canvas of [this.committedCanvas, this.liveCanvas]) {
      canvas.style.width = `${widthUnits}px`;
      canvas.style.height = `${heightUnits}px`;
      canvas.width = Math.max(1, Math.round(widthUnits * pixelsPerUnit));
      canvas.height = Math.max(1, Math.round(heightUnits * pixelsPerUnit));
    }
    this.drawCommitted();
    this.scheduleLiveFrame();
  }

  /**
   * Clears a canvas and sets its transform to sheet units.
   *
   * @param {HTMLCanvasElement} canvas - Canvas to prepare.
   * @returns {CanvasRenderingContext2D | null} Context ready for sheet-unit drawing.
   */
  private prepare(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(this.pixelsPerUnit, 0, 0, this.pixelsPerUnit, 0, 0);
    return ctx;
  }

  /**
   * Repaints every committed stroke.
   *
   * @returns {void} Nothing.
   */
  private drawCommitted(): void {
    if (!this.mounted) return;
    const ctx = this.prepare(this.committedCanvas);
    if (!ctx) return;
    this.renderer.drawAll(ctx, this.strokes);
  }

  /**
   * Schedules a repaint of the live canvas on the next frame (coalescing requests).
   *
   * @returns {void} Nothing.
   */
  private scheduleLiveFrame(): void {
    if (!this.mounted || this.disposed || this.pendingFrame !== null) return;
    this.pendingFrame = this.requestFrame(() => {
      this.pendingFrame = null;
      this.drawLive();
    });
  }

  /**
   * Repaints the local in-progress stroke and every remote pen.
   *
   * @returns {void} Nothing.
   */
  private drawLive(): void {
    const ctx = this.prepare(this.liveCanvas);
    if (!ctx) return;
    for (const pen of this.remotePens.values()) {
      this.renderer.drawLive(ctx, pen.points, pen.style);
    }
    const style = this.builder.style;
    if (style && this.builder.isActive) {
      this.renderer.drawLive(ctx, this.builder.points, style);
    }
  }

  /**
   * Updates the cursor to match the tool and read-only state.
   *
   * @returns {void} Nothing.
   */
  private applyCursor(): void {
    this.liveCanvas.style.cursor = cursorForTool(this.tool, this.readOnly);
  }

  // --- pointer handling ---------------------------------------------------------------

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.disposed || this.activePointerId !== null) return;
    if (event.pointerType === 'pen') this.lastPenInputAt = this.now();
    const action = decidePointerAction({
      pointerType: event.pointerType,
      isPrimary: event.isPrimary,
      button: event.button,
      tool: this.tool,
      fingerDraws: this.fingerDraws,
      readOnly: this.readOnly,
      lastPenInputAt: this.lastPenInputAt,
      now: this.now(),
    });
    if (action === 'ignore') return;
    event.preventDefault();
    this.activePointerId = event.pointerId;
    this.activeAction = action;
    this.viewportState = this.viewport.state;
    this.lastClient = { x: event.clientX, y: event.clientY };
    try {
      this.liveCanvas.setPointerCapture(event.pointerId);
    } catch {
      // Some browsers throw if the pointer is already gone; drawing still works.
    }
    const point = this.toPoint(event);
    switch (action) {
      case 'draw':
        this.builder.begin(this.style, this.authorId, point);
        this.emitLivePen();
        this.scheduleLiveFrame();
        break;
      case 'erase':
        this.erasedThisGesture = new Set();
        this.eraseAt(point);
        break;
      case 'scroll':
        break;
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.disposed || event.pointerId !== this.activePointerId) return;
    if (event.pointerType === 'pen') this.lastPenInputAt = this.now();
    event.preventDefault();
    // Refresh the origin once per move (the container may be scrolling under the pen).
    this.viewportState = this.viewport.state;
    switch (this.activeAction) {
      case 'draw': {
        const samples = coalesced(event);
        let changed = false;
        for (const sample of samples) {
          if (this.builder.addPoint(this.toPoint(sample))) changed = true;
        }
        if (changed) {
          this.emitLivePen();
          this.scheduleLiveFrame();
        }
        break;
      }
      case 'erase':
        this.eraseAt(this.toPoint(event));
        break;
      case 'scroll': {
        const last = this.lastClient ?? { x: event.clientX, y: event.clientY };
        this.emitter.emit('scrollRequested', {
          deltaX: last.x - event.clientX,
          deltaY: last.y - event.clientY,
        });
        break;
      }
      case 'ignore':
        break;
    }
    this.lastClient = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.disposed || event.pointerId !== this.activePointerId) return;
    event.preventDefault();
    if (this.activeAction === 'draw') {
      this.builder.addPoint(this.toPoint(event));
      const record = this.builder.end();
      this.emitter.emit('livePenChanged', null);
      this.emitter.emit('strokeCommitted', record);
      this.scheduleLiveFrame();
    }
    this.finishGesture(event.pointerId);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (this.disposed || event.pointerId !== this.activePointerId) return;
    this.cancelGesture();
  };

  /**
   * Abandons the current gesture without committing anything.
   *
   * @returns {void} Nothing.
   */
  private cancelGesture(): void {
    if (this.builder.isActive) {
      this.builder.cancel();
      this.emitter.emit('livePenChanged', null);
      this.scheduleLiveFrame();
    }
    if (this.activePointerId !== null) this.finishGesture(this.activePointerId);
  }

  /**
   * Releases capture and clears per-gesture state.
   *
   * @param {number} pointerId - The pointer that owned the gesture.
   * @returns {void} Nothing.
   */
  private finishGesture(pointerId: number): void {
    try {
      if (this.liveCanvas.hasPointerCapture(pointerId)) {
        this.liveCanvas.releasePointerCapture(pointerId);
      }
    } catch {
      // Already released.
    }
    this.activePointerId = null;
    this.activeAction = 'ignore';
    this.lastClient = null;
    this.viewportState = null;
    this.erasedThisGesture = new Set();
  }

  /**
   * Converts an event to a sheet point using the cached viewport state.
   *
   * @param {{ clientX: number; clientY: number; pressure: number }} event - Pointer sample.
   * @returns {StrokePoint} Point in sheet units with pressure.
   */
  private toPoint(event: { clientX: number; clientY: number; pressure: number }): StrokePoint {
    const state = this.viewportState ?? this.viewport.state;
    return {
      x: (event.clientX - state.originPx.x) / state.scale,
      y: (event.clientY - state.originPx.y) / state.scale,
      pressure: event.pressure,
    };
  }

  /**
   * Hit-tests the committed strokes and emits any new hits for this gesture.
   *
   * @param {StrokePoint} point - Eraser position in sheet units.
   * @returns {void} Nothing.
   */
  private eraseAt(point: StrokePoint): void {
    const hits = findStrokesAt(this.strokes, point.x, point.y, this.eraserRadiusUnits).filter(
      (id) => !this.erasedThisGesture.has(id),
    );
    if (hits.length === 0) return;
    for (const id of hits) this.erasedThisGesture.add(id);
    this.emitter.emit('eraseRequested', { ids: hits });
  }

  /**
   * Emits the current in-progress stroke.
   *
   * @returns {void} Nothing.
   */
  private emitLivePen(): void {
    const style = this.builder.style;
    if (!style) return;
    this.emitter.emit('livePenChanged', { points: this.builder.points, style });
  }
}

/**
 * Creates an absolutely positioned canvas covering the sheet.
 *
 * @param {string} className - CSS class for styling hooks.
 * @returns {HTMLCanvasElement} The canvas (not yet attached).
 */
function createCanvas(className: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = className;
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.display = 'block';
  return canvas;
}

/**
 * Returns the high-frequency samples behind a pointermove when the browser provides them.
 *
 * @param {PointerEvent} event - The pointermove event.
 * @returns {{ clientX: number; clientY: number; pressure: number }[]} Samples in order,
 *   falling back to the event itself.
 */
function coalesced(event: PointerEvent): { clientX: number; clientY: number; pressure: number }[] {
  const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
  return events.length > 0 ? events : [event];
}

/**
 * Suppresses a browser default action (used for the context menu over the canvas).
 *
 * @param {Event} event - The event to suppress.
 * @returns {void} Nothing.
 */
function preventDefault(event: Event): void {
  event.preventDefault();
}
