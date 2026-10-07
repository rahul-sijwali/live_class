'use client';
/**
 * Who is in the room and whether the connection is healthy. Colour is never the only
 * signal: the role is written out (CLAUDE.md §10).
 */

import { type PeerState } from '@live-class/core';
import { type ConnectionStatus, type Me, type ParticipantRole } from '@live-class/shared';

/** Who is here and how the connection is doing. */
export interface PresenceBarProps {
  readonly me: Me;
  readonly myRole: ParticipantRole | null;
  readonly peers: readonly PeerState[];
  readonly connection: ConnectionStatus;
}

/** Human text per connection status. */
const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Live',
  disconnected: 'Reconnecting…',
  unauthorized: 'Not allowed in this session',
  readonly: 'View only',
};

/**
 * Lists the people in the room (with their roles) next to a connection badge.
 *
 * @param {PresenceBarProps} props - Current user, peers and connection status.
 * @returns {JSX.Element} A status badge followed by the participant list.
 */
export function PresenceBar(props: PresenceBarProps): React.JSX.Element {
  return (
    <div className="lc-presence" aria-live="polite">
      <span className={`lc-status lc-status-${props.connection}`} role="status">
        {STATUS_TEXT[props.connection]}
      </span>
      <ul className="lc-presence-list" aria-label="People in this class">
        <li className="lc-presence-item">
          <span className="lc-presence-dot" aria-hidden="true" />
          {props.me.displayName} ({props.myRole ?? 'observer'}, you)
        </li>
        {props.peers.map((peer) => (
          <li key={peer.clientId} className="lc-presence-item">
            <span
              className="lc-presence-dot"
              style={{ backgroundColor: peer.state.user.color }}
              aria-hidden="true"
            />
            {peer.state.user.name} ({peer.state.user.role})
          </li>
        ))}
      </ul>
    </div>
  );
}
