/**
 * Session, participant and user DTOs.
 *
 * Owns: who is in a class, in what role, and the session lifecycle. The server is the
 * authority for all of this (invariant 4); the realtime documents only hold sheet state.
 */

import { z } from 'zod';

import { QuestionIdSchema, SessionIdSchema, UserIdSchema } from '../ids.js';
import { IsoDateTimeSchema } from './common.js';
import { SheetSchema } from './sheet.js';

/** Roles that can join a session as a writer. */
export const PARTICIPANT_ROLES = ['mentor', 'student'] as const;

/** Schema for a participant role. */
export const ParticipantRoleSchema = z.enum(PARTICIPANT_ROLES);

/** Role inside a session. */
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;

/** All roles a user can have. Admins manage; they do not join sessions as writers. */
export const USER_ROLES = ['admin', 'mentor', 'student'] as const;

/** Schema for a user role. */
export const UserRoleSchema = z.enum(USER_ROLES);

/** Account-level role. */
export type UserRole = z.infer<typeof UserRoleSchema>;

/** Session lifecycle. */
export const SESSION_STATUSES = ['scheduled', 'live', 'ended'] as const;

/** Schema for a session status. */
export const SessionStatusSchema = z.enum(SESSION_STATUSES);

/** Session lifecycle state. */
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/** A user as visible to admins and to participants of a shared session. */
export const UserSchema = z.object({
  id: UserIdSchema,
  displayName: z.string().min(1).max(100),
  role: UserRoleSchema,
  createdAt: IsoDateTimeSchema,
});

/** Parsed user. */
export type User = z.infer<typeof UserSchema>;

/** Admin query for listing users. */
export const ListUsersQuerySchema = z.object({
  role: UserRoleSchema.optional(),
  q: z.string().trim().max(100).optional(),
});

/** Parsed user list query. */
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

/** A participant of a session. */
export const ParticipantSchema = z.object({
  userId: UserIdSchema,
  displayName: z.string().min(1).max(100),
  role: ParticipantRoleSchema,
});

/** Parsed participant. */
export type Participant = z.infer<typeof ParticipantSchema>;

/** A session as returned by the API. */
export const SessionSchema = z.object({
  id: SessionIdSchema,
  title: z.string().min(1).max(200),
  status: SessionStatusSchema,
  scheduledAt: IsoDateTimeSchema.nullable(),
  startedAt: IsoDateTimeSchema.nullable(),
  endedAt: IsoDateTimeSchema.nullable(),
  participants: z.array(ParticipantSchema),
  createdBy: UserIdSchema,
  createdAt: IsoDateTimeSchema,
});

/** Parsed session. */
export type Session = z.infer<typeof SessionSchema>;

/** Input for creating a session. Participants are added separately. */
export const CreateSessionInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  scheduledAt: IsoDateTimeSchema.optional(),
});

/** Parsed create-session input. */
export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;

/** Input for adding a participant. A session has exactly one mentor and one student. */
export const AddParticipantInputSchema = z.object({
  userId: UserIdSchema,
  role: ParticipantRoleSchema,
});

/** Parsed add-participant input. */
export type AddParticipantInput = z.infer<typeof AddParticipantInputSchema>;

/** Input for pre-assigning questions, in the order they should appear. */
export const AssignQuestionsInputSchema = z.object({
  questionIds: z.array(QuestionIdSchema).min(1).max(50),
});

/** Parsed assign-questions input. */
export type AssignQuestionsInput = z.infer<typeof AssignQuestionsInputSchema>;

/** Why a question is attached to a session. */
export const SESSION_QUESTION_SOURCES = ['preassigned', 'live', 'adhoc'] as const;

/** Schema for a session-question source. */
export const SessionQuestionSourceSchema = z.enum(SESSION_QUESTION_SOURCES);

/** How a question reached the session. */
export type SessionQuestionSource = z.infer<typeof SessionQuestionSourceSchema>;

/** A question attached to a session, with whether it has been opened yet. */
export const SessionQuestionSchema = z.object({
  questionId: QuestionIdSchema,
  position: z.int().min(0),
  source: SessionQuestionSourceSchema,
  openedAt: IsoDateTimeSchema.nullable(),
});

/** Parsed session question. */
export type SessionQuestion = z.infer<typeof SessionQuestionSchema>;

/** Body for opening a question in a live session. */
export const OpenQuestionInputSchema = z.object({
  /** Marks whether the mentor picked it from the bank (`live`) or uploaded it now (`adhoc`). */
  source: z.enum(['live', 'adhoc']).default('live'),
});

/** Parsed open-question input. */
export type OpenQuestionInput = z.infer<typeof OpenQuestionInputSchema>;

/** Result of opening a question: the sheets that were created, in order. */
export const OpenQuestionResultSchema = z.object({
  sheets: z.array(SheetSchema).min(1),
});

/** Parsed open-question result. */
export type OpenQuestionResult = z.infer<typeof OpenQuestionResultSchema>;
