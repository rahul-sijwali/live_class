import { asUserId, newId, type StrokeRecord, type StrokeStyle } from '@live-class/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Viewport } from '../geometry/viewport.js';
import { recordingContextOf } from '../test/setup.js';
import { InkLayer } from './ink-layer.js';
import { computeBBox } from './points.js';
import { StrokeRenderer } from './stroke-renderer.js';

const style: StrokeStyle = { tool: 'pen', color: '#111827', sizeUnits: 2.5 };
const author = asUserId(newId());

/** Frames scheduled by the layer; flushed manually in tests. */
let frames: (() => void)[] = [];

/**
 * Creates a mounted layer over a 500 px wide container (scale 0.5) whose sheet sits at
 * client position (0, 0).
 *
 * @returns {{ layer: InkLayer; sheet: HTMLElement; viewport: Viewport; canvas: HTMLCanvasElement }}
 *   The layer and its elements.
 */
function mountLayer() {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 500, configurable: true });
  const stage = document.createElement('div');
  const sheet = document.createElement('div');
  sheet.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 600 }) as DOMRect;
  Object.defineProperty(sheet, 'clientWidth', { value: 1000, configurable: true });
  stage.appendChild(sheet);
  container.appendChild(stage);
  document.body.appendChild(container);
  const viewport = new Viewport({ container, stage, sheet });
  viewport.setSheetHeightUnits(1200);
  const layer = new InkLayer(sheet, viewport, new StrokeRenderer(), {
    authorId: author,
    style,
    now: () => 1000,
    requestFrame: (cb) => {
      frames.push(cb);
      return frames.length;
    },
    cancelFrame: () => undefined,
  });
  layer.mount();
  const canvas = sheet.querySelector<HTMLCanvasElement>('.lc-ink-live');
  if (!canvas) throw new Error('live canvas missing');
  return { layer, sheet, viewport, canvas };
}

/**
 * Dispatches a pointer event on an element.
 *
 * @param {HTMLElement} target - Element to dispatch on.
 * @param {string} type - Event type.
 * @param {PointerEventInit} init - Event fields.
 * @returns {void} Nothing.
 */
function pointer(target: HTMLElement, type: string, init: PointerEventInit): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'pen',
      isPrimary: true,
      button: 0,
      pressure: 0.6,
      ...init,
    }),
  );
}

/**
 * Builds a committed stroke for tests.
 *
 * @param {number[]} points - Flat points.
 * @returns {StrokeRecord} The stroke.
 */
function committed(points: number[]): StrokeRecord {
  return {
    id: newId() as StrokeRecord['id'],
    authorId: author,
    tool: 'pen',
    color: '#000000',
    sizeUnits: 2,
    points,
    bbox: computeBBox(points, 2),
    createdAt: 1,
  };
}

beforeEach(() => {
  frames = [];
  document.body.innerHTML = '';
});

