/**
 * Authorisation helpers for routes and realtime connections.
 *
 * Owns: turning "who is this user and what session is this?" into allow/deny using the
 * shared permission functions. Every route handler and the realtime `onAuthenticate` hook
 * go through here (CLAUDE.md §8: authorisation on the server for everything).
 */

import {
  AppError,
  canAdministerSessions,
  canBrowseBank,
  canCreateQuestion,
  canEndSession,
  canManageBank,
  canOpenQuestion,
  canViewSession,
  type SessionId,
  type UserRole,
} from '@live-class/shared';

import { type AuthUser } from '../auth/tokens.js';
import { type Membership, type SessionService } from '../services/session-service.js';

/**
 * Throws unless the user has one of the roles.
 *
 * @param {AuthUser} user - Authenticated user.
 * @param {readonly UserRole[]} roles - Allowed roles.
 * @returns {void} Nothing.
 * @throws {AppError} `FORBIDDEN` otherwise.
 */
export function assertRole(user: AuthUser, roles: readonly UserRole[]): void {
  if (!roles.includes(user.role))
    throw new AppError('FORBIDDEN', 'You do not have permission to do this');
}

/**
 * Bank-related assertions.
 */
export const bankPolicy = {
  /**
   * Throws unless the user may read the question bank.
   *
   * @param {AuthUser} user - Authenticated user.
   * @returns {void} Nothing.
   * @throws {AppError} `FORBIDDEN` unless the user may browse the bank.
   */
  assertBrowse(user: AuthUser): void {
    if (!canBrowseBank(user.role))
      throw new AppError('FORBIDDEN', 'Only admins and mentors can browse questions');
  },
  /**
   * Throws unless the user may add questions (admins, and mentors for ad hoc uploads).
   *
   * @param {AuthUser} user - Authenticated user.
   * @returns {void} Nothing.
   * @throws {AppError} `FORBIDDEN` unless the user may create questions.
   */
  assertCreate(user: AuthUser): void {
    if (!canCreateQuestion(user.role))
      throw new AppError('FORBIDDEN', 'Only admins and mentors can add questions');
  },
  /**
   * Throws unless the user may edit or delete questions (admins only).
   *
   * @param {AuthUser} user - Authenticated user.
   * @returns {void} Nothing.
   * @throws {AppError} `FORBIDDEN` unless the user may edit or delete questions.
   */
  assertManage(user: AuthUser): void {
    if (!canManageBank(user.role))
      throw new AppError('FORBIDDEN', 'Only admins can edit or delete questions');
  },
};

/**
 * Session-related assertions that need the user's membership.
 */
export class SessionPolicy {
  private readonly sessions: SessionService;

  /**
   * Creates the policy.
   *
   * @param {SessionService} sessions - Used to look up membership.
   */
  constructor(sessions: SessionService) {
    this.sessions = sessions;
  }

  /**
   * Throws unless the user administers sessions.
   *
   * @param {AuthUser} user - Authenticated user.
   * @returns {void} Nothing.
   * @throws {AppError} `FORBIDDEN` for non-admins.
   */
  assertAdminister(user: AuthUser): void {
    if (!canAdministerSessions(user.role))
      throw new AppError('FORBIDDEN', 'Only admins can manage sessions');
  }

  /**
   * Loads membership and throws unless the user may view the session.
   *
   * @param {AuthUser} user - Authenticated user.
   * @param {SessionId} sessionId - The session the user is trying to access.
   * @returns {Promise<Membership>} The membership for further checks.
   * @throws {AppError} `NOT_FOUND` when the session does not exist (also used instead of
   *   `FORBIDDEN` for non-members so session ids cannot be probed).
   */
  async assertView(user: AuthUser, sessionId: SessionId): Promise<Membership> {
    const membership = await this.sessions.membership(sessionId, user.id);
    if (!canViewSession(user.role, membership.participantRole)) {
      throw new AppError('NOT_FOUND', `Session ${sessionId} not found`);
    }
    return membership;
  }

  /**
   * Throws unless the user may open questions in the session.
   *
   * @param {AuthUser} user - Authenticated user.
   * @param {SessionId} sessionId - The session the user is trying to access.
   * @returns {Promise<Membership>} The membership.
   * @throws {AppError} `NOT_FOUND` for non-members; `FORBIDDEN` for students.
   */
  async assertOpenQuestion(user: AuthUser, sessionId: SessionId): Promise<Membership> {
    const membership = await this.assertView(user, sessionId);
    if (!canOpenQuestion(user.role, membership.participantRole)) {
      throw new AppError('FORBIDDEN', 'Only the mentor can open questions');
    }
    return membership;
  }

  /**
   * Throws unless the user may end the session.
   *
   * @param {AuthUser} user - Authenticated user.
   * @param {SessionId} sessionId - The session the user is trying to access.
   * @returns {Promise<Membership>} The membership.
   * @throws {AppError} `NOT_FOUND` for non-members; `FORBIDDEN` for students.
   */
  async assertEnd(user: AuthUser, sessionId: SessionId): Promise<Membership> {
    const membership = await this.assertView(user, sessionId);
    if (!canEndSession(user.role, membership.participantRole)) {
      throw new AppError('FORBIDDEN', 'Only the mentor can end the session');
    }
    return membership;
  }
}
