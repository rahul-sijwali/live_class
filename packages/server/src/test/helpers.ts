/**
 * Shared helpers for server tests: boot an app on the embedded database, log in as the
 * seeded accounts, build multipart bodies and generate small valid fixtures.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import sharp from 'sharp';

import { type LoginResponse } from '@live-class/shared';

import { buildServer, type BuiltServer } from '../app.js';
import { testConfig } from '../config.js';

/** A booted test server with a disposable upload directory. */
export interface TestServer extends BuiltServer {
  /** Logs in with a seeded local account and returns the bearer token. */
  login(
    email: 'admin@local.test' | 'mentor@local.test' | 'student@local.test',
  ): Promise<LoginResponse>;
  /** Builds `Authorization` headers for a token. */
  auth(token: string): { authorization: string };
  /** Closes the app and removes temp files. */
  stop(): Promise<void>;
}

/**
 * Boots a server on an in-memory database with local auth enabled.
 *
 * @param {Partial<Record<string, string>>} overrides - Extra environment overrides.
 * @returns {Promise<TestServer>} The ready server.
 */
export async function startTestServer(
  overrides: Partial<Record<string, string>> = {},
): Promise<TestServer> {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'live-class-test-'));
  const built = await buildServer(testConfig({ STORAGE_LOCAL_DIR: uploadDir, ...overrides }));
  await built.app.ready();
  return {
    ...built,
    async login(email) {
      const response = await built.app.inject({
        method: 'POST',
        url: '/auth/local/login',
        payload: { email, password: 'password123' },
      });
      if (response.statusCode !== 200) throw new Error(`login failed: ${response.body}`);
      return response.json() as LoginResponse;
    },
    auth(token) {
      return { authorization: `Bearer ${token}` };
    },
    async stop() {
      await built.app.close();
      await rm(uploadDir, { recursive: true, force: true });
    },
  };
}

/**
 * Encodes a file as a multipart body the way a browser would.
 *
 * @param {Buffer} file - File bytes.
 * @param {string} fileName - File name sent in the part.
 * @param {string} contentType - MIME type declared by the client (ignored by validation).
 * @returns {Promise<{ body: Buffer; contentType: string }>} Body and the boundary header.
 */
export async function multipart(
  file: Buffer,
  fileName: string,
  contentType: string,
): Promise<{ body: Buffer; contentType: string }> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file)], { type: contentType }), fileName);
  const encoded = new Response(form);
  return {
    body: Buffer.from(await encoded.arrayBuffer()),
    contentType: encoded.headers.get('content-type') ?? '',
  };
}

/**
 * Creates a solid-colour PNG.
 *
 * @param {number} width - Width in pixels.
 * @param {number} height - Height in pixels.
 * @returns {Promise<Buffer>} PNG bytes.
 */
export function png(width = 64, height = 32): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#4466aa' } })
    .png()
    .toBuffer();
}

/**
 * Creates a JPEG.
 *
 * @param {number} width - Width in pixels.
 * @param {number} height - Height in pixels.
 * @returns {Promise<Buffer>} JPEG bytes.
 */
export function jpeg(width = 64, height = 32): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#aa6644' } })
    .jpeg()
    .toBuffer();
}

/**
 * Creates a two-frame animated GIF.
 *
 * @param {number} width - Width in pixels.
 * @param {number} height - Height in pixels.
 * @returns {Promise<Buffer>} GIF bytes.
 */
export async function gif(width = 48, height = 24): Promise<Buffer> {
  const frameA = await sharp({ create: { width, height, channels: 3, background: '#ff0000' } })
    .raw()
    .toBuffer();
  const frameB = await sharp({ create: { width, height, channels: 3, background: '#0000ff' } })
    .raw()
    .toBuffer();
  return sharp(Buffer.concat([frameA, frameB]), {
    raw: { width, height: height * 2, channels: 3 },
  })
    .gif({ loop: 0 })
    .toBuffer()
    .then((joined) => sharp(joined, { animated: true, pages: -1 }).gif().toBuffer())
    .catch(() =>
      sharp(frameA, { raw: { width, height, channels: 3 } })
        .gif()
        .toBuffer(),
    );
}

/**
 * Creates a PDF with the given page sizes.
 *
 * @param {[number, number][]} pages - Width and height of each page in points.
 * @returns {Promise<Buffer>} PDF bytes.
 */
export async function pdf(pages: [number, number][] = [[612, 792]]): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (const [width, height] of pages) document.addPage([width, height]);
  return Buffer.from(await document.save());
}

/**
 * Creates a PDF whose open action runs JavaScript (must be rejected).
 *
 * @returns {Promise<Buffer>} PDF bytes.
 */
export async function pdfWithJavaScript(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  const action = document.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') });
  document.catalog.set(PDFName.of('OpenAction'), action);
  return Buffer.from(await document.save());
}
