import { asAssetId, asQuestionId, asUserId, newId, type Question } from '@live-class/shared';
import { describe, expect, it, vi } from 'vitest';

import { createQuestionView } from './create-question-view.js';
import { ImageQuestionView } from './image-view.js';
import { configurePdf, PdfPageQuestionView, type PdfLibrary } from './pdf-page-view.js';
import { TextQuestionView } from './text-view.js';

/**
 * Builds a question for tests.
 *
 * @param {Partial<Question>} overrides - Fields to change.
 * @returns {Question} A text question by default.
 */
function question(overrides: Partial<Question> = {}): Question {
  return {
    id: asQuestionId(newId()),
    kind: 'text',
    title: 'Q',
    altText: 'A question',
    tags: [],
    textMarkdown: 'Solve $x$',
    asset: null,
    pageCount: 1,
    createdBy: asUserId(newId()),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const asset = {
  id: asAssetId(newId()),
  mime: 'image/png' as const,
  bytes: 10,
  pageSizes: [{ width: 1600, height: 900 }],
  sha256: 'a'.repeat(64),
  url: '/assets/x/file',
  thumbnailUrl: null,
  createdAt: new Date().toISOString(),
};

describe('TextQuestionView', () => {
  it('renders sanitised Markdown at the logical width and measures it', async () => {
    const view = new TextQuestionView(question());
    const host = document.createElement('div');
    const size = await view.mount(host);
    expect(size.width).toBe(1000);
    expect(size.height).toBeGreaterThanOrEqual(1);
    expect(host.querySelector('.lc-question-text')?.getAttribute('aria-label')).toBe('A question');
    view.dispose();
    expect(host.children).toHaveLength(0);
  });

  it('rejects a question without text', () => {
    expect(() => new TextQuestionView(question({ textMarkdown: null }))).toThrow();
  });
});

describe('ImageQuestionView', () => {
  it('uses the stored size and sets alt text', async () => {
    const view = new ImageQuestionView(question({ kind: 'image', asset }), 'https://api/x');
    const host = document.createElement('div');
    const size = await view.mount(host);
    expect(size).toEqual({ width: 1600, height: 900 });
    const img = host.querySelector('img');
    expect(img?.alt).toBe('A question');
    expect(img?.getAttribute('src')).toBe('https://api/x');
    view.dispose();
  });

  it('fetches with a bearer token when a token source is given', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(new Blob(['x']), { status: 200 })),
    ) as unknown as typeof fetch;
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const view = new ImageQuestionView(
      question({ kind: 'image', asset }),
      'https://api/x',
      () => 'tok',
      fetchImpl,
    );
    const host = document.createElement('div');
    await view.mount(host);
    const call = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0];
    expect(new Headers(call?.[1]?.headers).get('Authorization')).toBe('Bearer tok');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:fake');
    view.dispose();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('rejects a question without an asset', () => {
    expect(() => new ImageQuestionView(question({ kind: 'image' }), 'u')).toThrow();
  });
});

describe('PdfPageQuestionView', () => {
  const pdfAsset = {
    ...asset,
    mime: 'application/pdf' as const,
    pageSizes: [{ width: 612, height: 792 }],
  };

  it('requires configuration before mounting', async () => {
    const view = new PdfPageQuestionView(
      question({ kind: 'pdf', asset: pdfAsset }),
      'u',
      0,
      undefined,
      () => Promise.reject(new Error('should not load')),
    );
    await expect(view.mount(document.createElement('div'))).rejects.toThrow(/configurePdf/);
    view.dispose();
  });

  it('renders the requested page through pdf.js at the current scale', async () => {
    configurePdf({ workerSrc: '/pdf.worker.js' });
    const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
      render,
    };
    const getPage = vi.fn(() => Promise.resolve(page));
    const destroy = vi.fn(() => Promise.resolve());
    const lib: PdfLibrary = {
      GlobalWorkerOptions: { workerSrc: '' },
      getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage, destroy }) }),
    };
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 })),
    ) as unknown as typeof fetch;
    const view = new PdfPageQuestionView(
      question({ kind: 'pdf', asset: pdfAsset }),
      'https://api/pdf',
      0,
      () => 'tok',
      () => Promise.resolve(lib),
      fetchImpl,
    );
    const host = document.createElement('div');
    const size = await view.mount(host);
    expect(size).toEqual({ width: 612, height: 792 });
    await vi.waitFor(() => {
      expect(render).toHaveBeenCalled();
    });
    expect(lib.GlobalWorkerOptions.workerSrc).toBe('/pdf.worker.js');
    expect(getPage).toHaveBeenCalledWith(1);
    view.onScaleChange(0.5, 2);
    await vi.waitFor(() => {
      expect(render).toHaveBeenCalledTimes(2);
    });
    view.dispose();
    expect(destroy).toHaveBeenCalled();
  });

  it('rejects an out-of-range page', () => {
    expect(
      () => new PdfPageQuestionView(question({ kind: 'pdf', asset: pdfAsset }), 'u', 3),
    ).toThrow();
  });
});

describe('createQuestionView', () => {
  it('picks the view by kind and requires asset URLs for media', () => {
    expect(
      createQuestionView({ question: question(), pageIndex: 0, assetUrl: null }),
    ).toBeInstanceOf(TextQuestionView);
    expect(
      createQuestionView({
        question: question({ kind: 'gif', asset }),
        pageIndex: 0,
        assetUrl: 'u',
      }),
    ).toBeInstanceOf(ImageQuestionView);
    expect(() =>
      createQuestionView({
        question: question({ kind: 'image', asset }),
        pageIndex: 0,
        assetUrl: null,
      }),
    ).toThrow();
  });
});
