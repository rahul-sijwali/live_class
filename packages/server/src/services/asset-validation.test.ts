import { describe, expect, it } from 'vitest';

import { gif, jpeg, pdf, pdfWithJavaScript, png } from '../test/helpers.js';
import { validateUpload } from './asset-validation.js';

const limits = { maxBytes: 5 * 1024 * 1024 };

describe('validateUpload', () => {
  it('accepts PNG and JPEG and reports their size', async () => {
    const result = await validateUpload(await png(100, 50), limits);
    expect(result).toMatchObject({
      mime: 'image/png',
      kind: 'image',
      pageSizes: [{ width: 100, height: 50 }],
    });
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    const asJpeg = await validateUpload(await jpeg(80, 40), limits);
    expect(asJpeg).toMatchObject({
      mime: 'image/jpeg',
      kind: 'image',
      pageSizes: [{ width: 80, height: 40 }],
    });
  });

  it('accepts GIFs as the gif kind with the frame size', async () => {
    const result = await validateUpload(await gif(48, 24), limits);
    expect(result.mime).toBe('image/gif');
    expect(result.kind).toBe('gif');
    expect(result.pageSizes[0]?.width).toBe(48);
  });

  it('accepts PDFs and returns every page size', async () => {
    const result = await validateUpload(
      await pdf([
        [612, 792],
        [400, 600],
      ]),
      limits,
    );
    expect(result.kind).toBe('pdf');
    expect(result.pageSizes).toEqual([
      { width: 612, height: 792 },
      { width: 400, height: 600 },
    ]);
  });

  it('rejects files by content, not by name or declared type', async () => {
    await expect(
      validateUpload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), limits),
    ).rejects.toMatchObject({
      code: 'UPLOAD_TYPE_NOT_ALLOWED',
    });
    await expect(validateUpload(Buffer.from('%PDF-1.4 not really'), limits)).rejects.toMatchObject({
      code: 'UPLOAD_LIMITS_EXCEEDED',
    });
    await expect(validateUpload(Buffer.alloc(0), limits)).rejects.toMatchObject({
      code: 'UPLOAD_TYPE_NOT_ALLOWED',
    });
  });

  it('rejects oversized files before decoding them', async () => {
    const bytes = await png();
    await expect(validateUpload(bytes, { maxBytes: bytes.byteLength - 1 })).rejects.toMatchObject({
      code: 'UPLOAD_TOO_LARGE',
    });
  });

  it('rejects images outside the dimension limits', async () => {
    await expect(validateUpload(await png(8, 8), limits)).rejects.toMatchObject({
      code: 'UPLOAD_LIMITS_EXCEEDED',
    });
    await expect(
      validateUpload(await png(300, 20), { ...limits, maxImageDimensionPx: 200 }),
    ).rejects.toMatchObject({
      code: 'UPLOAD_LIMITS_EXCEEDED',
    });
  });

  it('rejects PDFs with too many pages or active content', async () => {
    await expect(
      validateUpload(
        await pdf([
          [1, 1],
          [1, 1],
          [1, 1],
        ]),
        { ...limits, maxPdfPages: 2 },
      ),
    ).rejects.toMatchObject({
      code: 'UPLOAD_LIMITS_EXCEEDED',
    });
    await expect(validateUpload(await pdfWithJavaScript(), limits)).rejects.toMatchObject({
      code: 'UPLOAD_LIMITS_EXCEEDED',
      message: expect.stringMatching(/scripts/),
    });
  });
});
