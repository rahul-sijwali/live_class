'use client';
/**
 * React binding for `RoomStore`: one store per session, subscribed with
 * `useSyncExternalStore`, started and disposed with the component.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { RoomStore, type RoomSnapshot } from '@live-class/core';
import { type SessionId } from '@live-class/shared';

import { useLiveClass } from '../context.js';

/** The room snapshot plus the store for actions. */
export interface RoomState {
  readonly snapshot: RoomSnapshot;
  readonly store: RoomStore;
}

/**
 * Joins a session room and keeps the component in sync with it.
 *
 * @param {SessionId} sessionId - Session to join.
 * @returns {RoomState} Latest snapshot and the store for actions (view sheet, follow,
 *   mentor controls, refresh).
 */
export function useRoom(sessionId: SessionId): RoomState {
  const { api, realtime, user, reportError } = useLiveClass();
  const store = useMemo(
    () => new RoomStore({ api, realtime, user, sessionId, onError: reportError }),
    [api, realtime, user, sessionId, reportError],
  );
  useEffect(() => {
    store.start();
    return () => {
      store.dispose();
    };
  }, [store]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { snapshot, store };
}
