/**
 * Authentication routes: development login and `GET /me`.
 */

import { type FastifyInstance } from 'fastify';

import {
  apiContract,
  AppError,
  LocalLoginInputSchema,
  type LoginResponse,
  type Me,
} from '@live-class/shared';

import { requireUser } from '../plugins/auth.js';
import { type Services } from '../services/container.js';

/**
 * Registers auth routes.
 *
 * @param {FastifyInstance} app - Fastify instance.
 * @param {Services} services - Collaborators.
 * @returns {Promise<void>} Resolves when registered.
 */
export async function authRoutes(app: FastifyInstance, services: Services): Promise<void> {
  app.post(
    apiContract.localLogin.path,
    {
      config: {
        rateLimit: { max: services.config.RATE_LIMIT_LOGIN_PER_MINUTE, timeWindow: '1 minute' },
      },
    },
    async (request): Promise<LoginResponse> => {
      if (!services.config.AUTH_LOCAL_ENABLED)
        throw new AppError('FORBIDDEN', 'Local login is disabled');
      const input = LocalLoginInputSchema.parse(request.body);
      const user = await services.users.authenticateLocal(input);
      const token = await services.tokens.issueLocalToken(user.id);
      return { token, user: { id: user.id, displayName: user.displayName, role: user.role } };
    },
  );

  app.get(apiContract.me.path, { preHandler: app.authenticate }, (request): Me => {
    const user = requireUser(request);
    return { id: user.id, displayName: user.displayName, role: user.role };
  });
  await Promise.resolve();
}
