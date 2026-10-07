import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  docName,
  type Question,
  type Session,
  SESSION_DOC_KEYS,
  SHEET_DOC_KEYS,
  type Sheet,
  type User,
} from '@live-class/shared';

import { startTestServer, type TestServer } from '../test/helpers.js';
import { authorizeDocument } from './hocuspocus.js';

let server: TestServer;
let baseUrl: string;
let wsUrl: string;
let admin: string;
let mentor: string;
let student: string;
let session: Session;
let sheet: Sheet;

/**
 * Connects a provider for a document with a token and resolves once synced.
 *
 * @param {string} name - Document name.
 * @param {string} token - Bearer token.
 * @returns {Promise<{ provider: HocuspocusProvider; socket: HocuspocusProviderWebsocket; doc: Y.Doc; scope: string | null }>} Connected pieces.
 */
async function connect(name: string, token: string) {
  const socket = new HocuspocusProviderWebsocket({
    url: wsUrl,
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
  });
  const doc = new Y.Doc();
  let scope: string | null = null;
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name,
    document: doc,
    token,
    onAuthenticated: ({ scope: granted }: { scope: string }) => {
      scope = granted;
    },
  });
  provider.attach();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sync timeout for ${name}`)), 8000);
    provider.on('synced', () => {
      clearTimeout(timer);
      resolve();
    });
    provider.on('authenticationFailed', (payload: unknown) => {
      clearTimeout(timer);
      reject(new Error(`authentication failed: ${JSON.stringify(payload)}`));
    });
  });
  return { provider, socket, doc, scope: () => scope };
}

beforeAll(async () => {
  server = await startTestServer();
  await server.app.listen({ port: 0, host: '127.0.0.1' });
  const address = server.app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/realtime`;
  admin = (await server.login('admin@local.test')).token;
  mentor = (await server.login('mentor@local.test')).token;
  student = (await server.login('student@local.test')).token;

  const users = (
    await server.app.inject({ method: 'GET', url: '/users', headers: server.auth(admin) })
  ).json() as User[];
  session = (
    await server.app.inject({
      method: 'POST',
      url: '/sessions',
      headers: server.auth(admin),
      payload: { title: 'RT' },
    })
  ).json() as Session;
  for (const role of ['mentor', 'student'] as const) {
    await server.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/participants`,
      headers: server.auth(admin),
      payload: { userId: users.find((u) => u.role === role)!.id, role },
    });
  }
  const question = (
    await server.app.inject({
      method: 'POST',
      url: '/questions',
      headers: server.auth(admin),
      payload: { kind: 'text', title: 'RT Q', altText: 'alt', textMarkdown: 'x' },
    })
  ).json() as Question;
  const opened = await server.app.inject({
    method: 'POST',
    url: `/sessions/${session.id}/questions/${question.id}/open`,
    headers: server.auth(mentor),
    payload: {},
  });
  sheet = (opened.json() as { sheets: Sheet[] }).sheets[0]!;
}, 60_000);

afterAll(async () => {
  await server.stop();
});

describe('authorizeDocument', () => {
  it('grants participants write access and admins read-only access', async () => {
    const deps = { tokens: server.services.tokens, sessions: server.services.sessions };
    const asMentor = await authorizeDocument(deps, mentor, docName('sheet', sheet.id));
    expect(asMentor).toMatchObject({
      participantRole: 'mentor',
      readOnly: false,
      sessionId: session.id,
    });
    const asStudent = await authorizeDocument(deps, student, docName('session', session.id));
    expect(asStudent).toMatchObject({ participantRole: 'student', readOnly: false });
    const asAdmin = await authorizeDocument(deps, admin, docName('session', session.id));
    expect(asAdmin).toMatchObject({ participantRole: null, readOnly: true });
  });

  it('rejects bad tokens, bad names and unknown documents', async () => {
    const deps = { tokens: server.services.tokens, sessions: server.services.sessions };
    await expect(authorizeDocument(deps, 'bad', docName('sheet', sheet.id))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(authorizeDocument(deps, mentor, 'nonsense')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(
      authorizeDocument(deps, mentor, docName('sheet', '0192f1e0-0000-7000-8000-000000000000')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('live sync over WebSocket', () => {
  it('delivers a stroke from the mentor to the student and persists it', async () => {
    const name = docName('sheet', sheet.id);
    const a = await connect(name, mentor);
    const b = await connect(name, student);
    try {
      const strokes = a.doc.getMap(SHEET_DOC_KEYS.strokes);
      const arrived = new Promise<void>((resolve) => {
        b.doc.getMap(SHEET_DOC_KEYS.strokes).observe(() => resolve());
      });
      a.doc.transact(() => {
        strokes.set('s1', { id: 's1', points: [0, 0, 0.5] });
      });
      await arrived;
      expect(b.doc.getMap(SHEET_DOC_KEYS.strokes).get('s1')).toMatchObject({ id: 's1' });
      expect(a.scope()).toBe('read-write');
    } finally {
      a.provider.destroy();
      b.provider.destroy();
      a.socket.destroy();
      b.socket.destroy();
    }

    // Persistence: a fresh connection after the debounce window sees the stroke.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const c = await connect(name, mentor);
    try {
      expect(c.doc.getMap(SHEET_DOC_KEYS.strokes).get('s1')).toMatchObject({ id: 's1' });
    } finally {
      c.provider.destroy();
      c.socket.destroy();
    }
  }, 30_000);

  it('appends sheets to the session document when a question is opened', async () => {
    const name = docName('session', session.id);
    const a = await connect(name, student);
    try {
      const order = a.doc.getArray<string>(SESSION_DOC_KEYS.sheetOrder).toArray();
      expect(order).toContain(sheet.id);
      expect(a.doc.getMap(SESSION_DOC_KEYS.meta).get(SESSION_DOC_KEYS.currentSheetId)).toBe(
        sheet.id,
      );
    } finally {
      a.provider.destroy();
      a.socket.destroy();
    }
  }, 20_000);

  it('refuses a token that is not a participant', async () => {
    const socket = new HocuspocusProviderWebsocket({
      url: wsUrl,
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    });
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: docName('sheet', sheet.id),
      token: 'nope',
    });
    provider.attach();
    const failed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 8000);
      provider.on('authenticationFailed', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    provider.destroy();
    socket.destroy();
    expect(failed).toBe(true);
    expect(baseUrl).toMatch(/^http:/);
  }, 20_000);
});
