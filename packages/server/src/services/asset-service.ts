/**
 * Asset lifecycle: validate, de-duplicate, store, thumbnail, stream.
 *
 * Owns: `assets` rows and their objects in storage. Assets are immutable (invariant 5).
 */

import { type Readable } from 'node:stream';

import { eq } from 'drizzle-orm';
import sharp from 'sharp';

import {
  AppError,
  type Asset,
  type AssetId,
  newId,
  THUMBNAIL_WIDTH_PX,
  type UserId,
} from '@live-class/shared';

import { type Db } from '../db/client.js';
import { assets } from '../db/schema.js';
import { type StorageAdapter } from '../storage/storage-adapter.js';
import { validateUpload, type ValidatedUpload } from './asset-validation.js';
import { type AssetRow, toAsset } from './mappers.js';

/** File extension per MIME type, used only for readable storage keys. */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

/**
 * Asset operations.
 */
export class AssetService {
  private readonly db: Db;
  private readonly storage: StorageAdapter;
  private readonly maxBytes: number;

  /**
   * Creates the service.
   *
   * @param {Db} db - Database handle.
   * @param {StorageAdapter} storage - Object storage.
   * @param {number} maxUploadMb - Largest accepted upload in megabytes.
   */
  constructor(db: Db, storage: StorageAdapter, maxUploadMb: number) {
    this.db = db;
    this.storage = storage;
    this.maxBytes = maxUploadMb * 1024 * 1024;
  }

  /**
   * Validates and stores an uploaded file. Re-uploading identical bytes returns the
   * existing asset instead of storing a copy.
   *
   * @param {Buffer} buffer - Complete file contents.
   * @param {UserId} userId - Uploader.
   * @returns {Promise<Asset>} The stored (or existing) asset.
   * @throws {AppError} Upload codes from `validateUpload`.
   */
  async createFromUpload(buffer: Buffer, userId: UserId): Promise<Asset> {
    const validated = await validateUpload(buffer, { maxBytes: this.maxBytes });
    const [existing] = await this.db
      .select()
      .from(assets)
      .where(eq(assets.sha256, validated.sha256))
      .limit(1);
    if (existing) return toAsset(existing);

    const id = newId();
    const extension = EXTENSIONS[validated.mime] ?? 'bin';
    const storageKey = `assets/${id}/${id}.${extension}`;
    await this.storage.put(storageKey, buffer, validated.mime);
    const thumbnailKey = await this.storeThumbnail(id, buffer, validated);

    const [row] = await this.db
      .insert(assets)
      .values({
        id,
        storageKey,
        mime: validated.mime,
        bytes: validated.bytes,
        sha256: validated.sha256,
        pageSizes: [...validated.pageSizes],
        thumbnailKey,
        createdBy: userId,
      })
      .returning();
    if (!row) throw new AppError('INTERNAL', 'Asset insert returned no row');
    return toAsset(row);
  }

  /**
   * Loads an asset row.
   *
   * @param {AssetId} id - Identifier of the asset to load.
   * @returns {Promise<AssetRow>} The database row, including storage keys.
   * @throws {AppError} `NOT_FOUND` when missing.
   */
  async getRow(id: AssetId): Promise<AssetRow> {
    const [row] = await this.db.select().from(assets).where(eq(assets.id, id)).limit(1);
    if (!row) throw new AppError('NOT_FOUND', `Asset ${id} not found`);
    return row;
  }

  /**
   * Opens the original file for streaming.
   *
   * @param {AssetId} id - Identifier of the asset whose original bytes are wanted.
   * @returns {Promise<{ stream: Readable; mime: string; contentLength: number | null }>} Stream and headers.
   * @throws {AppError} `NOT_FOUND` when the asset or its object is missing.
   */
  async openFile(
    id: AssetId,
  ): Promise<{ stream: Readable; mime: string; contentLength: number | null }> {
    const row = await this.getRow(id);
    const { stream, contentLength } = await this.storage.getStream(row.storageKey);
    return { stream, mime: row.mime, contentLength };
  }

  /**
   * Opens the PNG thumbnail for streaming.
   *
   * @param {AssetId} id - Identifier of the asset whose preview is wanted.
   * @returns {Promise<{ stream: Readable; contentLength: number | null }>} Stream and size.
   * @throws {AppError} `NOT_FOUND` when the asset has no thumbnail.
   */
  async openThumbnail(id: AssetId): Promise<{ stream: Readable; contentLength: number | null }> {
    const row = await this.getRow(id);
    if (!row.thumbnailKey) throw new AppError('NOT_FOUND', `Asset ${id} has no thumbnail`);
    return this.storage.getStream(row.thumbnailKey);
  }

  /**
   * Renders and stores a thumbnail for raster uploads (first frame for GIFs). PDFs get
   * none; the client shows a document icon instead.
   *
   * @param {string} id - Identifier of the asset the thumbnail belongs to (used in its key).
   * @param {Buffer} buffer - Original bytes.
   * @param {ValidatedUpload} validated - Detected type.
   * @returns {Promise<string | null>} Storage key of the thumbnail, or null.
   */
  private async storeThumbnail(
    id: string,
    buffer: Buffer,
    validated: ValidatedUpload,
  ): Promise<string | null> {
    if (validated.kind === 'pdf') return null;
    try {
      const png = await sharp(buffer, { pages: 1 })
        .resize({ width: THUMBNAIL_WIDTH_PX, withoutEnlargement: true })
        .png()
        .toBuffer();
      const key = `assets/${id}/thumbnail.png`;
      await this.storage.put(key, png, 'image/png');
      return key;
    } catch {
      // A missing thumbnail is cosmetic; never fail the upload for it.
      return null;
    }
  }
}
