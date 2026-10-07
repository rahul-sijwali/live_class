import {
  asQuestionId,
  asSessionId,
  asSheetId,
  asStrokeId,
  asUserId,
  computeSheetGeometry,
  newId,
  type Question,
  type Sheet,
  type StrokeRecord,
  type StrokeStyle,
} from '@live-class/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { type QuestionView } from '../question/question-view.js';
import { Presence } from '../sync/presence.js';
import { SheetDoc } from '../sync/sheet-doc.js';
import { SheetController } from './sheet-controller.js';

const style: StrokeStyle = { tool: 'pen', color: '#111827', sizeUnits: 2 };
const mentorId = asUserId(newId());
const studentId = asUserId(newId());

/**
 * Builds a sheet + question pair.
 *
 * @param {Question['kind']} kind - Question kind.
 * @returns {{ sheet: Sheet; question: Question }} Records.
 */
function fixtures(kind: Question['kind'] = 'image') {
  const question: Question = {
    id: asQuestionId(newId()),
    kind,
    title: 'Q',
    altText: 'alt',
    tags: [],
    textMarkdown: kind === 'text' ? 'Hello $x$' : null,
    asset: null,
    pageCount: 1,
    createdBy: mentorId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const sheet: Sheet = {
    id: asSheetId(newId()),
    sessionId: asSessionId(newId()),
    questionId: question.id,
    pageIndex: 0,
    position: 0,
    geometry: computeSheetGeometry({ width: 1000, height: 500 }),
    createdAt: new Date().toISOString(),
  };
  return { sheet, question };
}

/** A question view that renders nothing and reports a fixed size. */
class FakeView implements QuestionView {
  mounted = false;
  disposed = false;
  scale: number | null = null;
  constructor(private readonly size = { width: 1000, height: 500 }) {}
  mount(): Promise<{ width: number; height: number }> {
    this.mounted = true;
    return Promise.resolve(this.size);
  }
  onScaleChange(scale: number): void {
    this.scale = scale;
  }
  dispose(): void {
    this.disposed = true;
  }
}

/**
 * Builds a controller with fakes.
 *
 * @param {object} options - Role and overrides.
 * @returns {object} The controller and collaborators.
 */
function build(options: {
  role?: 'mentor' | 'student';
  view?: FakeView;
  kind?: Question['kind'];
  studentCanWrite?: boolean;
}) {
  const role = options.role ?? 'mentor';
  const { sheet, question } = fixtures(options.kind);
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 1000, configurable: true });
  document.body.appendChild(container);
  const sheetDoc = new SheetDoc(new Y.Doc());
  const presence = new Presence(new Awareness(new Y.Doc()), {
    user: { id: role === 'mentor' ? mentorId : studentId, name: 'A', role, color: '#1d4ed8' },
    viewingSheetId: sheet.id,
    followMentor: false,
    pen: null,
  });
  const view = options.view ?? new FakeView();
  const controller = new SheetController({
    container,
    sheet,
    question,
    assetUrl: 'https://api/x',
    user: { id: role === 'mentor' ? mentorId : studentId, role },
    sheetDoc,
    presence,
    initialStyle: style,
    createView: () => view,
    ...(options.studentCanWrite === undefined ? {} : { studentCanWrite: options.studentCanWrite }),
  });
  return { controller, sheetDoc, presence, container, sheet, view };
}

/**
 * Builds a stroke by a given author.
 *
 * @param {string} authorId - Author id.
 * @returns {StrokeRecord} The stroke.
 */
