/**
 * Authentication DTOs.
 *
 * Owns: the claims we read from a host-issued token, and the development-only local login.
 * Token signature, expiry, issuer and audience checks happen in the server's auth plugin
 * with `jose`; this module only describes the payload we rely on afterwards.
 */

import { z } from 'zod';

import { UserIdSchema } from '../ids.js';
import { UserRoleSchema } from './session.js';

/** Claims the host must put in a token. `sub` is the host's own user id (any string). */
export const HostTokenClaimsSchema = z.object({
  sub: z.string().min(1).max(200),
  /** Display name shown to the other participant. */
  name: z.string().trim().min(1).max(100),
  role: UserRoleSchema,
});

/** Parsed host token claims. */
export type HostTokenClaims = z.infer<typeof HostTokenClaimsSchema>;

/** Development-only email/password login. */
export const LocalLoginInputSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(8).max(200),
});

/** Parsed local login input. */
export type LocalLoginInput = z.infer<typeof LocalLoginInputSchema>;

/** The current user as seen by the client. */
export const MeSchema = z.object({
  id: UserIdSchema,
  displayName: z.string().min(1).max(100),
  role: UserRoleSchema,
});

/** Parsed current user. */
export type Me = z.infer<typeof MeSchema>;

/** Response of a successful local login. */
export const LoginResponseSchema = z.object({
  /** Bearer token for REST calls and the realtime connection. */
  token: z.string().min(1),
  user: MeSchema,
});

/** Parsed login response. */
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
