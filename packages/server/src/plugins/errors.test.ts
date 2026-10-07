import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppError } from '@live-class/shared';

import { statusFor, toAppError } from './errors.js';

describe('toAppError', () => {
  it('passes application errors through', () => {
    const error = new AppError('FORBIDDEN', 'no');
    expect(toAppError(error)).toBe(error);
  });

  it('turns Zod errors into VALIDATION with field details', () => {
    const result = z.object({ title: z.string().min(1) }).safeParse({ title: '' });
    const error = toAppError(result.success ? null : result.error);
    expect(error.code).toBe('VALIDATION');
    expect(error.details).toEqual([expect.objectContaining({ path: 'title' })]);
  });

  it('maps framework upload and parsing errors', () => {
    expect(toAppError({ code: 'FST_REQ_FILE_TOO_LARGE' }).code).toBe('UPLOAD_TOO_LARGE');
    expect(toAppError({ code: 'FST_ERR_CTP_BODY_TOO_LARGE' }).code).toBe('UPLOAD_TOO_LARGE');
    expect(toAppError({ code: 'FST_INVALID_MULTIPART_CONTENT_TYPE', message: 'bad' }).code).toBe(
      'VALIDATION',
    );
    expect(toAppError({ code: 'FST_ERR_CTP_EMPTY_JSON_BODY' }).code).toBe('VALIDATION');
  });

  it('maps status codes and falls back to INTERNAL', () => {
    expect(toAppError({ statusCode: 429 }).code).toBe('RATE_LIMITED');
    expect(toAppError({ statusCode: 404 }).code).toBe('NOT_FOUND');
    expect(toAppError({ statusCode: 400, message: 'nope' }).code).toBe('VALIDATION');
    expect(toAppError(new Error('boom')).code).toBe('INTERNAL');
    expect(toAppError('string').code).toBe('INTERNAL');
  });
});

describe('statusFor', () => {
  it('maps every code to an HTTP status', () => {
    expect(statusFor('UNAUTHENTICATED')).toBe(401);
    expect(statusFor('FORBIDDEN')).toBe(403);
    expect(statusFor('UPLOAD_TYPE_NOT_ALLOWED')).toBe(415);
    expect(statusFor('UPLOAD_LIMITS_EXCEEDED')).toBe(422);
    expect(statusFor('SESSION_ENDED')).toBe(409);
    expect(statusFor('TIMEOUT')).toBe(504);
  });
});
