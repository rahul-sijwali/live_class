import { describe, expect, it } from 'vitest';

import { AppError, appErrorFromResponse, isAppError } from './errors.js';

describe('AppError', () => {
  it('carries a code, message and optional details', () => {
    const error = new AppError('NOT_FOUND', 'missing', { details: { id: '1' } });
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('missing');
    expect(error.details).toEqual({ id: '1' });
    expect(error.name).toBe('AppError');
  });

  it('serialises to the wire format without the cause', () => {
    const cause = new Error('db down');
    const error = new AppError('INTERNAL', 'boom', { cause });
    expect(error.toResponse()).toEqual({ code: 'INTERNAL', message: 'boom' });
    expect(error.cause).toBe(cause);
  });

  it('includes details in the wire format when present', () => {
    const error = new AppError('VALIDATION', 'bad', { details: [{ path: 'title' }] });
    expect(error.toResponse()).toEqual({
      code: 'VALIDATION',
      message: 'bad',
      details: [{ path: 'title' }],
    });
  });
});

describe('isAppError', () => {
  it('recognises instances and structurally similar objects', () => {
    expect(isAppError(new AppError('FORBIDDEN', 'no'))).toBe(true);
    expect(isAppError({ name: 'AppError', code: 'FORBIDDEN', message: 'no' })).toBe(true);
  });

  it('rejects other values', () => {
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError({ name: 'AppError', code: 'NOPE' })).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError('AppError')).toBe(false);
  });
});

describe('appErrorFromResponse', () => {
  it('rebuilds the server error from a valid body', () => {
    const error = appErrorFromResponse({ code: 'SESSION_ENDED', message: 'over' }, 'fallback');
    expect(error.code).toBe('SESSION_ENDED');
    expect(error.message).toBe('over');
  });

  it('falls back to INTERNAL for unknown bodies and keeps them as details', () => {
    const error = appErrorFromResponse('<html>502</html>', 'Bad gateway');
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toBe('Bad gateway');
    expect(error.details).toBe('<html>502</html>');
  });
});
