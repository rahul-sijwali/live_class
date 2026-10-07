'use client';
/**
 * Wraps a page in `LiveClassProvider` using the demo's stored token, redirecting to the
 * login page when there is none. This is the only demo-specific glue a host would replace.
 */

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useSyncExternalStore } from 'react';

import { configurePdf, LiveClassProvider } from '@live-class/react';

import { readToken } from '../lib/auth';
import { API_BASE_URL, REALTIME_URL } from '../lib/config';

configurePdf({ workerSrc: '/pdf.worker.min.mjs' });

/**
 * Subscribes to storage changes so a sign-out elsewhere is noticed.
 *
 * @param {() => void} onChange - Called when storage changes.
 * @returns {() => void} Unsubscribe function.
 */
function subscribeToStorage(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
  };
}

/**
 * Provides the Live Class context for signed-in demo users.
 *
 * @param {{ children: ReactNode }} props - Page content.
 * @returns {JSX.Element} The provider, or a short notice while redirecting to login.
 */
export function AppProvider(props: { children: ReactNode }): React.JSX.Element {
  const router = useRouter();
  // `undefined` while hydrating (server snapshot), then the stored token or null.
  const token = useSyncExternalStore<string | null | undefined>(
    subscribeToStorage,
    () => readToken(),
    () => undefined,
  );

  useEffect(() => {
    if (token === null) router.replace('/login/');
  }, [token, router]);

  if (!token) return <p className="demo-muted">Checking sign-in…</p>;
  return (
    <LiveClassProvider
      apiBaseUrl={API_BASE_URL}
      realtimeUrl={REALTIME_URL}
      token={token}
      onError={(error) => {
        console.error('[live-class]', error.code, error.message);
      }}
    >
      {props.children}
    </LiveClassProvider>
  );
}
