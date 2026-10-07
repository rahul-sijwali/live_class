import { describe, expect, it } from 'vitest';

import { asSessionId, asSheetId, newId, SessionIdSchema } from './ids.js';

describe('newId', () => {
  it('produces a lowercase UUID v7', () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('produces ids that sort by creation time', () => {
    const first = newId();
    const second = newId();
    expect(first < second || first === second).toBe(true);
  });
});

describe('branded ids', () => {
  it('accepts a valid UUID and keeps the string value', () => {
    const raw = newId();
    expect(asSessionId(raw)).toBe(raw);
    expect(SessionIdSchema.parse(raw)).toBe(raw);
  });

  it('rejects malformed ids', () => {
    expect(() => asSheetId('not-a-uuid')).toThrow();
    expect(() => asSessionId('')).toThrow();
  });
});
