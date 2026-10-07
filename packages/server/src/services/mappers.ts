/**
 * Row → DTO conversion so route handlers never leak database shapes.
 *
 * Owns: the mapping and the asset URL convention (`/assets/:id/file`, `/assets/:id/thumbnail`
 * relative to the API base). Does not own queries.
 */

import {
  apiContract,
  type Asset,
  type AssetMime,
  asAssetId,
  asQuestionId,
  asSessionId,
  asSheetId,
  asUserId,
  buildPath,
  type Participant,
  type Question,
  type Session,
  type SessionQuestion,
  type Sheet,
  type User,
} from '@live-class/shared';

import type {
  assets,
  questions,
  sessionParticipants,
  sessionQuestions,
  sessions,
  sheets,
  users,
} from '../db/schema.js';

/** A `users` row as selected. */
export type UserRow = typeof users.$inferSelect;
/** An `assets` row as selected. */
export type AssetRow = typeof assets.$inferSelect;
/** A `questions` row as selected. */
export type QuestionRow = typeof questions.$inferSelect;
/** A `sessions` row as selected. */
export type SessionRow = typeof sessions.$inferSelect;
/** A `session_participants` row joined with the user's display name. */
export type ParticipantRow = typeof sessionParticipants.$inferSelect & { displayName: string };
/** A `session_questions` row as selected. */
export type SessionQuestionRow = typeof sessionQuestions.$inferSelect;
/** A `sheets` row as selected. */
export type SheetRow = typeof sheets.$inferSelect;

/**
 * Formats a timestamp for the wire.
 *
 * @param {Date} value - Database timestamp.
 * @returns {string} ISO 8601 string in UTC.
 */
export function iso(value: Date): string {
  return value.toISOString();
}

/**
 * Converts a user row.
 *
 * @param {UserRow} row - Database row.
 * @returns {User} Public user DTO (no email, no password hash).
 */
export function toUser(row: UserRow): User {
  return {
    id: asUserId(row.id),
    displayName: row.displayName,
    role: row.role,
    createdAt: iso(row.createdAt),
  };
}

/**
 * Converts an asset row.
 *
 * @param {AssetRow} row - Database row.
 * @returns {Asset} Asset DTO with API-relative file and thumbnail paths.
 */
export function toAsset(row: AssetRow): Asset {
  const id = asAssetId(row.id);
  return {
    id,
    mime: row.mime as AssetMime,
    bytes: row.bytes,
    pageSizes: row.pageSizes,
    sha256: row.sha256,
    url: buildPath(apiContract.getAssetFile.path, { id }),
    thumbnailUrl: row.thumbnailKey ? buildPath(apiContract.getAssetThumbnail.path, { id }) : null,
    createdAt: iso(row.createdAt),
  };
}

/**
 * Converts a question row with its optional asset.
 *
 * @param {QuestionRow} row - The question as selected from the database.
 * @param {AssetRow | null} asset - Joined asset row, or null for text questions.
 * @returns {Question} Question DTO.
 */
export function toQuestion(row: QuestionRow, asset: AssetRow | null): Question {
  return {
    id: asQuestionId(row.id),
    kind: row.kind,
    title: row.title,
    altText: row.altText,
    tags: row.tags,
    textMarkdown: row.textMarkdown,
    asset: asset ? toAsset(asset) : null,
    pageCount: row.pageCount,
    createdBy: asUserId(row.createdBy),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/**
 * Converts a session row with its participants.
 *
 * @param {SessionRow} row - The session as selected from the database.
 * @param {ParticipantRow[]} participants - Participant rows joined with display names.
 * @returns {Session} Session DTO.
 */
export function toSession(row: SessionRow, participants: readonly ParticipantRow[]): Session {
  const mapped: Participant[] = participants.map((p) => ({
    userId: asUserId(p.userId),
    displayName: p.displayName,
    role: p.role,
  }));
  return {
    id: asSessionId(row.id),
    title: row.title,
    status: row.status,
    scheduledAt: row.scheduledAt ? iso(row.scheduledAt) : null,
    startedAt: row.startedAt ? iso(row.startedAt) : null,
    endedAt: row.endedAt ? iso(row.endedAt) : null,
    participants: mapped,
    createdBy: asUserId(row.createdBy),
    createdAt: iso(row.createdAt),
  };
}

/**
 * Converts a session-question row.
 *
 * @param {SessionQuestionRow} row - Database row.
 * @returns {SessionQuestion} DTO.
 */
export function toSessionQuestion(row: SessionQuestionRow): SessionQuestion {
  return {
    questionId: asQuestionId(row.questionId),
    position: row.position,
    source: row.source,
    openedAt: row.openedAt ? iso(row.openedAt) : null,
  };
}

/**
 * Converts a sheet row.
 *
 * @param {SheetRow} row - Database row.
 * @returns {Sheet} Sheet DTO.
 */
export function toSheet(row: SheetRow): Sheet {
  return {
    id: asSheetId(row.id),
    sessionId: asSessionId(row.sessionId),
    questionId: asQuestionId(row.questionId),
    pageIndex: row.pageIndex,
    position: row.position,
    geometry: row.geometry,
    createdAt: iso(row.createdAt),
  };
}
