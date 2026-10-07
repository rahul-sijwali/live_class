import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asUserId } from '@live-class/shared';

import { testConfig } from '../config.js';
import { createDatabase, type DatabaseHandle } from '../db/client.js';
import { TokenService } from './tokens.js';

const config = testConfig();
const hostKey = new TextEncoder().encode(config.AUTH_HOST_SHARED_SECRET);

/**
 * Signs a host-style token.
 *
 * @param {Record<string, unknown>} claims - Payload claims.
 * @param {{ issuer?: string; audience?: string; expiresIn?: string }} options - Overrides.
 * @returns {Promise<string>} Signed JWT.
 */
function hostToken(
  claims: Record<string, unknown>,
  options: { issuer?: string; audience?: string; expiresIn?: string } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(options.issuer ?? config.AUTH_HOST_ISSUER)
    .setAudience(options.audience ?? config.AUTH_HOST_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '5m')
    .sign(hostKey);
}

let database: DatabaseHandle;
let tokens: TokenService;

beforeAll(async () => {
  database = await createDatabase('pglite://memory');
  await database.migrate();
  tokens = new TokenService(config, database.db);
});

afterAll(async () => {
  await database.close();
});

describe('TokenService host tokens', () => {
  it('creates the user on first sight and reuses it afterwards', async () => {
    const token = await hostToken({ sub: 'host-user-1', name: 'Asha', role: 'mentor' });
    const first = await tokens.verify(token);
    expect(first).toMatchObject({ displayName: 'Asha', role: 'mentor' });
    const second = await tokens.verify(
      await hostToken({ sub: 'host-user-1', name: 'Asha K', role: 'mentor' }),
    );
    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe('Asha K');
  });

  it('rejects wrong issuer, wrong audience, expiry and bad signatures', async () => {
    await expect(
      tokens.verify(await hostToken({ sub: 'u', name: 'n', role: 'student' }, { issuer: 'evil' })),
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(
      tokens.verify(
        await hostToken({ sub: 'u', name: 'n', role: 'student' }, { audience: 'other' }),
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      tokens.verify(
        await hostToken({ sub: 'u', name: 'n', role: 'student' }, { expiresIn: '-1m' }),
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const forged = (await hostToken({ sub: 'u', name: 'n', role: 'admin' })).replace(/.$/, (c) =>
      c === 'a' ? 'b' : 'a',
    );
    await expect(tokens.verify(forged)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects tokens missing required claims and malformed tokens', async () => {
    await expect(tokens.verify(await hostToken({ sub: 'u' }))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(tokens.verify('not.a.jwt')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(tokens.verify('')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('TokenService local tokens', () => {
  it('issues and verifies a token for an existing user', async () => {
    const user = await tokens.verify(
      await hostToken({ sub: 'local-seed', name: 'Local', role: 'admin' }),
    );
    const token = await tokens.issueLocalToken(asUserId(user.id));
    const verified = await tokens.verify(token);
    expect(verified.id).toBe(user.id);
    expect(verified.role).toBe('admin');
  });

  it('rejects a local token for an unknown user', async () => {
    const token = await tokens.issueLocalToken(asUserId('0192f1e0-0000-7000-8000-000000000000'));
    await expect(tokens.verify(token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
