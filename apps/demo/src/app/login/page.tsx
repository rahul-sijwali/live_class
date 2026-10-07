'use client';
/**
 * Development login against the server's seeded accounts. A real host never shows this:
 * it already knows who the user is and mints a token on its backend.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { LiveClassApi, type FormSubmit, field } from '@live-class/react';

import { clearToken, writeToken } from '../../lib/auth';
import { API_BASE_URL } from '../../lib/config';

/**
 * Login form.
 *
 * @returns {JSX.Element} The form.
 */
export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Submits the credentials and stores the token.
   *
   * @param {FormSubmit} event - Form submission.
   * @returns {Promise<void>} Resolves after navigation.
   */
  const submit = async (event: FormSubmit): Promise<void> => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const api = new LiveClassApi({ baseUrl: API_BASE_URL, getToken: () => null });
      const result = await api.call('localLogin', {
        body: { email: field(data, 'email'), password: field(data, 'password') },
      });
      clearToken();
      writeToken(result.token);
      router.push(result.user.role === 'admin' ? '/admin/' : '/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="demo-card" onSubmit={(event) => void submit(event)}>
      <h1>Sign in</h1>
      <p className="demo-muted" style={{ padding: 0 }}>
        Seeded accounts: admin@local.test, mentor@local.test, student@local.test.
      </p>
      <label className="demo-field">
        Email
        <input
          type="email"
          name="email"
          required
          autoComplete="username"
          defaultValue="mentor@local.test"
        />
      </label>
      <label className="demo-field">
        Password
        <input type="password" name="password" required autoComplete="current-password" />
      </label>
      {error ? (
        <p className="demo-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="demo-button" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
