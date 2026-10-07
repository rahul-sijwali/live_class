/**
 * Typed access to one sheet's realtime document.
 *
 * Owns: the `strokes` map and `meta` map inside a sheet `Y.Doc`, every mutation (always in
 * a transaction tagged with the local origin) and per-user undo/redo. Does not own the
 * network (see `RealtimeClient`) or rendering. Invariant 2: only finished strokes are
 * written here; in-progress points travel over awareness.
 */

import * as Y from 'yjs';

import {
  MAX_SHEET_HEIGHT_UNITS,
  SHEET_DOC_KEYS,
  type StrokeId,
  type StrokeRecord,
  StrokeRecordSchema,
} from '@live-class/shared';

import { type Unsubscribe } from '../events.js';

/** What changed in a `SheetDoc` observation. */
export interface SheetDocChange {
  /** Current strokes in render order after the change. */
  readonly strokes: readonly StrokeRecord[];
  /** Current live height in sheet units, or null when the server-stored height applies. */
  readonly heightUnits: number | null;
  /** True when the change was made by this client (local transaction). */
  readonly local: boolean;
}

/**
 * Wraps a sheet `Y.Doc` with a small, validated API.
 *
 * @remarks Each `SheetDoc` creates its own `Y.UndoManager` scoped to the local origin, so
 * undo only ever affects this user's strokes even when both people draw at once.
 */
export class SheetDoc {
  /** Transaction origin for every local mutation; the undo manager tracks only this. */
  readonly origin: object = { kind: 'local' };

  private readonly doc: Y.Doc;
  private readonly strokes: Y.Map<StrokeRecord>;
  private readonly meta: Y.Map<number>;
  private readonly undoManager: Y.UndoManager;
  private readonly listeners = new Set<(change: SheetDocChange) => void>();
  private sortedCache: readonly StrokeRecord[] | null = null;
  private disposed = false;

