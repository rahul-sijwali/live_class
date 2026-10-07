/**
 * One mounted sheet: question content, ink, viewport, realtime document and presence,
 * wired together with the permission rules applied.
 *
 * Owns: the DOM skeleton (stage → sheet → content host + ink canvases), the lifecycle of
 * the `QuestionView`, `Viewport` and `InkLayer`, and the glue between ink events and the
 * `SheetDoc`/`Presence`. Does not own the network, the session document, or any toolbar.
 */

import {
  ADD_SPACE_STEP_UNITS,
  AppError,
  canControlSession,
  canDraw,
  canEraseStroke,
  computeTextSheetGeometry,
  isAppError,
  type PageSize,
  type ParticipantRole,
  type Question,
  type Sheet,
  type SheetGeometry,
  type StrokeId,
  type StrokeStyle,
  type UserId,
  withLiveHeight,
} from '@live-class/shared';

import { TypedEmitter, type Unsubscribe } from '../events.js';
import { Viewport } from '../geometry/viewport.js';
import { InkLayer } from '../ink/ink-layer.js';
import { type ActiveTool } from '../ink/pointer-policy.js';
import { StrokeRenderer } from '../ink/stroke-renderer.js';
import { createQuestionView } from '../question/create-question-view.js';
import { type QuestionView, type QuestionViewFactory } from '../question/question-view.js';
import { type PeerState, type Presence } from '../sync/presence.js';
import { type SheetDoc } from '../sync/sheet-doc.js';

/** Events emitted by `SheetController`. */
export interface SheetControllerEvents extends Record<string, unknown> {
  /** The question content is laid out; the sheet can be interacted with. */
  ready: PageSize;
  /** Something failed (rendering, invalid data). The sheet stays mounted. */
  error: AppError;
  /** Undo/redo availability or stroke set changed; toolbars refresh from this. */
  change: { readonly canUndo: boolean; readonly canRedo: boolean; readonly strokeCount: number };
}

/** Construction options. */
export interface SheetControllerOptions {
  /** Scrollable element the sheet is rendered into. */
  readonly container: HTMLElement;
  readonly sheet: Sheet;
  readonly question: Question;
  /** Absolute URL of the question's asset file, or null for text questions. */
  readonly assetUrl: string | null;
  /** Bearer token source for asset downloads. */
  readonly getToken?: () => string | Promise<string>;
  readonly user: { readonly id: UserId; readonly role: ParticipantRole };
  /** Wrapper over this sheet's realtime document. */
  readonly sheetDoc: SheetDoc;
  /** Room-level presence (shared across sheets). */
  readonly presence: Presence;
  readonly initialTool?: ActiveTool;
  readonly initialStyle: StrokeStyle;
  readonly fingerDraws?: boolean;
  /** External read-only flag (session ended, connection read-only). */
  readonly readOnly?: boolean;
  /** Mentor's live toggle for student writing. */
  readonly studentCanWrite?: boolean;
  /** Question view factory (injectable for tests). */
  readonly createView?: QuestionViewFactory;
  /** Shared renderer so path caches survive sheet switches. */
  readonly renderer?: StrokeRenderer;
}

/**
 * Mounts and runs one sheet.
 *
 * @remarks Construct, then `await controller.mount()`. Always call `dispose()` on unmount.
 */
export class SheetController {
  private readonly emitter = new TypedEmitter<SheetControllerEvents>();
  private readonly options: SheetControllerOptions;
  private readonly stage: HTMLElement;
  private readonly sheetEl: HTMLElement;
  private readonly contentHost: HTMLElement;
  private readonly viewport: Viewport;
  private readonly ink: InkLayer;
  private readonly view: QuestionView;
  private readonly subscriptions: Unsubscribe[] = [];
  private geometry: SheetGeometry;
  private readOnly: boolean;
  private studentCanWrite: boolean;
  private peerPens = new Set<string>();
  private disposed = false;

  /**
   * Builds the DOM skeleton and the collaborators. Nothing is fetched until `mount()`.
   *
   * @param {SheetControllerOptions} options - Elements, data, user and injectables.
   */
  constructor(options: SheetControllerOptions) {
    this.options = options;
    this.geometry = options.sheet.geometry;
    this.readOnly = options.readOnly ?? false;
    this.studentCanWrite = options.studentCanWrite ?? true;

    this.stage = document.createElement('div');
    this.stage.className = 'lc-stage';
    this.sheetEl = document.createElement('div');
    this.sheetEl.className = 'lc-sheet';
    this.contentHost = document.createElement('div');
    this.contentHost.className = 'lc-sheet-content';
    this.contentHost.style.position = 'absolute';
    this.contentHost.style.left = '0';
    this.contentHost.style.width = `${this.geometry.assetBox.w}px`;
    this.contentHost.style.top = `${this.geometry.assetBox.y}px`;
    this.sheetEl.appendChild(this.contentHost);
    this.stage.appendChild(this.sheetEl);

    this.viewport = new Viewport({
      container: options.container,
      stage: this.stage,
      sheet: this.sheetEl,
    });
    this.ink = new InkLayer(this.sheetEl, this.viewport, options.renderer ?? new StrokeRenderer(), {
      authorId: options.user.id,
      style: options.initialStyle,
      tool: options.initialTool ?? 'pen',
      fingerDraws: options.fingerDraws ?? false,
      readOnly: this.effectiveReadOnly(),
    });
    const factory = options.createView ?? createQuestionView;
    this.view = factory({
      question: options.question,
      pageIndex: options.sheet.pageIndex,
      assetUrl: options.assetUrl,
      ...(options.getToken ? { getToken: options.getToken } : {}),
    });
  }

