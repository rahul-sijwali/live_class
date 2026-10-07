import { describe, expect, it } from 'vitest';

import { cursorForTool, decidePointerAction, type PointerPolicyInput } from './pointer-policy.js';

const base: PointerPolicyInput = {
  pointerType: 'pen',
  isPrimary: true,
  button: 0,
  tool: 'pen',
  fingerDraws: false,
  readOnly: false,
  lastPenInputAt: null,
  now: 10_000,
};

describe('decidePointerAction', () => {
  it('lets a pen use the active tool', () => {
    expect(decidePointerAction(base)).toBe('draw');
    expect(decidePointerAction({ ...base, tool: 'eraser' })).toBe('erase');
    expect(decidePointerAction({ ...base, tool: 'pan' })).toBe('scroll');
    expect(decidePointerAction({ ...base, readOnly: true })).toBe('ignore');
  });

  it('lets a mouse draw with the primary button only', () => {
    expect(decidePointerAction({ ...base, pointerType: 'mouse' })).toBe('draw');
    expect(decidePointerAction({ ...base, pointerType: 'mouse', button: 2 })).toBe('ignore');
    expect(decidePointerAction({ ...base, pointerType: 'mouse', readOnly: true })).toBe('ignore');
    expect(
      decidePointerAction({ ...base, pointerType: 'mouse', readOnly: true, tool: 'pan' }),
    ).toBe('scroll');
  });

  it('scrolls with a finger unless finger drawing is on', () => {
    expect(decidePointerAction({ ...base, pointerType: 'touch' })).toBe('scroll');
    expect(decidePointerAction({ ...base, pointerType: 'touch', fingerDraws: true })).toBe('draw');
    expect(
      decidePointerAction({ ...base, pointerType: 'touch', fingerDraws: true, readOnly: true }),
    ).toBe('scroll');
  });

  it('ignores secondary touches and touches right after pen input', () => {
    expect(decidePointerAction({ ...base, pointerType: 'touch', isPrimary: false })).toBe('ignore');
    expect(
      decidePointerAction({ ...base, pointerType: 'touch', lastPenInputAt: 9_800, now: 10_000 }),
    ).toBe('ignore');
    expect(
      decidePointerAction({ ...base, pointerType: 'touch', lastPenInputAt: 9_000, now: 10_000 }),
    ).toBe('scroll');
  });

  it('ignores unknown pointer types', () => {
    expect(decidePointerAction({ ...base, pointerType: 'joystick' })).toBe('ignore');
  });
});

describe('cursorForTool', () => {
  it('shows a crosshair for drawing tools and default when read-only', () => {
    expect(cursorForTool('pen', false)).toBe('crosshair');
    expect(cursorForTool('eraser', false)).toBe('cell');
    expect(cursorForTool('pan', false)).toBe('grab');
    expect(cursorForTool('pen', true)).toBe('default');
  });
});
