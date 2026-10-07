/**
 * Asset routes: upload, stream file, stream thumbnail.
 *
 * Streams carry `nosniff`, `inline` disposition and private caching (CLAUDE.md §8).
 */

import multipart from '@fastify/multipart';
import { type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';

import { apiContract, AppError, type Asset, AssetIdSchema, isAppError } from '@live-class/shared';

import { type AuthUser } from '../auth/tokens.js';
import { bankPolicy } from '../authz/policies.js';
import { requireUser } from '../plugins/auth.js';
import { type Services } from '../services/container.js';

const IdParams = z.object({ id: AssetIdSchema });

/**
 * Registers asset routes and the multipart parser.
 *
 * @param {FastifyInstance} app - Fastify instance.
 * @param {Services} services - Collaborators.
 * @returns {Promise<void>} Resolves when registered.
 */
export async function assetRoutes(app: FastifyInstance, services: Services): Promise<void> {
  const maxBytes = services.config.MAX_UPLOAD_MB * 1024 * 1024;
  await app.register(multipart, { limits: { fileSize: maxBytes, files: 1, fields: 5 } });
  const auth = { preHandler: app.authenticate };

  app.post(
    apiContract.uploadAsset.path,
    { ...auth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply): Promise<Asset> => {
      const user = requireUser(request);
      bankPolicy.assertCreate(user);
      const part = await request.file();
      if (!part)
        throw new AppError('VALIDATION', 'Send the file in a multipart field named "file"');
      try {
        const buffer = await part.toBuffer();
        const asset = await services.assets.createFromUpload(buffer, user.id);
        void reply.status(201);
        return asset;
      } catch (error) {
        const code = isAppError(error) ? error.code : 'INTERNAL';
        services.metrics.uploadsFailed.inc({ code });
        throw error;
      }
    },
  );

  app.get(apiContract.getAssetFile.path, auth, async (request, reply) => {
    const user = requireUser(request);
    const { id } = IdParams.parse(request.params);
    await assertCanReadAsset(services, user, id);
    const { stream, mime, contentLength } = await services.assets.openFile(id);
    streamHeaders(reply, mime, contentLength, `asset-${id}`);
    return reply.send(stream);
  });

  app.get(apiContract.getAssetThumbnail.path, auth, async (request, reply) => {
    const user = requireUser(request);
    const { id } = IdParams.parse(request.params);
    await assertCanReadAsset(services, user, id);
    const { stream, contentLength } = await services.assets.openThumbnail(id);
    streamHeaders(reply, 'image/png', contentLength, `thumbnail-${id}`);
    return reply.send(stream);
  });
}

/**
 * Admins and mentors may read any asset; students only assets used in their sessions.
 *
 * @param {Services} services - Collaborators.
 * @param {AuthUser} user - Caller.
 * @param {string} assetId - Asset to read.
 * @returns {Promise<void>} Resolves when allowed.
 * @throws {AppError} `NOT_FOUND` when the caller may not see the asset.
 */
async function assertCanReadAsset(
  services: Services,
  user: AuthUser,
  assetId: string,
): Promise<void> {
  if (user.role === 'admin' || user.role === 'mentor') return;
  const allowed = await services.sessions.participantCanSeeAsset(user.id, assetId);
  if (!allowed) throw new AppError('NOT_FOUND', `Asset ${assetId} not found`);
}

/**
 * Sets safe headers for a streamed file.
 *
 * @param {FastifyReply} reply - Reply being built.
 * @param {string} mime - Content type.
 * @param {number | null} contentLength - Size when known.
 * @param {string} fileName - Name used in `Content-Disposition`.
 * @returns {void} Nothing.
 */
function streamHeaders(
  reply: FastifyReply,
  mime: string,
  contentLength: number | null,
  fileName: string,
): void {
  void reply
    .header('Content-Type', mime)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Disposition', `inline; filename="${fileName}"`)
    .header('Cache-Control', 'private, max-age=3600');
  if (contentLength !== null) void reply.header('Content-Length', String(contentLength));
}
