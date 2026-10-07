'use client';
/**
 * `LiveClassProvider`: the one place the host hands us its configuration.
 *
 * Owns: constructing the API client and realtime client once, resolving the current user,
 * and exposing them through context. Receives everything from props (CLAUDE.md §4 host
 * contract): no cookies, no globals, no router.
 */

import { createContext, type ReactNode, use, useEffect, useMemo, useState } from 'react';

import { LiveClassApi, type RealtimeConnection, RealtimeClient } from '@live-class/core';
import { type AppError, type Me } from '@live-class/shared';

import { ErrorBoundary } from './components/ErrorBoundary.js';
import { useAsync } from './hooks/useAsync.js';
import { HostBridge, type TokenSource } from './host-bridge.js';

export type { TokenSource } from './host-bridge.js';

/** A realtime client as the components need it; tests inject an in-memory one. */
export interface RealtimeLike extends RealtimeConnection {
  /**
   * Closes every document and the socket.
   *
   * @returns {void} Nothing.
   */
  dispose(): void;
}

/** Host configuration: where the server is, how to authenticate, and error reporting. */
export interface LiveClassProviderProps {
  /** Base URL of the Live Class server, for example `https://api.example.com`. */
  readonly apiBaseUrl: string;
  /** WebSocket URL of the realtime endpoint, for example `wss://api.example.com/realtime`. */
  readonly realtimeUrl: string;
  /** Token minted by the host backend, or a function returning a fresh one. */
  readonly token: TokenSource;
  /** Called for every error the components surface; the host decides how to report it. */
  readonly onError?: (error: AppError) => void;
  /** Children rendered once the current user is known. */
  readonly children: ReactNode;
  /** Shown while the user is being resolved. */
  readonly fallback?: ReactNode;
  /** Test seam: a pre-built API client. */
  readonly api?: LiveClassApi;
  /** Test seam: a pre-built realtime client (not disposed by the provider). */
  readonly realtime?: RealtimeLike;
}

/** What components read from context. */
export interface LiveClassContextValue {
  readonly api: LiveClassApi;
  readonly realtime: RealtimeLike;
  readonly user: Me;
  readonly getToken: () => Promise<string>;
  /**
   * Reports an error to the host and returns it normalised for display.
   *
   * @param {unknown} error - Anything thrown.
   * @returns {AppError} The normalised error.
   */
  readonly reportError: (error: unknown) => AppError;
}

const LiveClassContext = createContext<LiveClassContextValue | null>(null);

/**
 * Supplies the API client, realtime client and signed-in user to every Live Class
 * component below it, and shows a fallback until the server has identified the user.
 *
 * @param {LiveClassProviderProps} props - Host configuration and children.
 * @returns {JSX.Element} The provider tree, the fallback while loading, or an error notice.
 */
export function LiveClassProvider(props: LiveClassProviderProps): React.JSX.Element {
  const { apiBaseUrl, realtimeUrl, token, onError, children, fallback } = props;

  const [bridge] = useState(() => new HostBridge(token, onError));
  useEffect(() => {
    bridge.update(token, onError);
  });

  const api = useMemo(
    () => props.api ?? new LiveClassApi({ baseUrl: apiBaseUrl, getToken: bridge.getToken }),
    [props.api, apiBaseUrl, bridge],
  );
  const realtime = useMemo<RealtimeLike>(
    () => props.realtime ?? new RealtimeClient({ url: realtimeUrl, getToken: bridge.getToken }),
    [props.realtime, realtimeUrl, bridge],
  );
  useEffect(() => {
    if (props.realtime) return undefined;
    return () => {
      realtime.dispose();
    };
  }, [realtime, props.realtime]);

  const me = useAsync(() => api.call('me', {}), apiBaseUrl);
  useEffect(() => {
    if (me.error) bridge.report(me.error);
  }, [me.error, bridge]);

  if (me.error) {
    return (
      <div className="lc-notice lc-notice-error" role="alert">
        Could not sign in to the class server ({me.error.code}): {me.error.message}
      </div>
    );
  }
  if (!me.data || me.loading) {
    return <>{fallback ?? <div className="lc-notice">Connecting…</div>}</>;
  }
  const value: LiveClassContextValue = {
    api,
    realtime,
    user: me.data,
    getToken: bridge.getToken,
    reportError: bridge.report,
  };
  return (
    <LiveClassContext value={value}>
      <ErrorBoundary onError={bridge.report}>{children}</ErrorBoundary>
    </LiveClassContext>
  );
}

/**
 * Reads the Live Class context.
 *
 * @returns {LiveClassContextValue} API client, realtime client, user and error reporter.
 * @throws {Error} If used outside `LiveClassProvider`.
 */
export function useLiveClass(): LiveClassContextValue {
  const value = use(LiveClassContext);
  if (!value) throw new Error('useLiveClass must be used inside <LiveClassProvider>');
  return value;
}
