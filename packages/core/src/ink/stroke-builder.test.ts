import { asUserId, newId, type StrokeStyle } from '@live-class/shared';
import { describe, expect, it } from 'vitest';

import { pointCount } from './points.js';
import { StrokeBuilder } from './stroke-builder.js';

const style: StrokeStyle = { tool: 'pen', color: '#111827', sizeUnits: 2.5 };
const author = asUserId(newId());

describe('StrokeBuilder', () => {
  it('builds a record with id, author, style, simplified points and bounds', () => {
    const builder = new StrokeBuilder({ now: () => 1234, createId: () => newId() });
    builder.begin(style, author, { x: 0, y: 0, pressure: 0.5 });
    builder.addPoint({ x: 10, y: 0, pressure: 0.5 });
    builder.addPoint({ x: 20, y: 0, pressure: 0.5 });
    const record = builder.end();
    expect(record.authorId).toBe(author);
    expect(record.tool).toBe('pen');
    expect(record.createdAt).toBe(1234);
    expect(pointCount(record.points)).toBe(2); // middle collinear point simplified away
    expect(record.bbox).toEqual({ minX: -1.25, minY: -1.25, maxX: 21.25, maxY: 1.25 });
    expect(builder.isActive).toBe(false);
  });

  it('drops jitter closer than the minimum distance', () => {
    const builder = new StrokeBuilder({ minPointDistanceUnits: 1 });
    builder.begin(style, author, { x: 0, y: 0, pressure: 0.5 });
    expect(builder.addPoint({ x: 0.2, y: 0.2, pressure: 0.5 })).toBe(false);
    expect(builder.addPoint({ x: 5, y: 0, pressure: 0.5 })).toBe(true);
    expect(pointCount(builder.points)).toBe(2);
    builder.cancel();
  });

  it('clamps pressure into [0, 1] and substitutes 0.5 for invalid values', () => {
    const builder = new StrokeBuilder();
    builder.begin(style, author, { x: 0, y: 0, pressure: 7 });
    builder.addPoint({ x: 5, y: 5, pressure: Number.NaN });
    const record = builder.end();
    expect(record.points[2]).toBe(1);
    expect(record.points[5]).toBe(0.5);
  });

  it('caps the number of points in the committed record', () => {
    const builder = new StrokeBuilder({ maxPoints: 50, simplifyToleranceUnits: 0 });
    builder.begin(style, author, { x: 0, y: 0, pressure: 0.5 });
    for (let i = 1; i < 2000; i += 1) {
      builder.addPoint({ x: i, y: Math.sin(i) * 20, pressure: 0.5 });
    }
    const record = builder.end();
    expect(pointCount(record.points)).toBeLessThanOrEqual(50);
    expect(pointCount(record.points)).toBeGreaterThanOrEqual(2);
  });

  it('keeps the shape of a gentle curve while simplifying', () => {
    const builder = new StrokeBuilder({ maxPoints: 50, simplifyToleranceUnits: 0.5 });
    builder.begin(style, author, { x: 0, y: 0, pressure: 0.5 });
    for (let i = 1; i < 2000; i += 1) {
      builder.addPoint({ x: i, y: (i / 2000) ** 2 * 100, pressure: 0.5 });
    }
    const record = builder.end();
    expect(pointCount(record.points)).toBeLessThanOrEqual(50);
    expect(pointCount(record.points)).toBeGreaterThan(3);
  });

  it('refuses to begin twice or end without a stroke', () => {
    const builder = new StrokeBuilder();
    expect(() => builder.end()).toThrow();
    expect(() => builder.addPoint({ x: 0, y: 0, pressure: 0.5 })).toThrow();
    builder.begin(style, author, { x: 0, y: 0, pressure: 0.5 });
    expect(() => builder.begin(style, author, { x: 0, y: 0, pressure: 0.5 })).toThrow();
    builder.cancel();
    expect(builder.isActive).toBe(false);
    expect(builder.style).toBeNull();
  });
});
