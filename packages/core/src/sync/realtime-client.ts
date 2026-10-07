/**
 * Connection to the realtime server for many documents over one WebSocket.
 *
 * Owns: the shared `HocuspocusProviderWebsocket`, one `HocuspocusProvider` per open
 * document, the token callback, reconnection settings and the mapping from provider
 * events to our `ConnectionStatus`. Does not own document contents (`SheetDoc`,
 * `SessionDoc`) or presence semantics (`Presence`).
 */

import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
  WebSocketStatus,
} from '@hocuspocus/provider';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import {
  type ConnectionStatus,
  REALTIME_RECONNECT_MAX_MS,
  REALTIME_RECONNECT_MIN_MS,
} from '@live-class/shared';

import { TypedEmitter, type Unsubscribe } from '../events.js';

/** Options for `RealtimeClient`. */
export interface RealtimeClientOptions {
  /** WebSocket URL of the server's realtime endpoint, for example `wss://…/realtime`. */
  readonly url: string;
  /** Returns the bearer token to authenticate each document with. */
  readonly getToken: () => string | Promise<string>;
  /** Minimum reconnect delay in ms. */
  readonly reconnectMinMs?: number;
  /** Maximum reconnect delay in ms. */
  readonly reconnectMaxMs?: number;
}

/** Events emitted per connected document. */
export interface ConnectedDocEvents extends Record<string, unknown> {
  /** Connection or authorisation status changed. */
  status: ConnectionStatus;
  /** The document finished its first sync with the server. */
  synced: null;
}

/** A document opened through the client. */
export interface ConnectedDoc {
  /** Document name, for example `sheet:<id>`. */
  readonly name: string;
  /** The Yjs document, kept in sync with the server. */
  readonly doc: Y.Doc;
  /** Awareness channel of this document. */
  readonly awareness: Awareness;
  /** Latest status. */
  readonly status: ConnectionStatus;
  /** True once the first sync completed. */
  readonly synced: boolean;
  /** True when the server granted read-only access. */
  readonly readOnly: boolean;
  /**
   * Subscribes to status or sync events.
   *
   * @param {K} event - Name of the event to listen for (`status` or `synced`).
   * @param {(payload: ConnectedDocEvents[K]) => void} listener - Called with the payload each time the event fires.
   * @returns {Unsubscribe} Function that removes the listener.
   */
  on<K extends keyof ConnectedDocEvents>(
    event: K,
    listener: (payload: ConnectedDocEvents[K]) => void,
  ): Unsubscribe;
  /**
   * Detaches the document from the socket and destroys the local `Y.Doc`.
   *
   * @returns {void} Nothing.
   */
  close(): void;
}

/**
 * Multiplexes realtime documents over one socket with shared status tracking.
 *
 * @remarks The socket connects on the first `openDoc` and disconnects when the last
 * document closes or on `dispose()`.
 */
export class RealtimeClient {
  private readonly socket: HocuspocusProviderWebsocket;
  private readonly getToken: () => string | Promise<string>;
  private readonly openDocs = new Map<string, ConnectedDocImpl>();
  private readonly emitter = new TypedEmitter<{ status: ConnectionStatus }>();
  private socketStatus: ConnectionStatus = 'disconnected';
  private disposed = false;

  /**
   * Creates the client without connecting.
   *
   * @param {RealtimeClientOptions} options - URL, token source and reconnect bounds.
   */
  constructor(options: RealtimeClientOptions) {
    this.getToken = options.getToken;
    this.socket = new HocuspocusProviderWebsocket({
      url: options.url,
      autoConnect: false,
      minDelay: options.reconnectMinMs ?? REALTIME_RECONNECT_MIN_MS,
      maxDelay: options.reconnectMaxMs ?? REALTIME_RECONNECT_MAX_MS,
      maxAttempts: 0,
    });
    this.socket.on('status', ({ status }: { status: WebSocketStatus }) => {
      this.setSocketStatus(mapSocketStatus(status));
    });
  }

  /**
   * Overall socket status (independent of per-document authorisation).
   *
   * @returns {ConnectionStatus} `connecting`, `connected` or `disconnected`.
   */
  get status(): ConnectionStatus {
    return this.socketStatus;
  }

  /**
   * Subscribes to socket status changes.
   *
   * @param {(status: ConnectionStatus) => void} listener - Called on each change.
   * @returns {Unsubscribe} Function that removes the listener.
   */
  onStatus(listener: (status: ConnectionStatus) => void): Unsubscribe {
    return this.emitter.on('status', listener);
  }

  /**
   * Opens (or returns the already open) document with the given name.
   *
   * @param {string} name - Document name such as `sheet:<id>` or `session:<id>`.
   * @returns {ConnectedDoc} The connected document.
   * @throws {Error} If the client has been disposed.
   */
  openDoc(name: string): ConnectedDoc {
    if (this.disposed) throw new Error('RealtimeClient has been disposed');
    const existing = this.openDocs.get(name);
    if (existing) return existing;
    const connected = new ConnectedDocImpl(name, this.socket, this.getToken, () => {
      this.openDocs.delete(name);
      if (this.openDocs.size === 0) this.socket.disconnect();
    });
    this.openDocs.set(name, connected);
    if (this.openDocs.size === 1) void this.socket.connect();
    connected.applySocketStatus(this.socketStatus);
    return connected;
  }

