import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FakeRealtime, FakeRealtimeHub } from '@live-class/core/testing';
import { SessionDoc } from '@live-class/core';
import { docName } from '@live-class/shared';

import {
  fakeApi,
  mentor,
  question,
  session,
  sheet,
  student,
  TestProvider,
} from '../test/fixtures.js';
import { LiveClassRoom } from './LiveClassRoom.js';

describe('LiveClassRoom', () => {
  it('shows the mentor the toolbar, the sheet and the question picker', async () => {
    const { api } = fakeApi({
      me: mentor,
      session,
      sheets: [sheet],
      questions: [question],
      attached: [],
    });
    const hub = new FakeRealtimeHub();
    new SessionDoc(hub.doc(docName('session', session.id))).appendSheets([sheet.id], true);
    render(
      <TestProvider api={api} realtime={new FakeRealtime(hub)}>
        <LiveClassRoom sessionId={session.id} />
      </TestProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Monday algebra' })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: /Quadratics/ })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Drawing tools' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Open a question' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('lc-sheet-stage').querySelectorAll('canvas')).toHaveLength(2);
    });
    expect(screen.getByText(/Mentor Asha \(mentor, you\)/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Live');
  });

  it('gives the student follow mode and no picker, and waits when nothing is open', async () => {
    const { api } = fakeApi({
      me: student,
      session,
      sheets: [],
      questions: [question],
      attached: [],
    });
    render(
      <TestProvider api={api}>
        <LiveClassRoom sessionId={session.id} />
      </TestProvider>,
    );
    expect(await screen.findByText(/Waiting for the mentor/)).toBeInTheDocument();
    expect(screen.getByLabelText('Follow mentor')).toBeChecked();
    expect(
      screen.queryByRole('complementary', { name: 'Open a question' }),
    ).not.toBeInTheDocument();
  });

  it('shows peers from presence', async () => {
    const hub = new FakeRealtimeHub();
    const mentorApi = fakeApi({
      me: mentor,
      session,
      sheets: [sheet],
      questions: [question],
      attached: [],
    });
    const studentApi = fakeApi({
      me: student,
      session,
      sheets: [sheet],
      questions: [question],
      attached: [],
    });
    render(
      <>
        <TestProvider api={mentorApi.api} realtime={new FakeRealtime(hub)}>
          <LiveClassRoom sessionId={session.id} />
        </TestProvider>
        <TestProvider api={studentApi.api} realtime={new FakeRealtime(hub)}>
          <LiveClassRoom sessionId={session.id} />
        </TestProvider>
      </>,
    );
    expect(await screen.findAllByRole('heading', { name: 'Monday algebra' })).toHaveLength(2);
    // Each room lists the other participant through awareness on the shared document.
    expect(await screen.findByText(/Student Ben \(student\)$/)).toBeInTheDocument();
    expect(await screen.findByText(/Mentor Asha \(mentor\)$/)).toBeInTheDocument();
  });

  it('reports a session that cannot be loaded', async () => {
    const { api } = fakeApi({ me: mentor, session, sheets: [], questions: [], attached: [] });
    render(
      <TestProvider api={api}>
        <LiveClassRoom sessionId={'0192f1e0-0000-7000-8000-000000000000' as typeof session.id} />
      </TestProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/NOT_FOUND/);
  });
});
