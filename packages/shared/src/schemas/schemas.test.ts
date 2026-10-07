import { describe, expect, it } from 'vitest';

import { newId } from '../ids.js';
import { TagSchema } from './common.js';
import { CreateQuestionInputSchema, QuestionQuerySchema } from './question.js';
import { AwarenessStateSchema, docName, parseDocName } from './realtime.js';
import { StrokeRecordSchema } from './stroke.js';

describe('TagSchema', () => {
  it('trims and lower-cases', () => {
    expect(TagSchema.parse('  Algebra ')).toBe('algebra');
  });

  it('rejects punctuation that would break search', () => {
    expect(TagSchema.safeParse('alg;bra').success).toBe(false);
  });
});

describe('CreateQuestionInputSchema', () => {
  it('accepts a text question', () => {
    const parsed = CreateQuestionInputSchema.parse({
      kind: 'text',
      title: 'Quadratics',
      altText: 'Solve x squared minus 4 equals 0',
      textMarkdown: 'Solve $x^2 - 4 = 0$',
    });
    expect(parsed.kind).toBe('text');
    expect(parsed.tags).toEqual([]);
  });

  it('accepts a media question with an asset id', () => {
    const parsed = CreateQuestionInputSchema.parse({
      kind: 'gif',
      title: 'Slide 3',
      altText: 'Animated triangle',
      tags: ['Geometry'],
      assetId: newId(),
    });
    expect(parsed.kind).toBe('gif');
    expect(parsed.tags).toEqual(['geometry']);
  });

  it('rejects a text question without Markdown', () => {
    const result = CreateQuestionInputSchema.safeParse({
      kind: 'text',
      title: 'x',
      altText: 'y',
    });
    expect(result.success).toBe(false);
  });

  it('requires alt text', () => {
    const result = CreateQuestionInputSchema.safeParse({
      kind: 'image',
      title: 'x',
      altText: '   ',
      assetId: newId(),
    });
    expect(result.success).toBe(false);
  });
});

describe('QuestionQuerySchema', () => {
  it('splits comma-separated tags and coerces the limit', () => {
    const parsed = QuestionQuerySchema.parse({ tags: 'algebra,Geometry', limit: '5' });
    expect(parsed.tags).toEqual(['algebra', 'geometry']);
    expect(parsed.limit).toBe(5);
  });

  it('applies the default limit', () => {
    expect(QuestionQuerySchema.parse({}).limit).toBe(20);
  });
});

describe('StrokeRecordSchema', () => {
  const base = {
    id: newId(),
    authorId: newId(),
    tool: 'pen',
    color: '#1d4ed8',
    sizeUnits: 2.5,
    bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    createdAt: Date.now(),
  };

  it('accepts points in x, y, pressure triples', () => {
    expect(
      StrokeRecordSchema.safeParse({ ...base, points: [0, 0, 0.5, 10, 10, 0.5] }).success,
    ).toBe(true);
  });

  it('rejects a points array that is not a multiple of three', () => {
    expect(StrokeRecordSchema.safeParse({ ...base, points: [0, 0, 0.5, 10] }).success).toBe(false);
  });

  it('rejects non-finite coordinates', () => {
    expect(StrokeRecordSchema.safeParse({ ...base, points: [0, Number.NaN, 0.5] }).success).toBe(
      false,
    );
  });
});

describe('document names', () => {
  it('round-trips session and sheet names', () => {
    const id = newId();
    expect(parseDocName(docName('session', id))).toEqual({ kind: 'session', id });
    expect(parseDocName(docName('sheet', id))).toEqual({ kind: 'sheet', id });
  });

  it('rejects unknown kinds and malformed ids', () => {
    expect(parseDocName('room:123')).toBeNull();
    expect(parseDocName('sheet:not-a-uuid')).toBeNull();
    expect(parseDocName('')).toBeNull();
  });
});

describe('AwarenessStateSchema', () => {
  it('accepts a complete state with no pen', () => {
    const parsed = AwarenessStateSchema.parse({
      user: { id: 'u1', name: 'Asha', role: 'mentor', color: '#1d4ed8' },
      viewingSheetId: null,
      followMentor: false,
      pen: null,
    });
    expect(parsed.pen).toBeNull();
  });
});
