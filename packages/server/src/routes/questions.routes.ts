/**
 * Question bank routes.
 */

import { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  apiContract,
  CreateQuestionInputSchema,
  type Question,
  QuestionIdSchema,
  type QuestionList,
  QuestionQuerySchema,
  UpdateQuestionInputSchema,
} from '@live-class/shared';

import { bankPolicy } from '../authz/policies.js';
import { requireUser } from '../plugins/auth.js';
import { type Services } from '../services/container.js';

const IdParams = z.object({ id: QuestionIdSchema });

/**
 * Registers question routes.
 *
 * @param {FastifyInstance} app - Fastify instance.
 * @param {Services} services - Collaborators.
 * @returns {Promise<void>} Resolves when registered.
 */
export async function questionRoutes(app: FastifyInstance, services: Services): Promise<void> {
  const auth = { preHandler: app.authenticate };

  app.get(apiContract.listQuestions.path, auth, async (request): Promise<QuestionList> => {
    bankPolicy.assertBrowse(requireUser(request));
    return services.questions.list(QuestionQuerySchema.parse(request.query));
  });

  app.post(apiContract.createQuestion.path, auth, async (request, reply): Promise<Question> => {
    const user = requireUser(request);
    bankPolicy.assertCreate(user);
    const question = await services.questions.create(
      CreateQuestionInputSchema.parse(request.body),
      user.id,
    );
    void reply.status(201);
    return question;
  });

  app.get(apiContract.getQuestion.path, auth, async (request): Promise<Question> => {
    bankPolicy.assertBrowse(requireUser(request));
    return services.questions.get(IdParams.parse(request.params).id);
  });

  app.patch(apiContract.updateQuestion.path, auth, async (request): Promise<Question> => {
    bankPolicy.assertManage(requireUser(request));
    return services.questions.update(
      IdParams.parse(request.params).id,
      UpdateQuestionInputSchema.parse(request.body),
    );
  });

  app.delete(apiContract.deleteQuestion.path, auth, async (request): Promise<{ ok: true }> => {
    bankPolicy.assertManage(requireUser(request));
    await services.questions.softDelete(IdParams.parse(request.params).id);
    return { ok: true };
  });
  await Promise.resolve();
}
