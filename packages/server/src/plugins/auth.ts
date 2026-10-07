/**
 * Request authentication: reads the bearer token and attaches `request.user`.
 *
 * Owns: the `authenticate` pre-handler and the `request.user` decoration. Routes decide
 * authorisation with `authz/policies`; this plugin only answers "who is calling?".
 */

import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { AppError } from '@live-class/shared';

import { type AuthUser, type TokenService } from '../auth/tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Authenticated user; set by the `authenticate` pre-handler. */
    user: AuthUser | null;
  }
  interface FastifyInstance {
    /** Pre-handler that requires a valid bearer token. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** What the auth plugin needs from the application. */
export interface AuthPluginOptions {
  readonly tokens: TokenService;
}

/**
 * Extracts the bearer token from an `Authorization` header.
 *
 * @param {string | undefined} header - Raw header value.
 * @returns {string | null} The token, or null when absent or malformed.
 */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}

/**
 * Registers `request.user` and the `authenticate` pre-handler.
 *
 * @param {FastifyInstance} app - Fastify instance.
 * @param {AuthPluginOptions} options - Token service.
 * @returns {Promise<void>} Resolves when registered.
 */
async function authPlugin(app: FastifyInstance, options: AuthPluginOptions): Promise<void> {
  app.decorateRequest('user', null);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    const token = bearerToken(request.headers.authorization);
    if (!token) throw new AppError('UNAUTHENTICATED', 'Missing bearer token');
    request.user = await options.tokens.verify(token);
  });
  await Promise.resolve();
}

/**
 * Returns the authenticated user or throws; use inside handlers after `authenticate`.
 *
 * @param {FastifyRequest} request - Current request.
 * @returns {AuthUser} The caller identified by the bearer token.
 * @throws {AppError} `UNAUTHENTICATED` if the pre-handler did not run.
 */
export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  return request.user;
}

export default fp(authPlugin, { name: 'auth' });
