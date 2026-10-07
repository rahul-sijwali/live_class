/**
 * Disk-backed storage for development and tests.
 *
 * Owns: mapping keys to files under one root directory, refusing keys that would escape it.
 * Not for production: most free hosts wipe the disk on restart.
 */

import { createReadStream } from 'node:fs';
import { access, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type Readable } from 'node:stream';

import { AppError } from '@live-class/shared';

import { type StorageAdapter } from './storage-adapter.js';

/**
 * Stores objects as files under a root directory.
 */
export class LocalStorageAdapter implements StorageAdapter {
  private readonly root: string;

  /**
   * Creates the adapter.
   *
   * @param {string} rootDir - Directory that holds every object; created on first write.
   */
  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  /**
   * Resolves a key to an absolute path inside the root.
   *
   * @param {string} key - Object key.
   * @returns {string} Absolute file path.
   * @throws {AppError} `VALIDATION` if the key escapes the root (path traversal).
   */
  private resolve(key: string): string {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(this.root + path.sep) && target !== this.root) {
      throw new AppError('VALIDATION', `Invalid storage key: ${key}`);
    }
    return target;
  }

  /**
   * Writes an object to disk.
   *
   * @param {string} key - Object key.
   * @param {Buffer} body - File bytes.
   * @param {string} _contentType - MIME type (unused on disk; kept for the interface).
   * @returns {Promise<void>} Resolves when written.
   */
  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  /**
   * Opens an object for streaming.
   *
   * @param {string} key - Object key.
   * @returns {Promise<{ stream: Readable; contentLength: number | null }>} Stream and size.
   * @throws {AppError} `NOT_FOUND` if the file is missing.
   */
  async getStream(key: string): Promise<{ stream: Readable; contentLength: number | null }> {
    const target = this.resolve(key);
    try {
      const info = await stat(target);
      return { stream: createReadStream(target), contentLength: info.size };
    } catch (error) {
      throw new AppError('NOT_FOUND', `Object ${key} not found`, { cause: error });
    }
  }

  /**
   * Deletes an object.
   *
   * @param {string} key - Object key.
   * @returns {Promise<void>} Resolves when gone.
   */
  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  /**
   * Checks the root directory is usable.
   *
   * @returns {Promise<boolean>} True when the directory exists or could be created.
   */
  async healthy(): Promise<boolean> {
    try {
      await mkdir(this.root, { recursive: true });
      await access(this.root);
      return true;
    } catch {
      return false;
    }
  }
}
