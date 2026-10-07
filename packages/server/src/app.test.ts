import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  apiContract,
  type Asset,
  type Question,
  type Session,
  type Sheet,
  type User,
} from '@live-class/shared';

import { gif, multipart, pdf, png, startTestServer, type TestServer } from './test/helpers.js';

let server: TestServer;
let admin: string;
let mentor: string;
let student: string;
let mentorUser: User;
let studentUser: User;

beforeAll(async () => {
  server = await startTestServer();
  admin = (await server.login('admin@local.test')).token;
  mentor = (await server.login('mentor@local.test')).token;
  student = (await server.login('student@local.test')).token;
  const users = (
    await server.app.inject({ method: 'GET', url: '/users', headers: server.auth(admin) })
  ).json() as User[];
  mentorUser = users.find((u) => u.role === 'mentor')!;
  studentUser = users.find((u) => u.role === 'student')!;
});

afterAll(async () => {
  await server.stop();
});

describe('contract coverage', () => {
  it('registers every route declared in the API contract', () => {
    for (const route of Object.values(apiContract)) {
      // hasRoute matches on the registered pattern, including `:param` placeholders.
      expect(
        server.app.hasRoute({ method: route.method, url: route.path }),
        `${route.method} ${route.path}`,
      ).toBe(true);
    }
  });
});

