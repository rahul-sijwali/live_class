import { asSheetId, newId } from '@live-class/shared';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { SessionDoc } from './session-doc.js';

describe('SessionDoc', () => {
  it('starts empty with student writing allowed', () => {
    const session = new SessionDoc(new Y.Doc());
    expect(session.getState()).toEqual({
      sheetOrder: [],
      currentSheetId: null,
      studentCanWrite: true,
    });
    session.dispose();
  });

  it('appends sheets once and can make the first new one current', () => {
    const session = new SessionDoc(new Y.Doc());
    const a = asSheetId(newId());
    const b = asSheetId(newId());
    session.appendSheets([a, b], true);
    session.appendSheets([b], true); // duplicate ignored, current unchanged
    expect(session.getState()).toMatchObject({ sheetOrder: [a, b], currentSheetId: a });
    session.setCurrentSheet(b);
    expect(session.getState().currentSheetId).toBe(b);
    session.dispose();
  });

  it('refuses to make an unknown sheet current', () => {
    const session = new SessionDoc(new Y.Doc());
    expect(() => session.setCurrentSheet(asSheetId(newId()))).toThrow();
    session.dispose();
  });

  it('toggles student writing and notifies observers', () => {
    const session = new SessionDoc(new Y.Doc());
    const listener = vi.fn();
    session.observe(listener);
    session.setStudentCanWrite(false);
    expect(session.getState().studentCanWrite).toBe(false);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ studentCanWrite: false }));
    session.dispose();
  });

  it('skips malformed sheet ids written by others', () => {
    const doc = new Y.Doc();
    const session = new SessionDoc(doc);
    doc.getArray('sheetOrder').push(['not-a-uuid']);
    expect(session.getState().sheetOrder).toEqual([]);
    session.dispose();
  });
});
