'use client';
/**
 * Catches render errors inside the Live Class tree so a broken sheet never takes the host
 * page down (CLAUDE.md §11).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { type AppError } from '@live-class/shared';

/** What the boundary needs: a reporter and the subtree to protect. */
export interface ErrorBoundaryProps {
  /** Reports the error to the host. */
  readonly onError: (error: unknown) => AppError;
  readonly children: ReactNode;
}

/** The caught error, if any. */
interface ErrorBoundaryState {
  readonly error: AppError | null;
}

/**
 * React error boundary with a retry button.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  /**
   * Converts a render error into state.
   *
   * @param {unknown} _error - The thrown value (handled in `componentDidCatch`).
   * @returns {Partial<ErrorBoundaryState>} State marking that an error occurred.
   */
  static getDerivedStateFromError(_error: unknown): Partial<ErrorBoundaryState> {
    return {};
  }

  /**
   * Reports the error and stores the normalised version for display.
   *
   * @param {unknown} error - The thrown value.
   * @param {ErrorInfo} _info - Component stack (not shown to users).
   * @returns {void} Nothing.
   */
  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.setState({ error: this.props.onError(error) });
  }

  /**
   * Renders children, or a notice with a retry button after an error.
   *
   * @returns {ReactNode} The tree.
   */
  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="lc-notice lc-notice-error" role="alert">
        <p>Something went wrong in the class view ({error.code}).</p>
        <button
          type="button"
          className="lc-button"
          onClick={() => {
            this.setState({ error: null });
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
