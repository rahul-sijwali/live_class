'use client';
/**
 * The ordered list of sheets in a session. Shows which one the mentor is presenting and
 * which one this user is looking at.
 */

import { type Question, type QuestionId, type Sheet, type SheetId } from '@live-class/shared';

/** Sheets to list, their order, and which ones are current and viewed. */
export interface SheetTabsProps {
  readonly sheets: readonly Sheet[];
  readonly order: readonly SheetId[];
  readonly questions: ReadonlyMap<QuestionId, Question>;
  readonly currentSheetId: SheetId | null;
  readonly viewingSheetId: SheetId | null;
  readonly onSelect: (sheetId: SheetId) => void;
}

/**
 * Renders one tab per sheet, in session order.
 *
 * @param {SheetTabsProps} props - Sheets, order, and selection.
 * @returns {JSX.Element} The tab list.
 */
export function SheetTabs(props: SheetTabsProps): React.JSX.Element {
  const byId = new Map(props.sheets.map((sheet) => [sheet.id, sheet]));
  const ordered = (props.order.length > 0 ? props.order : props.sheets.map((s) => s.id))
    .map((id) => byId.get(id))
    .filter((sheet): sheet is Sheet => sheet !== undefined);
  if (ordered.length === 0) {
    return <p className="lc-muted">No question has been opened yet.</p>;
  }
  return (
    <div className="lc-tabs" role="tablist" aria-label="Sheets">
      {ordered.map((sheet, index) => {
        const question = props.questions.get(sheet.questionId);
        const label = question ? question.title : 'Loading…';
        const pageSuffix = question && question.pageCount > 1 ? ` (p. ${sheet.pageIndex + 1})` : '';
        const isViewing = sheet.id === props.viewingSheetId;
        const isCurrent = sheet.id === props.currentSheetId;
        return (
          <button
            key={sheet.id}
            type="button"
            role="tab"
            aria-selected={isViewing}
            className={`lc-tab${isViewing ? ' lc-tab-active' : ''}${isCurrent ? ' lc-tab-current' : ''}`}
            title={isCurrent ? 'Mentor is here' : undefined}
            onClick={() => {
              props.onSelect(sheet.id);
            }}
          >
            <span className="lc-tab-index">{index + 1}</span>
            <span className="lc-tab-label">
              {label}
              {pageSuffix}
            </span>
            {isCurrent ? <span className="lc-tab-badge">●</span> : null}
          </button>
        );
      })}
    </div>
  );
}
