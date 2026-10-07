'use client';
/**
 * Admin session setup: create a session, add the mentor and student, pre-assign questions,
 * and jump into the room.
 */

import { useState } from 'react';

import {
  type AppError,
  type Question,
  type Session,
  type SessionId,
  type SessionQuestion,
  type User,
} from '@live-class/shared';

import { useLiveClass } from '../context.js';
import { field, type FormSubmit } from '../forms.js';
import { useAsync } from '../hooks/useAsync.js';
import { QuestionBank } from './QuestionBank.js';

/** How to link from a session to its room page in the host app. */
export interface SessionSetupProps {
  /** Builds the link to a session's room in the host app. */
  readonly roomHref?: (sessionId: SessionId) => string;
}

/**
 * Admin screen listing sessions with forms to create one, add its mentor and student, and
 * pre-assign questions from the bank.
 *
 * @param {SessionSetupProps} props - Link builder for the room page.
 * @returns {JSX.Element} The screen.
 */
export function SessionSetup(props: SessionSetupProps): React.JSX.Element {
  const { api, reportError } = useLiveClass();
  const [selectedId, setSelectedId] = useState<SessionId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const sessions = useAsync(() => api.call('listSessions', {}), 'sessions');
  const users = useAsync(() => api.call('listUsers', { query: {} }), 'users');
  const selected = sessions.data?.find((session) => session.id === selectedId) ?? null;
  const attached = useAsync(
    () =>
      selectedId
        ? api.call('listSessionQuestions', { params: { id: selectedId } })
        : Promise.resolve([] as SessionQuestion[]),
    `attached|${selectedId ?? ''}`,
  );

  /**
   * Runs an admin action with busy/error handling.
   *
   * @param {() => Promise<void>} action - The work.
   * @returns {Promise<void>} Resolves when done.
   */
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(reportError(caught));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Creates a session from the form.
   *
   * @param {FormSubmit} event - Form submission.
   * @returns {Promise<void>} Resolves when done.
   */
  const createSession = async (event: FormSubmit): Promise<void> => {
    event.preventDefault();
    const form = event.currentTarget;
    const title = field(new FormData(form), 'title');
    await run(async () => {
      const session = await api.call('createSession', { body: { title } });
      form.reset();
      sessions.reload();
      setSelectedId(session.id);
    });
  };

  /**
   * Adds a participant to the selected session.
   *
   * @param {User} user - User to add.
   * @returns {Promise<void>} Resolves when done.
   */
  const addParticipant = (user: User): Promise<void> =>
    run(async () => {
      if (!selected || user.role === 'admin') return;
      await api.call('addParticipant', {
        params: { id: selected.id },
        body: { userId: user.id, role: user.role },
      });
      sessions.reload();
    });

  /**
   * Pre-assigns a question to the selected session.
   *
   * @param {Question} question - Question to assign.
   * @returns {Promise<void>} Resolves when done.
   */
  const assign = (question: Question): Promise<void> =>
    run(async () => {
      if (!selected) return;
      await api.call('assignQuestions', {
        params: { id: selected.id },
        body: { questionIds: [question.id] },
      });
      attached.reload();
    });

  return (
    <div className="lc-setup" data-testid="lc-session-setup">
      {error ? (
        <p className="lc-notice lc-notice-error" role="alert">
          {error.message}
        </p>
      ) : null}

      <section className="lc-card">
        <h3 className="lc-heading">Sessions</h3>
        <form className="lc-form lc-inline" onSubmit={(event) => void createSession(event)}>
          <input
            type="text"
            name="title"
            className="lc-input"
            placeholder="New session title"
            aria-label="Session title"
            required
            maxLength={200}
          />
          <button type="submit" className="lc-button lc-button-primary" disabled={busy}>
            Create
          </button>
        </form>
        <ul className="lc-list" aria-label="Sessions">
          {(sessions.data ?? []).map((session: Session) => (
            <li
              key={session.id}
              className={`lc-list-item${session.id === selectedId ? ' lc-list-item-active' : ''}`}
            >
              <button
                type="button"
                className="lc-link"
                onClick={() => {
                  setSelectedId(session.id);
                }}
              >
                {session.title} <span className="lc-muted">({session.status})</span>
              </button>
              {props.roomHref ? (
                <a className="lc-button" href={props.roomHref(session.id)}>
                  Open room
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {selected ? (
        <section className="lc-card">
          <h3 className="lc-heading">{selected.title}</h3>
          <p>
            Participants:{' '}
            {selected.participants.length === 0
              ? 'none yet'
              : selected.participants.map((p) => `${p.displayName} (${p.role})`).join(', ')}
          </p>
          <div className="lc-inline">
            {(['mentor', 'student'] as const).map((role) =>
              selected.participants.some((p) => p.role === role) ? null : (
                <label key={role} className="lc-field">
                  Add {role}
                  <select
                    className="lc-input"
                    defaultValue=""
                    disabled={busy}
                    onChange={(event) => {
                      const user = users.data?.find((u) => u.id === event.target.value);
                      if (user) void addParticipant(user);
                    }}
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    {(users.data ?? [])
                      .filter((u) => u.role === role)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName}
                        </option>
                      ))}
                  </select>
                </label>
              ),
            )}
          </div>
          <p>Planned questions: {attached.data?.length ?? 0}. Pick more from the bank below.</p>
          <QuestionBank readOnly onSelect={(question) => void assign(question)} />
        </section>
      ) : null}
    </div>
  );
}
