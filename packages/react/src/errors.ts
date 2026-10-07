/**
 * Error normalisation shared by hooks and components.
 */

import { AppError, isAppError } from '@live-class/shared';

/**
 * Normalises any thrown value into an `AppError`.
 *
 * @param {unknown} error - Anything thrown.
 * @returns {AppError} The error, wrapped as `INTERNAL` when it was not an `AppError`.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  return new AppError('INTERNAL', error instanceof Error ? error.message : 'Unexpected error', {
    cause: error,
  });
}