describe('auth', () => {
  it('rejects bad credentials with a generic message and no token', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/auth/local/login',
      payload: { email: 'admin@local.test', password: 'wrong-password' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('returns the current user and refuses missing or invalid tokens', async () => {
    const me = await server.app.inject({ method: 'GET', url: '/me', headers: server.auth(mentor) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ role: 'mentor', displayName: 'Mentor Asha' });
    expect((await server.app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401);
    expect(
      (await server.app.inject({ method: 'GET', url: '/me', headers: server.auth('garbage') }))
        .statusCode,
    ).toBe(401);
  });

  it('validates request bodies with field-level details', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/auth/local/login',
      payload: { email: 'nope', password: 'x' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION' });
  });
});

describe('question bank', () => {
  let textQuestion: Question;

  it('lets a mentor create a text question and tags are normalised', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/questions',
      headers: server.auth(mentor),
      payload: {
        kind: 'text',
        title: 'Quadratic',
        altText: 'Solve x squared minus four equals zero',
        tags: ['Algebra', ' Quadratics '],
        textMarkdown: 'Solve $x^2 - 4 = 0$',
      },
    });
    expect(response.statusCode).toBe(201);
    textQuestion = response.json() as Question;
    expect(textQuestion.tags).toEqual(['algebra', 'quadratics']);
    expect(textQuestion.pageCount).toBe(1);
  });

  it('refuses students and hides the bank from them', async () => {
    const create = await server.app.inject({
      method: 'POST',
      url: '/questions',
      headers: server.auth(student),
      payload: { kind: 'text', title: 't', altText: 'a', textMarkdown: 'm' },
    });
    expect(create.statusCode).toBe(403);
    const list = await server.app.inject({
      method: 'GET',
      url: '/questions',
      headers: server.auth(student),
    });
    expect(list.statusCode).toBe(403);
  });

  it('searches by text and tags with pagination', async () => {
    for (let i = 0; i < 3; i += 1) {
      await server.app.inject({
        method: 'POST',
        url: '/questions',
        headers: server.auth(admin),
        payload: {
          kind: 'text',
          title: `Geometry ${i}`,
          altText: 'triangles',
          tags: ['geometry'],
          textMarkdown: 'x',
        },
      });
    }
    const page1 = await server.app.inject({
      method: 'GET',
      url: '/questions?tags=geometry&limit=2',
      headers: server.auth(mentor),
    });
    const body1 = page1.json() as { items: Question[]; nextCursor: string | null };
    expect(body1.items).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();
    const page2 = await server.app.inject({
      method: 'GET',
      url: `/questions?tags=geometry&limit=2&cursor=${encodeURIComponent(body1.nextCursor ?? '')}`,
      headers: server.auth(mentor),
    });
    const body2 = page2.json() as { items: Question[]; nextCursor: string | null };
    expect(body2.items).toHaveLength(1);
    expect(body2.nextCursor).toBeNull();
    const search = await server.app.inject({
      method: 'GET',
      url: '/questions?q=quadratic',
      headers: server.auth(mentor),
    });
    expect((search.json() as { items: Question[] }).items.map((q) => q.id)).toContain(
      textQuestion.id,
    );
  });

  it('lets only admins edit and delete', async () => {
    const asMentor = await server.app.inject({
      method: 'PATCH',
      url: `/questions/${textQuestion.id}`,
      headers: server.auth(mentor),
      payload: { title: 'New title' },
    });
    expect(asMentor.statusCode).toBe(403);
    const asAdmin = await server.app.inject({
      method: 'PATCH',
      url: `/questions/${textQuestion.id}`,
      headers: server.auth(admin),
      payload: { title: 'New title' },
    });
    expect(asAdmin.statusCode).toBe(200);
    expect((asAdmin.json() as Question).title).toBe('New title');
    const empty = await server.app.inject({
      method: 'PATCH',
      url: `/questions/${textQuestion.id}`,
      headers: server.auth(admin),
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
  });
});

describe('uploads and media questions', () => {
  let pngAsset: Asset;

  it('accepts a PNG upload and de-duplicates identical bytes', async () => {
    const bytes = await png(200, 100);
    const { body, contentType } = await multipart(bytes, 'slide.png', 'image/png');
    const first = await server.app.inject({
      method: 'POST',
      url: '/assets',
      headers: { ...server.auth(mentor), 'content-type': contentType },
      payload: body,
    });
    expect(first.statusCode).toBe(201);
    pngAsset = first.json() as Asset;
    expect(pngAsset).toMatchObject({ mime: 'image/png', pageSizes: [{ width: 200, height: 100 }] });
    expect(pngAsset.thumbnailUrl).toBe(`/assets/${pngAsset.id}/thumbnail`);
    const second = await server.app.inject({
      method: 'POST',
      url: '/assets',
      headers: { ...server.auth(admin), 'content-type': contentType },
      payload: body,
    });
    expect((second.json() as Asset).id).toBe(pngAsset.id);
  });

  it('rejects disallowed types with the right code', async () => {
    const { body, contentType } = await multipart(Buffer.from('<svg/>'), 'evil.svg', 'image/png');
    const response = await server.app.inject({
      method: 'POST',
      url: '/assets',
      headers: { ...server.auth(mentor), 'content-type': contentType },
      payload: body,
    });
    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ code: 'UPLOAD_TYPE_NOT_ALLOWED' });
  });

  it('refuses a kind that does not match the asset', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/questions',
      headers: server.auth(mentor),
      payload: { kind: 'gif', title: 'x', altText: 'y', assetId: pngAsset.id },
    });
    expect(response.statusCode).toBe(400);
  });

  it('creates an image question and streams the file to allowed users only', async () => {
    const created = await server.app.inject({
      method: 'POST',
      url: '/questions',
      headers: server.auth(mentor),
      payload: { kind: 'image', title: 'Slide', altText: 'A slide', assetId: pngAsset.id },
    });
    expect(created.statusCode).toBe(201);
    const asMentor = await server.app.inject({
      method: 'GET',
      url: pngAsset.url,
      headers: server.auth(mentor),
    });
    expect(asMentor.statusCode).toBe(200);
    expect(asMentor.headers['content-type']).toBe('image/png');
    expect(asMentor.headers['x-content-type-options']).toBe('nosniff');
    expect(asMentor.rawPayload.byteLength).toBe(pngAsset.bytes);
    const asStudent = await server.app.inject({
      method: 'GET',
      url: pngAsset.url,
      headers: server.auth(student),
    });
    expect(asStudent.statusCode).toBe(404); // not in any of the student's sessions yet
    const thumb = await server.app.inject({
      method: 'GET',
      url: pngAsset.thumbnailUrl ?? '',
      headers: server.auth(admin),
    });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/png');
  });

  it('accepts GIF and PDF uploads with their page information', async () => {
    const gifUpload = await multipart(await gif(), 'anim.gif', 'image/gif');
    const gifResponse = await server.app.inject({
      method: 'POST',
      url: '/assets',
      headers: { ...server.auth(mentor), 'content-type': gifUpload.contentType },
      payload: gifUpload.body,
    });
    expect(gifResponse.statusCode).toBe(201);
    expect((gifResponse.json() as Asset).mime).toBe('image/gif');

    const pdfUpload = await multipart(
      await pdf([
        [612, 792],
        [612, 792],
      ]),
      'notes.pdf',
      'application/pdf',
    );
    const pdfResponse = await server.app.inject({
      method: 'POST',
      url: '/assets',
      headers: { ...server.auth(mentor), 'content-type': pdfUpload.contentType },
      payload: pdfUpload.body,
    });
    expect(pdfResponse.statusCode).toBe(201);
    const pdfAsset = pdfResponse.json() as Asset;
    expect(pdfAsset.pageSizes).toHaveLength(2);
    expect(pdfAsset.thumbnailUrl).toBeNull();
  });
});

