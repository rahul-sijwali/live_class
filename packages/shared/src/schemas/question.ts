/**
 * Question bank DTOs.
 *
 * Owns: what a question is, how one is created or edited, and how the bank is queried.
 * Content (the file or Markdown) is immutable; only metadata can be edited.
 */

import { z } from 'zod';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_TAGS_PER_QUESTION,
  MAX_TEXT_MARKDOWN_CHARS,
} from '../constants.js';
import { AssetIdSchema, QuestionIdSchema, UserIdSchema } from '../ids.js';
import { AssetSchema } from './asset.js';
import { IsoDateTimeSchema, TagSchema } from './common.js';

/** The four kinds of question content. */
export const QUESTION_KINDS = ['image', 'gif', 'pdf', 'text'] as const;

/** Schema for a question kind. */
export const QuestionKindSchema = z.enum(QUESTION_KINDS);

/** Kind of question content. */
export type QuestionKind = z.infer<typeof QuestionKindSchema>;

/** Metadata fields every question has. */
const questionMetadataFields = {
  title: z.string().trim().min(1).max(200),
  /** Text alternative read by screen readers and used for search. Required (CLAUDE.md §10). */
  altText: z.string().trim().min(1).max(1000),
  tags: z.array(TagSchema).max(MAX_TAGS_PER_QUESTION).default([]),
};

/** A question as returned by the API. */
export const QuestionSchema = z.object({
  id: QuestionIdSchema,
  kind: QuestionKindSchema,
  ...questionMetadataFields,
  /** Markdown source for `text` questions, null otherwise. */
  textMarkdown: z.string().max(MAX_TEXT_MARKDOWN_CHARS).nullable(),
  /** Uploaded file for `image`, `gif` and `pdf` questions, null for `text`. */
  asset: AssetSchema.nullable(),
  /** Number of renderable pages: 1 except for multi-page PDFs. */
  pageCount: z.int().min(1),
  createdBy: UserIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

/** Parsed question. */
export type Question = z.infer<typeof QuestionSchema>;

/** Input for creating a question from Markdown text. */
export const CreateTextQuestionInputSchema = z.object({
  kind: z.literal('text'),
  ...questionMetadataFields,
  textMarkdown: z.string().trim().min(1).max(MAX_TEXT_MARKDOWN_CHARS),
});

/** Input for creating a question from a previously uploaded asset. */
export const CreateMediaQuestionInputSchema = z.object({
  kind: z.enum(['image', 'gif', 'pdf']),
  ...questionMetadataFields,
  assetId: AssetIdSchema,
});

/** Input for creating any question. The server checks `kind` against the asset's MIME. */
export const CreateQuestionInputSchema = z.discriminatedUnion('kind', [
  CreateTextQuestionInputSchema,
  CreateMediaQuestionInputSchema,
]);

/** Parsed create-question input. */
export type CreateQuestionInput = z.infer<typeof CreateQuestionInputSchema>;

/** Editable metadata. At least one field must be present. */
export const UpdateQuestionInputSchema = z
  .object({
    title: questionMetadataFields.title,
    altText: questionMetadataFields.altText,
    tags: z.array(TagSchema).max(MAX_TAGS_PER_QUESTION),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

/** Parsed update-question input. */
export type UpdateQuestionInput = z.infer<typeof UpdateQuestionInputSchema>;

/**
 * Bank search parameters. `tags` arrives as a comma-separated string in a query string and
 * is normalised into an array.
 */
export const QuestionQuerySchema = z.object({
  /** Free-text search over title and alt text. */
  q: z.string().trim().max(200).optional(),
  tags: z
    .preprocess(
      (value) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value),
      z.array(TagSchema).max(MAX_TAGS_PER_QUESTION),
    )
    .optional(),
  kind: QuestionKindSchema.optional(),
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

/** Parsed bank query. */
export type QuestionQuery = z.infer<typeof QuestionQuerySchema>;

/** One page of bank results. */
export const QuestionListSchema = z.object({
  items: z.array(QuestionSchema),
  /** Cursor for the next page, or null when this is the last page. */
  nextCursor: z.string().nullable(),
});

/** Parsed bank page. */
export type QuestionList = z.infer<typeof QuestionListSchema>;