  /**
   * Attaches to the container, renders the question and starts syncing ink.
   *
   * @returns {Promise<void>} Resolves after the question view is laid out (`ready` fired).
   *   Rendering failures are reported through the `error` event instead of rejecting, so a
   *   broken image never takes the whole room down.
   */
  async mount(): Promise<void> {
    if (this.disposed) return;
    this.options.container.appendChild(this.stage);
    this.applyHeight(this.options.sheetDoc.getHeightUnits());
    this.ink.mount();
    this.ink.setStrokes(this.options.sheetDoc.getStrokes());
    this.wire();
    try {
      const size = await this.view.mount(this.contentHost);
      if (this.isDisposed()) return;
      this.applyMeasuredSize(size);
      const state = this.viewport.state;
      this.view.onScaleChange?.(state.scale, state.dpr);
      this.emitter.emit('ready', size);
    } catch (error) {
      this.emitError(error);
    }
    this.emitChange();
  }

  /**
   * Subscribes to controller events.
   *
   * @param {K} event - Event name.
   * @param {(payload: SheetControllerEvents[K]) => void} listener - Called with the payload each time the event fires.
   * @returns {Unsubscribe} Function that removes the listener.
   */
  on<K extends keyof SheetControllerEvents>(
    event: K,
    listener: (payload: SheetControllerEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  /**
   * Selects the drawing tool.
   *
   * @param {ActiveTool} tool - Pen, highlighter, eraser or pan.
   * @returns {void} Nothing.
   */
  setTool(tool: ActiveTool): void {
    this.ink.setTool(tool);
  }

  /**
   * Sets the pen style for subsequent strokes.
   *
   * @param {StrokeStyle} style - Tool, colour and width.
   * @returns {void} Nothing.
   */
  setStyle(style: StrokeStyle): void {
    this.ink.setStyle(style);
  }

  /**
   * Chooses whether a finger draws or scrolls.
   *
   * @param {boolean} fingerDraws - True to draw with a finger.
   * @returns {void} Nothing.
   */
  setFingerDraws(fingerDraws: boolean): void {
    this.ink.setFingerDraws(fingerDraws);
  }

  /**
   * Updates the permission inputs; the ink layer becomes read-only when either forbids
   * drawing.
   *
   * @param {{ readOnly?: boolean; studentCanWrite?: boolean }} permissions - New values.
   * @returns {void} Nothing.
   */
  setPermissions(permissions: {
    readonly readOnly?: boolean;
    readonly studentCanWrite?: boolean;
  }): void {
    if (permissions.readOnly !== undefined) this.readOnly = permissions.readOnly;
    if (permissions.studentCanWrite !== undefined)
      this.studentCanWrite = permissions.studentCanWrite;
    this.ink.setReadOnly(this.effectiveReadOnly());
  }

  /**
   * Adds blank space below the sheet (mentor only).
   *
   * @returns {void} Nothing.
   * @throws {AppError} `FORBIDDEN` if the user is not the mentor.
   */
  addSpace(): void {
    if (!canControlSession(this.options.user.role)) {
      throw new AppError('FORBIDDEN', 'Only the mentor can add space');
    }
    this.options.sheetDoc.setHeightUnits(this.viewport.sheetHeightUnits + ADD_SPACE_STEP_UNITS);
  }

  /**
   * Undoes this user's last change.
   *
   * @returns {boolean} True if something was undone.
   */
  undo(): boolean {
    const done = this.options.sheetDoc.undo();
    this.emitChange();
    return done;
  }

  /**
   * Redoes this user's last undone change.
   *
   * @returns {boolean} True if something was redone.
   */
  redo(): boolean {
    const done = this.options.sheetDoc.redo();
    this.emitChange();
    return done;
  }

  /**
   * Current sheet geometry (with the live height applied).
   *
   * @returns {SheetGeometry} Width, height and content box in sheet units.
   */
  get currentGeometry(): SheetGeometry {
    return { ...this.geometry, heightUnits: this.viewport.sheetHeightUnits };
  }

  /**
   * Tears everything down and removes the DOM. Safe to call twice.
   *
   * @returns {void} Nothing.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
    this.options.presence.clearPen();
    this.ink.dispose();
    this.view.dispose();
    this.viewport.dispose();
    this.stage.remove();
    this.emitter.dispose();
  }

  /**
   * Connects ink, document, presence and viewport events.
   *
   * @returns {void} Nothing.
   */
  private wire(): void {
    const { sheetDoc, presence, user, sheet, container } = this.options;

    this.subscriptions.push(
      this.ink.on('strokeCommitted', (record) => {
        if (!canDraw(user.role, this.studentCanWrite) || this.readOnly) return;
        try {
          sheetDoc.addStroke(record);
        } catch (error) {
          this.emitError(error);
        }
      }),
      this.ink.on('eraseRequested', ({ ids }) => {
        const allowed: StrokeId[] = [];
        for (const id of ids) {
          const stroke = sheetDoc.getStroke(id);
          if (stroke && canEraseStroke(user.role, user.id, stroke.authorId)) allowed.push(id);
        }
        sheetDoc.removeStrokes(allowed);
      }),
      this.ink.on('livePenChanged', (pen) => {
        if (pen === null) presence.clearPen();
        else presence.streamPen(sheet.id, pen.style, pen.points);
      }),
      this.ink.on('scrollRequested', ({ deltaX, deltaY }) => {
        container.scrollTop += deltaY;
        container.scrollLeft += deltaX;
      }),
      sheetDoc.observe((change) => {
        this.ink.setStrokes(change.strokes);
        this.applyHeight(change.heightUnits);
        this.emitChange();
      }),
      sheetDoc.onUndoStackChange(() => {
        this.emitChange();
      }),
      presence.onChange((peers) => {
        this.applyPeers(peers);
      }),
      this.viewport.onChange((state) => {
        this.view.onScaleChange?.(state.scale, state.dpr);
      }),
    );
    this.applyPeers(presence.getPeers());
  }

  /**
   * Shows peers' pens that target this sheet and clears the rest.
   *
   * @param {readonly PeerState[]} peers - Current peers.
   * @returns {void} Nothing.
   */
  private applyPeers(peers: readonly PeerState[]): void {
    const seen = new Set<string>();
    for (const peer of peers) {
      const key = String(peer.clientId);
      const pen = peer.state.pen;
      if (pen !== null && pen.sheetId === this.options.sheet.id) {
        seen.add(key);
        this.ink.setRemotePen(key, { points: pen.points, style: pen.style });
      }
    }
    for (const key of this.peerPens) {
      if (!seen.has(key)) this.ink.setRemotePen(key, null);
    }
    this.peerPens = seen;
  }

  /**
   * Applies a measured content size. Text pages replace the provisional geometry; raster
   * pages keep the stored geometry (the server already knew their size).
   *
   * @param {PageSize} size - Size reported by the question view.
   * @returns {void} Nothing.
   */
  private applyMeasuredSize(size: PageSize): void {
    if (this.options.question.kind !== 'text') return;
    const margins = {
      topUnits: this.geometry.assetBox.y,
      bottomUnits: Math.max(
        0,
        this.geometry.heightUnits - this.geometry.assetBox.y - this.geometry.assetBox.h,
      ),
    };
    this.geometry = computeTextSheetGeometry(size.height, margins);
    this.contentHost.style.height = `${this.geometry.assetBox.h}px`;
    this.applyHeight(this.options.sheetDoc.getHeightUnits());
  }

  /**
   * Sets the viewport height from the stored geometry and the live document height.
   *
   * @param {number | null} liveHeight - Live height from the sheet document, if any.
   * @returns {void} Nothing.
   */
  private applyHeight(liveHeight: number | null): void {
    const resolved = withLiveHeight(this.geometry, liveHeight ?? this.geometry.heightUnits);
    if (resolved.heightUnits !== this.viewport.sheetHeightUnits) {
      this.viewport.setSheetHeightUnits(resolved.heightUnits);
    }
  }

  /**
   * Whether `dispose()` has run. A method rather than a field read so control-flow analysis
   * does not assume the value is unchanged across an `await`.
   *
   * @returns {boolean} True after disposal.
   */
  private isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Combines the external flag with the permission rule.
   *
   * @returns {boolean} True when the user may not draw right now.
   */
  private effectiveReadOnly(): boolean {
    return this.readOnly || !canDraw(this.options.user.role, this.studentCanWrite);
  }

  /**
   * Emits the current undo/redo availability.
   *
   * @returns {void} Nothing.
   */
  private emitChange(): void {
    if (this.disposed) return;
    const { sheetDoc } = this.options;
    this.emitter.emit('change', {
      canUndo: sheetDoc.canUndo,
      canRedo: sheetDoc.canRedo,
      strokeCount: sheetDoc.getStrokes().length,
    });
  }

  /**
   * Normalises and emits an error.
   *
   * @param {unknown} error - Anything thrown.
   * @returns {void} Nothing.
   */
  private emitError(error: unknown): void {
    const appError = isAppError(error)
      ? error
      : new AppError('INTERNAL', error instanceof Error ? error.message : 'Unknown error', {
          cause: error,
        });
    this.emitter.emit('error', appError);
  }
}
