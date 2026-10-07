import { asSheetId, type AwarenessState, newId, type StrokeStyle } from '@live-class/shared';
import { describe, expect, it, vi } from 'vitest';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { Presence } from './presence.js';

const style: StrokeStyle = { tool: 'pen', color: '#111827', sizeUnits: 2 };

/**
 * Builds an initial awareness state.
 *
 * @param {string} name - Display name.
 * @returns {AwarenessState} State with no pen.
 */
function initial(name: string): AwarenessState {
  return {
    user: { id: newId(), name, role: 'mentor', color: '#1d4ed8' },
    viewingSheetId: null,
    followMentor: false,
    pen: null,
  };
}

/**
 * Links two awareness instances so each sees the other's state.
 *
 * @param {Awareness} a - First.
 * @param {Awareness} b - Second.
 * @returns {void} Nothing.
 */
function link(a: Awareness, b: Awareness): void {
  a.on(
    'update',
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      applyAwarenessUpdate(
        b,
        encodeAwarenessUpdate(a, [...added, ...updated, ...removed]),
        'remote',
      );
    },
  );
  b.on(
    'update',
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      applyAwarenessUpdate(
        a,
        encodeAwarenessUpdate(b, [...added, ...updated, ...removed]),
        'remote',
      );
    },
  );
}

describe('Presence', () => {
  it('publishes the local state and exposes validated peers', () => {
    const awarenessA = new Awareness(new Y.Doc());
    const awarenessB = new Awareness(new Y.Doc());
    link(awarenessA, awarenessB);
    const a = new Presence(awarenessA, initial('Asha'));
    const b = new Presence(awarenessB, initial('Ben'));
    const peersOfA = a.getPeers();
    expect(peersOfA).toHaveLength(1);
    expect(peersOfA[0]?.state.user.name).toBe('Ben');
    expect(b.getPeers()[0]?.state.user.name).toBe('Asha');
    a.dispose();
    b.dispose();
  });

  it('throttles pen updates and flushes the latest one', () => {
    let now = 0;
    const timers: { callback: () => void; ms: number }[] = [];
    const awareness = new Awareness(new Y.Doc());
    const presence = new Presence(awareness, initial('Asha'), {
      throttleMs: 30,
      now: () => now,
      setTimer: (callback, ms) => {
        timers.push({ callback, ms });
        return timers.length;
      },
      clearTimer: () => undefined,
    });
    const sheetId = asSheetId(newId());
    now = 1000;
    presence.streamPen(sheetId, style, [0, 0, 0.5]);
    expect(presence.localState.pen?.points).toEqual([0, 0, 0.5]);
    now = 1010;
    presence.streamPen(sheetId, style, [0, 0, 0.5, 1, 1, 0.5]);
    now = 1015;
    presence.streamPen(sheetId, style, [0, 0, 0.5, 1, 1, 0.5, 2, 2, 0.5]);
    expect(presence.localState.pen?.points).toEqual([0, 0, 0.5]); // not yet flushed
    expect(timers).toHaveLength(1);
    now = 1030;
    timers[0]?.callback();
    expect(presence.localState.pen?.points).toHaveLength(9);
    presence.clearPen();
    expect(presence.localState.pen).toBeNull();
    presence.dispose();
  });

  it('notifies on peer changes and clears itself on dispose', () => {
    const awarenessA = new Awareness(new Y.Doc());
    const awarenessB = new Awareness(new Y.Doc());
    link(awarenessA, awarenessB);
    const a = new Presence(awarenessA, initial('Asha'));
    const listener = vi.fn();
    a.onChange(listener);
    const b = new Presence(awarenessB, initial('Ben'));
    expect(listener).toHaveBeenCalled();
    b.dispose();
    expect(a.getPeers()).toHaveLength(0);
    a.setLocal({ followMentor: true });
    expect(a.localState.followMentor).toBe(true);
    a.dispose();
  });

  it('rejects an invalid initial state', () => {
    const awareness = new Awareness(new Y.Doc());
    expect(
      () =>
        new Presence(awareness, { ...initial('x'), user: { ...initial('x').user, color: 'red' } }),
    ).toThrow();
  });
});
