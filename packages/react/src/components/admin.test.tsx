import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  admin,
  fakeApi,
  mentor,
  question,
  session,
  sessionId,
  TestProvider,
} from '../test/fixtures.js';
import { PresenceBar } from './PresenceBar.js';
import { QuestionBank } from './QuestionBank.js';
import { QuestionPicker } from './QuestionPicker.js';
import { SessionSetup } from './SessionSetup.js';

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('QuestionBank', () => {
  it('lists questions and lets an admin add a text question, edit and delete', async () => {
    const records = { me: admin, session, sheets: [], questions: [question], attached: [] };
    const { api, calls } = fakeApi(records);
    render(
      <TestProvider api={api}>
        <QuestionBank />
      </TestProvider>,
    );
    expect(await screen.findByText('Quadratics')).toBeInTheDocument();

    const form = screen.getByRole('form', { name: 'Add a question' });
    await userEvent.click(within(form).getByLabelText('Type text with maths'));
    await userEvent.type(within(form).getByLabelText(/Markdown/), 'What is $1+1$?');
    await userEvent.type(within(form).getByLabelText('Title'), 'Addition');
    await userEvent.type(
      within(form).getByLabelText('Description for screen readers'),
      'One plus one',
    );
    await userEvent.type(within(form).getByLabelText(/Tags/), 'arithmetic, easy');
    await userEvent.click(within(form).getByRole('button', { name: 'Add to bank' }));
    expect(await screen.findByText('Addition')).toBeInTheDocument();
    const create = calls.find((c) => c.method === 'POST' && c.path === '/questions');
    expect(create?.body).toMatchObject({
      kind: 'text',
      title: 'Addition',
      tags: ['arithmetic', 'easy'],
    });

    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    const edit = screen.getByRole('form', { name: 'Edit question' });
    const title = within(edit).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Quadratics (renamed)');
    await userEvent.click(within(edit).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Quadratics (renamed)')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(true);

    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    });
  });

  it('hides management controls from mentors and offers selection when asked', async () => {
    const onSelect = vi.fn();
    const { api } = fakeApi({
      me: mentor,
      session,
      sheets: [],
      questions: [question],
      attached: [],
    });
    render(
      <TestProvider api={api}>
        <QuestionBank onSelect={onSelect} readOnly />
      </TestProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: question.id }));
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Add a question' })).not.toBeInTheDocument();
  });
});

describe('QuestionPicker', () => {
  it('opens planned questions and bank questions', async () => {
    const attached = [
      { questionId: question.id, position: 0, source: 'preassigned' as const, openedAt: null },
    ];
    const { api, calls } = fakeApi({
      me: mentor,
      session,
      sheets: [],
      questions: [question],
      attached,
    });
    const onOpened = vi.fn();
    render(
      <TestProvider api={api}>
        <QuestionPicker sessionId={sessionId} attached={attached} onOpened={onOpened} />
      </TestProvider>,
    );
    const planned = await screen.findByRole('heading', { name: 'Planned for this class' });
    const plannedSection = planned.parentElement!;
    await userEvent.click(await within(plannedSection).findByRole('button', { name: 'Open' }));
    await waitFor(() => {
      expect(onOpened).toHaveBeenCalled();
    });
    expect(calls.some((c) => c.path.endsWith(`/questions/${question.id}/open`))).toBe(true);

    await userEvent.type(screen.getByLabelText('Search questions'), 'quad');
    await waitFor(() => {
      expect(calls.some((c) => c.path === '/questions' && c.method === 'GET')).toBe(true);
    });
  });

  it('refuses an upload without a file', async () => {
    const { api } = fakeApi({ me: mentor, session, sheets: [], questions: [], attached: [] });
    const onError = vi.fn();
    render(
      <TestProvider api={api} onError={onError}>
        <QuestionPicker sessionId={sessionId} attached={[]} onOpened={vi.fn()} />
      </TestProvider>,
    );
    const form = (await screen.findByRole('heading', { name: 'Upload now' })).parentElement!;
    const fileInput = within(form).getByLabelText(/File/) as HTMLInputElement;
    fileInput.removeAttribute('required');
    await userEvent.type(within(form).getByLabelText('Title'), 'x');
    await userEvent.type(within(form).getByLabelText('Description for screen readers'), 'y');
    await userEvent.click(within(form).getByRole('button', { name: 'Upload and open' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Choose a file/);
  });
});

describe('SessionSetup', () => {
  it('creates a session, adds participants and assigns a question', async () => {
    const { api, calls } = fakeApi({
      me: admin,
      session,
      sheets: [],
      questions: [question],
      attached: [],
      sessions: [],
    });
    const roomHref = (id: string): string => `/room?session=${id}`;
    render(
      <TestProvider api={api}>
        <SessionSetup roomHref={roomHref} />
      </TestProvider>,
    );
    await userEvent.type(await screen.findByLabelText('Session title'), 'Friday revision');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('heading', { name: 'Friday revision' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open room' })).toHaveAttribute(
      'href',
      expect.stringContaining('/room?session='),
    );

    fireEvent.change(screen.getByLabelText('Add mentor'), { target: { value: mentor.id } });
    expect(await screen.findByText(/Mentor Asha \(mentor\)/)).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/participants'))).toBe(true);

    await userEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await waitFor(() => {
      expect(
        calls.some((c) => c.method === 'POST' && c.path.endsWith('/questions') && c.body !== null),
      ).toBe(true);
    });
    expect(await screen.findByText(/Planned questions: 1/)).toBeInTheDocument();
  });
});

describe('PresenceBar', () => {
  it('writes out roles and the connection state', () => {
    render(
      <PresenceBar
        me={mentor}
        myRole="mentor"
        connection="disconnected"
        peers={[
          {
            clientId: 7,
            state: {
              user: { id: 'u', name: 'Ben', role: 'student', color: '#111827' },
              viewingSheetId: null,
              followMentor: true,
              pen: null,
            },
          },
        ]}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
    expect(screen.getByText(/Mentor Asha \(mentor, you\)/)).toBeInTheDocument();
    expect(screen.getByText(/Ben \(student\)/)).toBeInTheDocument();
  });
});
