import { newId } from '@live-class/shared';
import { describe, expect, it, vi } from 'vitest';

import { LiveClassApi } from './client.js';

/**
 * Creates a fetch stub returning the given response.
 *
 * @param {number} status - HTTP status.
 * @param {unknown} body - JSON body.
 * @returns {typeof fetch & { mock: { calls: [string, RequestInit][] } }} The stub.
 */
function fetchReturning(status: number, body: unknown) {
  return vi.fn(() =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  ) as unknown as typeof fetch & { mock: { calls: [string, RequestInit][] } };
}

describe('LiveClassApi', () => {
  it('builds URLs, sends the bearer token and validates the response', async () => {
    const me = { id: newId(), displayName: 'Asha', role: 'mentor' };
    const fetchImpl = fetchReturning(200, me);
    const api = new LiveClassApi({
      baseUrl: 'https://api.test/',
      getToken: () => 'tok',
      fetchImpl,
    });
    const result = await api.call('me', {});
    expect(result).toEqual(me);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.test/me');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('serialises query strings and path params', async () => {
    const fetchImpl = fetchReturning(200, { items: [], nextCursor: null });
    const api = new LiveClassApi({ baseUrl: 'https://api.test', getToken: () => 'tok', fetchImpl });
    await api.call('listQuestions', { query: { q: 'alg', tags: ['a', 'b'], limit: 5 } });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.test/questions?q=alg&tags=a%2Cb&limit=5');
    expect(api.urlFor('getQuestion', { id: 'q1' })).toBe('https://api.test/questions/q1');
    expect(api.assetFileUrl('a1')).toBe('https://api.test/assets/a1/file');
  });

  it('skips the token for public routes and sends JSON bodies', async () => {
    const fetchImpl = fetchReturning(200, {
      token: 't',
      user: { id: newId(), displayName: 'A', role: 'admin' },
    });
    const api = new LiveClassApi({ baseUrl: 'https://api.test', getToken: () => null, fetchImpl });
    await api.call('localLogin', { body: { email: 'a@b.co', password: 'password123' } });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.co', password: 'password123' });
  });

  it('maps error responses to AppError with the server code', async () => {
    const fetchImpl = fetchReturning(403, { code: 'FORBIDDEN', message: 'nope' });
    const api = new LiveClassApi({ baseUrl: 'https://api.test', getToken: () => 'tok', fetchImpl });
    await expect(api.call('me', {})).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'nope' });
  });

  it('reports responses that do not match the contract', async () => {
    const fetchImpl = fetchReturning(200, { unexpected: true });
    const api = new LiveClassApi({ baseUrl: 'https://api.test', getToken: () => 'tok', fetchImpl });
    await expect(api.call('me', {})).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('maps network failures and timeouts', async () => {
    const failing = vi.fn(() =>
      Promise.reject(new TypeError('offline')),
    ) as unknown as typeof fetch;
    const api = new LiveClassApi({
      baseUrl: 'https://api.test',
      getToken: () => 'tok',
      fetchImpl: failing,
    });
    await expect(api.call('me', {})).rejects.toMatchObject({ code: 'NETWORK' });

    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const reason: unknown = init.signal?.reason;
            reject(reason instanceof Error ? reason : new Error('aborted'));
          });
        }),
    ) as unknown as typeof fetch;
    const slow = new LiveClassApi({
      baseUrl: 'https://api.test',
      getToken: () => 'tok',
      fetchImpl: hanging,
      timeoutMs: 5,
    });
    await expect(slow.call('me', {})).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
