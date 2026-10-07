/**
 * The REST API described once, as data, so the server registers routes from it and the
 * client derives its methods from it. Neither side can drift from the other.
 *
 * Owns: method, path, and input/query/output schemas per route, plus `buildPath` for
 * substituting `:params`. Does not own authorisation (server) or transport (client).
 */

import { z } from 'zod';

import { ErrorResponseSchema } from './errors.js';
import { AssetSchema } from './schemas/asset.js';
import { LocalLoginInputSchema, LoginResponseSchema, MeSchema } from './schemas/auth.js';
import { OkResponseSchema } from './schemas/common.js';
import {
  CreateQuestionInputSchema,
  QuestionListSchema,
  QuestionQuerySchema,
  QuestionSchema,
  UpdateQuestionInputSchema,
} from './schemas/question.js';
import {
  AddParticipantInputSchema,
  AssignQuestionsInputSchema,
  CreateSessionInputSchema,
  ListUsersQuerySchema,
  OpenQuestionInputSchema,
  OpenQuestionResultSchema,
  SessionQuestionSchema,
  SessionSchema,
  UserSchema,
} from './schemas/session.js';
import { SheetSchema } from './schemas/sheet.js';

/** HTTP methods used by the API. */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Description of one route. `input` is the JSON body; `query` the query string. */
export interface RouteDefinition<
  TInput extends z.ZodType | undefined = z.ZodType | undefined,
  TQuery extends z.ZodType | undefined = z.ZodType | undefined,
  TOutput extends z.ZodType = z.ZodType,
> {
  readonly method: HttpMethod;
  /** Path with `:param` placeholders, relative to the API base URL. */
  readonly path: string;
  readonly input?: TInput;
  readonly query?: TQuery;
  readonly output: TOutput;
  /** True when the body is `multipart/form-data` instead of JSON. */
  readonly multipart?: true;
  /** True when no bearer token is needed. */
  readonly public?: true;
}

/**
 * Helper that preserves literal types when declaring a route.
 *
 * @param {RouteDefinition} definition - The route description.
 * @returns {RouteDefinition} The same object, typed precisely.
 */
function route<
  TInput extends z.ZodType | undefined = undefined,
  TQuery extends z.ZodType | undefined = undefined,
  TOutput extends z.ZodType = z.ZodType,
>(definition: RouteDefinition<TInput, TQuery, TOutput>): RouteDefinition<TInput, TQuery, TOutput> {
  return definition;
}

/** Every REST route. Keys are the method names exposed by the client. */
export const apiContract = {
  // --- auth ---------------------------------------------------------------
  localLogin: route({
    method: 'POST',
    path: '/auth/local/login',
    input: LocalLoginInputSchema,
    output: LoginResponseSchema,
    public: true,
  }),
  me: route({ method: 'GET', path: '/me', output: MeSchema }),

  // --- users (admin) --------------------------------------------------------
  listUsers: route({
    method: 'GET',
    path: '/users',
    query: ListUsersQuerySchema,
    output: z.array(UserSchema),
  }),
  deleteUser: route({ method: 'DELETE', path: '/users/:id', output: OkResponseSchema }),

  // --- question bank --------------------------------------------------------
  listQuestions: route({
    method: 'GET',
    path: '/questions',
    query: QuestionQuerySchema,
    output: QuestionListSchema,
  }),
  createQuestion: route({
    method: 'POST',
    path: '/questions',
    input: CreateQuestionInputSchema,
    output: QuestionSchema,
  }),
  getQuestion: route({ method: 'GET', path: '/questions/:id', output: QuestionSchema }),
  updateQuestion: route({
    method: 'PATCH',
    path: '/questions/:id',
    input: UpdateQuestionInputSchema,
    output: QuestionSchema,
  }),
  deleteQuestion: route({ method: 'DELETE', path: '/questions/:id', output: OkResponseSchema }),

  // --- assets ---------------------------------------------------------------
  uploadAsset: route({ method: 'POST', path: '/assets', output: AssetSchema, multipart: true }),
  /** Streams the file; not JSON. Listed so the client can build the URL. */
  getAssetFile: route({ method: 'GET', path: '/assets/:id/file', output: z.never() }),
  /** Streams the thumbnail; not JSON. */
  getAssetThumbnail: route({ method: 'GET', path: '/assets/:id/thumbnail', output: z.never() }),

  // --- sessions -------------------------------------------------------------
  createSession: route({
    method: 'POST',
    path: '/sessions',
    input: CreateSessionInputSchema,
    output: SessionSchema,
  }),
  listSessions: route({ method: 'GET', path: '/sessions', output: z.array(SessionSchema) }),
  getSession: route({ method: 'GET', path: '/sessions/:id', output: SessionSchema }),
  addParticipant: route({
    method: 'POST',
    path: '/sessions/:id/participants',
    input: AddParticipantInputSchema,
    output: SessionSchema,
  }),
  assignQuestions: route({
    method: 'POST',
    path: '/sessions/:id/questions',
    input: AssignQuestionsInputSchema,
    output: z.array(SessionQuestionSchema),
  }),
  listSessionQuestions: route({
    method: 'GET',
    path: '/sessions/:id/questions',
    output: z.array(SessionQuestionSchema),
  }),
  /** A question attached to the session, readable by every participant (students too). */
  getSessionQuestion: route({
    method: 'GET',
    path: '/sessions/:id/questions/:questionId',
    output: QuestionSchema,
  }),
  openQuestion: route({
    method: 'POST',
    path: '/sessions/:id/questions/:questionId/open',
    input: OpenQuestionInputSchema,
    output: OpenQuestionResultSchema,
  }),
  listSheets: route({ method: 'GET', path: '/sessions/:id/sheets', output: z.array(SheetSchema) }),
  endSession: route({ method: 'POST', path: '/sessions/:id/end', output: SessionSchema }),
} as const;

