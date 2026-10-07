'use client';
/**
 * Mentor's in-session panel: open a pre-assigned question, search the bank, or upload a
 * file right now (ad hoc).
 */

import { useState } from 'react';

import {
  type AppError,
  type Question,
  type QuestionId,
  type SessionId,
  type SessionQuestion,
} from '@live-class/shared';

import { useLiveClass } from '../context.js';
import { field, fileField, type FormSubmit } from '../forms.js';
import { useAsync } from '../hooks/useAsync.js';

/** Session context for the picker and what to do after a question opens. */
export interface QuestionPickerProps {
  readonly sessionId: SessionId;
  /** Questions already attached to the session (opened or pre-assigned). */
  readonly attached: readonly SessionQuestion[];
  /** Called after a question was opened so the room refreshes its sheets. */
  readonly onOpened: () => void;
}

/**
 * Side panel the mentor uses to put a question in front of the student: planned
 * questions first, then a bank search, then an upload form for something new.
 *
 * @param {QuestionPickerProps} props - Session, attached questions and callbacks.
 * @returns {JSX.Element} The panel.
 */
export function QuestionPicker(props: QuestionPickerProps): React.JSX.Element {
  const { api, reportError } = useLiveClass();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const bank = useAsync(
    () => api.call('listQuestions', { query: { q: search || undefined, limit: 10 } }),
    `bank|${search}`,
  );
  const pendingIds = props.attached.filter((q) => q.openedAt === null).map((q) => q.questionId);
  const preassigned = useAsync(
    () =>
      Promise.all(
        pendingIds.map((questionId) =>
          api.call('getSessionQuestion', { params: { id: props.sessionId, questionId } }),
        ),
      ),
    `planned|${props.sessionId}|${pendingIds.join(',')}`,
  );

  /**
   * Opens a question in the session.
   *
   * @param {QuestionId} questionId - Question to open.
   * @param {'live' | 'adhoc'} source - How it was chosen.
   * @returns {Promise<void>} Resolves when done.
   */
  const open = async (questionId: QuestionId, source: 'live' | 'adhoc'): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.call('openQuestion', {
        params: { id: props.sessionId, questionId },
        body: { source },
      });
      props.onOpened();
    } catch (caught) {
      setError(reportError(caught));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Uploads a file, creates a question from it and opens it.
   *
   * @param {FormSubmit} event - Form submission.
   * @returns {Promise<void>} Resolves when done.
   */
  const uploadAndOpen = async (event: FormSubmit): Promise<void> => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = fileField(data, 'file');
    const title = field(data, 'title');
    const altText = field(data, 'altText');
    if (!file || !title || !altText) {
      setError(reportError(new Error('Choose a file and fill in title and description')));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const asset = await api.uploadAsset(file);
      const kind =
        asset.mime === 'application/pdf' ? 'pdf' : asset.mime === 'image/gif' ? 'gif' : 'image';
      const question: Question = await api.call('createQuestion', {
        body: { kind, title, altText, tags: ['adhoc'], assetId: asset.id },
      });
      form.reset();
      await open(question.id, 'adhoc');
    } catch (caught) {
      setError(reportError(caught));
    } finally {
      setBusy(false);
    }
  };

  const openedIds = new Set(
    props.attached.filter((q) => q.openedAt !== null).map((q) => q.questionId),
  );

  return (
    <aside className="lc-picker" aria-label="Open a question">
      {error ? (
        <p className="lc-notice lc-notice-error" role="alert">
          {error.message}
        </p>
      ) : null}

      <section>
        <h3 className="lc-heading">Planned for this class</h3>
        {preassigned.data && preassigned.data.length > 0 ? (
          <ul className="lc-list">
            {preassigned.data.map((question) => (
              <li key={question.id} className="lc-list-item">
                <span>{question.title}</span>
                <button
                  type="button"
                  className="lc-button"
                  disabled={busy}
                  onClick={() => void open(question.id, 'live')}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="lc-muted">Nothing left to open.</p>
        )}
      </section>

      <section>
        <h3 className="lc-heading">From the bank</h3>
        <input
          type="search"
          className="lc-input"
          placeholder="Search questions"
          aria-label="Search questions"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        {bank.loading ? <p className="lc-muted">Searching…</p> : null}
        <ul className="lc-list">
          {(bank.data?.items ?? []).map((question) => (
            <li key={question.id} className="lc-list-item">
              <span>
                {question.title} <span className="lc-muted">({question.kind})</span>
              </span>
              <button
                type="button"
                className="lc-button"
                disabled={busy || openedIds.has(question.id)}
                onClick={() => void open(question.id, 'live')}
              >
                {openedIds.has(question.id) ? 'Opened' : 'Open'}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="lc-heading">Upload now</h3>
        <form className="lc-form" onSubmit={(event) => void uploadAndOpen(event)}>
          <label className="lc-field">
            File (PNG, JPG, GIF or PDF)
            <input
              type="file"
              name="file"
              accept="image/png,image/jpeg,image/gif,application/pdf"
              required
            />
          </label>
          <label className="lc-field">
            Title
            <input type="text" name="title" className="lc-input" required maxLength={200} />
          </label>
          <label className="lc-field">
            Description for screen readers
            <input type="text" name="altText" className="lc-input" required maxLength={1000} />
          </label>
          <button type="submit" className="lc-button lc-button-primary" disabled={busy}>
            Upload and open
          </button>
        </form>
      </section>
    </aside>
  );
}
