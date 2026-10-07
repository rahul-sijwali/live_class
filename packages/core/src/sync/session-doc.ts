/**
 * Typed access to a session's realtime document.
 *
 * Owns: the ordered list of sheets and the session-level live settings (current sheet,
 * student-can-write). Sheets are appended by the server when a question is opened and the
 * mentor changes the settings; students only read.
 */

import type * as Y from 'yjs';

import { SESSION_DOC_KEYS, type SheetId, SheetIdSchema } from '@live-class/shared';

import { type Unsubscribe } from '../events.js';

/** Snapshot of the session document. */
export interface SessionDocState {
  /** Sheets in display order. */
  readonly sheetOrder: readonly SheetId[];
  /** Sheet the mentor is showing, or null before any question is opened. */
  readonly currentSheetId: SheetId | null;
  /** Whether the student may write right now (defaults to true). */
  readonly studentCanWrite: boolean;
}

/**
 * Wraps the session `Y.Doc`.
 */
export class SessionDoc {
  /** Transaction origin for local mutations. */
  readonly origin: object = { kind: 'local' };

  private readonly doc: Y.Doc;
  private readonly sheetOrder: Y.Array<string>;
  private readonly meta: Y.Map<string | boolean>;
  private readonly listeners = new Set<(state: SessionDocState) => void>();
  private disposed = false;

  /**
   * Creates the wrapper. Call `dispose()` when leaving the room.
   *
   * @param {Y.Doc} doc - The session's document.
   */
  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.sheetOrder = doc.getArray<string>(SESSION_DOC_KEYS.sheetOrder);
    this.meta = doc.getMap<string | boolean>(SESSION_DOC_KEYS.meta);
    this.sheetOrder.observe(this.onChanged);
    this.meta.observe(this.onChanged);
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
   * Current state of the document.
   *
   * @returns {SessionDocState} Sheet order and live settings. Invalid sheet ids are skipped.
   */
  getState(): SessionDocState {
    const sheetOrder: SheetId[] = [];
    for (const value of this.sheetOrder.toArray()) {
      const parsed = SheetIdSchema.safeParse(value);
      if (parsed.success) sheetOrder.push(parsed.data);
    }
    const current = SheetIdSchema.safeParse(this.meta.get(SESSION_DOC_KEYS.currentSheetId));
    const studentCanWrite = this.meta.get(SESSION_DOC_KEYS.studentCanWrite);
    return {
      sheetOrder,
      currentSheetId: current.success ? current.data : null,
      studentCanWrite: typeof studentCanWrite === 'boolean' ? studentCanWrite : true,
    };
  }

  /**
   * Appends sheets to the order (skipping ids already present) and optionally makes the
   * first new one current. Used by the server after creating sheets.
   *
   * @param {readonly SheetId[]} sheetIds - Sheet ids to append, in order.
   * @param {boolean} makeCurrent - Whether to switch the current sheet to the first new one.
   * @returns {void} Nothing.
   */
  appendSheets(sheetIds: readonly SheetId[], makeCurrent: boolean): void {
    const existing = new Set(this.sheetOrder.toArray());
    const fresh = sheetIds.filter((id) => !existing.has(id));
    if (fresh.length === 0) return;
    this.doc.transact(() => {
      this.sheetOrder.push([...fresh]);
      const first = fresh[0];
      if (makeCurrent && first !== undefined) this.meta.set(SESSION_DOC_KEYS.currentSheetId, first);
    }, this.origin);
  }

  /**
   * Changes the sheet the mentor is showing.
   *
   * @param {SheetId} sheetId - A sheet present in the order.
   * @returns {void} Nothing.
   * @throws {Error} If the sheet is not part of this session.
   */
  setCurrentSheet(sheetId: SheetId): void {
    if (!this.sheetOrder.toArray().includes(sheetId)) {
      throw new Error(`Sheet ${sheetId} is not part of this session`);
    }
    this.doc.transact(() => {
      this.meta.set(SESSION_DOC_KEYS.currentSheetId, sheetId);
    }, this.origin);
  }

  /**
   * Toggles whether the student may write.
   *
   * @param {boolean} allowed - True to allow student ink.
   * @returns {void} Nothing.
   */
  setStudentCanWrite(allowed: boolean): void {
    this.doc.transact(() => {
      this.meta.set(SESSION_DOC_KEYS.studentCanWrite, allowed);
    }, this.origin);
  }

  /**
   * Subscribes to changes from any client.
   *
   * @param {(state: SessionDocState) => void} listener - Called after each change.
   * @returns {Unsubscribe} Function that removes the listener.
   */
  observe(listener: (state: SessionDocState) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Stops observing. The `Y.Doc` is owned by the caller.
   *
   * @returns {void} Nothing.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sheetOrder.unobserve(this.onChanged);
    this.meta.unobserve(this.onChanged);
    this.listeners.clear();
  }

  private readonly onChanged = (): void => {
    if (this.disposed) return;
    const state = this.getState();
    for (const listener of Array.from(this.listeners)) listener(state);
  };
}