describe('sessions', () => {
  let session: Session;
  let question: Question;
  let pdfQuestion: Question;

  beforeAll(async () => {
    question = (
      await server.app.inject({
        method: 'POST',
        url: '/questions',
        headers: server.auth(admin),
        payload: { kind: 'text', title: 'Session Q', altText: 'alt', textMarkdown: 'Solve $y$' },
      })
    ).json() as Question;
    const pdfUpload = await multipart(
      await pdf([
        [600, 800],
        [600, 400],
      ]),
      'two.pdf',
      'application/pdf',
    );
    const asset = (
      await server.app.inject({
        method: 'POST',
        url: '/assets',
        headers: { ...server.auth(admin), 'content-type': pdfUpload.contentType },
        payload: pdfUpload.body,
      })
    ).json() as Asset;
    pdfQuestion = (
      await server.app.inject({
        method: 'POST',
        url: '/questions',
        headers: server.auth(admin),
        payload: { kind: 'pdf', title: 'PDF Q', altText: 'alt', assetId: asset.id },
      })
    ).json() as Question;
  });

  it('lets an admin create a session and add exactly one mentor and one student', async () => {
    const created = await server.app.inject({
      method: 'POST',
      url: '/sessions',
      headers: server.auth(admin),
      payload: { title: 'Monday algebra' },
    });
    expect(created.statusCode).toBe(201);
    session = created.json() as Session;
    expect(session.status).toBe('scheduled');

    const addMentor = await server.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/participants`,
      headers: server.auth(admin),
      payload: { userId: mentorUser.id, role: 'mentor' },
    });
    expect(addMentor.statusCode).toBe(200);
    const wrongRole = await server.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/participants`,
      headers: server.auth(admin),
      payload: { userId: studentUser.id, role: 'mentor' },
    });
    expect(wrongRole.statusCode).toBe(400);
    const addStudent = await server.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/participants`,
      headers: server.auth(admin),
      payload: { userId: studentUser.id, role: 'student' },
    });
    expect(addStudent.statusCode).toBe(200);
    session = addStudent.json() as Session;
    expect(session.participants).toHaveLength(2);
    const duplicate = await server.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/participants`,
      headers: server.auth(admin),
      payload: { userId: studentUser.id, role: 'student' },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('hides sessions from non-members and shows them to participants', async () => {
    const other = (
      await server.app.inject({
        method: 'POST',
        url: '/sessions',
        headers: server.auth(admin),
        payload: { title: 'Other' },
      })
    ).json() as Session;
    const asStudent = await server.app.inject({
      method: 'GET',
      url: `/sessions/${other.id}`,
      headers: server.auth(student),
    });
    expect(asStudent.statusCode).toBe(404);
    const own = await server.app.inject({
      method: 'GET',
      url: `/sessions/${session.id}`,
      headers: server.auth(student),
    });
    expect(own.statusCode).toBe(200);
    const list = await server.app.inject({
      method: 'GET',
      url: '/sessions',
      headers: server.auth(student),
    });
    expect((list.json() as Session[]).map((s) => s.id)).toEqual([session.id]);
  });

  it('pre-assigns questions and lets the mentor open them, creating one sheet per page', async () => {
    const assign = await server.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/questions`,
      headers: server.auth(admin),
      payload: { questionIds: [question.id] },
    });
    expect(assign.statusCode).toBe(200);
    expect(assign.json()).toMatchObject([
      { questionId: question.id, source: 'preassigned', openedAt: null },
    ]);

    const asStudent = await server.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/questions/${question.id}/open`,
      headers: server.auth(student),
      payload: {},
    });
    expect(asStudent.statusCode).toBe(403);

    const opened = await server.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/questions/${question.id}/open`,
      headers: server.auth(mentor),
      payload: {},
    });
    expect(opened.statusCode).toBe(201);
    const { sheets } = opened.json() as { sheets: Sheet[] };
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.geometry.widthUnits).toBe(1000);

    const openedPdf = await server.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/questions/${pdfQuestion.id}/open`,
      headers: server.auth(mentor),
      payload: { source: 'live' },
    });
    expect(openedPdf.statusCode).toBe(201);
    const pdfSheets = (openedPdf.json() as { sheets: Sheet[] }).sheets;
    expect(pdfSheets).toHaveLength(2);
    expect(pdfSheets[0]?.geometry.assetBox.h).toBeCloseTo((1000 * 800) / 600, 5);
    expect(pdfSheets[1]?.geometry.assetBox.h).toBeCloseTo((1000 * 400) / 600, 5);
    expect(pdfSheets.map((s) => s.position)).toEqual([1, 2]);

    const again = await server.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/questions/${question.id}/open`,
      headers: server.auth(mentor),
      payload: {},
    });
    expect(again.statusCode).toBe(409);

    const refreshed = (
      await server.app.inject({
        method: 'GET',
        url: `/sessions/${session.id}`,
        headers: server.auth(mentor),
      })
    ).json() as Session;
    expect(refreshed.status).toBe('live');
    const listed = (
      await server.app.inject({
        method: 'GET',
        url: `/sessions/${session.id}/sheets`,
        headers: server.auth(student),
      })
    ).json() as Sheet[];
    expect(listed).toHaveLength(3);
    const sessionQuestions = (
      await server.app.inject({
        method: 'GET',
        url: `/sessions/${session.id}/questions`,
        headers: server.auth(student),
      })
    ).json() as { source: string }[];
    expect(sessionQuestions.map((q) => q.source)).toEqual(['preassigned', 'live']);
  });

  it('lets participants read a question attached to their session, and nothing else', async () => {
    const ok = await server.app.inject({
      method: 'GET',
      url: `/sessions/${session.id}/questions/${pdfQuestion.id}`,
      headers: server.auth(student),
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as Question).id).toBe(pdfQuestion.id);
    const stray = (
      await server.app.inject({
        method: 'POST',
        url: '/questions',
        headers: server.auth(admin),
        payload: { kind: 'text', title: 'Unrelated', altText: 'alt', textMarkdown: 'x' },
      })
    ).json() as Question;
    const denied = await server.app.inject({
      method: 'GET',
      url: `/sessions/${session.id}/questions/${stray.id}`,
      headers: server.auth(student),
    });
    expect(denied.statusCode).toBe(404);
  });

  it('lets the student read assets used in their session', async () => {
    const response = await server.app.inject({
      method: 'GET',
      url: pdfQuestion.asset?.url ?? '',
      headers: server.auth(student),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
  });

  it('ends the session and blocks further opens', async () => {
    const asStudent = await server.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/end`,
      headers: server.auth(student),
    });
    expect(asStudent.statusCode).toBe(403);
    const ended = await server.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/end`,
      headers: server.auth(mentor),
    });
    expect(ended.statusCode).toBe(200);
    expect((ended.json() as Session).status).toBe('ended');
    const other = (
      await server.app.inject({
        method: 'POST',
        url: '/questions',
        headers: server.auth(admin),
        payload: { kind: 'text', title: 'Late', altText: 'alt', textMarkdown: 'x' },
      })
    ).json() as Question;
    const open = await server.app.inject({
      method: 'POST',
      url: `/sessions/${session.id}/questions/${other.id}/open`,
      headers: server.auth(mentor),
      payload: {},
    });
    expect(open.statusCode).toBe(409);
    expect(open.json()).toMatchObject({ code: 'SESSION_ENDED' });
  });
});

describe('operations endpoints', () => {
  it('answers health, readiness and metrics', async () => {
    expect((await server.app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({
      ok: true,
    });
    const ready = await server.app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ ok: true, database: true, storage: true });
    const metrics = await server.app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain('live_class_http_request_duration_seconds');
  });

  it('returns the standard error shape for unknown routes', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'NOT_FOUND', message: 'Route not found' });
  });

  it('deletes a user on request and their token stops working', async () => {
    const victim = await server.app.inject({
      method: 'POST',
      url: '/auth/local/login',
      payload: { email: 'student@local.test', password: 'password123' },
    });
    expect(victim.statusCode).toBe(200);
    const removed = await server.app.inject({
      method: 'DELETE',
      url: `/users/${studentUser.id}`,
      headers: server.auth(admin),
    });
    expect(removed.statusCode).toBe(200);
    const me = await server.app.inject({
      method: 'GET',
      url: '/me',
      headers: server.auth((victim.json() as { token: string }).token),
    });
    expect(me.statusCode).toBe(401);
  });
});
