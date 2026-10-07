/**
 * Sessions, participants, question assignment and sheet creation.
 *
 * Owns: `sessions`, `session_participants`, `session_questions` and `sheets` rows and the
 * server-side geometry of new sheets. Does not own realtime documents; `openQuestion`
 * returns the new sheets and the caller appends them to the session document.
 */

import { and, asc, count, eq, inArray } from 'drizzle-orm';

import {
  type AddParticipantInput,
  AppError,
  type CreateSessionInput,
  computeSheetGeometry,
  computeTextSheetGeometry,
  newId,
  type ParticipantRole,
  PROVISIONAL_TEXT_HEIGHT_UNITS,
  type Question,
  type QuestionId,
  type Session,
  type SessionId,
  type SessionQuestion,
  type SessionQuestionSource,
  type SessionStatus,
  type Sheet,
  type SheetGeometry,
  type UserId,
} from '@live-class/shared';

import { type Db } from '../db/client.js';
import { sessionParticipants, sessionQuestions, sessions, sheets, users } from '../db/schema.js';
import { toSession, toSessionQuestion, toSheet } from './mappers.js';
import { type QuestionService } from './question-service.js';

/** What the authorisation layer needs to know about a user in a session. */
export interface Membership {
  readonly status: SessionStatus;
  /** The user's role in the session, or null when not a participant. */
  readonly participantRole: ParticipantRole | null;
}

/**
 * Session operations.
 */
export class SessionService {
  private readonly db: Db;
  private readonly questionService: QuestionService;

  /**
   * Creates the service.
   *
   * @param {Db} db - Database handle.
   * @param {QuestionService} questionService - Used to resolve questions when opening them.
   */
  constructor(db: Db, questionService: QuestionService) {
    this.db = db;
    this.questionService = questionService;
  }

  /**
   * Creates a session with no participants.
   *
   * @param {CreateSessionInput} input - Title and optional schedule.
   * @param {UserId} userId - Creator.
   * @returns {Promise<Session>} The new session.
   */
  async create(input: CreateSessionInput, userId: UserId): Promise<Session> {
    const id = newId();
    await this.db.insert(sessions).values({
      id,
      title: input.title,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      createdBy: userId,
    });
    return this.get(id as SessionId);
  }

  /**
   * Loads a session with participants.
   *
   * @param {SessionId} id - Identifier of the session to load.
   * @returns {Promise<Session>} The session with its participants.
   * @throws {AppError} `NOT_FOUND` when missing.
   */
  async get(id: SessionId): Promise<Session> {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    if (!row) throw new AppError('NOT_FOUND', `Session ${id} not found`);
    const participants = await this.db
      .select({
        sessionId: sessionParticipants.sessionId,
        userId: sessionParticipants.userId,
        role: sessionParticipants.role,
        joinedAt: sessionParticipants.joinedAt,
        displayName: users.displayName,
      })
      .from(sessionParticipants)
      .innerJoin(users, eq(users.id, sessionParticipants.userId))
      .where(eq(sessionParticipants.sessionId, id));
    return toSession(row, participants);
  }

  /**
   * Lists sessions visible to a user: all for admins, own for participants.
   *
   * @param {UserId} userId - Caller.
   * @param {boolean} isAdmin - Whether the caller is an admin.
   * @returns {Promise<Session[]>} Sessions, newest first (at most 200).
   */
  async list(userId: UserId, isAdmin: boolean): Promise<Session[]> {
    let ids: string[];
    if (isAdmin) {
      ids = (
        await this.db
          .select({ id: sessions.id })
          .from(sessions)
          .orderBy(asc(sessions.createdAt))
          .limit(200)
      ).map((r) => r.id);
    } else {
      ids = (
        await this.db
          .select({ id: sessionParticipants.sessionId })
          .from(sessionParticipants)
          .where(eq(sessionParticipants.userId, userId))
          .limit(200)
      ).map((r) => r.id);
    }
    const result = await Promise.all(ids.map((id) => this.get(id as SessionId)));
    return result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /**
   * Adds the mentor or the student. A session holds exactly one of each.
   *
   * @param {SessionId} sessionId - Session to add the participant to.
   * @param {AddParticipantInput} input - User and role.
   * @returns {Promise<Session>} The updated session.
   * @throws {AppError} `NOT_FOUND` for unknown session or user; `CONFLICT` when the role is
   *   already filled or the user is already in the session; `VALIDATION` when the user's
   *   account role does not match (a student cannot be the mentor).
   */
  async addParticipant(sessionId: SessionId, input: AddParticipantInput): Promise<Session> {
    const session = await this.get(sessionId);
    const [user] = await this.db.select().from(users).where(eq(users.id, input.userId)).limit(1);
    if (!user || user.deletedAt) throw new AppError('NOT_FOUND', `User ${input.userId} not found`);
    if (user.role !== input.role) {
      throw new AppError(
        'VALIDATION',
        `User ${input.userId} is a ${user.role}, not a ${input.role}`,
      );
    }
    if (session.participants.some((p) => p.userId === input.userId)) {
      throw new AppError('CONFLICT', 'User is already in this session');
    }
    if (session.participants.some((p) => p.role === input.role)) {
      throw new AppError('CONFLICT', `This session already has a ${input.role}`);
    }
    await this.db
      .insert(sessionParticipants)
      .values({ sessionId, userId: input.userId, role: input.role });
    return this.get(sessionId);
  }

  /**
   * Resolves a user's relationship to a session for authorisation.
   *
   * @param {SessionId} sessionId - Session being accessed.
   * @param {UserId} userId - Caller whose relationship to the session is wanted.
   * @returns {Promise<Membership>} Status and participant role (null if not a member).
   * @throws {AppError} `NOT_FOUND` when the session does not exist.
   */
  async membership(sessionId: SessionId, userId: UserId): Promise<Membership> {
    const [row] = await this.db
      .select({ status: sessions.status })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!row) throw new AppError('NOT_FOUND', `Session ${sessionId} not found`);
    const [participant] = await this.db
      .select({ role: sessionParticipants.role })
      .from(sessionParticipants)
      .where(
        and(eq(sessionParticipants.sessionId, sessionId), eq(sessionParticipants.userId, userId)),
      )
      .limit(1);
    return { status: row.status, participantRole: participant?.role ?? null };
  }

