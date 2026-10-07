/**
 * In-memory stand-in for `RealtimeClient` used by core and React tests.
 *
 * Each fake client gets its own `Y.Doc` and `Awareness` per document name, and the hub
 * relays document updates and awareness updates between every client that opened the same
 * name, exactly as a server would. Two clients created from one hub therefore behave like
 * two browsers in the same room, including distinct awareness client ids.
 */

import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import * as Y from 'yjs';

import { type ConnectionStatus } from '@live-class/shared';

import { TypedEmitter, type Unsubscribe } from '../events.js';
import { type RealtimeConnection } from '../room/room-store.js';
import { type ConnectedDoc, type ConnectedDocEvents } from '../sync/realtime-client.js';

/** One client's replica of a document. */
interface Replica {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
}

/** Relays updates between replicas of the same document. */
export class FakeRealtimeHub {
  private readonly replicas = new Map<string, Set<Replica>>();
  /** The "server copy" each new replica is seeded from. */
  private readonly canonical = new Map<string, Y.Doc>();

  /**
   * Returns the server-side copy of a document (seed it in tests to simulate stored state).
   *
   * @param {string} name - Document name.
   * @returns {Y.Doc} The canonical document; changes to it reach every replica.
   */
  doc(name: string): Y.Doc {
    let doc = this.canonical.get(name);
    if (!doc) {
      doc = new Y.Doc();
      this.canonical.set(name, doc);
      const canonical = doc;
      canonical.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin === this) return;
        for (const replica of this.replicas.get(name) ?? [])
          Y.applyUpdate(replica.doc, update, this);
      });
    }
    return doc;
  }

  /**
   * Creates a replica synced with the canonical copy and every other replica.
   *
   * @param {string} name - Document name.
   * @returns {Replica & { leave(): void }} The replica and a function to disconnect it.
   */
  join(name: string): Replica & { leave(): void } {
    const canonical = this.doc(name);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(canonical), this);
    const awareness = new Awareness(doc);
    const replica: Replica = { doc, awareness };
    let set = this.replicas.get(name);
    if (!set) {
      set = new Set();
      this.replicas.set(name, set);
    }
    const peers = set;
    peers.add(replica);

    const onDocUpdate = (update: Uint8Array, origin: unknown): void => {
      if (origin === this) return;
      Y.applyUpdate(canonical, update, this);
      for (const other of peers) {
        if (other !== replica) Y.applyUpdate(other.doc, update, this);
      }
    };
    const onAwareness = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ): void => {
      if (origin === this) return;
      const encoded = encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]);
      for (const other of peers) {
        if (other !== replica) applyAwarenessUpdate(other.awareness, encoded, this);
      }
    };
    doc.on('update', onDocUpdate);
    awareness.on('update', onAwareness);
    // Learn about peers that were already present.
    for (const other of peers) {
      if (other === replica) continue;
      const states = Array.from(other.awareness.getStates().keys());
      if (states.length > 0) {
        applyAwarenessUpdate(awareness, encodeAwarenessUpdate(other.awareness, states), this);
      }
    }

    return {
      doc,
      awareness,
      leave: () => {
        doc.off('update', onDocUpdate);
        awareness.off('update', onAwareness);
        peers.delete(replica);
        // Tell the others this client left.
        for (const other of peers) {
          removeAwarenessStates(other.awareness, [awareness.clientID], this);
        }
        awareness.destroy();
        doc.destroy();
      },
    };
  }
}

/**
 * A fake realtime client backed by a hub.
 */
export class FakeRealtime implements RealtimeConnection {
  readonly hub: FakeRealtimeHub;
  readonly opened: string[] = [];
  readonly closed: string[] = [];
  readonly readOnly: boolean;
  private readonly emitter = new TypedEmitter<{ status: ConnectionStatus }>();
  private readonly open = new Map<string, ConnectedDoc>();
  private currentStatus: ConnectionStatus;

  /**
   * Creates a fake client.
   *
   * @param {FakeRealtimeHub} hub - Shared relay; clients on the same hub see each other.
   * @param {{ status?: ConnectionStatus; readOnly?: boolean }} options - Initial status and scope.
   */
  constructor(
    hub: FakeRealtimeHub = new FakeRealtimeHub(),
    options: { status?: ConnectionStatus; readOnly?: boolean } = {},
  ) {
    this.hub = hub;
    this.currentStatus = options.status ?? 'connected';
    this.readOnly = options.readOnly ?? false;
  }

  /**
   * Current socket status.
   *
   * @returns {ConnectionStatus} Status.
   */
  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  /**
   * Changes the status and notifies subscribers (tests simulate disconnects with this).
   *
   * @param {ConnectionStatus} status - New status.
   * @returns {void} Nothing.
   */
  setStatus(status: ConnectionStatus): void {
    this.currentStatus = status;
    this.emitter.emit('status', status);
  }

  /**
   * Subscribes to status changes.
   *
   * @param {(status: ConnectionStatus) => void} listener - Called on each change.
   * @returns {Unsubscribe} Function that removes the listener.
   */
  onStatus(listener: (status: ConnectionStatus) => void): Unsubscribe {
    return this.emitter.on('status', listener);
  }

  /**
   * Opens (or returns the already open) replica of a document.
   *
   * @param {string} name - Document name.
   * @returns {ConnectedDoc} A connected document view.
   */
  openDoc(name: string): ConnectedDoc {
    const existing = this.open.get(name);
    if (existing) return existing;
    this.opened.push(name);
    const replica = this.hub.join(name);
    const docEmitter = new TypedEmitter<ConnectedDocEvents>();
    const offStatus = this.emitter.on('status', (status) => {
      docEmitter.emit('status', this.readOnly && status === 'connected' ? 'readonly' : status);
    });
    const statusOf = (): ConnectionStatus => (this.readOnly ? 'readonly' : this.currentStatus);
    const connected: ConnectedDoc = {
      name,
      doc: replica.doc,
      awareness: replica.awareness,
      get status() {
        return statusOf();
      },
      synced: true,
      readOnly: this.readOnly,
      on: (event, listener) => docEmitter.on(event, listener),
      close: () => {
        offStatus();
        docEmitter.dispose();
        replica.leave();
        this.open.delete(name);
        this.closed.push(name);
      },
    };
    this.open.set(name, connected);
    return connected;
  }

  /**
   * Closes every open document.
   *
   * @returns {void} Nothing.
   */
  dispose(): void {
    for (const connected of Array.from(this.open.values())) connected.close();
    this.emitter.dispose();
  }
}
