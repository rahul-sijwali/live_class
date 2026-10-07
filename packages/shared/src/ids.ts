/**
 * Branded identifier types and id generation.
 *
 * Owns: the one way to create ids (`newId`) and the branded schemas that stop a `SheetId`
 * being passed where a `SessionId` is expected. Does not own persistence or lookup.
 */

import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

/** Any RFC 9562 UUID. Host user ids may be v4, our own ids are v7. */
const uuidSchema = z.uuid();

/** Schema for a session id. */
export const SessionIdSchema = uuidSchema.brand<'SessionId'>();
/** Schema for a sheet id. */
export const SheetIdSchema = uuidSchema.brand<'SheetId'>();
/** Schema for a question id. */
export const QuestionIdSchema = uuidSchema.brand<'QuestionId'>();
/** Schema for an asset id. */
export const AssetIdSchema = uuidSchema.brand<'AssetId'>();
/** Schema for a user id. */
export const UserIdSchema = uuidSchema.brand<'UserId'>();
/** Schema for a stroke id. */
export const StrokeIdSchema = uuidSchema.brand<'StrokeId'>();

/** Identifier of a session. */
export type SessionId = z.infer<typeof SessionIdSchema>;
/** Identifier of a sheet. */
export type SheetId = z.infer<typeof SheetIdSchema>;
/** Identifier of a question. */
export type QuestionId = z.infer<typeof QuestionIdSchema>;
/** Identifier of an uploaded asset. */
export type AssetId = z.infer<typeof AssetIdSchema>;
/** Identifier of a user. */
export type UserId = z.infer<typeof UserIdSchema>;
/** Identifier of a stroke inside a sheet document. */
export type StrokeId = z.infer<typeof StrokeIdSchema>;

/**
 * Generates a new time-sortable id (UUID v7).
 *
 * @returns {string} A lowercase UUID v7 string. Callers brand it with the matching
 *   `as*Id` helper or let a schema do so.
 */
export function newId(): string {
  return uuidv7();
}

/**
 * Validates and brands a string as a `SessionId`.
 *
 * @param {string} value - Candidate id.
 * @returns {SessionId} The same string, branded.
 * @throws {ZodError} If `value` is not a UUID.
 */
export function asSessionId(value: string): SessionId {
  return SessionIdSchema.parse(value);
}

/**
 * Validates and brands a string as a `SheetId`.
 *
 * @param {string} value - Candidate id.
 * @returns {SheetId} The same string, branded.
 * @throws {ZodError} If `value` is not a UUID.
 */
export function asSheetId(value: string): SheetId {
  return SheetIdSchema.parse(value);
}

/**
 * Validates and brands a string as a `QuestionId`.
 *
 * @param {string} value - Candidate id.
 * @returns {QuestionId} The same string, branded.
 * @throws {ZodError} If `value` is not a UUID.
 */
export function asQuestionId(value: string): QuestionId {
  return QuestionIdSchema.parse(value);
}

/**
 * Validates and brands a string as an `AssetId`.
 *
 * @param {string} value - Candidate id.
 * @returns {AssetId} The same string, branded.
 * @throws {ZodError} If `value` is not a UUID.
 */
export function asAssetId(value: string): AssetId {
  return AssetIdSchema.parse(value);
}

/**
 * Validates and brands a string as a `UserId`.
 *
 * @param {string} value - Candidate id.
 * @returns {UserId} The same string, branded.
 * @throws {ZodError} If `value` is not a UUID.
 */
export function asUserId(value: string): UserId {
  return UserIdSchema.parse(value);
}

/**
 * Validates and brands a string as a `StrokeId`.
 *
 * @param {string} value - Candidate id.
 * @returns {StrokeId} The same string, branded.
 * @throws {ZodError} If `value` is not a UUID.
 */
export function asStrokeId(value: string): StrokeId {
  return StrokeIdSchema.parse(value);
}