function strokeBy(authorId: string): StrokeRecord {
  return {
    id: asStrokeId(newId()),
    authorId: asUserId(authorId),
    tool: 'pen',
    color: '#000000',
    sizeUnits: 2,
    points: [0, 0, 0.5, 10, 0, 0.5],
    bbox: { minX: -1, minY: -1, maxX: 11, maxY: 1 },
    createdAt: 1,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('SheetController', () => {
  it('mounts the DOM skeleton, renders the view and reports ready', async () => {
    const { controller, container, view } = build({});
    const ready = vi.fn();
    controller.on('ready', ready);
    await controller.mount();
    expect(container.querySelector('.lc-stage .lc-sheet .lc-sheet-content')).not.toBeNull();
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
    expect(view.mounted).toBe(true);
    expect(view.scale).toBe(1);
    expect(ready).toHaveBeenCalledWith({ width: 1000, height: 500 });
    controller.dispose();
    expect(container.children).toHaveLength(0);
    expect(view.disposed).toBe(true);
  });

  it('reports view failures as errors without unmounting', async () => {
    const failing = new FakeView();
    failing.mount = () => Promise.reject(new Error('bad image'));
    const { controller, container } = build({ view: failing });
    const error = vi.fn();
    controller.on('error', error);
    await controller.mount();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'INTERNAL', message: 'bad image' }),
    );
    expect(container.querySelector('.lc-stage')).not.toBeNull();
    controller.dispose();
  });

  it('lets the mentor erase any stroke and the student only their own', async () => {
    const mentor = build({ role: 'mentor' });
    await mentor.controller.mount();
    const byStudent = strokeBy(studentId);
    const byMentor = strokeBy(mentorId);
    mentor.sheetDoc.addStroke(byStudent);
    mentor.sheetDoc.addStroke(byMentor);
    // Reach into the ink layer through its public event path: emit via the layer instance.
    const ink = (
      mentor.controller as unknown as {
        ink: { emitter: { emit: (e: string, p: unknown) => void } };
      }
    ).ink;
    ink.emitter.emit('eraseRequested', { ids: [byStudent.id] });
    expect(mentor.sheetDoc.getStrokes()).toHaveLength(1);
    mentor.controller.dispose();

    const student = build({ role: 'student' });
    await student.controller.mount();
    const other = strokeBy(mentorId);
    const own = strokeBy(studentId);
    student.sheetDoc.addStroke(other);
    student.sheetDoc.addStroke(own);
    const studentInk = (
      student.controller as unknown as {
        ink: { emitter: { emit: (e: string, p: unknown) => void } };
      }
    ).ink;
    studentInk.emitter.emit('eraseRequested', { ids: [other.id, own.id] });
    expect(student.sheetDoc.getStrokes().map((s) => s.id)).toEqual([other.id]);
    student.controller.dispose();
  });

  it('commits strokes only when drawing is allowed', async () => {
    const student = build({ role: 'student', studentCanWrite: false });
    await student.controller.mount();
    const ink = (
      student.controller as unknown as {
        ink: { emitter: { emit: (e: string, p: unknown) => void } };
      }
    ).ink;
    ink.emitter.emit('strokeCommitted', strokeBy(studentId));
    expect(student.sheetDoc.getStrokes()).toHaveLength(0);
    student.controller.setPermissions({ studentCanWrite: true });
    ink.emitter.emit('strokeCommitted', strokeBy(studentId));
    expect(student.sheetDoc.getStrokes()).toHaveLength(1);
    student.controller.dispose();
  });

  it('streams the live pen through presence and clears it on pen up', async () => {
    const { controller, presence, sheet } = build({});
    await controller.mount();
    const ink = (
      controller as unknown as { ink: { emitter: { emit: (e: string, p: unknown) => void } } }
    ).ink;
    ink.emitter.emit('livePenChanged', { points: [1, 2, 0.5], style });
    expect(presence.localState.pen).toMatchObject({ sheetId: sheet.id, points: [1, 2, 0.5] });
    ink.emitter.emit('livePenChanged', null);
    expect(presence.localState.pen).toBeNull();
    controller.dispose();
  });

  it('adds space for the mentor and refuses for the student', async () => {
    const mentor = build({ role: 'mentor' });
    await mentor.controller.mount();
    const before = mentor.controller.currentGeometry.heightUnits;
    mentor.controller.addSpace();
    expect(mentor.sheetDoc.getHeightUnits()).toBe(before + 400);
    expect(mentor.controller.currentGeometry.heightUnits).toBe(before + 400);
    mentor.controller.dispose();

    const student = build({ role: 'student' });
    await student.controller.mount();
    expect(() => student.controller.addSpace()).toThrow(/mentor/);
    student.controller.dispose();
  });

  it('replaces provisional text geometry with the measured height', async () => {
    const { controller } = build({
      kind: 'text',
      view: new FakeView({ width: 1000, height: 250 }),
    });
    await controller.mount();
    const geometry = controller.currentGeometry;
    expect(geometry.assetBox.h).toBe(250);
    expect(geometry.heightUnits).toBe(120 + 250 + 600);
    controller.dispose();
  });

  it('emits change with undo availability', async () => {
    const { controller, sheetDoc } = build({});
    await controller.mount();
    const change = vi.fn();
    controller.on('change', change);
    sheetDoc.addStroke(strokeBy(mentorId));
    expect(change).toHaveBeenLastCalledWith({ canUndo: true, canRedo: false, strokeCount: 1 });
    expect(controller.undo()).toBe(true);
    expect(change).toHaveBeenLastCalledWith({ canUndo: false, canRedo: true, strokeCount: 0 });
    controller.dispose();
  });
});