  /**
   * Creates the wrapper. Call `dispose()` when the sheet unmounts.
   *
   * @param {Y.Doc} doc - The sheet's document (new or already synced).
   */
  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.strokes = doc.getMap<StrokeRecord>(SHEET_DOC_KEYS.strokes);
    this.meta = doc.getMap<number>(SHEET_DOC_KEYS.meta);
    this.undoManager = new Y.UndoManager([this.strokes, this.meta], {
      trackedOrigins: new Set([this.origin]),
      captureTimeout: 0,
    });
    this.strokes.observe(this.onStrokesChanged);
    this.meta.observe(this.onMetaChanged);
  }

  /**
   * The underlying document, for the realtime provider.
   *
   * @returns {Y.Doc} The Yjs document.
   */
  get ydoc(): Y.Doc {
    return this.doc;
  }

  /**
   * Committed strokes sorted by creation time, then id, so every client renders in the
   * same order.
   *
   * @returns {readonly StrokeRecord[]} Strokes in render order. Entries that fail schema
   *   validation (from a buggy or malicious client) are skipped.
   */
  getStrokes(): readonly StrokeRecord[] {
    if (this.sortedCache) return this.sortedCache;
    const records: StrokeRecord[] = [];
    for (const value of this.strokes.values()) {
      const parsed = StrokeRecordSchema.safeParse(value);
      if (parsed.success) records.push(parsed.data);
    }
    records.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.sortedCache = records;
    return records;
  }

  /**
   * Looks up one stroke.
   *
   * @param {StrokeId} id - Identifier of the stroke to read.
   * @returns {StrokeRecord | undefined} The stroke, or undefined if absent or invalid.
   */
  getStroke(id: StrokeId): StrokeRecord | undefined {
    const value = this.strokes.get(id);
    if (!value) return undefined;
    const parsed = StrokeRecordSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  }

  /**
   * Live sheet height set by "add space", if any.
   *
   * @returns {number | null} Height in sheet units, or null when never changed.
   */
  getHeightUnits(): number | null {
    const value = this.meta.get(SHEET_DOC_KEYS.heightUnits);
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  /**
   * Commits a finished stroke.
   *
   * @param {StrokeRecord} record - Validated stroke record.
   * @returns {void} Nothing.
   * @throws {ZodError} If the record does not match `StrokeRecordSchema`.
   */
  addStroke(record: StrokeRecord): void {
    const valid = StrokeRecordSchema.parse(record);
    this.transact(() => {
      this.strokes.set(valid.id, valid);
    });
  }

  /**
   * Deletes strokes by id. Missing ids are ignored.
   *
   * @param {readonly StrokeId[]} ids - Identifiers of the strokes to delete.
   * @returns {void} Nothing.
   */
  removeStrokes(ids: readonly StrokeId[]): void {
    if (ids.length === 0) return;
    this.transact(() => {
      for (const id of ids) this.strokes.delete(id);
    });
  }

  /**
   * Sets the live sheet height.
   *
   * @param {number} heightUnits - New height in sheet units, positive and at most
   *   `MAX_SHEET_HEIGHT_UNITS`.
   * @returns {void} Nothing.
   * @throws {RangeError} If the height is out of range.
   */
  setHeightUnits(heightUnits: number): void {
    if (!Number.isFinite(heightUnits) || heightUnits <= 0 || heightUnits > MAX_SHEET_HEIGHT_UNITS) {
      throw new RangeError(`heightUnits out of range: ${heightUnits}`);
    }
    this.transact(() => {
      this.meta.set(SHEET_DOC_KEYS.heightUnits, heightUnits);
    });
  }

  /**
   * Undoes this user's last change.
   *
   * @returns {boolean} True if something was undone.
   */
  undo(): boolean {
    return this.undoManager.undo() !== null;
  }

  /**
   * Redoes this user's last undone change.
   *
   * @returns {boolean} True if something was redone.
   */
  redo(): boolean {
    return this.undoManager.redo() !== null;
  }

  /**
   * Whether `undo()` would do anything.
   *
   * @returns {boolean} True when this user has an undoable change.
   */
  get canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  /**
   * Whether `redo()` would do anything.
   *
   * @returns {boolean} True when this user has a redoable change.
   */
  get canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  /**
   * Subscribes to undo-stack changes. Fires after the transaction that created or consumed
   * a stack item, so `canUndo`/`canRedo` are up to date inside the listener (type
   * observers run before the undo manager sees the transaction, so `observe` alone is too
   * early for undo state).
   *
   * @param {() => void} listener - Called whenever undo or redo availability may have changed.
   * @returns {Unsubscribe} Function that removes the listener.
   */
  onUndoStackChange(listener: () => void): Unsubscribe {
    const handler = (): void => {
      if (!this.disposed) listener();
    };
    this.undoManager.on('stack-item-added', handler);
    this.undoManager.on('stack-item-popped', handler);
    this.undoManager.on('stack-cleared', handler);
    return () => {
      this.undoManager.off('stack-item-added', handler);
      this.undoManager.off('stack-item-popped', handler);
      this.undoManager.off('stack-cleared', handler);
    };
  }

  /**
   * Subscribes to changes from any client.
   *
   * @param {(change: SheetDocChange) => void} listener - Called after each transaction.
   * @returns {Unsubscribe} Function that removes the listener.
   */
  observe(listener: (change: SheetDocChange) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Stops observing and releases the undo manager. The `Y.Doc` itself is owned by the
   * caller (the realtime client) and is not destroyed here.
   *
   * @returns {void} Nothing.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.strokes.unobserve(this.onStrokesChanged);
    this.meta.unobserve(this.onMetaChanged);
    this.undoManager.destroy();
    this.listeners.clear();
  }

  /**
   * Runs a mutation inside a transaction tagged with the local origin.
   *
   * @param {() => void} mutate - Mutation to run; may touch `strokes` and `meta`.
   * @returns {void} Nothing.
   */
  private transact(mutate: () => void): void {
    this.doc.transact(mutate, this.origin);
  }

  private readonly onStrokesChanged = (
    _event: Y.YMapEvent<StrokeRecord>,
    tx: Y.Transaction,
  ): void => {
    this.sortedCache = null;
    this.notify(tx);
  };

  private readonly onMetaChanged = (_event: Y.YMapEvent<number>, tx: Y.Transaction): void => {
    this.notify(tx);
  };

  /**
   * Notifies listeners with the current state.
   *
   * @param {Y.Transaction} tx - The transaction that caused the change.
   * @returns {void} Nothing.
   */
  private notify(tx: Y.Transaction): void {
    if (this.disposed) return;
    const change: SheetDocChange = {
      strokes: this.getStrokes(),
      heightUnits: this.getHeightUnits(),
      local: tx.origin === this.origin,
    };
    for (const listener of Array.from(this.listeners)) listener(change);
  }
}
