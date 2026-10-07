'use client';
/**
 * Admin question bank: search, upload (file or Markdown), edit metadata, delete.
 */

import { useState } from 'react';

import { type AppError, type Question, type QuestionId } from '@live-class/shared';

import { useLiveClass } from '../context.js';
import { field, fileField, type FormSubmit, tagField } from '../forms.js';
import { useAsync } from '../hooks/useAsync.js';

/** Selection hook and read-only switch for embedding the bank in other screens. */
export interface QuestionBankProps {
  /** Optional selection callback (used by `SessionSetup` to pick questions). */
  readonly onSelect?: (question: Question) => void;
  /** Hide creation and editing controls (read-only picker). */
  readonly readOnly?: boolean;
}

/**
 * Searchable list of every question in the bank with, for admins, forms to add new
 * questions (file upload or typed Markdown), edit metadata and delete.
 *
 * @param {QuestionBankProps} props - Selection callback and read-only mode.
 * @returns {JSX.Element} The bank screen.
 */
export function QuestionBank(props: QuestionBankProps): React.JSX.Element {
  const { api, user, reportError } = useLiveClass();
  const [search, setSearch] = useState('');
  const [tags, setTags] = useState('');
  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [editing, setEditing] = useState<Question | null>(null);
  const canManage = user.role === 'admin' && !props.readOnly;
  const canCreate = (user.role === 'admin' || user.role === 'mentor') && !props.readOnly;
  const tagList = tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const list = useAsync(
    () =>
      api.call('listQuestions', { query: { q: search || undefined, tags: tagList, limit: 50 } }),
    `questions|${search}|${tagList.join(',')}`,
  );

  /**
   * Creates a question from the form.
   *
   * @param {FormSubmit} event - Form submission.
   * @returns {Promise<void>} Resolves when done.
   */
  const create = async (event: FormSubmit): Promise<void> => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = field(data, 'title');
    const altText = field(data, 'altText');
    const newTags = tagField(data, 'tags');
    setBusy(true);
    setError(null);
    try {
      if (mode === 'text') {
        const textMarkdown = field(data, 'textMarkdown');
        await api.call('createQuestion', {
          body: { kind: 'text', title, altText, tags: newTags, textMarkdown },
        });
      } else {
        const file = fileField(data, 'file');
        if (!file) throw new Error('Choose a file to upload');
        const asset = await api.uploadAsset(file);
        const kind =
          asset.mime === 'application/pdf' ? 'pdf' : asset.mime === 'image/gif' ? 'gif' : 'image';
        await api.call('createQuestion', {
          body: { kind, title, altText, tags: newTags, assetId: asset.id },
        });
      }
      form.reset();
      list.reload();
    } catch (caught) {
      setError(reportError(caught));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Saves metadata edits.
   *
   * @param {FormSubmit} event - Form submission.
   * @returns {Promise<void>} Resolves when done.
   */
  const saveEdit = async (event: FormSubmit): Promise<void> => {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.call('updateQuestion', {
        params: { id: editing.id },
        body: {
          title: field(data, 'title'),
          altText: field(data, 'altText'),
          tags: tagField(data, 'tags'),
        },
      });
      setEditing(null);
      list.reload();
    } catch (caught) {
      setError(reportError(caught));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Soft-deletes a question after confirmation.
   *
   * @param {QuestionId} id - Question to delete.
   * @returns {Promise<void>} Resolves when done.
   */
  const remove = async (id: QuestionId): Promise<void> => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this question from the bank?'))
      return;
    setBusy(true);
    try {
      await api.call('deleteQuestion', { params: { id } });
      list.reload();
    } catch (caught) {
      setError(reportError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lc-bank" data-testid="lc-question-bank">
      {error ? (
        <p className="lc-notice lc-notice-error" role="alert">
          {error.message}
        </p>
      ) : null}

      <div className="lc-bank-filters">
        <input
          type="search"
          className="lc-input"
          placeholder="Search title or description"
          aria-label="Search questions"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        <input
          type="text"
          className="lc-input"
          placeholder="Tags (comma separated)"
          aria-label="Filter by tags"
          value={tags}
          onChange={(event) => {
            setTags(event.target.value);
          }}
        />
      </div>

      {list.loading ? <p className="lc-muted">Loading…</p> : null}
      {list.error ? (
        <p className="lc-notice lc-notice-error" role="alert">
          {list.error.message}
        </p>
      ) : null}
      <ul className="lc-list" aria-label="Questions">
        {(list.data?.items ?? []).map((question) => (
          <li key={question.id} className="lc-list-item lc-bank-item">
            {question.asset?.thumbnailUrl ? (
              <img
                className="lc-thumb"
                src={api.assetThumbnailUrl(question.asset.id)}
                alt=""
                width={64}
                height={40}
                loading="lazy"
              />
            ) : (
              <span className="lc-thumb lc-thumb-placeholder" aria-hidden="true">
                {question.kind}
              </span>
            )}
            <div className="lc-bank-meta">
              <strong>{question.title}</strong>
              <span className="lc-muted">
                {question.kind}
                {question.pageCount > 1 ? ` · ${question.pageCount} pages` : ''}
                {question.tags.length > 0 ? ` · ${question.tags.join(', ')}` : ''}
              </span>
            </div>
            <div className="lc-bank-actions">
              {props.onSelect ? (
                <button
                  type="button"
                  className="lc-button"
                  onClick={() => props.onSelect?.(question)}
                >
                  Select
                </button>
              ) : null}
              {canManage ? (
                <>
                  <button
                    type="button"
                    className="lc-button"
                    onClick={() => {
                      setEditing(question);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="lc-button lc-button-danger"
                    disabled={busy}
                    onClick={() => void remove(question.id)}
                  >
                    Delete
                  </button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {editing ? (
        <form
          className="lc-form lc-card"
          onSubmit={(event) => void saveEdit(event)}
          aria-label="Edit question"
        >
          <h3 className="lc-heading">Edit “{editing.title}”</h3>
          <label className="lc-field">
            Title
            <input
              type="text"
              name="title"
              className="lc-input"
              defaultValue={editing.title}
              required
              maxLength={200}
            />
          </label>
          <label className="lc-field">
            Description for screen readers
            <input
              type="text"
              name="altText"
              className="lc-input"
              defaultValue={editing.altText}
              required
              maxLength={1000}
            />
          </label>
          <label className="lc-field">
            Tags (comma separated)
            <input
              type="text"
              name="tags"
              className="lc-input"
              defaultValue={editing.tags.join(', ')}
            />
          </label>
          <div className="lc-form-actions">
            <button type="submit" className="lc-button lc-button-primary" disabled={busy}>
              Save
            </button>
            <button
              type="button"
              className="lc-button"
              onClick={() => {
                setEditing(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {canCreate ? (
        <form
          className="lc-form lc-card"
          onSubmit={(event) => void create(event)}
          aria-label="Add a question"
        >
          <h3 className="lc-heading">Add a question</h3>
          <div className="lc-segment" role="radiogroup" aria-label="Question type">
            <label className="lc-toggle">
              <input
                type="radio"
                name="mode"
                checked={mode === 'file'}
                onChange={() => {
                  setMode('file');
                }}
              />
              Upload a file (PNG, JPG, GIF, PDF)
            </label>
            <label className="lc-toggle">
              <input
                type="radio"
                name="mode"
                checked={mode === 'text'}
                onChange={() => {
                  setMode('text');
                }}
              />
              Type text with maths
            </label>
          </div>
          {mode === 'file' ? (
            <label className="lc-field">
              File
              <input
                type="file"
                name="file"
                accept="image/png,image/jpeg,image/gif,application/pdf"
                required
              />
            </label>
          ) : (
            <label className="lc-field">
              Markdown (use $…$ for maths)
              <textarea name="textMarkdown" className="lc-input lc-textarea" rows={6} required />
            </label>
          )}
          <label className="lc-field">
            Title
            <input type="text" name="title" className="lc-input" required maxLength={200} />
          </label>
          <label className="lc-field">
            Description for screen readers
            <input type="text" name="altText" className="lc-input" required maxLength={1000} />
          </label>
          <label className="lc-field">
            Tags (comma separated)
            <input type="text" name="tags" className="lc-input" placeholder="algebra, grade 8" />
          </label>
          <button type="submit" className="lc-button lc-button-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Add to bank'}
          </button>
        </form>
      ) : null}
    </div>
  );
}
