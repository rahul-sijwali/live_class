/**
 * HTTP hardening: Helmet headers, CORS allowlist and rate limits.
 *
 * Owns: registration of the three plugins with our settings. Asset responses are allowed
 * cross-origin because the host app lives on another origin.
 */

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/** Settings for the HTTP hardening plugins. */
export interface SecurityPluginOptions {
  readonly corsOrigins: readonly string[];
  /** Requests per minute per client for ordinary routes. */
  readonly ratePerMinute?: number;
}

/**
 * Registers Helmet, CORS and rate limiting.
 *
 * @param {FastifyInstance} app - Fastify instance.
 * @param {SecurityPluginOptions} options - Allowed origins and rate.
 * @returns {Promise<void>} Resolves when registered.
 */
async function securityPlugin(app: FastifyInstance, options: SecurityPluginOptions): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(cors, {
    origin: [...options.corsOrigins],
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    global: true,
    max: options.ratePerMinute ?? 300,
    timeWindow: '1 minute',
    allowList: (request) => request.url.startsWith('/healthz') || request.url.startsWith('/readyz'),
  });
}

export default fp(securityPlugin, { name: 'security' });
