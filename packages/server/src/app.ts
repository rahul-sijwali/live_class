/**
 * Server assembly: builds every collaborator and the Fastify instance.
 *
 * Owns: construction order, plugin registration and shutdown. Nothing here contains
 * business rules. Tests call `buildServer(testConfig())` and use `app.inject`.
 */

import Fastify, { type FastifyBaseLogger, type FastifyInstance, LogController } from 'fastify';

import { type Config } from './config.js';
import { createDatabase, type DatabaseHandle } from './db/client.js';
import { createLogger } from './logger.js';
import { createMetrics } from './metrics.js';
import authPlugin from './plugins/auth.js';
import errorsPlugin from './plugins/errors.js';
import securityPlugin from './plugins/security.js';
import { createRealtime } from './realtime/hocuspocus.js';
import { registerRealtimeRoute } from './realtime/websocket-route.js';
import { assetRoutes } from './routes/assets.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { questionRoutes } from './routes/questions.routes.js';
import { sessionRoutes } from './routes/sessions.routes.js';
import { userRoutes } from './routes/users.routes.js';
import { AssetService } from './services/asset-service.js';
import { type Services, SessionPolicy } from './services/container.js';
import { QuestionService } from './services/question-service.js';
import { SessionService } from './services/session-service.js';
import { UserService } from './services/user-service.js';
import { TokenService } from './auth/tokens.js';
import { createStorage } from './storage/create-storage.js';
import { type StorageAdapter } from './storage/storage-adapter.js';

/** Pieces a test may replace. */
export interface BuildOverrides {
  readonly database?: DatabaseHandle;
  readonly storage?: StorageAdapter;
}

/** A built server. */
export interface BuiltServer {
  readonly app: FastifyInstance;
  readonly services: Services;
}

/**
 * Builds the server without listening.
 *
 * @param {Config} config - Validated configuration.
 * @param {BuildOverrides} overrides - Optional replacements for tests.
 * @returns {Promise<BuiltServer>} The Fastify instance (ready for `listen` or `inject`)
 *   and its services. `app.close()` closes the database and the realtime server.
 */
export async function buildServer(
  config: Config,
  overrides: BuildOverrides = {},
): Promise<BuiltServer> {
  const logger = createLogger(config);
  const database = overrides.database ?? (await createDatabase(config.DATABASE_URL));
  if (config.DB_MIGRATE_ON_START) {
    await database.migrate();
    logger.info({ driver: database.driver }, 'database migrated');
  }
  const storage = overrides.storage ?? createStorage(config);
  const metrics = createMetrics();
  const tokens = new TokenService(config, database.db);
  const users = new UserService(database.db);
  const assets = new AssetService(database.db, storage, config.MAX_UPLOAD_MB);
  const questions = new QuestionService(database.db);
  const sessions = new SessionService(database.db, questions);
  const sessionPolicy = new SessionPolicy(sessions);
  const realtime = await createRealtime({
    db: database.db,
    tokens,
    sessions,
    logger,
    redisUrl: config.REDIS_URL,
  });

  if (config.AUTH_LOCAL_ENABLED && config.AUTH_LOCAL_SEED_PASSWORD) {
    const seeded = await users.seedIfEmpty(config.AUTH_LOCAL_SEED_PASSWORD);
    if (seeded) logger.warn('seeded local development accounts (admin/mentor/student @local.test)');
  }

  const services: Services = {
    config,
    logger,
    database,
    storage,
    tokens,
    users,
    assets,
    questions,
    sessions,
    sessionPolicy,
    realtime,
    metrics,
  };

  const app = Fastify({
    // pino's Logger type is stricter than Fastify's base logger under exactOptionalPropertyTypes;
    // the instance is a real pino logger, so the cast is safe.
    loggerInstance: logger as unknown as FastifyBaseLogger,
    trustProxy: config.TRUST_PROXY,
    requestIdHeader: 'x-request-id',
    bodyLimit: 1024 * 1024,
    logController: new LogController({ disableRequestLogging: config.NODE_ENV === 'test' }),
  });

  await app.register(errorsPlugin);
  await app.register(securityPlugin, { corsOrigins: config.CORS_ORIGINS });
  await app.register(authPlugin, { tokens });

  app.addHook('onResponse', (request, reply, done) => {
    const route = request.routeOptions.url ?? 'unknown';
    metrics.httpDuration.observe(
      { method: request.method, route, status: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
    done();
  });

  await app.register(async (instance) => {
    await authRoutes(instance, services);
    await userRoutes(instance, services);
    await questionRoutes(instance, services);
    await assetRoutes(instance, services);
    await sessionRoutes(instance, services);
    await healthRoutes(instance, services);
  });
  await registerRealtimeRoute(app, realtime, 4 * 1024 * 1024);

  app.addHook('onClose', async () => {
    // Hocuspocus v4 has no destroy(): close sockets, then write every pending document
    // state synchronously before the database goes away (graceful shutdown, CLAUDE.md §11).
    realtime.closeConnections();
    realtime.flushPendingStores();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await database.close();
  });

  return { app, services };
}
