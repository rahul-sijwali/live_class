import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { asSheetId, newId } from '@live-class/shared';

import { question, sheet } from '../test/fixtures.js';
import { SheetTabs } from './SheetTabs.js';

describe('SheetTabs', () => {
  it('renders sheets in session order with question titles and marks the mentor position', async () => {
    const second = { ...sheet, id: asSheetId(newId()), position: 1 };
    const onSelect = vi.fn();
    render(
      <SheetTabs
        sheets={[sheet, second]}
        order={[second.id, sheet.id]}
        questions={new Map([[question.id, question]])}
        currentSheetId={sheet.id}
        viewingSheetId={second.id}
        onSelect={onSelect}
      />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('title', 'Mentor is here');
    expect(tabs[0]).toHaveTextContent('Quadratics');
    await userEvent.click(tabs[1]!);
    expect(onSelect).toHaveBeenCalledWith(sheet.id);
  });

  it('explains when nothing is open yet', () => {
    render(
      <SheetTabs
        sheets={[]}
        order={[]}
        questions={new Map()}
        currentSheetId={null}
        viewingSheetId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/No question has been opened yet/)).toBeInTheDocument();
  });
});
