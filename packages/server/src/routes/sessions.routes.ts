/**
 * Session routes: lifecycle, participants, question assignment, opening questions, sheets.
 */

import { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  AddParticipantInputSchema,
  apiContract,
  AppError,
  AssignQuestionsInputSchema,
  CreateSessionInputSchema,
  OpenQuestionInputSchema,
  type OpenQuestionResult,
  type Question,
  QuestionIdSchema,
  type Session,
  SessionIdSchema,
  type SessionQuestion,
  type Sheet,
} from '@live-class/shared';

import { requireUser } from '../plugins/auth.js';
import { appendSheetsToSession } from '../realtime/server-doc-ops.js';
import { type Services } from '../services/container.js';

const IdParams = z.object({ id: SessionIdSchema });
const OpenParams = z.object({ id: SessionIdSchema, questionId: QuestionIdSchema });

/**
 * Registers session routes.
 *
 * @param {FastifyInstance} app - Fastify instance.
 * @param {Services} services - Collaborators.
 * @returns {Promise<void>} Resolves when registered.
 */
export async function sessionRoutes(app: FastifyInstance, services: Services): Promise<void> {
  const auth = { preHandler: app.authenticate };
  const { sessionPolicy: policy, sessions } = services;

  app.post(apiContract.createSession.path, auth, async (request, reply): Promise<Session> => {
    const user = requireUser(request);
    policy.assertAdminister(user);
    const session = await sessions.create(CreateSessionInputSchema.parse(request.body), user.id);
    void reply.status(201);
    return session;
  });

  app.get(apiContract.listSessions.path, auth, async (request): Promise<Session[]> => {
    const user = requireUser(request);
    return sessions.list(user.id, user.role === 'admin');
  });

  app.get(apiContract.getSession.path, auth, async (request): Promise<Session> => {
    const { id } = IdParams.parse(request.params);
    await policy.assertView(requireUser(request), id);
    return sessions.get(id);
  });

  app.post(apiContract.addParticipant.path, auth, async (request): Promise<Session> => {
    policy.assertAdminister(requireUser(request));
    const { id } = IdParams.parse(request.params);
    return sessions.addParticipant(id, AddParticipantInputSchema.parse(request.body));
  });

  app.post(apiContract.assignQuestions.path, auth, async (request): Promise<SessionQuestion[]> => {
    policy.assertAdminister(requireUser(request));
    const { id } = IdParams.parse(request.params);
    return sessions.assignQuestions(id, AssignQuestionsInputSchema.parse(request.body).questionIds);
  });

  app.get(
    apiContract.listSessionQuestions.path,
    auth,
    async (request): Promise<SessionQuestion[]> => {
      const { id } = IdParams.parse(request.params);
      await policy.assertView(requireUser(request), id);
      return sessions.listQuestions(id);
    },
  );

  app.get(apiContract.getSessionQuestion.path, auth, async (request): Promise<Question> => {
    const { id, questionId } = OpenParams.parse(request.params);
    await policy.assertView(requireUser(request), id);
    const attached = await sessions.listQuestions(id);
    if (!attached.some((q) => q.questionId === questionId)) {
      throw new AppError('NOT_FOUND', `Question ${questionId} is not part of this session`);
    }
    return services.questions.get(questionId);
  });

  app.post(
    apiContract.openQuestion.path,
    auth,
    async (request, reply): Promise<OpenQuestionResult> => {
      const user = requireUser(request);
      const { id, questionId } = OpenParams.parse(request.params);
      await policy.assertOpenQuestion(user, id);
      const { source } = OpenQuestionInputSchema.parse(request.body ?? {});
      const existing = await sessions.listQuestions(id);
      const effectiveSource = existing.some((q) => q.questionId === questionId)
        ? 'preassigned'
        : source;
      const result = await sessions.openQuestion(id, questionId, effectiveSource);
      await appendSheetsToSession(
        services.realtime,
        id,
        result.sheets.map((sheet) => sheet.id),
        true,
      );
      void reply.status(201);
      return { sheets: result.sheets };
    },
  );

  app.get(apiContract.listSheets.path, auth, async (request): Promise<Sheet[]> => {
    const { id } = IdParams.parse(request.params);
    await policy.assertView(requireUser(request), id);
    return sessions.listSheets(id);
  });

  app.post(apiContract.endSession.path, auth, async (request): Promise<Session> => {
    const { id } = IdParams.parse(request.params);
    await policy.assertEnd(requireUser(request), id);
    return sessions.end(id);
  });
  await Promise.resolve();
}
