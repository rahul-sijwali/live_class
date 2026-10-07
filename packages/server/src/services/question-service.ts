/**
 * The question bank.
 *
 * Owns: `questions` rows: creation from text or an asset, cursor-paginated search, metadata
 * edits and soft deletion. Content is immutable once created.
 */

import { and, arrayContains, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';

import {
  AppError,
  type CreateQuestionInput,
  newId,
  type Question,
  type QuestionId,
  type QuestionList,
  type QuestionQuery,
  type UpdateQuestionInput,
  type UserId,
} from '@live-class/shared';

import { type Db } from '../db/client.js';
import { assets, questions } from '../db/schema.js';
import { type AssetRow, type QuestionRow, toQuestion } from './mappers.js';
import { escapeLike } from './user-service.js';

/** Which question kind an asset MIME type backs. */
const KIND_BY_MIME: Record<string, 'image' | 'gif' | 'pdf'> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

/**
 * Question bank operations.
 */
export class QuestionService {
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
   * Creates a question. For media kinds the asset must exist and its MIME must match
   * the declared kind (a GIF cannot be filed as an image, a PDF cannot be an image).
   *
   * @param {CreateQuestionInput} input - Validated body.
   * @param {UserId} userId - Creator.
   * @returns {Promise<Question>} The new question.
   * @throws {AppError} `NOT_FOUND` for an unknown asset; `VALIDATION` for a kind/MIME mismatch.
   */
  async create(input: CreateQuestionInput, userId: UserId): Promise<Question> {
    const id = newId();
    if (input.kind === 'text') {
      const [row] = await this.db
        .insert(questions)
        .values({
          id,
          kind: 'text',
          title: input.title,
          altText: input.altText,
          tags: input.tags,
          textMarkdown: input.textMarkdown,
          pageCount: 1,
          createdBy: userId,
        })
        .returning();
      if (!row) throw new AppError('INTERNAL', 'Question insert returned no row');
      return toQuestion(row, null);
    }
    const [asset] = await this.db
      .select()
      .from(assets)
      .where(eq(assets.id, input.assetId))
      .limit(1);
    if (!asset) throw new AppError('NOT_FOUND', `Asset ${input.assetId} not found`);
    const expectedKind = KIND_BY_MIME[asset.mime];
    if (expectedKind !== input.kind) {
      throw new AppError(
        'VALIDATION',
        `Asset is ${asset.mime}, which cannot back a "${input.kind}" question`,
      );
    }
    const [row] = await this.db
      .insert(questions)
      .values({
        id,
        kind: input.kind,
        title: input.title,
        altText: input.altText,
        tags: input.tags,
        assetId: asset.id,
        pageCount: asset.pageSizes.length,
        createdBy: userId,
      })
      .returning();
    if (!row) throw new AppError('INTERNAL', 'Question insert returned no row');
    return toQuestion(row, asset);
  }

  /**
   * Loads one question with its asset.
   *
   * @param {QuestionId} id - Identifier of the question to load.
   * @returns {Promise<Question>} The question with its asset, if any.
   * @throws {AppError} `NOT_FOUND` when missing or deleted.
   */
  async get(id: QuestionId): Promise<Question> {
    const [found] = await this.selectWithAsset(
      and(eq(questions.id, id), isNull(questions.deletedAt)),
    ).limit(1);
    if (!found) throw new AppError('NOT_FOUND', `Question ${id} not found`);
    return toQuestion(found.question, found.asset);
  }

  /**
   * Loads several questions by id (order of the input is preserved; missing ids skipped).
   *
   * @param {readonly QuestionId[]} ids - Identifiers to look up; duplicates are allowed.
   * @returns {Promise<Question[]>} Found questions.
   */
  async getMany(ids: readonly QuestionId[]): Promise<Question[]> {
    if (ids.length === 0) return [];
    const rows = await this.selectWithAsset(
      and(
        isNull(questions.deletedAt),
        sql`${questions.id} = ANY(${sql.raw(`ARRAY[${ids.map((id) => `'${id}'`).join(',')}]::text[]`)})`,
      ),
    );
    const byId = new Map(rows.map((row) => [row.question.id, toQuestion(row.question, row.asset)]));
    return ids.flatMap((id) => {
      const question = byId.get(id);
      return question ? [question] : [];
    });
  }

  /**
   * Searches the bank with cursor pagination (newest first).
   *
   * @param {QuestionQuery} query - Text, tags, kind, cursor and page size.
   * @returns {Promise<QuestionList>} One page and the cursor for the next.
   * @throws {AppError} `VALIDATION` for a malformed cursor.
   */
  async list(query: QuestionQuery): Promise<QuestionList> {
    const conditions = [isNull(questions.deletedAt)];
    if (query.kind) conditions.push(eq(questions.kind, query.kind));
    if (query.tags && query.tags.length > 0)
      conditions.push(arrayContains(questions.tags, query.tags));
    if (query.q) {
      const pattern = `%${escapeLike(query.q)}%`;
      const textMatch = or(
        sql`${questions.title} ILIKE ${pattern}`,
        sql`${questions.altText} ILIKE ${pattern}`,
      );
      if (textMatch) conditions.push(textMatch);
    }
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      const keyset = or(
        lt(questions.createdAt, cursor.createdAt),
        and(eq(questions.createdAt, cursor.createdAt), lt(questions.id, cursor.id)),
      );
      if (keyset) conditions.push(keyset);
    }
    const rows = await this.selectWithAsset(and(...conditions))
      .orderBy(desc(questions.createdAt), desc(questions.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => toQuestion(row.question, row.asset)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.question.createdAt, id: last.question.id })
          : null,
    };
  }

  /**
   * Edits title, alt text or tags.
   *
   * @param {QuestionId} id - Identifier of the question to edit.
   * @param {UpdateQuestionInput} patch - Fields to change.
   * @returns {Promise<Question>} The updated question.
   * @throws {AppError} `NOT_FOUND` when missing or deleted.
   */
  async update(id: QuestionId, patch: UpdateQuestionInput): Promise<Question> {
    const result = await this.db
      .update(questions)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(questions.id, id), isNull(questions.deletedAt)))
      .returning({ id: questions.id });
    if (result.length === 0) throw new AppError('NOT_FOUND', `Question ${id} not found`);
    return this.get(id);
  }

  /**
   * Soft-deletes a question. Sessions that already opened it keep their sheets.
   *
   * @param {QuestionId} id - Identifier of the question to remove from the bank.
   * @returns {Promise<void>} Resolves when marked deleted.
   * @throws {AppError} `NOT_FOUND` when missing or already deleted.
   */
  async softDelete(id: QuestionId): Promise<void> {
    const result = await this.db
      .update(questions)
      .set({ deletedAt: new Date() })
      .where(and(eq(questions.id, id), isNull(questions.deletedAt)))
      .returning({ id: questions.id });
    if (result.length === 0) throw new AppError('NOT_FOUND', `Question ${id} not found`);
  }

  /**
   * Base query joining the optional asset.
   *
   * @param {ReturnType<typeof and>} where - Filter.
   * @returns {ReturnType<Db['select']>} Builder yielding `{ question, asset }` rows.
   */
  private selectWithAsset(where: ReturnType<typeof and>) {
    return this.db
      .select({ question: questions, asset: assets })
      .from(questions)
      .leftJoin(assets, eq(questions.assetId, assets.id))
      .where(where)
      .$dynamic() as unknown as {
      orderBy(...args: unknown[]): {
        limit(n: number): Promise<{ question: QuestionRow; asset: AssetRow | null }[]>;
      };
      limit(n: number): Promise<{ question: QuestionRow; asset: AssetRow | null }[]>;
    } & Promise<{ question: QuestionRow; asset: AssetRow | null }[]>;
  }
}

/** Keyset cursor contents. */
interface Cursor {
  readonly createdAt: Date;
  readonly id: string;
}

/**
 * Encodes a keyset cursor as URL-safe base64.
 *
 * @param {Cursor} cursor - Last row's sort keys.
 * @returns {string} Opaque cursor.
 */
function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, 'utf8').toString(
    'base64url',
  );
}

/**
 * Decodes a cursor produced by `encodeCursor`.
 *
 * @param {string} value - Opaque cursor from the client.
 * @returns {Cursor} Sort keys.
 * @throws {AppError} `VALIDATION` when malformed.
 */
function decodeCursor(value: string): Cursor {
  const text = Buffer.from(value, 'base64url').toString('utf8');
  const [iso, id] = text.split('|');
  const createdAt = iso ? new Date(iso) : new Date(Number.NaN);
  if (!id || Number.isNaN(createdAt.getTime())) throw new AppError('VALIDATION', 'Invalid cursor');
  return { createdAt, id };
}
