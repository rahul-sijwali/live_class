import { beforeEach, describe, expect, it, vi } from 'vitest';

const sockets: FakeSocket[] = [];
const providers: FakeProvider[] = [];

/** Stand-in for HocuspocusProviderWebsocket that records calls and lets tests fire events. */
class FakeSocket {
  readonly options: Record<string, unknown>;
  readonly handlers = new Map<string, ((payload: unknown) => void)[]>();
  connect = vi.fn(() => Promise.resolve());
  disconnect = vi.fn();
  destroy = vi.fn();

  constructor(options: Record<string, unknown>) {
    this.options = options;
    sockets.push(this);
  }

  on(event: string, handler: (payload: unknown) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  fire(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

/** Stand-in for HocuspocusProvider. */
class FakeProvider {
  readonly options: Record<string, unknown>;
  attach = vi.fn();
  detach = vi.fn();
  destroy = vi.fn();

  constructor(options: Record<string, unknown>) {
    this.options = options;
    providers.push(this);
  }
}

vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProviderWebsocket: FakeSocket,
  HocuspocusProvider: FakeProvider,
  WebSocketStatus: {
    Connected: 'connected',
    Connecting: 'connecting',
    Disconnected: 'disconnected',
  },
}));

const { RealtimeClient } = await import('./realtime-client.js');

beforeEach(() => {
  sockets.length = 0;
  providers.length = 0;
});

describe('RealtimeClient', () => {
  it('connects on the first document and disconnects after the last closes', () => {
    const client = new RealtimeClient({ url: 'ws://x', getToken: () => 't' });
    const socket = sockets[0]!;
    expect(socket.options['autoConnect']).toBe(false);
    expect(socket.connect).not.toHaveBeenCalled();
    const a = client.openDoc('sheet:a');
    const b = client.openDoc('sheet:b');
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(client.openDoc('sheet:a')).toBe(a);
    expect(providers).toHaveLength(2);
    expect(providers[0]!.attach).toHaveBeenCalled();
    a.close();
    expect(socket.disconnect).not.toHaveBeenCalled();
    b.close();
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    client.dispose();
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('maps socket and authorisation events to statuses', () => {
    const client = new RealtimeClient({ url: 'ws://x', getToken: () => 't' });
    const socket = sockets[0]!;
    const doc = client.openDoc('session:s');
    const statuses: string[] = [];
    doc.on('status', (status) => statuses.push(status));
    socket.fire('status', { status: 'connecting' });
    socket.fire('status', { status: 'connected' });
    const provider = providers[0]!;
    (provider.options['onAuthenticated'] as (p: { scope: string }) => void)({ scope: 'readonly' });
    expect(doc.readOnly).toBe(true);
    (provider.options['onSynced'] as () => void)();
    expect(doc.synced).toBe(true);
    (provider.options['onAuthenticationFailed'] as () => void)();
    expect(statuses).toEqual(['connecting', 'connected', 'readonly', 'unauthorized']);
    expect(client.status).toBe('connected');
    client.dispose();
  });

  it('passes the token source to each provider', async () => {
    const client = new RealtimeClient({ url: 'ws://x', getToken: () => 'secret' });
    client.openDoc('sheet:a');
    const token = providers[0]!.options['token'] as () => Promise<string>;
    await expect(token()).resolves.toBe('secret');
    client.dispose();
    expect(() => client.openDoc('sheet:b')).toThrow();
  });
});
