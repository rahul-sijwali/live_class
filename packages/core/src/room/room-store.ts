/**
 * Everything a class room needs to know, kept in one observable store.
 *
 * Owns: loading the session, sheets and questions over REST; opening the session's
 * realtime document and presence; deciding which sheet the user is viewing (follow mode);
 * and publishing immutable snapshots. UI layers (React or anything else) subscribe and
 * render; they never talk to the API or Yjs for room state themselves.
 */

import {
  type AppError,
  type ConnectionStatus,
  DEFAULT_PEN_COLOR_BY_ROLE,
  docName,
  isAppError,
  AppError as AppErrorClass,
  type Me,
  type ParticipantRole,
  type Question,
  type QuestionId,
  type Session,
  type SessionId,
  type Sheet,
  type SheetId,
} from '@live-class/shared';

import { type LiveClassApi } from '../api/client.js';
import { type Unsubscribe } from '../events.js';
import { type PeerState, Presence } from '../sync/presence.js';
import { type ConnectedDoc } from '../sync/realtime-client.js';
import { SessionDoc, type SessionDocState } from '../sync/session-doc.js';

/** The subset of `RealtimeClient` a room needs; tests inject an in-memory implementation. */
export interface RealtimeConnection {
  /**
   * Opens (or returns the already open) realtime document.
   *
   * @param {string} name - Document name such as `session:<id>`.
   * @returns {ConnectedDoc} The connected document.
   */
  openDoc(name: string): ConnectedDoc;
  /**
   * Subscribes to socket status changes.
   *
   * @param {(status: ConnectionStatus) => void} listener - Called on each change.
   * @returns {Unsubscribe} Function that removes the listener.
   */
  onStatus(listener: (status: ConnectionStatus) => void): Unsubscribe;
  /** Current socket status. */
  readonly status: ConnectionStatus;
}

/** Immutable view of the room at one instant. */
export interface RoomSnapshot {
  readonly status: 'loading' | 'ready' | 'error';
  readonly error: AppError | null;
  readonly session: Session | null;
  /** The user's role in the session; null for an admin observing. */
  readonly role: ParticipantRole | null;
  readonly sheets: readonly Sheet[];
  readonly questions: ReadonlyMap<QuestionId, Question>;
  readonly live: SessionDocState;
  readonly connection: ConnectionStatus;
  readonly peers: readonly PeerState[];
  /** Sheet this user sees (follows the mentor unless the student opted out). */
  readonly viewingSheetId: SheetId | null;
  readonly followMentor: boolean;
}

/** Construction options. */
export interface RoomStoreOptions {
  readonly api: LiveClassApi;
  readonly realtime: RealtimeConnection;
  readonly user: Me;
  readonly sessionId: SessionId;
  /** Receives every error the store absorbs (for the host's reporting). */
  readonly onError?: (error: AppError) => void;
}

const EMPTY_LIVE: SessionDocState = { sheetOrder: [], currentSheetId: null, studentCanWrite: true };

/**
 * Observable room state with the loading and realtime logic behind it.
 *
 * @example
 *   const store = new RoomStore({ api, realtime, user, sessionId });
 *   const off = store.subscribe(() => render(store.getSnapshot()));
 *   store.start();
 *   // later
 *   off(); store.dispose();
 */
export class RoomStore {
  private readonly options: RoomStoreOptions;
  private readonly listeners = new Set<() => void>();
  private snapshot: RoomSnapshot;
  private connected: ConnectedDoc | null = null;
  private sessionDocWrapper: SessionDoc | null = null;
  private presenceWrapper: Presence | null = null;
  private subscriptions: Unsubscribe[] = [];
  private manualSheetId: SheetId | null = null;
  private followMentor = true;
  private started = false;
  private disposed = false;
  private loadingQuestions = new Set<QuestionId>();

  /**
   * Creates the store without touching the network. Call `start()`.
   *
   * @param {RoomStoreOptions} options - API, realtime, user and session.
   */
  constructor(options: RoomStoreOptions) {
    this.options = options;
    this.snapshot = {
      status: 'loading',
      error: null,
      session: null,
      role: null,
      sheets: [],
      questions: new Map(),
      live: EMPTY_LIVE,
      connection: options.realtime.status,
      peers: [],
      viewingSheetId: null,
      followMentor: true,
    };
  }