/** The contract object type. */
export type ApiContract = typeof apiContract;

/** Route names. */
export type RouteName = keyof ApiContract;

/** Body type of a route, or `never` when it has none. */
export type RouteInput<K extends RouteName> = ApiContract[K] extends { input?: infer S }
  ? NonNullable<S> extends z.ZodType
    ? z.input<NonNullable<S>>
    : never
  : never;

/** Query type of a route, or `never` when it has none. */
export type RouteQuery<K extends RouteName> = ApiContract[K] extends { query?: infer S }
  ? NonNullable<S> extends z.ZodType
    ? z.input<NonNullable<S>>
    : never
  : never;

/**
 * Whether a route needs no bearer token.
 *
 * @param {RouteDefinition} definition - Any route from the contract.
 * @returns {boolean} True for public routes such as login.
 */
export function isPublicRoute(definition: RouteDefinition): boolean {
  return definition.public === true;
}

/** Parsed response type of a route. */
export type RouteOutput<K extends RouteName> = z.output<ApiContract[K]['output']>;

/** Error body shared by every route. */
export const ApiErrorSchema = ErrorResponseSchema;

/**
 * Substitutes `:param` placeholders in a route path.
 *
 * @param {string} path - Route path such as `/sessions/:id/sheets`.
 * @param {Record<string, string>} params - Values for every placeholder in `path`.
 * @returns {string} The concrete path with each value URL-encoded.
 * @throws {Error} If a placeholder has no value in `params`.
 * @example
 *   buildPath('/questions/:id', { id }) // => '/questions/0192…'
 */
export function buildPath(path: string, params: Readonly<Record<string, string>> = {}): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Missing value for path parameter ":${name}" in ${path}`);
    }
    return encodeURIComponent(value);
  });
}

/**
 * Narrows a value to something that can be written into a query string unambiguously.
 *
 * @param {unknown} value - Any query value.
 * @returns {boolean} True for strings, finite numbers and booleans.
 */
function isQueryScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/**
 * Serialises a query object into a query string, skipping undefined values and joining
 * arrays with commas (the format `QuestionQuerySchema` accepts). Objects are ignored.
 *
 * @param {Record<string, unknown>} query - Query parameters.
 * @returns {string} Either an empty string or a string starting with `?`.
 */
export function buildQueryString(query: Readonly<Record<string, unknown>> | undefined): string {
  if (!query) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const parts = value.filter(isQueryScalar).map((part) => String(part));
      if (parts.length > 0) search.set(key, parts.join(','));
      continue;
    }
    if (isQueryScalar(value)) search.set(key, String(value));
  }
  const text = search.toString();
  return text.length > 0 ? `?${text}` : '';
}
