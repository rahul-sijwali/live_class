import { asStrokeId, asUserId, newId, type StrokeRecord } from '@live-class/shared';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { SheetDoc } from './sheet-doc.js';

/**
 * Builds a valid stroke for tests.
 *
 * @param {number} createdAt - Creation time.
 * @param {string} authorId - Author.
 * @returns {StrokeRecord} The stroke.
 */
function stroke(createdAt: number, authorId: string = newId()): StrokeRecord {
  return {
    id: asStrokeId(newId()),
    authorId: asUserId(authorId),
    tool: 'pen',
    color: '#111827',
    sizeUnits: 2,
    points: [0, 0, 0.5, 10, 10, 0.5],
    bbox: { minX: -1, minY: -1, maxX: 11, maxY: 11 },
    createdAt,
  };
}

/**
 * Wires two documents so every update on one is applied to the other, like a server would.
 *
 * @param {Y.Doc} a - First doc.
 * @param {Y.Doc} b - Second doc.
 * @returns {void} Nothing.
 */
function link(a: Y.Doc, b: Y.Doc): void {
  a.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(b, update, 'remote');
  });
  b.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(a, update, 'remote');
  });
}

describe('SheetDoc', () => {
  it('adds, lists in order and removes strokes', () => {
    const sheet = new SheetDoc(new Y.Doc());
    const later = stroke(200);
    const earlier = stroke(100);
    sheet.addStroke(later);
    sheet.addStroke(earlier);
    expect(sheet.getStrokes().map((s) => s.id)).toEqual([earlier.id, later.id]);
    expect(sheet.getStroke(later.id)?.id).toBe(later.id);
    sheet.removeStrokes([later.id, asStrokeId(newId())]);
    expect(sheet.getStrokes()).toHaveLength(1);
    sheet.dispose();
  });

  it('rejects invalid records and skips invalid entries written by others', () => {
    const doc = new Y.Doc();
    const sheet = new SheetDoc(doc);
    expect(() => sheet.addStroke({ ...stroke(1), points: [1, 2] })).toThrow();
    doc.getMap('strokes').set('bad', { nonsense: true });
    expect(sheet.getStrokes()).toEqual([]);
    sheet.dispose();
  });

  it('notifies observers with local flag and current state', () => {
    const sheet = new SheetDoc(new Y.Doc());
    const listener = vi.fn();
    const off = sheet.observe(listener);
    sheet.addStroke(stroke(1));
    sheet.setHeightUnits(2500);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ local: true, heightUnits: null });
    expect(listener.mock.calls[1]?.[0]).toMatchObject({ local: true, heightUnits: 2500 });
    off();
    sheet.addStroke(stroke(2));
    expect(listener).toHaveBeenCalledTimes(2);
    sheet.dispose();
  });

  it('merges concurrent edits from two clients', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    link(docA, docB);
    const a = new SheetDoc(docA);
    const b = new SheetDoc(docB);
    const remoteSpy = vi.fn();
    b.observe(remoteSpy);
    const fromA = stroke(1, 'a'.repeat(8) + '-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const fromB = stroke(2);
    a.addStroke(fromA);
    b.addStroke(fromB);
    expect(
      a
        .getStrokes()
        .map((s) => s.id)
        .sort(),
    ).toEqual([fromA.id, fromB.id].sort());
    expect(b.getStrokes()).toHaveLength(2);
    expect(remoteSpy.mock.calls[0]?.[0]).toMatchObject({ local: false });
    a.dispose();
    b.dispose();
  });

  it('undoes only the local user’s strokes', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    link(docA, docB);
    const a = new SheetDoc(docA);
    const b = new SheetDoc(docB);
    const mine = stroke(1);
    const theirs = stroke(2);
    a.addStroke(mine);
    b.addStroke(theirs);
    expect(a.canUndo).toBe(true);
    expect(a.undo()).toBe(true);
    expect(a.getStrokes().map((s) => s.id)).toEqual([theirs.id]);
    expect(b.getStrokes().map((s) => s.id)).toEqual([theirs.id]);
    expect(a.undo()).toBe(false);
    expect(a.redo()).toBe(true);
    expect(a.getStrokes()).toHaveLength(2);
    a.dispose();
    b.dispose();
  });

  it('validates the height range', () => {
    const sheet = new SheetDoc(new Y.Doc());
    expect(() => sheet.setHeightUnits(0)).toThrow(RangeError);
    expect(() => sheet.setHeightUnits(1e9)).toThrow(RangeError);
    sheet.dispose();
  });

  it('stops notifying after dispose', () => {
    const doc = new Y.Doc();
    const sheet = new SheetDoc(doc);
    const listener = vi.fn();
    sheet.observe(listener);
    sheet.dispose();
    doc.getMap('strokes').set('x', stroke(1));
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('SheetDoc extras', () => {
  it('reports undo-stack changes and ignores invalid single strokes', () => {
    const doc = new Y.Doc();
    const sheet = new SheetDoc(doc);
    const listener = vi.fn();
    const off = sheet.onUndoStackChange(listener);
    sheet.addStroke(stroke(1));
    expect(listener).toHaveBeenCalled();
    doc.getMap('strokes').set('bad', { nonsense: true });
    expect(sheet.getStroke(asStrokeId(newId()))).toBeUndefined();
    expect(sheet.getStroke('bad' as never)).toBeUndefined();
    off();
    sheet.removeStrokes([]);
    expect(sheet.getHeightUnits()).toBeNull();
    sheet.dispose();
    sheet.dispose();
  });
});
