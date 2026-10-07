/**
 * Shared steps for the end-to-end suites: API calls as the admin and page-level sign-in.
 */

import { type APIRequestContext, type Page, request } from '@playwright/test';

export const API_URL = 'http://localhost:4000';

/** Seeded demo accounts (see server `SEED_USERS`). */
export const ACCOUNTS = {
  admin: 'admin@local.test',
  mentor: 'mentor@local.test',
  student: 'student@local.test',
} as const;

/**
 * Logs in through the API and returns a bearer token.
 *
 * @param {keyof typeof ACCOUNTS} who - Seeded account.
 * @returns {Promise<string>} Token.
 */
export async function apiToken(who: keyof typeof ACCOUNTS): Promise<string> {
  const context = await request.newContext({ baseURL: API_URL });
  const response = await context.post('/auth/local/login', {
    data: { email: ACCOUNTS[who], password: 'password123' },
  });
  if (!response.ok()) throw new Error(`login failed: ${await response.text()}`);
  const body = (await response.json()) as { token: string };
  await context.dispose();
  return body.token;
}

/**
 * Creates an authenticated API context.
 *
 * @param {string} token - Bearer token.
 * @returns {Promise<APIRequestContext>} Context with the auth header set.
 */
export function apiAs(token: string): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  });
}

/**
 * Creates a live session with the seeded mentor and student and one opened text question.
 *
 * @param {string} title - Session title.
 * @returns {Promise<{ sessionId: string; questionId: string }>} Ids.
 */
export async function createSessionWithQuestion(
  title: string,
): Promise<{ sessionId: string; questionId: string }> {
  const admin = await apiAs(await apiToken('admin'));
  const users = (await (await admin.get('/users')).json()) as { id: string; role: string }[];
  const session = (await (await admin.post('/sessions', { data: { title } })).json()) as {
    id: string;
  };
  for (const role of ['mentor', 'student'] as const) {
    const user = users.find((u) => u.role === role);
    if (!user) throw new Error(`no seeded ${role}`);
    await admin.post(`/sessions/${session.id}/participants`, { data: { userId: user.id, role } });
  }
  const question = (await (
    await admin.post('/questions', {
      data: {
        kind: 'text',
        title: 'Solve for x',
        altText: 'Solve two x plus three equals eleven',
        tags: ['e2e'],
        textMarkdown: 'Solve $2x + 3 = 11$',
      },
    })
  ).json()) as { id: string };
  await admin.post(`/sessions/${session.id}/questions`, { data: { questionIds: [question.id] } });
  await admin.dispose();
  return { sessionId: session.id, questionId: question.id };
}

/**
 * Signs a page in the way the demo stores a token (sessionStorage), using the API directly.
 * The login form itself is covered by the admin suite.
 *
 * @param {Page} page - Browser page.
 * @param {keyof typeof ACCOUNTS} who - Seeded account.
 * @returns {Promise<void>} Resolves once the token is in place for subsequent navigations.
 */
export async function signIn(page: Page, who: keyof typeof ACCOUNTS): Promise<void> {
  const token = await apiToken(who);
  await page.addInitScript((value: string) => {
    window.sessionStorage.setItem('live-class-demo-token', value);
  }, token);
}

/**
 * Signs in through the demo login form (exercises the real UI path).
 *
 * @param {Page} page - Browser page.
 * @param {keyof typeof ACCOUNTS} who - Seeded account.
 * @returns {Promise<void>} Resolves after navigation away from the login page.
 */
export async function signInViaForm(page: Page, who: keyof typeof ACCOUNTS): Promise<void> {
  await page.goto('/login/');
  await page.getByLabel('Email').fill(ACCOUNTS[who]);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}
