/**
 * Database schema (Drizzle ORM, PostgreSQL dialect).
 *
 * Owns: every table and index. Mirrors live_class.md §6. Changing this file requires a
 * generated migration (`pnpm db:generate`) in the same commit; shipped migrations are
 * never edited (CLAUDE.md §11).
 */

import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import type { PageSize, SheetGeometry } from '@live-class/shared';

/** Binary column for Yjs document state. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const userRole = pgEnum('user_role', ['admin', 'mentor', 'student']);
export const participantRole = pgEnum('participant_role', ['mentor', 'student']);
export const sessionStatus = pgEnum('session_status', ['scheduled', 'live', 'ended']);
export const questionKind = pgEnum('question_kind', ['image', 'gif', 'pdf', 'text']);
export const sessionQuestionSource = pgEnum('session_question_source', [
  'preassigned',
  'live',
  'adhoc',
]);

/** Accounts. Identity comes from the host (`hostUserId`) or, in development, local login. */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    hostUserId: text('host_user_id'),
    displayName: text('display_name').notNull(),
    role: userRole('role').notNull(),
    /** Local login only. */
    email: text('email'),
    /** Local login only (bcrypt). */
    passwordHash: text('password_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('users_host_user_id_idx').on(table.hostUserId),
    uniqueIndex('users_email_idx').on(table.email),
  ],
);

/** A class between one mentor and one student. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    status: sessionStatus('status').notNull().default('scheduled'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sessions_status_idx').on(table.status)],
);

/** Who is in a session. Exactly one mentor and one student (unique on session + role). */
export const sessionParticipants = pgTable(
  'session_participants',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: participantRole('role').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.userId] }),
    uniqueIndex('session_participants_role_idx').on(table.sessionId, table.role),
    index('session_participants_user_idx').on(table.userId),
  ],
);

/** Uploaded, validated files. Immutable (invariant 5). */
export const assets = pgTable('assets', {
  id: text('id').primaryKey(),
  storageKey: text('storage_key').notNull().unique(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  sha256: text('sha256').notNull().unique(),
  /** One entry for images/GIFs, one per page for PDFs. */
  pageSizes: jsonb('page_sizes').$type<PageSize[]>().notNull(),
  thumbnailKey: text('thumbnail_key'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** The question bank. Content is immutable; metadata is editable; deletion is soft. */
export const questions = pgTable(
  'questions',
  {
    id: text('id').primaryKey(),
    kind: questionKind('kind').notNull(),
    title: text('title').notNull(),
    altText: text('alt_text').notNull(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    textMarkdown: text('text_markdown'),
    assetId: text('asset_id').references(() => assets.id),
    pageCount: integer('page_count').notNull().default(1),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('questions_tags_idx').using('gin', table.tags),
    index('questions_created_idx').on(table.createdAt, table.id),
    check(
      'questions_content_check',
      sql`(${table.kind} = 'text' AND ${table.textMarkdown} IS NOT NULL AND ${table.assetId} IS NULL) OR (${table.kind} <> 'text' AND ${table.assetId} IS NOT NULL AND ${table.textMarkdown} IS NULL)`,
    ),
  ],
);

/** Questions attached to a session: pre-assigned, picked live or uploaded ad hoc. */
export const sessionQuestions = pgTable(
  'session_questions',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id),
    position: integer('position').notNull(),
    source: sessionQuestionSource('source').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.questionId] })],
);

/** One page of one question opened inside one session. */
export const sheets = pgTable(
  'sheets',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id),
    pageIndex: integer('page_index').notNull(),
    position: integer('position').notNull(),
    geometry: jsonb('geometry').$type<SheetGeometry>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sheets_session_idx').on(table.sessionId, table.position)],
);

/** Persisted Yjs state per realtime document (`session:<id>` / `sheet:<id>`). */
export const yjsDocuments = pgTable('yjs_documents', {
  name: text('name').primaryKey(),
  state: bytea('state').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Stored flag so `studentCanWrite` survives without the realtime doc (reserved). */
export const sessionSettings = pgTable('session_settings', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  studentCanWrite: boolean('student_can_write').notNull().default(true),
});
