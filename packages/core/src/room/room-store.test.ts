import {
  asQuestionId,
  asSessionId,
  asSheetId,
  asUserId,
  computeSheetGeometry,
  docName,
  type Me,
  newId,
  type Question,
  type Session,
  type Sheet,
} from '@live-class/shared';
import { describe, expect, it, vi } from 'vitest';

import { LiveClassApi } from '../api/client.js';
import { SessionDoc } from '../sync/session-doc.js';
import { FakeRealtime, FakeRealtimeHub } from '../test/fake-realtime.js';
import { RoomStore } from './room-store.js';

const mentorId = asUserId(newId());
const studentId = asUserId(newId());
const sessionId = asSessionId(newId());
const questionId = asQuestionId(newId());

const question: Question = {
  id: questionId,
  kind: 'text',
  title: 'Q1',
  altText: 'alt',
  tags: [],
  textMarkdown: 'x',
  asset: null,
  pageCount: 1,
  createdBy: mentorId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const sheetA: Sheet = {
  id: asSheetId(newId()),
  sessionId,
  questionId,
  pageIndex: 0,
  position: 0,
  geometry: computeSheetGeometry({ width: 1000, height: 500 }),
  createdAt: new Date().toISOString(),
};
const sheetB: Sheet = { ...sheetA, id: asSheetId(newId()), position: 1 };
const session: Session = {
  id: sessionId,
  title: 'Algebra',
  status: 'live',
  scheduledAt: null,
  startedAt: null,
  endedAt: null,
  participants: [
    { userId: mentorId, displayName: 'Asha', role: 'mentor' },
    { userId: studentId, displayName: 'Ben', role: 'student' },
  ],
  createdBy: mentorId,
  createdAt: new Date().toISOString(),
};

/**
 * Builds an API client whose fetch answers the room's routes from fixtures.
 *
 * @param {Sheet[]} sheets - Sheets to return.
 * @returns {LiveClassApi} The client.
 */
function fakeApi(sheets: Sheet[]): LiveClassApi {
  const fetchImpl = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    let body: unknown = { code: 'NOT_FOUND', message: path };
    let status = 404;
    if (path === `/sessions/${sessionId}`) {
      body = session;
      status = 200;
    } else if (path === `/sessions/${sessionId}/sheets`) {
      body = sheets;
      status = 200;
    } else if (path === `/sessions/${sessionId}/questions/${questionId}`) {
      body = question;
      status = 200;
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return new LiveClassApi({ baseUrl: 'https://api.test', getToken: () => 't', fetchImpl });
}

const mentor: Me = { id: mentorId, displayName: 'Asha', role: 'mentor' };
const student: Me = { id: studentId, displayName: 'Ben', role: 'student' };

/**
 * Waits until the store's snapshot satisfies a predicate.
 *
 * @param {RoomStore} store - Store to observe.
 * @param {(snapshot: ReturnType<RoomStore['getSnapshot']>) => boolean} predicate - Condition.
 * @returns {Promise<void>} Resolves when satisfied.
 */
function until(
  store: RoomStore,
  predicate: (snapshot: ReturnType<RoomStore['getSnapshot']>) => boolean,
): Promise<void> {
  return vi.waitFor(() => {
    expect(predicate(store.getSnapshot())).toBe(true);
  });
}

describe('RoomStore', () => {
  it('loads the session, sheets and questions, and derives the role', async () => {
    const realtime = new FakeRealtime();
    const store = new RoomStore({ api: fakeApi([sheetA]), realtime, user: mentor, sessionId });
    const listener = vi.fn();
    store.subscribe(listener);
    store.start();
    await until(store, (s) => s.status === 'ready' && s.questions.has(questionId));
    const snapshot = store.getSnapshot();
    expect(snapshot.role).toBe('mentor');
    expect(snapshot.sheets).toHaveLength(1);
    expect(snapshot.viewingSheetId).toBe(sheetA.id);
    expect(snapshot.connection).toBe('connected');
    expect(realtime.opened).toEqual([docName('session', sessionId)]);
    expect(listener).toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(snapshot); // stable until the next change
    store.dispose();
    expect(realtime.closed).toEqual([docName('session', sessionId)]);
  });

  it('reports a failed load through the snapshot', async () => {
    const onError = vi.fn();
    const store = new RoomStore({
      api: fakeApi([]),
      realtime: new FakeRealtime(),
      user: mentor,
      sessionId: asSessionId(newId()),
      onError,
    });
    store.start();
    await until(store, (s) => s.status === 'error');
    expect(store.getSnapshot().error?.code).toBe('NOT_FOUND');
    expect(onError).toHaveBeenCalled();
    store.dispose();
  });

  it('follows the mentor until the student picks a sheet, and can follow again', async () => {
    const hub = new FakeRealtimeHub();
    const mentorStore = new RoomStore({
      api: fakeApi([sheetA, sheetB]),
      realtime: new FakeRealtime(hub),
      user: mentor,
      sessionId,
    });
    const studentStore = new RoomStore({
      api: fakeApi([sheetA, sheetB]),
      realtime: new FakeRealtime(hub),
      user: student,
      sessionId,
    });
    mentorStore.start();
    studentStore.start();
    await until(mentorStore, (s) => s.status === 'ready');
    await until(studentStore, (s) => s.status === 'ready');
    // The server normally seeds the order; simulate it on the shared document.
    new SessionDoc(hub.doc(docName('session', sessionId))).appendSheets(
      [sheetA.id, sheetB.id],
      true,
    );
    await until(studentStore, (s) => s.viewingSheetId === sheetA.id);

    mentorStore.setCurrentSheet(sheetB.id);
    await until(studentStore, (s) => s.viewingSheetId === sheetB.id);
    expect(studentStore.getSnapshot().followMentor).toBe(true);

    studentStore.viewSheet(sheetA.id);
    expect(studentStore.getSnapshot().viewingSheetId).toBe(sheetA.id);
    expect(studentStore.getSnapshot().followMentor).toBe(false);
    mentorStore.setCurrentSheet(sheetA.id);
    mentorStore.setCurrentSheet(sheetB.id);
    expect(studentStore.getSnapshot().viewingSheetId).toBe(sheetA.id);

    studentStore.setFollowMentor(true);
    expect(studentStore.getSnapshot().viewingSheetId).toBe(sheetB.id);

    mentorStore.setStudentCanWrite(false);
    await until(studentStore, (s) => !s.live.studentCanWrite);
    mentorStore.dispose();
    studentStore.dispose();
  });

  it('tracks connection status changes and peers', async () => {
    const hub = new FakeRealtimeHub();
    const realtime = new FakeRealtime(hub);
    const store = new RoomStore({ api: fakeApi([sheetA]), realtime, user: mentor, sessionId });
    store.start();
    await until(store, (s) => s.status === 'ready');
    realtime.setStatus('disconnected');
    expect(store.getSnapshot().connection).toBe('disconnected');
    expect(store.presence?.localState.viewingSheetId).toBe(sheetA.id);
    store.dispose();
  });

  it('refreshes when the session document lists an unknown sheet', async () => {
    const hub = new FakeRealtimeHub();
    const sheets = [sheetA];
    const api = fakeApi(sheets);
    const store = new RoomStore({ api, realtime: new FakeRealtime(hub), user: mentor, sessionId });
    store.start();
    await until(store, (s) => s.status === 'ready');
    sheets.push(sheetB);
    new SessionDoc(hub.doc(docName('session', sessionId))).appendSheets(
      [sheetA.id, sheetB.id],
      true,
    );
    await until(store, (s) => s.sheets.length === 2);
    store.dispose();
  });
});

describe('RoomStore structural sharing', () => {
  it('keeps the identity of unchanged sheets across refreshes (prevents stage remounts)', async () => {
    const sheets = [sheetA];
    const store = new RoomStore({
      api: fakeApi(sheets),
      realtime: new FakeRealtime(),
      user: mentor,
      sessionId,
    });
    store.start();
    await until(store, (s) => s.status === 'ready');
    const before = store.getSnapshot().sheets[0];
    sheets.push(sheetB);
    await store.refresh();
    const after = store.getSnapshot().sheets;
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before);
    store.dispose();
  });
});
