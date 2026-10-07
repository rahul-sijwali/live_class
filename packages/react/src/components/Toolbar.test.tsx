import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Toolbar, type ToolbarProps } from './Toolbar.js';

/**
 * Builds toolbar props with spies.
 *
 * @param {Partial<ToolbarProps>} overrides - Fields to change.
 * @returns {ToolbarProps} Complete props.
 */
function makeProps(overrides: Partial<ToolbarProps> = {}): ToolbarProps {
  return {
    role: 'mentor',
    tool: 'pen',
    style: { tool: 'pen', color: '#111827', sizeUnits: 2.5 },
    fingerDraws: false,
    canUndo: true,
    canRedo: false,
    readOnly: false,
    studentCanWrite: true,
    followMentor: true,
    sessionEnded: false,
    onToolChange: vi.fn(),
    onStyleChange: vi.fn(),
    onFingerDrawsChange: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onAddSpace: vi.fn(),
    onStudentCanWriteChange: vi.fn(),
    onFollowMentorChange: vi.fn(),
    onEndSession: vi.fn(),
    ...overrides,
  };
}

describe('Toolbar', () => {
  it('switches tools and adjusts the width for the highlighter', async () => {
    const props = makeProps();
    render(<Toolbar {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'highlighter' }));
    expect(props.onToolChange).toHaveBeenCalledWith('highlighter');
    expect(props.onStyleChange).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'highlighter', sizeUnits: 14 }),
    );
  });

  it('changes colour and fires undo', async () => {
    const props = makeProps();
    render(<Toolbar {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Colour #dc2626' }));
    expect(props.onStyleChange).toHaveBeenCalledWith(expect.objectContaining({ color: '#dc2626' }));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(props.onUndo).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  it('shows mentor controls for mentors and follow mode for students', () => {
    const { rerender } = render(<Toolbar {...makeProps()} />);
    expect(screen.getByRole('button', { name: 'Add space below' })).toBeInTheDocument();
    expect(screen.getByLabelText('Student can write')).toBeChecked();
    expect(screen.queryByLabelText('Follow mentor')).not.toBeInTheDocument();
    rerender(<Toolbar {...makeProps({ role: 'student' })} />);
    expect(screen.getByLabelText('Follow mentor')).toBeChecked();
    expect(screen.queryByRole('button', { name: 'End session' })).not.toBeInTheDocument();
  });

  it('disables drawing tools when read-only but keeps scrolling', () => {
    render(<Toolbar {...makeProps({ readOnly: true })} />);
    expect(screen.getByRole('button', { name: 'pen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'pan' })).toBeEnabled();
  });
});