  /**
   * Current snapshot. The same object is returned until something changes, so it is safe
   * for `useSyncExternalStore`.
   *
   * @returns {RoomSnapshot} The latest state.
   */
  getSnapshot = (): RoomSnapshot => this.snapshot;

  /**
   * Subscribes to snapshot changes.
   *
   * @param {() => void} listener - Called after every change; read `getSnapshot()` inside.
   * @returns {Unsubscribe} Function that removes the listener.
   */
  subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Room-level presence, once the session document is open.
   *
   * @returns {Presence | null} Presence, or null before `start()` finished connecting.
   */
  get presence(): Presence | null {
    return this.presenceWrapper;
  }

  /**
   * The live session document wrapper, for mentor controls.
   *
   * @returns {SessionDoc | null} Wrapper, or null before connecting.
   */
  get sessionDoc(): SessionDoc | null {
    return this.sessionDocWrapper;
  }

  /**
   * Loads the room and connects to realtime. Idempotent.
   *
   * @returns {void} Nothing.
   */
  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    void this.refresh();
  }

  /**
   * Re-fetches the session and its sheets, then connects realtime if not yet connected.
   *
   * @returns {Promise<void>} Resolves when the snapshot is updated (errors are absorbed and
   *   reported through the snapshot).
   */
  async refresh(): Promise<void> {
    const { api, sessionId } = this.options;
    try {
      const [session, sheets] = await Promise.all([
        api.call('getSession', { params: { id: sessionId } }),
        api.call('listSheets', { params: { id: sessionId } }),
      ]);
      if (this.disposed) return;
      const participant = session.participants.find((p) => p.userId === this.options.user.id);
      const role = participant?.role ?? null;
      // Structural sharing: keep the previous object for sheets that did not change so React
      // dependencies keyed on identity do not churn.
      const previousById = new Map(this.snapshot.sheets.map((s) => [s.id, s]));
      const stableSheets = sheets.map((next) => {
        const previous = previousById.get(next.id);
        return previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
      });
      this.update({ session, sheets: stableSheets, role, status: 'ready', error: null });
      this.connect(role);
      this.loadMissingQuestions();
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * Chooses the sheet to view. Students leave follow mode when they pick manually.
   *
   * @param {SheetId} sheetId - Sheet to show.
   * @returns {void} Nothing.
   */
  viewSheet(sheetId: SheetId): void {
    this.manualSheetId = sheetId;
    if (this.snapshot.role === 'student') this.followMentor = false;
    this.recomputeViewing();
  }

  /**
   * Turns follow mode on or off.
   *
   * @param {boolean} follow - True to follow the mentor's current sheet.
   * @returns {void} Nothing.
   */
  setFollowMentor(follow: boolean): void {
    this.followMentor = follow;
    if (follow) this.manualSheetId = null;
    this.recomputeViewing();
  }

  /**
   * Mentor control: makes a sheet current for everyone.
   *
   * @param {SheetId} sheetId - Sheet to present.
   * @returns {void} Nothing.
   * @throws {Error} If the sheet is not part of the session or the document is not open.
   */
  setCurrentSheet(sheetId: SheetId): void {
    if (!this.sessionDocWrapper) throw new Error('Session document is not open yet');
    this.sessionDocWrapper.setCurrentSheet(sheetId);
  }

  /**
   * Mentor control: allows or blocks student writing.
   *
   * @param {boolean} allowed - True to allow.
   * @returns {void} Nothing.
   */
  setStudentCanWrite(allowed: boolean): void {
    this.sessionDocWrapper?.setStudentCanWrite(allowed);
  }

  /**
   * Disconnects and releases everything. Safe to call twice.
   *
   * @returns {void} Nothing.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.subscriptions.splice(0)) off();
    this.presenceWrapper?.dispose();
    this.sessionDocWrapper?.dispose();
    this.connected?.close();
    this.presenceWrapper = null;
    this.sessionDocWrapper = null;
    this.connected = null;
    this.listeners.clear();
  }

  /**
   * Opens the session document and presence once the role is known.
   *
   * @param {ParticipantRole | null} role - The user's role in the session.
   * @returns {void} Nothing.
   */
  private connect(role: ParticipantRole | null): void {
    if (this.connected || this.disposed) return;
    const { realtime, sessionId, user } = this.options;
    let connected: ConnectedDoc;
    try {
      connected = realtime.openDoc(docName('session', sessionId));
    } catch (error) {
      this.fail(error);
      return;
    }
    this.connected = connected;
    const doc = new SessionDoc(connected.doc);
    const presenceRole: ParticipantRole = role ?? 'mentor';
    const presence = new Presence(connected.awareness, {
      user: {
        id: user.id,
        name: user.displayName,
        role: presenceRole,
        color: DEFAULT_PEN_COLOR_BY_ROLE[presenceRole],
      },
      viewingSheetId: null,
      followMentor: role === 'student',
      pen: null,
    });
    this.sessionDocWrapper = doc;
    this.presenceWrapper = presence;
    this.subscriptions.push(
      doc.observe((live) => {
        this.update({ live });
        const known = new Set(this.snapshot.sheets.map((s) => s.id));
        if (live.sheetOrder.some((id) => !known.has(id))) void this.refresh();
        this.recomputeViewing();
      }),
      presence.onChange((peers) => {
        this.update({ peers });
      }),
      connected.on('status', (connection) => {
        this.update({ connection });
      }),
    );
    this.update({ live: doc.getState(), peers: presence.getPeers(), connection: connected.status });
    this.recomputeViewing();
  }

  /**
   * Fetches any question referenced by a sheet that is not loaded yet.
   *
   * @returns {void} Nothing (updates the snapshot as results arrive).
   */
  private loadMissingQuestions(): void {
    const { api, sessionId } = this.options;
    const missing = Array.from(new Set(this.snapshot.sheets.map((s) => s.questionId))).filter(
      (id) => !this.snapshot.questions.has(id) && !this.loadingQuestions.has(id),
    );
    for (const questionId of missing) {
      this.loadingQuestions.add(questionId);
      api
        .call('getSessionQuestion', { params: { id: sessionId, questionId } })
        .then((question) => {
          this.loadingQuestions.delete(questionId);
          if (this.disposed) return;
          const questions = new Map(this.snapshot.questions);
          questions.set(question.id, question);
          this.update({ questions });
        })
        .catch((error: unknown) => {
          this.loadingQuestions.delete(questionId);
          this.report(error);
        });
    }
  }

  /**
   * Recomputes `viewingSheetId` from live state, follow mode and manual choice, and
   * publishes it through presence.
   *
   * @returns {void} Nothing.
   */
  private recomputeViewing(): void {
    const { live, sheets, role } = this.snapshot;
    const order = live.sheetOrder.length > 0 ? live.sheetOrder : sheets.map((s) => s.id);
    let viewing: SheetId | null;
    if (role === 'student' && this.followMentor) {
      viewing = live.currentSheetId ?? order[0] ?? null;
    } else if (this.manualSheetId && order.includes(this.manualSheetId)) {
      viewing = this.manualSheetId;
    } else {
      viewing = live.currentSheetId ?? order[0] ?? null;
    }
    const followMentor = role === 'student' && this.followMentor;
    this.update({ viewingSheetId: viewing, followMentor });
    this.presenceWrapper?.setLocal({ viewingSheetId: viewing, followMentor });
  }

  /**
   * Replaces part of the snapshot and notifies listeners when anything changed.
   *
   * @param {Partial<RoomSnapshot>} patch - Fields to change.
   * @returns {void} Nothing.
   */
  private update(patch: Partial<RoomSnapshot>): void {
    if (this.disposed) return;
    let changed = false;
    for (const key of Object.keys(patch) as (keyof RoomSnapshot)[]) {
      if (this.snapshot[key] !== patch[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of Array.from(this.listeners)) listener();
  }

  /**
   * Records a fatal error in the snapshot and reports it.
   *
   * @param {unknown} error - Anything thrown.
   * @returns {void} Nothing.
   */
  private fail(error: unknown): void {
    const appError = this.report(error);
    this.update({ status: 'error', error: appError });
  }

  /**
   * Normalises and reports an error without changing the snapshot status.
   *
   * @param {unknown} error - Anything thrown.
   * @returns {AppError} The normalised error.
   */
  private report(error: unknown): AppError {
    const appError = isAppError(error)
      ? error
      : new AppErrorClass('INTERNAL', error instanceof Error ? error.message : 'Unexpected error', {
          cause: error,
        });
    this.options.onError?.(appError);
    return appError;
  }
}
