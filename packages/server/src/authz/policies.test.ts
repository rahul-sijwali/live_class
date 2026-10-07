import { describe, expect, it } from 'vitest';

import { asSessionId, asUserId, newId } from '@live-class/shared';

import { type AuthUser } from '../auth/tokens.js';
import { type Membership, type SessionService } from '../services/session-service.js';
import { assertRole, bankPolicy, SessionPolicy } from './policies.js';

const admin: AuthUser = { id: asUserId(newId()), displayName: 'A', role: 'admin' };
const mentor: AuthUser = { id: asUserId(newId()), displayName: 'M', role: 'mentor' };
const student: AuthUser = { id: asUserId(newId()), displayName: 'S', role: 'student' };
const sessionId = asSessionId(newId());

/**
 * Builds a policy over a stub session service returning the given membership.
 *
 * @param {Membership} membership - Membership to return for any user.
 * @returns {SessionPolicy} The policy.
 */
function policyWith(membership: Membership): SessionPolicy {
  const stub = { membership: () => Promise.resolve(membership) } as unknown as SessionService;
  return new SessionPolicy(stub);
}

describe('assertRole and bank policy', () => {
  it('allows listed roles and rejects others', () => {
    expect(() => assertRole(admin, ['admin'])).not.toThrow();
    expect(() => assertRole(mentor, ['admin'])).toThrow(/permission/);
    expect(() => bankPolicy.assertBrowse(mentor)).not.toThrow();
    expect(() => bankPolicy.assertBrowse(student)).toThrow();
    expect(() => bankPolicy.assertCreate(mentor)).not.toThrow();
    expect(() => bankPolicy.assertCreate(student)).toThrow();
    expect(() => bankPolicy.assertManage(admin)).not.toThrow();
    expect(() => bankPolicy.assertManage(mentor)).toThrow();
  });
});

describe('SessionPolicy', () => {
  it('lets admins administer and view everything', async () => {
    const policy = policyWith({ status: 'live', participantRole: null });
    expect(() => policy.assertAdminister(admin)).not.toThrow();
    expect(() => policy.assertAdminister(mentor)).toThrow();
    await expect(policy.assertView(admin, sessionId)).resolves.toMatchObject({
      participantRole: null,
    });
    await expect(policy.assertOpenQuestion(admin, sessionId)).resolves.toBeDefined();
    await expect(policy.assertEnd(admin, sessionId)).resolves.toBeDefined();
  });

  it('hides sessions from non-members with NOT_FOUND', async () => {
    const policy = policyWith({ status: 'live', participantRole: null });
    await expect(policy.assertView(mentor, sessionId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets mentors open and end, and students only view', async () => {
    const asMentor = policyWith({ status: 'live', participantRole: 'mentor' });
    await expect(asMentor.assertOpenQuestion(mentor, sessionId)).resolves.toBeDefined();
    await expect(asMentor.assertEnd(mentor, sessionId)).resolves.toBeDefined();
    const asStudent = policyWith({ status: 'live', participantRole: 'student' });
    await expect(asStudent.assertView(student, sessionId)).resolves.toBeDefined();
    await expect(asStudent.assertOpenQuestion(student, sessionId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(asStudent.assertEnd(student, sessionId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
