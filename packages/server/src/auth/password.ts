/**
 * Password hashing for the development-only local login.
 */

import bcrypt from 'bcryptjs';

/** bcrypt cost factor; 10 keeps tests fast and is adequate for a dev-only feature. */
const COST = 10;

/**
 * Hashes a password.
 *
 * @param {string} password - Plain-text password.
 * @returns {Promise<string>} bcrypt hash.
 */
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

/**
 * Checks a password against a hash.
 *
 * @param {string} password - Plain-text password.
 * @param {string} hash - bcrypt hash from the database.
 * @returns {Promise<boolean>} True when they match.
 */
export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
