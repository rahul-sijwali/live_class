import { describe, expect, it } from 'vitest';

import {
  canAdministerSessions,
  canBrowseBank,
  canControlSession,
  canCreateQuestion,
  canDraw,
  canEndSession,
  canEraseStroke,
  canManageBank,
  canOpenQuestion,
  canViewSession,
  canWriteRealtime,
} from './permissions.js';

describe('bank permissions', () => {
  it('lets only admins manage the bank', () => {
    expect(canManageBank('admin')).toBe(true);
    expect(canManageBank('mentor')).toBe(false);
    expect(canManageBank('student')).toBe(false);
  });

  it('lets admins and mentors create and browse', () => {
    expect(canCreateQuestion('mentor')).toBe(true);
    expect(canCreateQuestion('student')).toBe(false);
    expect(canBrowseBank('admin')).toBe(true);
    expect(canBrowseBank('student')).toBe(false);
  });
});

describe('session permissions', () => {
  it('lets only admins administer sessions', () => {
    expect(canAdministerSessions('admin')).toBe(true);
    expect(canAdministerSessions('mentor')).toBe(false);
  });

  it('lets admins and the session mentor open questions and end the session', () => {
    expect(canOpenQuestion('admin', null)).toBe(true);
    expect(canOpenQuestion('mentor', 'mentor')).toBe(true);
    expect(canOpenQuestion('mentor', null)).toBe(false);
    expect(canOpenQuestion('student', 'student')).toBe(false);
    expect(canEndSession('mentor', 'mentor')).toBe(true);
    expect(canEndSession('student', 'student')).toBe(false);
  });

  it('lets admins and participants view a session', () => {
    expect(canViewSession('admin', null)).toBe(true);
    expect(canViewSession('student', 'student')).toBe(true);
    expect(canViewSession('mentor', null)).toBe(false);
  });
});

describe('realtime permissions', () => {
  it('allows writes only for participants of a session that has not ended', () => {
    expect(canWriteRealtime('student', 'live')).toBe(true);
    expect(canWriteRealtime('mentor', 'scheduled')).toBe(true);
    expect(canWriteRealtime('mentor', 'ended')).toBe(false);
    expect(canWriteRealtime(null, 'live')).toBe(false);
  });

  it('lets mentors draw always and students only when allowed', () => {
    expect(canDraw('mentor', false)).toBe(true);
    expect(canDraw('student', false)).toBe(false);
    expect(canDraw('student', true)).toBe(true);
  });

  it('lets mentors erase any stroke and students only their own', () => {
    expect(canEraseStroke('mentor', 'm', 's')).toBe(true);
    expect(canEraseStroke('student', 's', 's')).toBe(true);
    expect(canEraseStroke('student', 's', 'm')).toBe(false);
  });

  it('lets only mentors control the session', () => {
    expect(canControlSession('mentor')).toBe(true);
    expect(canControlSession('student')).toBe(false);
  });
});