  /**
   * Closes every document and the socket.
   *
   * @returns {void} Nothing.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const doc of Array.from(this.openDocs.values())) doc.close();
    this.socket.destroy();
    this.emitter.dispose();
  }

  /**
   * Records a new socket status and propagates it to open documents.
   *
   * @param {ConnectionStatus} status - Mapped socket status.
   * @returns {void} Nothing.
   */
  private setSocketStatus(status: ConnectionStatus): void {
    if (status === this.socketStatus) return;
    this.socketStatus = status;
    this.emitter.emit('status', status);
    for (const doc of this.openDocs.values()) doc.applySocketStatus(status);
  }
}

/**
 * Maps Hocuspocus socket states to our status vocabulary.
 *
 * @param {WebSocketStatus} status - Provider socket status.
 * @returns {ConnectionStatus} `connecting`, `connected` or `disconnected`.
 */
function mapSocketStatus(status: WebSocketStatus): ConnectionStatus {
  switch (status) {
    case WebSocketStatus.Connected:
      return 'connected';
    case WebSocketStatus.Connecting:
      return 'connecting';
    case WebSocketStatus.Disconnected:
      return 'disconnected';
    default:
      return 'disconnected';
  }
}

/** Internal implementation of `ConnectedDoc`. */
class ConnectedDocImpl implements ConnectedDoc {
  readonly name: string;
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  private readonly provider: HocuspocusProvider;
  private readonly emitter = new TypedEmitter<ConnectedDocEvents>();
  private readonly onClosed: () => void;
  private socketStatus: ConnectionStatus = 'disconnected';
  private authFailed = false;
  private isReadOnly = false;
  private isSynced = false;
  private closed = false;

  /**
   * Attaches a new provider for `name` to the shared socket.
   *
   * @param {string} name - Document name.
   * @param {HocuspocusProviderWebsocket} socket - Shared socket.
   * @param {() => string | Promise<string>} getToken - Token source.
   * @param {() => void} onClosed - Called after `close()` so the client can forget the doc.
   */
  constructor(
    name: string,
    socket: HocuspocusProviderWebsocket,
    getToken: () => string | Promise<string>,
    onClosed: () => void,
  ) {
    this.name = name;
    this.onClosed = onClosed;
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);
    this.provider = new HocuspocusProvider({
      websocketProvider: socket,
      name,
      document: this.doc,
      awareness: this.awareness,
      token: () => Promise.resolve(getToken()),
      onAuthenticated: ({ scope }: { scope?: string }) => {
        this.authFailed = false;
        this.isReadOnly = scope === 'readonly';
        this.recompute();
      },
      onAuthenticationFailed: () => {
        this.authFailed = true;
        this.recompute();
      },
      onSynced: () => {
        this.isSynced = true;
        this.emitter.emit('synced', null);
        this.recompute();
      },
    });
    this.provider.attach();
  }

  /**
   * Latest status for this document.
   *
   * @returns {ConnectionStatus} Combined socket and authorisation status.
   */
  get status(): ConnectionStatus {
    if (this.authFailed) return 'unauthorized';
    if (this.socketStatus === 'connected' && this.isReadOnly) return 'readonly';
    return this.socketStatus;
  }

  /**
   * Whether the first sync has completed.
   *
   * @returns {boolean} True after the initial sync.
   */
  get synced(): boolean {
    return this.isSynced;
  }

  /**
   * Whether the server granted read-only access.
   *
   * @returns {boolean} True when the scope is read-only.
   */
  get readOnly(): boolean {
    return this.isReadOnly;
  }

  /**
   * Subscribes to document events.
   *
   * @param {K} event - Name of the event to listen for (`status` or `synced`).
   * @param {(payload: ConnectedDocEvents[K]) => void} listener - Called with the payload each time the event fires.
   * @returns {Unsubscribe} Function that removes the listener.
   */
  on<K extends keyof ConnectedDocEvents>(
    event: K,
    listener: (payload: ConnectedDocEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, listener);
  }

  /**
   * Detaches from the socket and destroys the local document.
   *
   * @returns {void} Nothing.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.provider.detach();
    this.provider.destroy();
    this.awareness.destroy();
    this.doc.destroy();
    this.emitter.dispose();
    this.onClosed();
  }

  /**
   * Receives the shared socket status from the client.
   *
   * @param {ConnectionStatus} status - The shared socket's new connection state.
   * @returns {void} Nothing.
   */
  applySocketStatus(status: ConnectionStatus): void {
    this.socketStatus = status;
    if (status !== 'connected') this.isSynced = false;
    this.recompute();
  }

  private lastEmitted: ConnectionStatus | null = null;

  /**
   * Emits the combined status when it changes.
   *
   * @returns {void} Nothing.
   */
  private recompute(): void {
    if (this.closed) return;
    const status = this.status;
    if (status === this.lastEmitted) return;
    this.lastEmitted = status;
    this.emitter.emit('status', status);
  }
}
