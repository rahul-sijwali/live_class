/**
 * Liveness, readiness and metrics endpoints (CLAUDE.md §11).
 */

import { type FastifyInstance } from 'fastify';

import { type Services } from '../services/container.js';

/**
 * Registers `/healthz`, `/readyz` and `/metrics`.
 *
 * @param {FastifyInstance} app - Fastify instance.
 * @param {Services} services - Collaborators.
 * @returns {Promise<void>} Resolves when registered.
 */
export async function healthRoutes(app: FastifyInstance, services: Services): Promise<void> {
  app.get('/healthz', { config: { rateLimit: false } }, () => ({ ok: true }));

  app.get('/readyz', { config: { rateLimit: false } }, async (_request, reply) => {
    const [database, storage] = await Promise.all([
      services.database.ping().catch(() => false),
      services.storage.healthy().catch(() => false),
    ]);
    const ok = database && storage;
    void reply.status(ok ? 200 : 503);
    return { ok, database, storage };
  });

  app.get('/metrics', { config: { rateLimit: false } }, async (_request, reply) => {
    services.metrics.realtimeConnections.set(services.realtime.getConnectionsCount());
    services.metrics.realtimeDocuments.set(services.realtime.getDocumentsCount());
    void reply.header('Content-Type', services.metrics.registry.contentType);
    return services.metrics.registry.metrics();
  });
  await Promise.resolve();
}
