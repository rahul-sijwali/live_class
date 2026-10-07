/**
 * Mutable holder for the host's callbacks (token source, error reporter).
 *
 * The API and realtime clients are created once but must always use the host's latest
 * token function and error handler. Keeping those in one small object that is updated
 * from an effect (never read during render) satisfies React's rules while staying simple.
 */

import { type AppError } from '@live-class/shared';

import { toAppError } from './errors.js';

/** Bearer token or a function that returns one (the host refreshes it as it likes). */
export type TokenSource = string | (() => string | Promise<string>);

/**
 * Holds the latest host callbacks behind stable methods.
 */
export class HostBridge {
  private token: TokenSource;
  private onError: ((error: AppError) => void) | undefined;

  /**
   * Creates the bridge with the initial values.
   *
   * @param {TokenSource} token - Initial token or token function.
   * @param {((error: AppError) => void) | undefined} onError - Initial error handler.
   */
  constructor(token: TokenSource, onError: ((error: AppError) => void) | undefined) {
    this.token = token;
    this.onError = onError;
  }

  /**
   * Replaces the stored callbacks (called from an effect on every render).
   *
   * @param {TokenSource} token - Latest token or token function.
   * @param {((error: AppError) => void) | undefined} onError - Latest error handler.
   * @returns {void} Nothing.
   */
  update(token: TokenSource, onError: ((error: AppError) => void) | undefined): void {
    this.token = token;
    this.onError = onError;
  }

  /**
   * Resolves the current bearer token from whatever the host last supplied.
   *
   * @returns {Promise<string>} A token string ready for an `Authorization` header.
   */
  getToken = async (): Promise<string> => {
    const current = this.token;
    return typeof current === 'function' ? current() : current;
  };

  /**
   * Normalises an error, hands it to the host, and returns it for display.
   *
   * @param {unknown} error - Anything thrown.
   * @returns {AppError} The normalised error.
   */
  report = (error: unknown): AppError => {
    const appError = toAppError(error);
    this.onError?.(appError);
    return appError;
  };
}
