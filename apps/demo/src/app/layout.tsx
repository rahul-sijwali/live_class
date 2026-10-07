import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@live-class/react/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Live Class demo',
  description: 'Shared maths worksheet for one mentor and one student.',
};

/**
 * Root layout with the demo navigation.
 *
 * @param {{ children: ReactNode }} props - Page content.
 * @returns {JSX.Element} HTML shell.
 */
export default function RootLayout(props: { children: ReactNode }): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        <nav className="demo-nav" aria-label="Demo navigation">
          <a href="/">Live Class demo</a>
          <a href="/admin/">Admin</a>
          <a href="/login/">Sign in</a>
        </nav>
        <main className="demo-main">{props.children}</main>
      </body>
    </html>
  );
}
