/**
 * The realtime (Yjs) server: authorises document opens, persists state, fans out updates.
 *
 * Owns: Hocuspocus configuration, the `onAuthenticate` policy (invariants 3 and 4) and
 * persistence to `yjs_documents`. Transport is attached by `websocket-route.ts`.
 */

import { Database } from '@hocuspocus/extension-database';
import { Hocuspocus, type onAuthenticatePayload } from '@hocuspocus/server';
import { eq } from 'drizzle-orm';
import { type Logger } from 'pino';

import {
  AppError,
  asSessionId,
  asUserId,
  canViewSession,
  canWriteRealtime,
  DOC_PERSIST_DEBOUNCE_MS,
  DOC_PERSIST_MAX_WAIT_MS,
  type ParticipantRole,
  parseDocName,
  type SessionId,
} from '@live-class/shared';

import { type AuthUser, type TokenService } from '../auth/tokens.js';
import { type Db } from '../db/client.js';
import { yjsDocuments } from '../db/schema.js';
import { type SessionService } from '../services/session-service.js';

/** Context attached to every authenticated realtime connection. */
export interface RealtimeContext {
  readonly user: AuthUser;
  readonly sessionId: SessionId;
  readonly participantRole: ParticipantRole | null;
  readonly readOnly: boolean;
}

/** Dependencies of the realtime server. */
export interface RealtimeDeps {
  readonly db: Db;
  readonly tokens: TokenService;
  readonly sessions: SessionService;
  readonly logger: Logger;
  /** Optional Redis URL for multi-instance fan-out. */
  readonly redisUrl?: string | undefined;
}

/**
 * Decides whether a token holder may open a document and with what access. Exported so
 * it can be unit-tested without a socket.
 *
 * @param {RealtimeDeps} deps - Token and session services.
 * @param {string} token - Bearer token from the client handshake.
 * @param {string} documentName - `session:<id>` or `sheet:<id>`.
 * @returns {Promise<RealtimeContext>} Context including the read-only decision.
 * @throws {AppError} `UNAUTHENTICATED` for bad tokens, `VALIDATION` for bad names,
 *   `NOT_FOUND` for documents the user may not see.
 */
export async function authorizeDocument(
  deps: Pick<RealtimeDeps, 'tokens' | 'sessions'>,
  token: string,
  documentName: string,
): Promise<RealtimeContext> {
  const user = await deps.tokens.verify(token);
  const parsed = parseDocName(documentName);
  if (!parsed) throw new AppError('VALIDATION', `Invalid document name: ${documentName}`);
  const sessionId =
    parsed.kind === 'session'
      ? asSessionId(parsed.id)
      : (await deps.sessions.getSheet(parsed.id)).sessionId;
  const membership = await deps.sessions.membership(sessionId, asUserId(user.id));
  if (!canViewSession(user.role, membership.participantRole)) {
    throw new AppError('NOT_FOUND', 'Document not found');
  }
  const readOnly = !canWriteRealtime(membership.participantRole, membership.status);
  return { user, sessionId, participantRole: membership.participantRole, readOnly };
}

/**
 * Builds the Hocuspocus instance.
 *
 * @param {RealtimeDeps} deps - Database, auth, sessions and logger.
 * @returns {Promise<Hocuspocus>} Configured server (not listening; attach via `handleConnection`).
 */
export async function createRealtime(deps: RealtimeDeps): Promise<Hocuspocus> {
  const extensions = [
    new Database({
      fetch: async ({ documentName }) => {
        const [row] = await deps.db
          .select({ state: yjsDocuments.state })
          .from(yjsDocuments)
          .where(eq(yjsDocuments.name, documentName))
          .limit(1);
        return row ? new Uint8Array(row.state) : null;
      },
      store: async ({ documentName, state }) => {
        const buffer = Buffer.from(state);
        await deps.db
          .insert(yjsDocuments)
          .values({ name: documentName, state: buffer, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: yjsDocuments.name,
            set: { state: buffer, updatedAt: new Date() },
          });
      },
    }),
  ];
  if (deps.redisUrl) {
    const { Redis } = await import('@hocuspocus/extension-redis');
    const url = new URL(deps.redisUrl);
    extensions.push(
      new Redis({
        host: url.hostname,
        port: Number(url.port || 6379),
        options: {
          ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
          ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
          ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
        },
      }) as unknown as Database,
    );
  }

  return new Hocuspocus({
    name: 'live-class',
    quiet: true,
    // Keep a document in memory until its pending store runs instead of unloading the moment
    // the last socket closes; a client that reconnects within that window joins the same
    // instance (live_class.md §16).
    unloadImmediately: false,
    debounce: DOC_PERSIST_DEBOUNCE_MS,
    maxDebounce: DOC_PERSIST_MAX_WAIT_MS,
    extensions,
    async onAuthenticate(payload: onAuthenticatePayload): Promise<RealtimeContext> {
      try {
        const context = await authorizeDocument(deps, payload.token, payload.documentName);
        payload.connectionConfig.readOnly = context.readOnly;
        return context;
      } catch (error) {
        deps.logger.info(
          {
            documentName: payload.documentName,
            code: error instanceof AppError ? error.code : 'INTERNAL',
          },
          'realtime authentication rejected',
        );
        throw error;
      }
    },
  });
}
