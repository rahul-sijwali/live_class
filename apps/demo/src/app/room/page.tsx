'use client';
/**
 * The class room. The session id comes from `?session=` because a static export cannot
 * pre-render unknown dynamic routes (live_class.md D-016).
 */

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { LiveClassRoom } from '@live-class/react';
import { asSessionId } from '@live-class/shared';

import { AppProvider } from '../../components/AppProvider';

/**
 * Reads the session id from the query string and renders the room.
 *
 * @returns {JSX.Element} The room or a notice.
 */
function RoomFromQuery(): React.JSX.Element {
  const params = useSearchParams();
  const raw = params.get('session');
  let sessionId: ReturnType<typeof asSessionId> | null = null;
  try {
    sessionId = raw ? asSessionId(raw) : null;
  } catch {
    sessionId = null;
  }
  if (!sessionId) {
    return (
      <p className="demo-muted">
        Add <code>?session=&lt;id&gt;</code> to the address, or open a room from the admin page.
      </p>
    );
  }
  return (
    <AppProvider>
      <div className="demo-room">
        <LiveClassRoom sessionId={sessionId} />
      </div>
    </AppProvider>
  );
}

/**
 * Room page with the Suspense boundary `useSearchParams` needs in static exports.
 *
 * @returns {JSX.Element} The room wrapped in Suspense.
 */
export default function RoomPage(): React.JSX.Element {
  return (
    <Suspense fallback={<p className="demo-muted">Loading…</p>}>
      <RoomFromQuery />
    </Suspense>
  );
}
