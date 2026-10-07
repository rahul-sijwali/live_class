/**
 * Users: local login, listing for admins, deletion for privacy requests, and seeding.
 *
 * Owns: everything about `users` rows except token verification (`TokenService`).
 */

import { and, eq, ilike, isNull } from 'drizzle-orm';

import {
  AppError,
  asUserId,
  type ListUsersQuery,
  type LocalLoginInput,
  type User,
  type UserId,
  type UserRole,
} from '@live-class/shared';

import { hashPassword, verifyPassword } from '../auth/password.js';
import { type Db } from '../db/client.js';
import { users } from '../db/schema.js';
import { toUser } from './mappers.js';

/** Accounts created on first start when local login is enabled. */
export const SEED_USERS: readonly { email: string; displayName: string; role: UserRole }[] = [
  { email: 'admin@local.test', displayName: 'Admin', role: 'admin' },
  { email: 'mentor@local.test', displayName: 'Mentor Asha', role: 'mentor' },
  { email: 'student@local.test', displayName: 'Student Ben', role: 'student' },
];

/**
 * User operations.
 */
export class UserService {
  private readonly db: Db;

  /**
   * Creates the service.
   *
   * @param {Db} db - Database handle.
   */
  constructor(db: Db) {
    this.db = db;
  }

  /**
   * Checks an email/password pair (development only).
   *
   * @param {LocalLoginInput} input - Credentials.
   * @returns {Promise<User>} The user on success.
   * @throws {AppError} `UNAUTHENTICATED` when the email is unknown or the password is wrong
   *   (same message for both, so emails cannot be enumerated).
   */
  async authenticateLocal(input: LocalLoginInput): Promise<User> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.email, input.email.toLowerCase()), isNull(users.deletedAt)))
      .limit(1);
    const ok = row?.passwordHash ? await verifyPassword(input.password, row.passwordHash) : false;
    if (!row || !ok) throw new AppError('UNAUTHENTICATED', 'Email or password is incorrect');
    return toUser(row);
  }

  /**
   * Lists users for admin screens.
   *
   * @param {ListUsersQuery} query - Optional role and name filter.
   * @returns {Promise<User[]>} Matching users, newest first, at most 200.
   */
  async list(query: ListUsersQuery): Promise<User[]> {
    const conditions = [isNull(users.deletedAt)];
    if (query.role) conditions.push(eq(users.role, query.role));
    if (query.q) conditions.push(ilike(users.displayName, `%${escapeLike(query.q)}%`));
    const rows = await this.db
      .select()
      .from(users)
      .where(and(...conditions))
      .orderBy(users.createdAt)
      .limit(200);
    return rows.map(toUser);
  }

  /**
   * Loads one user.
   *
   * @param {UserId} id - Identifier of the user to load.
   * @returns {Promise<User>} Public profile of that user.
   * @throws {AppError} `NOT_FOUND` when missing or deleted.
   */
  async get(id: UserId): Promise<User> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    if (!row) throw new AppError('NOT_FOUND', `User ${id} not found`);
    return toUser(row);
  }

  /**
   * Soft-deletes a user and scrubs their personal fields (privacy request). Strokes keep
   * an opaque author id so documents stay consistent.
   *
   * @param {UserId} id - Identifier of the user to delete.
   * @returns {Promise<void>} Resolves when done.
   * @throws {AppError} `NOT_FOUND` when missing.
   */
  async delete(id: UserId): Promise<void> {
    const result = await this.db
      .update(users)
      .set({
        deletedAt: new Date(),
        displayName: 'Deleted user',
        email: null,
        passwordHash: null,
        hostUserId: null,
      })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning({ id: users.id });
    if (result.length === 0) throw new AppError('NOT_FOUND', `User ${id} not found`);
  }

  /**
   * Creates the seed accounts if the table is empty.
   *
   * @param {string} password - Password shared by the seed accounts.
   * @returns {Promise<boolean>} True if accounts were created.
   */
  async seedIfEmpty(password: string): Promise<boolean> {
    const existing = await this.db.select({ id: users.id }).from(users).limit(1);
    if (existing.length > 0) return false;
    const passwordHash = await hashPassword(password);
    await this.db.insert(users).values(
      SEED_USERS.map((seed) => ({
        id: asUserId(crypto.randomUUID()),
        email: seed.email,
        displayName: seed.displayName,
        role: seed.role,
        passwordHash,
      })),
    );
    return true;
  }
}

/**
 * Escapes `%` and `_` so user input cannot widen an ILIKE pattern.
 *
 * @param {string} value - Raw search text.
 * @returns {string} Escaped text.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
