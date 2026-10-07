/**
 * Admin user routes: list users (to pick participants) and delete a user (privacy).
 */

import { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  apiContract,
  ListUsersQuerySchema,
  type OkResponseSchema,
  type User,
  UserIdSchema,
} from '@live-class/shared';

import { assertRole } from '../authz/policies.js';
import { requireUser } from '../plugins/auth.js';
import { type Services } from '../services/container.js';

const IdParams = z.object({ id: UserIdSchema });

/**
 * Registers user routes.
 *
 * @param {FastifyInstance} app - Fastify instance.
 * @param {Services} services - Collaborators.
 * @returns {Promise<void>} Resolves when registered.
 */
export async function userRoutes(app: FastifyInstance, services: Services): Promise<void> {
  app.get(
    apiContract.listUsers.path,
    { preHandler: app.authenticate },
    async (request): Promise<User[]> => {
      assertRole(requireUser(request), ['admin']);
      return services.users.list(ListUsersQuerySchema.parse(request.query));
    },
  );

  app.delete(
    apiContract.deleteUser.path,
    { preHandler: app.authenticate },
    async (request): Promise<z.infer<typeof OkResponseSchema>> => {
      assertRole(requireUser(request), ['admin']);
      const { id } = IdParams.parse(request.params);
      await services.users.delete(id);
      return { ok: true };
    },
  );
  await Promise.resolve();
}
