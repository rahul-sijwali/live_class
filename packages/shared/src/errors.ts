/**
 * Error codes and the single error class used across client and server.
 *
 * Owns: the stable list of codes and the `AppError` shape that travels over HTTP as
 * `{ code, message, details? }`. Does not own HTTP status mapping (server) or user-facing
 * wording (UI); both key off `code`.
 */

import { z } from 'zod';

/** Stable machine-readable error codes. Add to the end; never rename a shipped code. */
export const APP_ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'UPLOAD_TYPE_NOT_ALLOWED',
  'UPLOAD_TOO_LARGE',
  'UPLOAD_LIMITS_EXCEEDED',
  'SESSION_ENDED',
  'CONFLICT',
  'RATE_LIMITED',
  'NETWORK',
  'TIMEOUT',
  'INTERNAL',
] as const;

/** Union of all error codes. */
export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

/** Wire format of an error response body. */
export const ErrorResponseSchema = z.object({
  code: z.enum(APP_ERROR_CODES),
  message: z.string(),
  details: z.unknown().optional(),
});

/** Parsed error response body. */
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/** Options accepted by the `AppError` constructor. */
export interface AppErrorOptions {
  /** Structured, safe-to-expose extra information (for example validation issues). */
  readonly details?: unknown;
  /** The underlying error, kept for logs and never sent to clients. */
  readonly cause?: unknown;
}

/**
 * The one error type that crosses module boundaries. Everything else is wrapped into it at
 * the boundary where it is caught.
 *
 * @example
 *   throw new AppError('NOT_FOUND', `Question ${id} does not exist`);
 */
export class AppError extends Error {
  /** Stable machine-readable code. */
  readonly code: AppErrorCode;
  /** Structured, safe-to-expose details, if any. */
  readonly details: unknown;

  /**
   * Creates an application error.
   *
   * @param {AppErrorCode} code - Stable code the caller can branch on.
   * @param {string} message - Human-readable, internal-facing message.
   * @param {AppErrorOptions} options - Optional details (exposed) and cause (logged only).
   */
  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.details = options.details;
  }

  /**
   * Converts the error into the wire format.
   *
   * @returns {ErrorResponse} Body safe to send to a client; never includes `cause`.
   */
  toResponse(): ErrorResponse {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

/**
 * Type guard for `AppError`, robust across package boundaries where `instanceof` can fail.
 *
 * @param {unknown} error - Any thrown value.
 * @returns {boolean} True if `error` has the `AppError` shape.
 */
export function isAppError(error: unknown): error is AppError {
  if (error instanceof AppError) return true;
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return (
    candidate.name === 'AppError' &&
    typeof candidate.code === 'string' &&
    (APP_ERROR_CODES as readonly string[]).includes(candidate.code)
  );
}

/**
 * Builds an `AppError` from an error response body received over HTTP.
 *
 * @param {unknown} body - Parsed JSON body of a non-2xx response.
 * @param {string} fallbackMessage - Message used when the body is not an error response.
 * @returns {AppError} `VALIDATION`-free reconstruction of the server error, or an
 *   `INTERNAL` error with `fallbackMessage` when the body is unrecognisable.
 */
export function appErrorFromResponse(body: unknown, fallbackMessage: string): AppError {
  const parsed = ErrorResponseSchema.safeParse(body);
  if (!parsed.success) return new AppError('INTERNAL', fallbackMessage, { details: body });
  const { code, message, details } = parsed.data;
  return new AppError(code, message, details === undefined ? {} : { details });
}
