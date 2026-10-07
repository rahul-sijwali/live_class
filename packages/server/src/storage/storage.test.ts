import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { testConfig } from '../config.js';
import { createStorage } from './create-storage.js';
import { LocalStorageAdapter } from './local-storage.js';
import { S3StorageAdapter } from './s3-storage.js';

/**
 * Reads a stream fully.
 *
 * @param {Readable} stream - Stream to drain.
 * @returns {Promise<Buffer>} Its bytes.
 */
async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

describe('LocalStorageAdapter', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'lc-storage-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes, reads, deletes and reports health', async () => {
    const storage = new LocalStorageAdapter(dir);
    expect(await storage.healthy()).toBe(true);
    await storage.put('assets/a/a.png', Buffer.from('hello'), 'image/png');
    const { stream, contentLength } = await storage.getStream('assets/a/a.png');
    expect(contentLength).toBe(5);
    expect((await drain(stream)).toString()).toBe('hello');
    await storage.delete('assets/a/a.png');
    await storage.delete('assets/a/a.png'); // idempotent
    await expect(storage.getStream('assets/a/a.png')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses keys that escape the root', async () => {
    const storage = new LocalStorageAdapter(dir);
    await expect(
      storage.put('../escape.txt', Buffer.from('x'), 'text/plain'),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});

describe('S3StorageAdapter', () => {
  const objects = new Map<string, Buffer>();
  const send = vi.fn(
    (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const key = command.input['Key'] as string;
      switch (command.constructor.name) {
        case 'PutObjectCommand':
          objects.set(key, Buffer.from(command.input['Body'] as Buffer));
          return Promise.resolve({});
        case 'GetObjectCommand': {
          const body = objects.get(key);
          if (!body)
            return Promise.reject(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));
          return Promise.resolve({ Body: Readable.from([body]), ContentLength: body.byteLength });
        }
        case 'DeleteObjectCommand':
          objects.delete(key);
          return Promise.resolve({});
        case 'HeadBucketCommand':
          return Promise.resolve({});
        default:
          return Promise.reject(new Error(`unexpected ${command.constructor.name}`));
      }
    },
  );
  const client = { send } as unknown as ConstructorParameters<typeof S3StorageAdapter>[1];
  const options = {
    endpoint: 'https://s3.test',
    region: 'us-east-1',
    bucket: 'b',
    accessKeyId: 'k',
    secretAccessKey: 's',
    forcePathStyle: true,
  };

  it('round-trips objects through the S3 client', async () => {
    const storage = new S3StorageAdapter(options, client);
    await storage.put('k1', Buffer.from('data'), 'text/plain');
    const { stream, contentLength } = await storage.getStream('k1');
    expect(contentLength).toBe(4);
    expect((await drain(stream)).toString()).toBe('data');
    await storage.delete('k1');
    await expect(storage.getStream('k1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await storage.healthy()).toBe(true);
  });

  it('reports unhealthy when the bucket check fails', async () => {
    const failing = {
      send: vi.fn(() => Promise.reject(new Error('down'))),
    } as unknown as typeof client;
    const storage = new S3StorageAdapter(options, failing);
    expect(await storage.healthy()).toBe(false);
    await expect(storage.getStream('x')).rejects.toThrow('down');
  });
});

describe('createStorage', () => {
  it('builds the adapter the configuration asks for', () => {
    expect(createStorage(testConfig())).toBeInstanceOf(LocalStorageAdapter);
    expect(
      createStorage(
        testConfig({
          STORAGE_DRIVER: 's3',
          S3_BUCKET: 'b',
          S3_ACCESS_KEY_ID: 'k',
          S3_SECRET_ACCESS_KEY: 's',
          S3_ENDPOINT: 'https://s3.test',
        }),
      ),
    ).toBeInstanceOf(S3StorageAdapter);
  });
});
