/**
 * Shared fixtures for React tests: a fake API (fetch router over in-memory records), an
 * in-memory realtime hub, and a provider wrapper.
 */

import { type ReactNode } from 'react';
import { vi } from 'vitest';

import { LiveClassApi } from '@live-class/core';
import { FakeRealtime, FakeRealtimeHub } from '@live-class/core/testing';
import {
  asQuestionId,
  asSessionId,
  asSheetId,
  asUserId,
  computeSheetGeometry,
  type Me,
  newId,
  type Question,
  type Session,
  type SessionQuestion,
  type Sheet,
  type User,
} from '@live-class/shared';

import { LiveClassProvider } from '../context.js';

export const mentor: Me = { id: asUserId(newId()), displayName: 'Mentor Asha', role: 'mentor' };
export const student: Me = { id: asUserId(newId()), displayName: 'Student Ben', role: 'student' };
export const admin: Me = { id: asUserId(newId()), displayName: 'Admin', role: 'admin' };
export const sessionId = asSessionId(newId());

export const question: Question = {
  id: asQuestionId(newId()),
  kind: 'text',
  title: 'Quadratics',
  altText: 'Solve a quadratic',
  tags: ['algebra'],
  textMarkdown: 'Solve $x^2 = 4$',
  asset: null,
  pageCount: 1,
  createdBy: mentor.id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const sheet: Sheet = {
  id: asSheetId(newId()),
  sessionId,
  questionId: question.id,
  pageIndex: 0,
  position: 0,
  geometry: computeSheetGeometry({ width: 1000, height: 400 }),
  createdAt: new Date().toISOString(),
};

export const session: Session = {
  id: sessionId,
  title: 'Monday algebra',
  status: 'live',
  scheduledAt: null,
  startedAt: null,
  endedAt: null,
  participants: [
    { userId: mentor.id, displayName: mentor.displayName, role: 'mentor' },
    { userId: student.id, displayName: student.displayName, role: 'student' },
  ],
  createdBy: admin.id,
  createdAt: new Date().toISOString(),
};

/** Users as the admin list endpoint returns them. */
export const users: User[] = [
  { id: admin.id, displayName: admin.displayName, role: 'admin', createdAt: session.createdAt },
  { id: mentor.id, displayName: mentor.displayName, role: 'mentor', createdAt: session.createdAt },
  {
    id: student.id,
    displayName: student.displayName,
    role: 'student',
    createdAt: session.createdAt,
  },
];

/** Mutable records the fake API serves. */
export interface FakeRecords {
  me: Me;
  session: Session;
  sheets: Sheet[];
  questions: Question[];
  attached: SessionQuestion[];
  sessions?: Session[];
}

/** One recorded request. */
export interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/**
 * Builds a fake API client that routes requests to in-memory records and applies writes.
 *
 * @param {FakeRecords} records - Records to serve (mutated by write requests).
 * @returns {{ api: LiveClassApi; calls: RecordedCall[] }} The client and the request log.
 */
export function fakeApi(records: FakeRecords): { api: LiveClassApi; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const sessions = records.sessions ?? [records.session];
  const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method, path: pathname, body });
    const respond = (payload: unknown, status = 200): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const notFound = (): Promise<Response> =>
      respond({ code: 'NOT_FOUND', message: `unhandled ${method} ${pathname}` }, 404);

    if (pathname === '/me') return respond(records.me);
    if (pathname === '/users') return respond(users);
    if (pathname === '/sessions' && method === 'GET') return respond(sessions);
    if (pathname === '/sessions' && method === 'POST') {
      const created: Session = {
        ...session,
        id: asSessionId(newId()),
        title: (body as { title: string }).title,
        status: 'scheduled',
        participants: [],
      };
      sessions.push(created);
      return respond(created, 201);
    }
    const found = sessions.find((s) => pathname.startsWith(`/sessions/${s.id}`));
    if (pathname.startsWith('/sessions/') && !found) return notFound();
    if (found) {
      const rest = pathname.slice(`/sessions/${found.id}`.length);
      if (rest === '') return respond(found);
      if (rest === '/sheets') return respond(records.sheets);
      if (rest === '/participants' && method === 'POST') {
        const input = body as { userId: string; role: 'mentor' | 'student' };
        const user = users.find((u) => u.id === input.userId);
        found.participants.push({
          userId: input.userId as Session['participants'][number]['userId'],
          displayName: user?.displayName ?? 'Someone',
          role: input.role,
        });
        return respond(found);
      }
      if (rest === '/questions' && method === 'GET') return respond(records.attached);
      if (rest === '/questions' && method === 'POST') {
        const input = body as { questionIds: string[] };
        for (const id of input.questionIds) {
          records.attached.push({
            questionId: id as SessionQuestion['questionId'],
            position: records.attached.length,
            source: 'preassigned',
            openedAt: null,
          });
        }
        return respond(records.attached);
      }
      const open = /^\/questions\/([^/]+)\/open$/.exec(rest);
      if (open && method === 'POST') {
        const target = records.questions.find((q) => q.id === open[1]);
        if (!target) return notFound();
        const newSheet: Sheet = { ...sheet, id: asSheetId(newId()), questionId: target.id };
        records.sheets.push(newSheet);
        return respond({ sheets: [newSheet] }, 201);
      }
      const single = /^\/questions\/([^/]+)$/.exec(rest);
      if (single) {
        const target = records.questions.find((q) => q.id === single[1]);
        return target ? respond(target) : notFound();
      }
      if (rest === '/end' && method === 'POST') {
        found.status = 'ended';
        return respond(found);
      }
      return notFound();
    }
    if (pathname === '/questions' && method === 'GET') {
      return respond({ items: records.questions, nextCursor: null });
    }
    if (pathname === '/questions' && method === 'POST') {
      const input = body as {
        title: string;
        altText: string;
        tags?: string[];
        textMarkdown?: string;
      };
      const created: Question = {
        ...question,
        id: asQuestionId(newId()),
        title: input.title,
        altText: input.altText,
        tags: input.tags ?? [],
        textMarkdown: input.textMarkdown ?? null,
      };
      records.questions.push(created);
      return respond(created, 201);
    }
    const questionPath = /^\/questions\/([^/]+)$/.exec(pathname);
    if (questionPath && method === 'PATCH') {
      const target = records.questions.find((q) => q.id === questionPath[1]);
      if (!target) return notFound();
      Object.assign(target, body);
      return respond(target);
    }
    if (questionPath && method === 'DELETE') {
      const index = records.questions.findIndex((q) => q.id === questionPath[1]);
      if (index === -1) return notFound();
      records.questions.splice(index, 1);
      return respond({ ok: true });
    }
    return notFound();
  }) as unknown as typeof fetch;
  return {
    api: new LiveClassApi({ baseUrl: 'https://api.test', getToken: () => 'token', fetchImpl }),
    calls,
  };
}

/**
 * Wraps children in a provider backed by the fakes.
 *
 * @param {{ api: LiveClassApi; realtime?: FakeRealtime; children: ReactNode; onError?: (e: unknown) => void }} props - Fakes and children.
 * @returns {JSX.Element} The provider.
 */
export function TestProvider(props: {
  api: LiveClassApi;
  realtime?: FakeRealtime;
  children: ReactNode;
  onError?: (error: unknown) => void;
}): React.JSX.Element {
  return (
    <LiveClassProvider
      apiBaseUrl="https://api.test"
      realtimeUrl="ws://unused"
      token="token"
      api={props.api}
      realtime={props.realtime ?? new FakeRealtime(new FakeRealtimeHub())}
      {...(props.onError ? { onError: props.onError } : {})}
    >
      {props.children}
    </LiveClassProvider>
  );
}
