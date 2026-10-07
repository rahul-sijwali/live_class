import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LiveClassApi } from '@live-class/core';

import { useLiveClass } from './context.js';
import { fakeApi, mentor, question, session, sheet, TestProvider } from './test/fixtures.js';

/**
 * Shows the signed-in user's name.
 *
 * @returns {JSX.Element} Text.
 */
function WhoAmI(): React.JSX.Element {
  const { user } = useLiveClass();
  return <p>Hello {user.displayName}</p>;
}

describe('LiveClassProvider', () => {
  it('resolves the user and renders children', async () => {
    const { api } = fakeApi({
      me: mentor,
      session,
      sheets: [sheet],
      questions: [question],
      attached: [],
    });
    render(
      <TestProvider api={api}>
        <WhoAmI />
      </TestProvider>,
    );
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    expect(await screen.findByText('Hello Mentor Asha')).toBeInTheDocument();
  });

  it('shows an error notice and reports when the server rejects the token', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: 'UNAUTHENTICATED', message: 'bad token' }), {
          status: 401,
        }),
      ),
    ) as unknown as typeof fetch;
    const api = new LiveClassApi({ baseUrl: 'https://api.test', getToken: () => 'x', fetchImpl });
    const onError = vi.fn();
    render(
      <TestProvider api={api} onError={onError}>
        <WhoAmI />
      </TestProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/UNAUTHENTICATED/);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
  });

  it('throws when the hook is used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<WhoAmI />)).toThrow(/inside <LiveClassProvider>/);
    spy.mockRestore();
  });
});