  /**
   * Pre-assigns questions in order (appending after any existing ones; duplicates ignored).
   *
   * @param {SessionId} sessionId - Session to attach the questions to.
   * @param {readonly QuestionId[]} questionIds - Questions in display order.
   * @returns {Promise<SessionQuestion[]>} All questions attached to the session, in order.
   * @throws {AppError} `NOT_FOUND` for unknown session or question; `SESSION_ENDED` after the end.
   */
  async assignQuestions(
    sessionId: SessionId,
    questionIds: readonly QuestionId[],
  ): Promise<SessionQuestion[]> {
    const session = await this.get(sessionId);
    if (session.status === 'ended') throw new AppError('SESSION_ENDED', 'The session has ended');
    const found = await this.questionService.getMany(questionIds);
    if (found.length !== new Set(questionIds).size) {
      throw new AppError('NOT_FOUND', 'One or more questions do not exist');
    }
    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ questionId: sessionQuestions.questionId, position: sessionQuestions.position })
        .from(sessionQuestions)
        .where(eq(sessionQuestions.sessionId, sessionId));
      const present = new Set(existing.map((e) => e.questionId));
      let position = existing.reduce((max, e) => Math.max(max, e.position + 1), 0);
      for (const question of found) {
        if (present.has(question.id)) continue;
        await tx
          .insert(sessionQuestions)
          .values({ sessionId, questionId: question.id, position, source: 'preassigned' });
        position += 1;
      }
    });
    return this.listQuestions(sessionId);
  }

  /**
   * Lists the questions attached to a session.
   *
   * @param {SessionId} sessionId - Session whose attached questions are listed.
   * @returns {Promise<SessionQuestion[]>} In position order.
   */
  async listQuestions(sessionId: SessionId): Promise<SessionQuestion[]> {
    const rows = await this.db
      .select()
      .from(sessionQuestions)
      .where(eq(sessionQuestions.sessionId, sessionId))
      .orderBy(asc(sessionQuestions.position));
    return rows.map(toSessionQuestion);
  }

  /**
   * Opens a question in a session: creates one sheet per page, records the question as
   * opened and moves a scheduled session to `live`.
   *
   * @param {SessionId} sessionId - Session the question is opened in.
   * @param {QuestionId} questionId - Question to open.
   * @param {SessionQuestionSource} source - How it got here (`live` from the bank, `adhoc`
   *   uploaded now; pre-assigned questions keep `preassigned`).
   * @returns {Promise<{ sheets: Sheet[]; question: Question }>} The new sheets, in order.
   * @throws {AppError} `NOT_FOUND` for unknown session or question; `SESSION_ENDED`;
   *   `CONFLICT` if the question was already opened in this session.
   */
  async openQuestion(
    sessionId: SessionId,
    questionId: QuestionId,
    source: SessionQuestionSource,
  ): Promise<{ sheets: Sheet[]; question: Question }> {
    const session = await this.get(sessionId);
    if (session.status === 'ended') throw new AppError('SESSION_ENDED', 'The session has ended');
    const question = await this.questionService.get(questionId);
    const created = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(sessionQuestions)
        .where(
          and(
            eq(sessionQuestions.sessionId, sessionId),
            eq(sessionQuestions.questionId, questionId),
          ),
        )
        .limit(1);
      if (existing?.openedAt)
        throw new AppError('CONFLICT', 'This question is already open in the session');
      const sheetCount =
        (await tx.select({ value: count() }).from(sheets).where(eq(sheets.sessionId, sessionId)))[0]
          ?.value ?? 0;
      const questionCount =
        (
          await tx
            .select({ value: count() })
            .from(sessionQuestions)
            .where(eq(sessionQuestions.sessionId, sessionId))
        )[0]?.value ?? 0;
      const now = new Date();
      if (existing) {
        await tx
          .update(sessionQuestions)
          .set({ openedAt: now })
          .where(
            and(
              eq(sessionQuestions.sessionId, sessionId),
              eq(sessionQuestions.questionId, questionId),
            ),
          );
      } else {
        await tx
          .insert(sessionQuestions)
          .values({ sessionId, questionId, position: questionCount, source, openedAt: now });
      }
      const rows = [];
      for (let pageIndex = 0; pageIndex < question.pageCount; pageIndex += 1) {
        const [row] = await tx
          .insert(sheets)
          .values({
            id: newId(),
            sessionId,
            questionId,
            pageIndex,
            position: sheetCount + pageIndex,
            geometry: geometryFor(question, pageIndex),
          })
          .returning();
        if (row) rows.push(row);
      }
      if (session.status === 'scheduled') {
        await tx
          .update(sessions)
          .set({ status: 'live', startedAt: now })
          .where(eq(sessions.id, sessionId));
      }
      return rows;
    });
    return { sheets: created.map(toSheet), question };
  }

  /**
   * Lists a session's sheets in order.
   *
   * @param {SessionId} sessionId - Session whose sheets are listed.
   * @returns {Promise<Sheet[]>} Every sheet of the session in display order.
   */
  async listSheets(sessionId: SessionId): Promise<Sheet[]> {
    const rows = await this.db
      .select()
      .from(sheets)
      .where(eq(sheets.sessionId, sessionId))
      .orderBy(asc(sheets.position));
    return rows.map(toSheet);
  }

  /**
   * Loads one sheet.
   *
   * @param {string} sheetId - Identifier of the sheet to load (unbranded: it arrives from a document name).
   * @returns {Promise<Sheet>} The sheet record with its geometry.
   * @throws {AppError} `NOT_FOUND` when missing.
   */
  async getSheet(sheetId: string): Promise<Sheet> {
    const [row] = await this.db.select().from(sheets).where(eq(sheets.id, sheetId)).limit(1);
    if (!row) throw new AppError('NOT_FOUND', `Sheet ${sheetId} not found`);
    return toSheet(row);
  }

  /**
   * Whether an asset is used by a question in any of the user's sessions.
   *
   * @param {UserId} userId - Student or mentor whose sessions are searched.
   * @param {string} assetId - Asset to check.
   * @returns {Promise<boolean>} True if some session the user belongs to opened or was
   *   assigned a question backed by this asset.
   */
  async participantCanSeeAsset(userId: UserId, assetId: string): Promise<boolean> {
    const memberships = await this.db
      .select({ sessionId: sessionParticipants.sessionId })
      .from(sessionParticipants)
      .where(eq(sessionParticipants.userId, userId));
    if (memberships.length === 0) return false;
    const sessionIds = memberships.map((m) => m.sessionId);
    const questionIds = (
      await this.db
        .select({ questionId: sessionQuestions.questionId })
        .from(sessionQuestions)
        .where(inArray(sessionQuestions.sessionId, sessionIds))
    ).map((r) => r.questionId);
    if (questionIds.length === 0) return false;
    const found = await this.questionService.getMany(questionIds as QuestionId[]);
    return found.some((q) => q.asset?.id === assetId);
  }

  /**
   * Ends a session. Realtime documents become read-only on the next connection.
   *
   * @param {SessionId} sessionId - Session to end.
   * @returns {Promise<Session>} The ended session.
   * @throws {AppError} `NOT_FOUND` when missing.
   */
  async end(sessionId: SessionId): Promise<Session> {
    const result = await this.db
      .update(sessions)
      .set({ status: 'ended', endedAt: new Date() })
      .where(eq(sessions.id, sessionId))
      .returning({ id: sessions.id });
    if (result.length === 0) throw new AppError('NOT_FOUND', `Session ${sessionId} not found`);
    return this.get(sessionId);
  }
}

/**
 * Computes the stored geometry for one page of a question.
 *
 * @param {Question} question - Question whose page is being turned into a sheet.
 * @param {number} pageIndex - Zero-based page.
 * @returns {SheetGeometry} Geometry in sheet units.
 */
export function geometryFor(question: Question, pageIndex: number): SheetGeometry {
  if (question.kind === 'text' || !question.asset) {
    return computeTextSheetGeometry(PROVISIONAL_TEXT_HEIGHT_UNITS);
  }
  const page = question.asset.pageSizes[pageIndex] ??
    question.asset.pageSizes[0] ?? { width: 1, height: 1 };
  return computeSheetGeometry(page);
}
