import { afterEach, describe, expect, it, vi } from 'vitest';

import { LiveClassApi } from './client.js';

/** Minimal XMLHttpRequest stand-in that tests drive by hand. */
class FakeXhr {
  static instances: FakeXhr[] = [];
  readonly headers: Record<string, string> = {};
  readonly upload = {
    onprogress: null as
      ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null,
  };
  method = '';
  url = '';
  timeout = 0;
  responseType = '';
  status = 0;
  responseText = '';
  sent: unknown = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(body: unknown): void {
    this.sent = body;
  }

  abort(): void {
    this.onabort?.();
  }
}

const originalXhr = globalThis.XMLHttpRequest;

/**
 * Waits for the n-th XHR the client creates (it is created after the token resolves).
 *
 * @param {number} index - Zero-based instance index.
 * @returns {Promise<FakeXhr>} The instance.
 */
async function xhrAt(index: number): Promise<FakeXhr> {
  await vi.waitFor(() => {
    expect(FakeXhr.instances.length).toBeGreaterThan(index);
  });
  return FakeXhr.instances[index]!;
}

afterEach(() => {
  globalThis.XMLHttpRequest = originalXhr;
  FakeXhr.instances = [];
});

const assetBody = {
  id: '0192f1e0-0000-7000-8000-000000000001',
  mime: 'image/png',
  bytes: 3,
  pageSizes: [{ width: 10, height: 10 }],
  sha256: 'a'.repeat(64),
  url: '/assets/x/file',
  thumbnailUrl: null,
  createdAt: new Date().toISOString(),
};

describe('LiveClassApi.uploadAsset (browser XHR path)', () => {
  it('sends multipart with the token, reports progress and parses the asset', async () => {
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    const api = new LiveClassApi({
      baseUrl: 'https://api.test',
      getToken: () => 'tok',
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    const progress = vi.fn();
    const pending = api.uploadAsset(new Blob(['abc'], { type: 'image/png' }), {
      fileName: 'a.png',
      onProgress: progress,
    });
    const xhr = await xhrAt(0);
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('https://api.test/assets');
    expect(xhr.headers['Authorization']).toBe('Bearer tok');
    expect(xhr.sent).toBeInstanceOf(FormData);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 3 });
    expect(progress).toHaveBeenCalledWith({ loadedBytes: 1, totalBytes: 3 });
    xhr.status = 201;
    xhr.responseText = JSON.stringify(assetBody);
    xhr.onload?.();
    await expect(pending).resolves.toMatchObject({ id: assetBody.id, mime: 'image/png' });
  });

  it('maps server rejections, network errors, timeouts and cancellation', async () => {
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    const api = new LiveClassApi({
      baseUrl: 'https://api.test',
      getToken: () => 'tok',
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    const rejected = api.uploadAsset(new Blob(['x']));
    const first = await xhrAt(0);
    first.status = 415;
    first.responseText = JSON.stringify({ code: 'UPLOAD_TYPE_NOT_ALLOWED', message: 'nope' });
    first.onload?.();
    await expect(rejected).rejects.toMatchObject({ code: 'UPLOAD_TYPE_NOT_ALLOWED' });

    const network = api.uploadAsset(new Blob(['x']));
    (await xhrAt(1)).onerror?.();
    await expect(network).rejects.toMatchObject({ code: 'NETWORK' });

    const slow = api.uploadAsset(new Blob(['x']));
    (await xhrAt(2)).ontimeout?.();
    await expect(slow).rejects.toMatchObject({ code: 'TIMEOUT' });

    const controller = new AbortController();
    const cancelled = api.uploadAsset(new Blob(['x']), { signal: controller.signal });
    await xhrAt(3);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'NETWORK', message: 'Upload cancelled' });
  });

  it('rejects an unexpected response shape', async () => {
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    const api = new LiveClassApi({
      baseUrl: 'https://api.test',
      getToken: () => 'tok',
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    const pending = api.uploadAsset(new Blob(['x']));
    const xhr = await xhrAt(0);
    xhr.status = 201;
    xhr.responseText = '{"unexpected":true}';
    xhr.onload?.();
    await expect(pending).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});

describe('LiveClassApi.uploadAsset (fetch fallback)', () => {
  it('uses fetch when XMLHttpRequest is unavailable', async () => {
    globalThis.XMLHttpRequest = undefined as unknown as typeof XMLHttpRequest;
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(assetBody), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ) as unknown as typeof fetch;
    const api = new LiveClassApi({ baseUrl: 'https://api.test', getToken: () => 'tok', fetchImpl });
    const asset = await api.uploadAsset(new Blob(['abc']));
    expect(asset.id).toBe(assetBody.id);
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });
});
