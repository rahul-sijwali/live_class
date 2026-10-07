/**
 * Awareness (presence) wrapper: who is here, what they look at, and their pen in progress.
 *
 * Owns: writing the local awareness state (throttled for the pen), reading and validating
 * peers' states, and change notifications. Does not own the transport (Hocuspocus sends
 * awareness over the same socket as the document).
 */

import { type Awareness } from 'y-protocols/awareness';

import {
  AWARENESS_THROTTLE_MS,
  type AwarenessState,
  AwarenessStateSchema,
  type LivePen,
  type SheetId,
  type StrokeStyle,
} from '@live-class/shared';

import { type Unsubscribe } from '../events.js';

/** A peer's validated awareness state with its connection id. */
export interface PeerState {
  /** Awareness client id of the connection (stable while connected). */
  readonly clientId: number;
  readonly state: AwarenessState;
}

/** Options for `Presence`. */
export interface PresenceOptions {
  /** Throttle interval for pen updates in milliseconds. */
  readonly throttleMs?: number;
  /** Clock, injectable for tests. */
  readonly now?: () => number;
  /** Timer, injectable for tests. */
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  /** Timer canceller matching `setTimer`. */
  readonly clearTimer?: (handle: unknown) => void;
}

/**
 * Manages the local user's awareness state and exposes peers'.
 */
export class Presence {
  private readonly awareness: Awareness;
  private readonly throttleMs: number;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly listeners = new Set<(peers: readonly PeerState[]) => void>();
  private local: AwarenessState;
  private pendingPen: LivePen | null | undefined;
  private pendingTimer: unknown = null;
  private lastPenSentAt = 0;
  private disposed = false;

  /**
   * Creates the wrapper and publishes the initial local state.
   *
   * @param {Awareness} awareness - Awareness instance of the connected document.
   * @param {AwarenessState} initial - Local user's initial state.
   * @param {PresenceOptions} options - Throttle and injectable timers.
   */
  constructor(awareness: Awareness, initial: AwarenessState, options: PresenceOptions = {}) {
    this.awareness = awareness;
    this.throttleMs = options.throttleMs ?? AWARENESS_THROTTLE_MS;
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer =
      options.clearTimer ??
      ((handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      });
    this.local = AwarenessStateSchema.parse(initial);
    this.awareness.setLocalState(this.local);
    this.awareness.on('change', this.onAwarenessChange);
  }

  /**
   * The local state as last published.
   *
   * @returns {AwarenessState} Current local state.
   */
  get localState(): AwarenessState {
    return this.local;
  }

  /**
   * Updates part of the local state (not the pen; use `streamPen`).
   *
   * @param {Partial<Omit<AwarenessState, 'pen'>>} patch - Fields to change.
   * @returns {void} Nothing.
   */
  setLocal(patch: Partial<Omit<AwarenessState, 'pen'>>): void {
    if (this.disposed) return;
    this.local = AwarenessStateSchema.parse({ ...this.local, ...patch });
    this.awareness.setLocalState(this.local);
  }

  /**
   * Publishes the in-progress stroke, throttled to `throttleMs`. Passing `null` (pen up)
   * is sent immediately so peers never see a stale stroke.
   *
   * @param {SheetId} sheetId - Sheet being drawn on.
   * @param {StrokeStyle} style - Tool, colour and width.
   * @param {readonly number[]} points - Flat `[x, y, pressure, …]` points so far.
   * @returns {void} Nothing.
   */
  streamPen(sheetId: SheetId, style: StrokeStyle, points: readonly number[]): void {
    this.queuePen({ sheetId, style, points: [...points] });
  }

  /**
   * Clears the in-progress stroke (pen up or cancel). Sent immediately.
   *
   * @returns {void} Nothing.
   */
  clearPen(): void {
    this.queuePen(null);
  }

  /**
   * Validated states of every other connection.
   *
   * @returns {readonly PeerState[]} Peers; connections with invalid state are skipped.
   */
  getPeers(): readonly PeerState[] {
    const peers: PeerState[] = [];
    for (const [clientId, raw] of this.awareness.getStates()) {
      if (clientId === this.awareness.clientID) continue;
      const parsed = AwarenessStateSchema.safeParse(raw);
      if (parsed.success) peers.push({ clientId, state: parsed.data });
    }
    return peers;
  }

  /**
   * Subscribes to peer changes.
   *
   * @param {(peers: readonly PeerState[]) => void} listener - Called with the full peer list.
   * @returns {Unsubscribe} Function that removes the listener.
   */
  onChange(listener: (peers: readonly PeerState[]) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Clears the local state so peers see this user leave, and stops listening.
   *
   * @returns {void} Nothing.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pendingTimer !== null) this.clearTimer(this.pendingTimer);
    this.awareness.off('change', this.onAwarenessChange);
    this.awareness.setLocalState(null);
    this.listeners.clear();
  }

  /**
   * Applies pen throttling: immediate when due or clearing, otherwise deferred.
   *
   * @param {LivePen | null} pen - Pen state to publish.
   * @returns {void} Nothing.
   */
  private queuePen(pen: LivePen | null): void {
    if (this.disposed) return;
    const elapsed = this.now() - this.lastPenSentAt;
    if (pen === null || elapsed >= this.throttleMs) {
      if (this.pendingTimer !== null) {
        this.clearTimer(this.pendingTimer);
        this.pendingTimer = null;
      }
      this.pendingPen = undefined;
      this.publishPen(pen);
      return;
    }
    this.pendingPen = pen;
    if (this.pendingTimer === null) {
      this.pendingTimer = this.setTimer(() => {
        this.pendingTimer = null;
        if (this.pendingPen !== undefined) {
          const next = this.pendingPen;
          this.pendingPen = undefined;
          this.publishPen(next);
        }
      }, this.throttleMs - elapsed);
    }
  }

  /**
   * Writes the pen into the local awareness state.
   *
   * @param {LivePen | null} pen - Pen state to publish.
   * @returns {void} Nothing.
   */
  private publishPen(pen: LivePen | null): void {
    this.lastPenSentAt = this.now();
    this.local = { ...this.local, pen };
    this.awareness.setLocalState(this.local);
  }

  private readonly onAwarenessChange = (): void => {
    if (this.disposed) return;
    const peers = this.getPeers();
    for (const listener of Array.from(this.listeners)) listener(peers);
  };
}
