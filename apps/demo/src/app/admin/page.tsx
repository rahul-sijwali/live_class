'use client';
/**
 * Admin page: question bank and session setup.
 */

import { QuestionBank, SessionSetup } from '@live-class/react';

import { AppProvider } from '../../components/AppProvider';

/**
 * Admin screens inside the provider.
 *
 * @returns {JSX.Element} Session setup above the question bank.
 */
export default function AdminPage(): React.JSX.Element {
  return (
    <AppProvider>
      <div className="demo-page">
        <h1>Sessions</h1>
        <SessionSetup roomHref={(sessionId) => `/room/?session=${encodeURIComponent(sessionId)}`} />
        <h1>Question bank</h1>
        <QuestionBank />
      </div>
    </AppProvider>
  );
}
