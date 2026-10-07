/**
 * Decides what a pointer gesture means: draw, erase, scroll, or nothing.
 *
 * Owns: the pen/finger/mouse rules and palm rejection. A pen always uses the active tool;
 * a mouse uses it with the primary button; a finger scrolls unless "draw with finger" is on
 * and is ignored for a short window after pen input (palm rejection).
 */

import { PALM_REJECTION_WINDOW_MS, type ToolKind } from '@live-class/shared';

/** Tools selectable in the toolbar. `pan` makes every pointer scroll. */
export type ActiveTool = ToolKind | 'eraser' | 'pan';

/** What a pointer-down should start. */
export type PointerAction = 'draw' | 'erase' | 'scroll' | 'ignore';

/** Inputs to the decision. */
export interface PointerPolicyInput {
  /** `PointerEvent.pointerType`: `'pen'`, `'touch'` or `'mouse'`. */
  readonly pointerType: string;
  /** `PointerEvent.isPrimary`; secondary touches never draw. */
  readonly isPrimary: boolean;
  /** `PointerEvent.button`; only the primary mouse button draws. */
  readonly button: number;
  /** Currently selected tool. */
  readonly tool: ActiveTool;
  /** Whether a finger should draw instead of scroll. */
  readonly fingerDraws: boolean;
  /** Whether the layer is read-only (session ended, student locked). */
  readonly readOnly: boolean;
  /** Epoch ms of the last pen input, or null if none yet. */
  readonly lastPenInputAt: number | null;
  /** Current epoch ms. */
  readonly now: number;
}

/**
 * Maps the active tool to the action it performs.
 *
 * @param {ActiveTool} tool - Selected tool.
 * @returns {PointerAction} `draw` for pens/highlighters, `erase` for the eraser, `scroll`
 *   for pan.
 */
function toolAction(tool: ActiveTool): PointerAction {
  switch (tool) {
    case 'pen':
    case 'highlighter':
      return 'draw';
    case 'eraser':
      return 'erase';
    case 'pan':
      return 'scroll';
  }
}

/**
 * Decides what a pointer-down should do.
 *
 * @param {PointerPolicyInput} input - Pointer and layer state.
 * @returns {PointerAction} The action to start.
 * @example
 *   decidePointerAction({ pointerType: 'touch', isPrimary: true, button: 0, tool: 'pen',
 *     fingerDraws: false, readOnly: false, lastPenInputAt: null, now: Date.now() })
 *   // => 'scroll'
 */
export function decidePointerAction(input: PointerPolicyInput): PointerAction {
  const action = toolAction(input.tool);
  switch (input.pointerType) {
    case 'pen':
      if (input.readOnly) return 'ignore';
      return action;
    case 'mouse':
      if (input.button !== 0) return 'ignore';
      if (input.readOnly) return action === 'scroll' ? 'scroll' : 'ignore';
      return action;
    case 'touch': {
      if (!input.isPrimary) return 'ignore';
      const sincePen = input.lastPenInputAt === null ? Infinity : input.now - input.lastPenInputAt;
      if (sincePen < PALM_REJECTION_WINDOW_MS) return 'ignore';
      if (input.readOnly || !input.fingerDraws) return 'scroll';
      return action;
    }
    default:
      return 'ignore';
  }
}

/**
 * CSS cursor for a tool, so the mouse shows what will happen.
 *
 * @param {ActiveTool} tool - Selected tool.
 * @param {boolean} readOnly - Whether drawing is disabled.
 * @returns {string} A CSS `cursor` value.
 */
export function cursorForTool(tool: ActiveTool, readOnly: boolean): string {
  if (readOnly) return 'default';
  switch (tool) {
    case 'pen':
    case 'highlighter':
      return 'crosshair';
    case 'eraser':
      return 'cell';
    case 'pan':
      return 'grab';
  }
}
