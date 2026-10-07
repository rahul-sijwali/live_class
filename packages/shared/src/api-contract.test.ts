import { describe, expect, it } from 'vitest';

import { apiContract, buildPath, buildQueryString } from './api-contract.js';

describe('buildPath', () => {
  it('substitutes and encodes parameters', () => {
    expect(
      buildPath('/sessions/:id/questions/:questionId/open', { id: 'a b', questionId: 'q' }),
    ).toBe('/sessions/a%20b/questions/q/open');
  });

  it('throws when a parameter is missing', () => {
    expect(() => buildPath('/questions/:id')).toThrow(/":id"/);
  });

  it('leaves paths without placeholders untouched', () => {
    expect(buildPath('/me')).toBe('/me');
  });
});

describe('buildQueryString', () => {
  it('skips undefined values and joins arrays with commas', () => {
    expect(buildQueryString({ q: 'x', tags: ['a', 'b'], kind: undefined, limit: 5 })).toBe(
      '?q=x&tags=a%2Cb&limit=5',
    );
  });

  it('returns an empty string when nothing is set', () => {
    expect(buildQueryString(undefined)).toBe('');
    expect(buildQueryString({ tags: [] })).toBe('');
  });
});

describe('apiContract', () => {
  it('uses unique method+path pairs', () => {
    const seen = new Set<string>();
    for (const definition of Object.values(apiContract)) {
      const key = `${definition.method} ${definition.path}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('declares bodies only for POST and PATCH routes', () => {
    for (const definition of Object.values(apiContract)) {
      if (definition.input !== undefined) {
        expect(['POST', 'PATCH']).toContain(definition.method);
      }
    }
  });
});
