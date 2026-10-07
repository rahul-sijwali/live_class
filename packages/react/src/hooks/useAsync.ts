'use client';
/**
 * Small async-state hook used by admin screens (load lists, submit forms).
 *
 * The loader runs whenever `key` changes or `reload()` is called. Results from an older
 * request are ignored, and previous data is kept while a newer request is in flight so
 * lists do not flicker.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { type AppError } from '@live-class/shared';

import { toAppError } from '../errors.js';

/** State of an async operation. */
export interface AsyncState<T> {
  readonly data: T | null;
  readonly error: AppError | null;
  readonly loading: boolean;
}

/** A settled result tagged with the request it answers. */
interface Settled<T> {
  readonly key: string;
  readonly version: number;
  readonly data: T | null;
  readonly error: AppError | null;
}

/**
 * Runs an async loader when `key` changes and exposes the result.
 *
 * @template T - Result type.
 * @param {() => Promise<T>} loader - Produces the data; the latest function is used.
 * @param {string} key - Describes the inputs; a change re-runs the loader.
 * @returns {AsyncState<T> & { reload: () => void }} Current state and a manual reload.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  key: string,
): AsyncState<T> & { readonly reload: () => void } {
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });
  const [version, setVersion] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loaderRef
      .current()
      .then((data) => {
        if (!cancelled) setSettled({ key, version, data, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setSettled({ key, version, data: null, error: toAppError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [key, version]);

  const reload = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  const current = settled !== null && settled.key === key && settled.version === version;
  return {
    data: current ? settled.data : (settled?.data ?? null),
    error: current ? settled.error : null,
    loading: !current,
    reload,
  };
}
