/**
 * Maps every thrown error to the wire format `{ code, message, details? }`.
 *
 * Owns: the single `AppErrorCode` → HTTP status table and the translation of framework
 * errors (validation, payload too large, rate limit) into our codes. Logs once, here, with
 * request context (CLAUDE.md §5 errors).
 */

import { type FastifyError, type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

import { AppError, type AppErrorCode, isAppError } from '@live-class/shared';

/** HTTP status per error code. */
const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  UPLOAD_TYPE_NOT_ALLOWED: 415,
  UPLOAD_TOO_LARGE: 413,
  UPLOAD_LIMITS_EXCEEDED: 422,
  SESSION_ENDED: 409,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  NETWORK: 502,
  TIMEOUT: 504,
  INTERNAL: 500,
};

/**
 * Converts any thrown value into an `AppError`.
 *
 * @param {unknown} error - Thrown value.
 * @returns {AppError} Equivalent application error.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  if (error instanceof ZodError) {
    return new AppError('VALIDATION', 'Request validation failed', {
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  const fastifyError = error as Partial<FastifyError> & { code?: string; statusCode?: number };
  switch (fastifyError.code) {
    case 'FST_REQ_FILE_TOO_LARGE':
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return new AppError('UPLOAD_TOO_LARGE', 'The upload exceeds the size limit', {
        cause: error,
      });
    case 'FST_FILES_LIMIT':
    case 'FST_INVALID_MULTIPART_CONTENT_TYPE':
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_VALIDATION':
      return new AppError('VALIDATION', fastifyError.message ?? 'Invalid request', {
        cause: error,
      });
    case undefined:
    default:
      break;
  }
  if (fastifyError.statusCode === 429) {
    return new AppError('RATE_LIMITED', 'Too many requests; slow down', { cause: error });
  }
  if (fastifyError.statusCode === 404)
    return new AppError('NOT_FOUND', 'Route not found', { cause: error });
  if (fastifyError.statusCode === 400) {
    return new AppError('VALIDATION', fastifyError.message ?? 'Invalid request', { cause: error });
  }
  return new AppError('INTERNAL', 'Something went wrong', { cause: error });
}

/**
 * HTTP status for an error code.
 *
 * @param {AppErrorCode} code - Error code.
 * @returns {number} Status code.
 */
export function statusFor(code: AppErrorCode): number {
  return STATUS_BY_CODE[code];
}

/**
 * Registers the error and not-found handlers.
 *
 * @param {FastifyInstance} app - Fastify instance.
 * @returns {Promise<void>} Resolves when registered.
 */
async function errorsPlugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, request, reply) => {
    const appError = toAppError(error);
    const status = statusFor(appError.code);
    if (status >= 500) {
      request.log.error({ err: error, code: appError.code }, 'request failed');
    } else {
      request.log.info({ code: appError.code }, appError.message);
    }
    void reply.status(status).send(appError.toResponse());
  });
  app.setNotFoundHandler((_request, reply) => {
    void reply.status(404).send(new AppError('NOT_FOUND', 'Route not found').toResponse());
  });
  await Promise.resolve();
}

export default fp(errorsPlugin, { name: 'errors' });
