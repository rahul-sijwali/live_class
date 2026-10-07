/**
 * Demo-only token storage. A real host mints tokens on its backend and passes them as a
 * prop; the demo keeps the development login's token in `sessionStorage`.
 */

const KEY = 'live-class-demo-token';

/**
 * Reads the stored token.
 *
 * @returns {string | null} The token, or null when signed out or storage is unavailable.
 */
export function readToken(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * Stores a token.
 *
 * @param {string} token - Bearer token from the local login.
 * @returns {void} Nothing.
 */
export function writeToken(token: string): void {
  try {
    window.sessionStorage.setItem(KEY, token);
  } catch {
    // Private mode or blocked storage: the user stays signed in for this page only.
  }
}

/**
 * Removes the stored token.
 *
 * @returns {void} Nothing.
 */
export function clearToken(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
