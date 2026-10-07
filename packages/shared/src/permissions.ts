/**
 * The permissions matrix (live_class.md §11) as pure functions.
 *
 * Owns: who may do what, given a role and the resource. Used by the server for every
 * route and realtime document open, and by the client to enable or disable controls.
 * Does not own identity (who the user is) or data access.
 */

import { type ParticipantRole, type SessionStatus, type UserRole } from './schemas/session.js';

/**
 * Whether a role may manage the question bank (edit and delete questions).
 *
 * @param {UserRole} role - The user's account role.
 * @returns {boolean} True only for admins.
 */
export function canManageBank(role: UserRole): boolean {
  return role === 'admin';
}

/**
 * Whether a role may create questions. Mentors may, for ad hoc uploads during class.
 *
 * @param {UserRole} role - The user's account role.
 * @returns {boolean} True for admins and mentors.
 */
export function canCreateQuestion(role: UserRole): boolean {
  return role === 'admin' || role === 'mentor';
}

/**
 * Whether a role may read the question bank.
 *
 * @param {UserRole} role - The user's account role.
 * @returns {boolean} True for admins and mentors; students only see opened sheets.
 */
export function canBrowseBank(role: UserRole): boolean {
  return role === 'admin' || role === 'mentor';
}

/**
 * Whether a role may create sessions, add participants and pre-assign questions.
 *
 * @param {UserRole} role - The user's account role.
 * @returns {boolean} True only for admins.
 */
export function canAdministerSessions(role: UserRole): boolean {
  return role === 'admin';
}

/**
 * Whether a user may open a question in a session. Admins always may; mentors only in
 * sessions they take part in. Pass `null` for `participantRole` when the user is not a
 * participant.
 *
 * @param {UserRole} role - The user's account role.
 * @param {ParticipantRole | null} participantRole - The user's role in this session, if any.
 * @returns {boolean} True if the question may be opened.
 */
export function canOpenQuestion(role: UserRole, participantRole: ParticipantRole | null): boolean {
  return role === 'admin' || participantRole === 'mentor';
}

/**
 * Whether a user may end a session.
 *
 * @param {UserRole} role - The user's account role.
 * @param {ParticipantRole | null} participantRole - The user's role in this session, if any.
 * @returns {boolean} True for admins and the session's mentor.
 */
export function canEndSession(role: UserRole, participantRole: ParticipantRole | null): boolean {
  return role === 'admin' || participantRole === 'mentor';
}

/**
 * Whether a user may read a session (its record, sheets and assets).
 *
 * @param {UserRole} role - The user's account role.
 * @param {ParticipantRole | null} participantRole - The user's role in this session, if any.
 * @returns {boolean} True for admins and participants.
 */
export function canViewSession(role: UserRole, participantRole: ParticipantRole | null): boolean {
  return role === 'admin' || participantRole !== null;
}

/**
 * Whether a participant may open a realtime document for writing.
 *
 * @param {ParticipantRole | null} participantRole - The user's role in this session, if any.
 * @param {SessionStatus} status - Current session status.
 * @returns {boolean} True for participants of a session that has not ended.
 */
export function canWriteRealtime(
  participantRole: ParticipantRole | null,
  status: SessionStatus,
): boolean {
  return participantRole !== null && status !== 'ended';
}

/**
 * Whether a participant may draw right now.
 *
 * @param {ParticipantRole} participantRole - Whether this person is the mentor or the student in the session.
 * @param {boolean} studentCanWrite - The mentor's live toggle for student writing.
 * @returns {boolean} True for mentors always and for students when the toggle is on.
 */
export function canDraw(participantRole: ParticipantRole, studentCanWrite: boolean): boolean {
  return participantRole === 'mentor' || studentCanWrite;
}

/**
 * Whether a participant may erase a given stroke.
 *
 * @param {ParticipantRole} participantRole - Whether this person is the mentor or the student in the session.
 * @param {string} userId - The participant's user id.
 * @param {string} strokeAuthorId - The id of the user who drew the stroke.
 * @returns {boolean} True for mentors (any stroke) and for students (own strokes only).
 */
export function canEraseStroke(
  participantRole: ParticipantRole,
  userId: string,
  strokeAuthorId: string,
): boolean {
  return participantRole === 'mentor' || userId === strokeAuthorId;
}

/**
 * Whether a participant may control the session: current sheet, student write toggle and
 * adding space below a sheet.
 *
 * @param {ParticipantRole} participantRole - Whether this person is the mentor or the student in the session.
 * @returns {boolean} True only for mentors.
 */
export function canControlSession(participantRole: ParticipantRole): boolean {
  return participantRole === 'mentor';
}
