/**
 * Chooses the storage adapter from configuration.
 */

import { type Config } from '../config.js';
import { LocalStorageAdapter } from './local-storage.js';
import { S3StorageAdapter } from './s3-storage.js';
import { type StorageAdapter } from './storage-adapter.js';

/**
 * Builds the configured storage adapter.
 *
 * @param {Config} config - Validated configuration.
 * @returns {StorageAdapter} Local disk or S3-compatible storage.
 * @throws {Error} If `STORAGE_DRIVER=s3` but a required S3 setting is missing (the config
 *   schema already rejects this; the check here keeps the types honest).
 */
export function createStorage(config: Config): StorageAdapter {
  if (config.STORAGE_DRIVER === 'local') return new LocalStorageAdapter(config.STORAGE_LOCAL_DIR);
  if (!config.S3_BUCKET || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
    throw new Error(
      'S3 storage selected but S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY missing',
    );
  }
  return new S3StorageAdapter({
    ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
  });
}
