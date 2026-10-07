/**
 * Bearer token verification and issuance.
 *
 * Owns: verifying host-issued tokens (JWKS or shared secret) and development-only local
 * tokens, and turning a valid token into an `AuthUser` row. Nothing else touches `jose`.
 */

import { and, eq, isNull } from 'drizzle-orm';
import {
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose';

import {
  AppError,
  asUserId,
  HostTokenClaimsSchema,
  newId,
  type UserId,
  type UserRole,
} from '@live-class/shared';

import { type Config } from '../config.js';
import { type Db } from '../db/client.js';
import { users } from '../db/schema.js';

/** Identity attached to every authenticated request and realtime connection. */
export interface AuthUser {
  readonly id: UserId;
  readonly displayName: string;
  readonly role: UserRole;
}

/** Issuer written into locally issued tokens. */
export const LOCAL_ISSUER = 'live-class-local';

/**
 * Verifies tokens and resolves them to users.
 */
export class TokenService {
  private readonly config: Config;
  private readonly db: Db;
  private readonly hostKey: JWTVerifyGetKey | Uint8Array | null;
  private readonly localKey: Uint8Array | null;

  /**
   * Creates the service.
   *
   * @param {Config} config - Auth settings.
   * @param {Db} db - Database for user lookup and upsert.
   */
  constructor(config: Config, db: Db) {
    this.config = config;
    this.db = db;
    this.hostKey = config.AUTH_HOST_JWKS_URL
      ? createRemoteJWKSet(new URL(config.AUTH_HOST_JWKS_URL))
      : config.AUTH_HOST_SHARED_SECRET
        ? new TextEncoder().encode(config.AUTH_HOST_SHARED_SECRET)
        : null;
    this.localKey =
      config.AUTH_LOCAL_ENABLED && config.AUTH_LOCAL_JWT_SECRET
        ? new TextEncoder().encode(config.AUTH_LOCAL_JWT_SECRET)
        : null;
  }

  /**
   * Verifies a bearer token and loads (or creates) the matching user.
   *
   * @param {string} token - Raw JWT from the `Authorization` header or realtime handshake.
   * @returns {Promise<AuthUser>} The authenticated user.
   * @throws {AppError} `UNAUTHENTICATED` for missing, malformed, expired or wrongly signed
   *   tokens, and for deleted users.
   */
  async verify(token: string): Promise<AuthUser> {
    if (!token) throw new AppError('UNAUTHENTICATED', 'Missing bearer token');
    let issuer: string | undefined;
    try {
      issuer = decodeJwt(token).iss;
    } catch (error) {
      throw new AppError('UNAUTHENTICATED', 'Malformed token', { cause: error });
    }
    if (issuer === LOCAL_ISSUER) return this.verifyLocal(token);
    return this.verifyHost(token);
  }

  /**
   * Issues a development-only token for a local user.
   *
   * @param {UserId} userId - Subject of the token.
   * @returns {Promise<string>} Signed HS256 JWT.
   * @throws {AppError} `FORBIDDEN` when local auth is disabled.
   */
  async issueLocalToken(userId: UserId): Promise<string> {
    if (!this.localKey) throw new AppError('FORBIDDEN', 'Local login is disabled');
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(LOCAL_ISSUER)
      .setAudience(this.config.AUTH_HOST_AUDIENCE)
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${this.config.AUTH_LOCAL_TOKEN_TTL_SECONDS}s`)
      .sign(this.localKey);
  }

  /**
   * Verifies a local token and loads its user.
   *
   * @param {string} token - Raw JWT.
   * @returns {Promise<AuthUser>} The user.
   * @throws {AppError} `UNAUTHENTICATED` on any failure.
   */
  private async verifyLocal(token: string): Promise<AuthUser> {
    if (!this.localKey) throw new AppError('UNAUTHENTICATED', 'Local login is disabled');
    const payload = await this.verifyWith(token, this.localKey, LOCAL_ISSUER);
    if (!payload.sub) throw new AppError('UNAUTHENTICATED', 'Token has no subject');
    const [row] = await this.db
      .select({ id: users.id, displayName: users.displayName, role: users.role })
      .from(users)
      .where(and(eq(users.id, payload.sub), isNull(users.deletedAt)))
      .limit(1);
    if (!row) throw new AppError('UNAUTHENTICATED', 'Unknown user');
    return { id: asUserId(row.id), displayName: row.displayName, role: row.role };
  }

  /**
   * Verifies a host token and upserts its user by the host's user id.
   *
   * @param {string} token - Raw JWT.
   * @returns {Promise<AuthUser>} The user.
   * @throws {AppError} `UNAUTHENTICATED` on any failure.
   */
  private async verifyHost(token: string): Promise<AuthUser> {
    if (!this.hostKey) throw new AppError('UNAUTHENTICATED', 'Host tokens are not configured');
    const payload = await this.verifyWith(token, this.hostKey, this.config.AUTH_HOST_ISSUER);
    const claims = HostTokenClaimsSchema.safeParse(payload);
    if (!claims.success) {
      throw new AppError('UNAUTHENTICATED', 'Token is missing required claims', {
        details: claims.error.issues,
      });
    }
    const { sub, name, role } = claims.data;
    const [existing] = await this.db
      .select({
        id: users.id,
        displayName: users.displayName,
        role: users.role,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.hostUserId, sub))
      .limit(1);
    if (existing) {
      if (existing.deletedAt) throw new AppError('UNAUTHENTICATED', 'User has been deleted');
      if (existing.displayName !== name || existing.role !== role) {
        await this.db
          .update(users)
          .set({ displayName: name, role })
          .where(eq(users.id, existing.id));
      }
      return { id: asUserId(existing.id), displayName: name, role };
    }
    const id = asUserId(newId());
    await this.db.insert(users).values({ id, hostUserId: sub, displayName: name, role });
    return { id, displayName: name, role };
  }

  /**
   * Runs `jwtVerify` with our audience and the given issuer, mapping failures.
   *
   * @param {string} token - Raw JWT.
   * @param {JWTVerifyGetKey | Uint8Array} key - Verification key or JWKS resolver.
   * @param {string} issuer - Expected `iss` claim.
   * @returns {Promise<JWTPayload>} Verified payload.
   * @throws {AppError} `UNAUTHENTICATED` when verification fails.
   */
  private async verifyWith(
    token: string,
    key: JWTVerifyGetKey | Uint8Array,
    issuer: string,
  ): Promise<JWTPayload> {
    try {
      const options = { issuer, audience: this.config.AUTH_HOST_AUDIENCE };
      const result =
        key instanceof Uint8Array
          ? await jwtVerify(token, key, options)
          : await jwtVerify(token, key, options);
      return result.payload;
    } catch (error) {
      throw new AppError('UNAUTHENTICATED', 'Invalid or expired token', { cause: error });
    }
  }
}