describe('InkLayer', () => {
  it('sizes canvases to device pixels within the sheet', () => {
    const { sheet, layer } = mountLayer();
    const canvases = sheet.querySelectorAll('canvas');
    expect(canvases).toHaveLength(2);
    const live = canvases[1]!;
    expect(live.style.width).toBe('1000px');
    expect(live.style.height).toBe('1200px');
    // scale 0.5 × dpr 1 → 500 × 600 device pixels
    expect(live.width).toBe(500);
    expect(live.height).toBe(600);
    layer.dispose();
    expect(sheet.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('commits a stroke in sheet units after a pen gesture', () => {
    const { layer, canvas } = mountLayer();
    const committedSpy = vi.fn();
    const liveSpy = vi.fn();
    layer.on('strokeCommitted', committedSpy);
    layer.on('livePenChanged', liveSpy);

    pointer(canvas, 'pointerdown', { clientX: 50, clientY: 50 });
    pointer(canvas, 'pointermove', { clientX: 100, clientY: 50 });
    pointer(canvas, 'pointermove', { clientX: 150, clientY: 80 });
    pointer(canvas, 'pointerup', { clientX: 150, clientY: 80 });

    expect(committedSpy).toHaveBeenCalledTimes(1);
    const record = committedSpy.mock.calls[0]?.[0] as StrokeRecord;
    // client 50 px at scale 0.5 → 100 units
    expect(record.points[0]).toBe(100);
    expect(record.points[1]).toBe(100);
    expect(record.authorId).toBe(author);
    expect(record.createdAt).toBe(1000);
    expect(liveSpy).toHaveBeenLastCalledWith(null);
    layer.dispose();
  });

  it('repaints committed strokes when the set changes and invalidates removed ones', () => {
    const { layer, sheet } = mountLayer();
    const committedCanvas = sheet.querySelector<HTMLCanvasElement>('.lc-ink-committed');
    if (!committedCanvas) throw new Error('missing canvas');
    const a = committed([0, 0, 0.5, 100, 0, 0.5]);
    layer.setStrokes([a]);
    const fills = () =>
      recordingContextOf(committedCanvas).calls.filter((c) => c.method === 'fill');
    expect(fills()).toHaveLength(1);
    layer.setStrokes([]);
    expect(fills()).toHaveLength(1); // nothing new drawn, canvas cleared
    layer.dispose();
  });

  it('emits erase requests once per stroke per gesture', () => {
    const { layer, canvas } = mountLayer();
    const a = committed([0, 100, 0.5, 1000, 100, 0.5]);
    layer.setStrokes([a]);
    layer.setTool('eraser');
    const eraseSpy = vi.fn();
    layer.on('eraseRequested', eraseSpy);
    pointer(canvas, 'pointerdown', { clientX: 100, clientY: 50 }); // (200, 100) units
    pointer(canvas, 'pointermove', { clientX: 120, clientY: 50 });
    pointer(canvas, 'pointerup', { clientX: 120, clientY: 50 });
    expect(eraseSpy).toHaveBeenCalledTimes(1);
    expect(eraseSpy).toHaveBeenCalledWith({ ids: [a.id] });
    layer.dispose();
  });

  it('turns a finger drag into scroll requests', () => {
    const { layer, canvas } = mountLayer();
    const scrollSpy = vi.fn();
    const committedSpy = vi.fn();
    layer.on('scrollRequested', scrollSpy);
    layer.on('strokeCommitted', committedSpy);
    pointer(canvas, 'pointerdown', { pointerType: 'touch', clientX: 10, clientY: 100 });
    pointer(canvas, 'pointermove', { pointerType: 'touch', clientX: 10, clientY: 80 });
    pointer(canvas, 'pointerup', { pointerType: 'touch', clientX: 10, clientY: 80 });
    expect(scrollSpy).toHaveBeenCalledWith({ deltaX: 0, deltaY: 20 });
    expect(committedSpy).not.toHaveBeenCalled();
    layer.dispose();
  });

  it('ignores input when read-only and cancels an active stroke', () => {
    const { layer, canvas } = mountLayer();
    const committedSpy = vi.fn();
    layer.on('strokeCommitted', committedSpy);
    pointer(canvas, 'pointerdown', { clientX: 10, clientY: 10 });
    layer.setReadOnly(true);
    pointer(canvas, 'pointerup', { clientX: 20, clientY: 20 });
    expect(committedSpy).not.toHaveBeenCalled();
    pointer(canvas, 'pointerdown', { clientX: 10, clientY: 10 });
    pointer(canvas, 'pointerup', { clientX: 30, clientY: 30 });
    expect(committedSpy).not.toHaveBeenCalled();
    layer.dispose();
  });

  it('paints remote pens on the live canvas on the next frame', () => {
    const { layer, canvas } = mountLayer();
    layer.setRemotePen('peer-1', { points: [0, 0, 0.5, 10, 10, 0.5], style });
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames.splice(0)) frame();
    const fills = recordingContextOf(canvas).calls.filter((c) => c.method === 'fill');
    expect(fills).toHaveLength(1);
    layer.setRemotePen('peer-1', null);
    for (const frame of frames.splice(0)) frame();
    expect(recordingContextOf(canvas).calls.filter((c) => c.method === 'fill')).toHaveLength(1);
    layer.dispose();
  });
});
