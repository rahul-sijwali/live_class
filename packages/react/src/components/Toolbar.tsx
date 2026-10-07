'use client';
/**
 * Drawing toolbar: tool, colour, width, undo/redo, finger drawing, and the role-specific
 * controls (mentor: add space, student-can-write, end session; student: follow mentor).
 *
 * Owns: only presentation and callbacks. State lives in `LiveClassRoom`.
 */

import { type ActiveTool } from '@live-class/core';
import {
  DEFAULT_HIGHLIGHTER_SIZE_UNITS,
  DEFAULT_PEN_SIZE_UNITS,
  type ParticipantRole,
  type StrokeStyle,
} from '@live-class/shared';

/** Colours offered in the toolbar. */
export const PALETTE = ['#111827', '#1d4ed8', '#dc2626', '#059669', '#d97706', '#7c3aed'] as const;

/** Toolbar state (controlled) and the callbacks it fires. */
export interface ToolbarProps {
  readonly role: ParticipantRole;
  readonly tool: ActiveTool;
  readonly style: StrokeStyle;
  readonly fingerDraws: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly readOnly: boolean;
  readonly studentCanWrite: boolean;
  readonly followMentor: boolean;
  readonly sessionEnded: boolean;
  readonly onToolChange: (tool: ActiveTool) => void;
  readonly onStyleChange: (style: StrokeStyle) => void;
  readonly onFingerDrawsChange: (fingerDraws: boolean) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onAddSpace: () => void;
  readonly onStudentCanWriteChange: (allowed: boolean) => void;
  readonly onFollowMentorChange: (follow: boolean) => void;
  readonly onEndSession: () => void;
}

/**
 * Drawing controls for the room: tool, colour and width pickers, undo/redo, finger
 * drawing, and the controls that depend on the role.
 *
 * @param {ToolbarProps} props - Current state and callbacks.
 * @returns {JSX.Element} A horizontal strip of buttons and toggles.
 */
export function Toolbar(props: ToolbarProps): React.JSX.Element {
  const { role, tool, style, readOnly } = props;
  const drawingDisabled = readOnly || props.sessionEnded;

  /**
   * Switches tool, keeping the width sensible for the tool kind.
   *
   * @param {ActiveTool} next - Tool to select.
   * @returns {void} Nothing.
   */
  const selectTool = (next: ActiveTool): void => {
    props.onToolChange(next);
    if (next === 'pen' || next === 'highlighter') {
      props.onStyleChange({
        ...style,
        tool: next,
        sizeUnits: next === 'highlighter' ? DEFAULT_HIGHLIGHTER_SIZE_UNITS : DEFAULT_PEN_SIZE_UNITS,
      });
    }
  };

  return (
    <div className="lc-toolbar" role="toolbar" aria-label="Drawing tools">
      <div className="lc-toolbar-group" role="group" aria-label="Tool">
        {(['pen', 'highlighter', 'eraser', 'pan'] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={`lc-button lc-tool${tool === candidate ? ' lc-tool-active' : ''}`}
            aria-pressed={tool === candidate}
            aria-label={candidate}
            disabled={drawingDisabled && candidate !== 'pan'}
            onClick={() => {
              selectTool(candidate);
            }}
          >
            {TOOL_LABELS[candidate]}
          </button>
        ))}
      </div>

      <div className="lc-toolbar-group" role="group" aria-label="Colour">
        {PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            className={`lc-swatch${style.color === color ? ' lc-swatch-active' : ''}`}
            style={{ backgroundColor: color }}
            aria-label={`Colour ${color}`}
            aria-pressed={style.color === color}
            disabled={drawingDisabled}
            onClick={() => {
              props.onStyleChange({ ...style, color });
            }}
          />
        ))}
      </div>

      <label className="lc-toolbar-group lc-size">
        <span className="lc-visually-hidden">Pen width</span>
        <input
          type="range"
          min={1}
          max={tool === 'highlighter' ? 40 : 12}
          step={0.5}
          value={style.sizeUnits}
          disabled={drawingDisabled}
          aria-label="Pen width"
          onChange={(event) => {
            props.onStyleChange({ ...style, sizeUnits: Number(event.target.value) });
          }}
        />
      </label>

      <div className="lc-toolbar-group" role="group" aria-label="History">
        <button
          type="button"
          className="lc-button"
          disabled={!props.canUndo || drawingDisabled}
          onClick={props.onUndo}
        >
          Undo
        </button>
        <button
          type="button"
          className="lc-button"
          disabled={!props.canRedo || drawingDisabled}
          onClick={props.onRedo}
        >
          Redo
        </button>
      </div>

      <label className="lc-toggle">
        <input
          type="checkbox"
          checked={props.fingerDraws}
          onChange={(event) => {
            props.onFingerDrawsChange(event.target.checked);
          }}
        />
        Draw with finger
      </label>

      {role === 'mentor' ? (
        <>
          <button
            type="button"
            className="lc-button"
            disabled={props.sessionEnded}
            onClick={props.onAddSpace}
          >
            Add space below
          </button>
          <label className="lc-toggle">
            <input
              type="checkbox"
              checked={props.studentCanWrite}
              disabled={props.sessionEnded}
              onChange={(event) => {
                props.onStudentCanWriteChange(event.target.checked);
              }}
            />
            Student can write
          </label>
          <button
            type="button"
            className="lc-button lc-button-danger"
            disabled={props.sessionEnded}
            onClick={props.onEndSession}
          >
            End session
          </button>
        </>
      ) : (
        <label className="lc-toggle">
          <input
            type="checkbox"
            checked={props.followMentor}
            onChange={(event) => {
              props.onFollowMentorChange(event.target.checked);
            }}
          />
          Follow mentor
        </label>
      )}
    </div>
  );
}

/** Human labels for tools. */
const TOOL_LABELS: Record<ActiveTool, string> = {
  pen: 'Pen',
  highlighter: 'Highlighter',
  eraser: 'Eraser',
  pan: 'Scroll',
};
