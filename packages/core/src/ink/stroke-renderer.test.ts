import {
  asStrokeId,
  asUserId,
  newId,
  type StrokeRecord,
  type StrokeStyle,
} from '@live-class/shared';
import { describe, expect, it } from 'vitest';

import { createRecordingContext } from '../test/setup.js';
import {
  applyStyle,
  HIGHLIGHTER_ALPHA,
  outlineToPath,
  StrokeRenderer,
  strokeOutline,
} from './stroke-renderer.js';

const pen: StrokeStyle = { tool: 'pen', color: '#1d4ed8', sizeUnits: 3 };
const highlighter: StrokeStyle = { tool: 'highlighter', color: '#facc15', sizeUnits: 14 };

/**
 * Builds a committed stroke for tests.
 *
 * @param {StrokeStyle} style - Style to use.
 * @returns {StrokeRecord} A short straight stroke.
 */
function stroke(style: StrokeStyle = pen): StrokeRecord {
  return {
    id: asStrokeId(newId()),
    authorId: asUserId(newId()),
    tool: style.tool,
    color: style.color,
    sizeUnits: style.sizeUnits,
    points: [0, 0, 0.5, 50, 10, 0.5, 100, 0, 0.5],
    bbox: { minX: -1.5, minY: -1.5, maxX: 101.5, maxY: 11.5 },
    createdAt: 1,
  };
}

describe('strokeOutline', () => {
  it('produces a closed polygon around the points', () => {
    const outline = strokeOutline([0, 0, 0.5, 100, 0, 0.5], pen, true);
    expect(outline.length).toBeGreaterThan(4);
    const xs = outline.map((p) => p[0] ?? 0);
    expect(Math.min(...xs)).toBeLessThan(1);
    expect(Math.max(...xs)).toBeGreaterThan(99);
  });

  it('returns an empty outline for no points', () => {
    expect(strokeOutline([], pen, true)).toEqual([]);
  });
});

describe('outlineToPath', () => {
  it('draws a dot for a single point and a closed curve otherwise', () => {
    const dot = outlineToPath([[1, 1]]) as unknown as { commands: { method: string }[] };
    expect(dot.commands.map((c) => c.method)).toEqual(['arc']);
    const shape = outlineToPath([
      [0, 0],
      [10, 0],
      [10, 10],
    ]) as unknown as { commands: { method: string }[] };
    expect(shape.commands[0]?.method).toBe('moveTo');
    expect(shape.commands.at(-1)?.method).toBe('closePath');
  });
});

describe('applyStyle', () => {
  it('uses full opacity for pens and reduced opacity for highlighters', () => {
    const ctx = createRecordingContext();
    applyStyle(ctx, pen);
    expect(ctx.props['fillStyle']).toBe('#1d4ed8');
    expect(ctx.props['globalAlpha']).toBe(1);
    applyStyle(ctx, highlighter);
    expect(ctx.props['globalAlpha']).toBe(HIGHLIGHTER_ALPHA);
  });
});

describe('StrokeRenderer', () => {
  it('caches paths per stroke and invalidates on request', () => {
    const renderer = new StrokeRenderer();
    const s = stroke();
    const first = renderer.pathFor(s);
    expect(renderer.pathFor(s)).toBe(first);
    expect(renderer.cacheSize).toBe(1);
    renderer.invalidate(s.id);
    expect(renderer.cacheSize).toBe(0);
    expect(renderer.pathFor(s)).not.toBe(first);
  });

  it('evicts the oldest entry when the cache is full', () => {
    const renderer = new StrokeRenderer({ cacheLimit: 2 });
    const a = stroke();
    const b = stroke();
    const c = stroke();
    renderer.pathFor(a);
    renderer.pathFor(b);
    renderer.pathFor(c);
    expect(renderer.cacheSize).toBe(2);
    renderer.clear();
    expect(renderer.cacheSize).toBe(0);
  });

  it('fills one path per stroke and does not cache live strokes', () => {
    const renderer = new StrokeRenderer();
    const ctx = createRecordingContext();
    renderer.drawAll(ctx, [stroke(), stroke(highlighter)]);
    expect(ctx.calls.filter((c) => c.method === 'fill')).toHaveLength(2);
    renderer.drawLive(ctx, [0, 0, 0.5, 5, 5, 0.5], pen);
    expect(ctx.calls.filter((c) => c.method === 'fill')).toHaveLength(3);
    expect(renderer.cacheSize).toBe(2);
    renderer.drawLive(ctx, [], pen);
    expect(ctx.calls.filter((c) => c.method === 'fill')).toHaveLength(3);
  });
});
