/**
 * S3-compatible storage (Supabase Storage, Cloudflare R2, AWS S3, MinIO).
 *
 * Owns: translating the adapter contract to S3 commands. Switching providers means
 * changing endpoint, bucket and keys in the environment, nothing here.
 */

import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { AppError } from '@live-class/shared';

import { type StorageAdapter } from './storage-adapter.js';

/** Connection settings. */
export interface S3StorageOptions {
  /** Custom endpoint for non-AWS providers; undefined for AWS. */
  readonly endpoint?: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Path-style URLs (`endpoint/bucket/key`), required by Supabase and MinIO. */
  readonly forcePathStyle: boolean;
}

/**
 * Stores objects in an S3-compatible bucket.
 */
export class S3StorageAdapter implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;

  /**
   * Creates the adapter.
   *
   * @param {S3StorageOptions} options - Endpoint, bucket and credentials.
   * @param {S3Client} [client] - Pre-built client (injectable for tests).
   */
  constructor(options: S3StorageOptions, client?: S3Client) {
    this.bucket = options.bucket;
    this.client =
      client ??
      new S3Client({
        region: options.region,
        ...(options.endpoint ? { endpoint: options.endpoint } : {}),
        forcePathStyle: options.forcePathStyle,
        credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
      });
  }

  /**
   * Uploads an object.
   *
   * @param {string} key - Object key.
   * @param {Buffer} body - File bytes.
   * @param {string} contentType - MIME type.
   * @returns {Promise<void>} Resolves when stored.
   */
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /**
   * Opens an object for streaming.
   *
   * @param {string} key - Object key.
   * @returns {Promise<{ stream: Readable; contentLength: number | null }>} Stream and size.
   * @throws {AppError} `NOT_FOUND` when the key does not exist.
   */
  async getStream(key: string): Promise<{ stream: Readable; contentLength: number | null }> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = result.Body;
      if (!body) throw new AppError('NOT_FOUND', `Object ${key} has no body`);
      const stream =
        body instanceof Readable ? body : Readable.fromWeb(body.transformToWebStream());
      return { stream, contentLength: result.ContentLength ?? null };
    } catch (error) {
      if (error instanceof AppError) throw error;
      const name = (error as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') {
        throw new AppError('NOT_FOUND', `Object ${key} not found`, { cause: error });
      }
      throw error;
    }
  }

  /**
   * Deletes an object.
   *
   * @param {string} key - Object key.
   * @returns {Promise<void>} Resolves when gone.
   */
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /**
   * Checks the bucket is reachable.
   *
   * @returns {Promise<boolean>} True when `HeadBucket` succeeded.
   */
  async healthy(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}
