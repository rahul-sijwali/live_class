/**
 * PDF page question view, rendered with pdf.js into a canvas.
 *
 * Owns: lazy-loading pdf.js, fetching the document with the bearer token, rendering one
 * page at the current scale × DPR, and re-rendering when the scale changes. The page size
 * comes from the asset record so layout never waits for the download.
 *
 * Setup contract: the host must call `configurePdf({ workerSrc })` once with a URL that
 * serves `pdfjs-dist/build/pdf.worker.min.mjs`; without it pdf.js cannot start its worker.
 */

import { AppError, type PageSize, type Question } from '@live-class/shared';

import { type QuestionView } from './question-view.js';

/** Global pdf.js configuration provided by the host application. */
let workerSrc: string | null = null;

/**
 * Configures pdf.js. Call once at application start-up.
 *
 * @param {{ workerSrc: string }} options - URL of the pdf.js worker script.
 * @returns {void} Nothing.
 */
export function configurePdf(options: { readonly workerSrc: string }): void {
  workerSrc = options.workerSrc;
}

/** Subset of pdf.js we rely on, so the module can be mocked in tests. */
export interface PdfLibrary {
  /** Global worker settings; `workerSrc` must point at the worker script. */
  GlobalWorkerOptions: { workerSrc: string };
  /**
   * Starts parsing a PDF held in memory.
   *
   * @param {{ data: ArrayBuffer }} params - The PDF bytes.
   * @returns {{ promise: Promise<PdfDocument> }} Loading task whose promise yields the document.
   */
  getDocument(params: { data: ArrayBuffer }): { promise: Promise<PdfDocument> };
}

/** Subset of `PDFDocumentProxy`. */
export interface PdfDocument {
  /** Total number of pages in the file. */
  numPages: number;
  /**
   * Loads one page.
   *
   * @param {number} pageNumber - One-based page number.
   * @returns {Promise<PdfPage>} The page proxy.
   */
  getPage(pageNumber: number): Promise<PdfPage>;
  /**
   * Frees the parsed document and its worker resources.
   *
   * @returns {Promise<void>} Resolves when cleanup is done.
   */
  destroy(): Promise<void>;
}

/** Subset of `PDFPageProxy`. */
export interface PdfPage {
  /**
   * Computes the rendered size of the page at a scale.
   *
   * @param {{ scale: number }} params - Device pixels per PDF point.
   * @returns {{ width: number; height: number }} Size in device pixels.
   */
  getViewport(params: { scale: number }): { width: number; height: number };
  /**
   * Paints the page into a canvas.
   *
   * @param {{ canvas: HTMLCanvasElement; viewport: { width: number; height: number } }} params - Target canvas and viewport.
   * @returns {{ promise: Promise<void>; cancel(): void }} Render task that can be cancelled.
   */
  render(params: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }): {
    promise: Promise<void>;
    cancel(): void;
  };
}

/** Loader for the pdf.js module; injectable for tests. */
export type PdfLoader = () => Promise<PdfLibrary>;

/**
 * Default loader: dynamic import so the bundle only pays for pdf.js when a PDF is opened.
 *
 * @returns {Promise<PdfLibrary>} The pdf.js module.
 */
const defaultLoader: PdfLoader = async () => {
  const module = await import('pdfjs-dist');
  return module as unknown as PdfLibrary;
};

/**
 * Renders one page of a PDF question.
 */
export class PdfPageQuestionView implements QuestionView {
  private readonly question: Question;
  private readonly url: string;
  private readonly pageIndex: number;
  private readonly getToken: (() => string | Promise<string>) | undefined;
  private readonly load: PdfLoader;
  private readonly fetchImpl: typeof fetch;
  private canvas: HTMLCanvasElement | null = null;
  private document: PdfDocument | null = null;
  private page: PdfPage | null = null;
  private renderTask: { promise: Promise<void>; cancel(): void } | null = null;
  private scale = 1;
  private dpr = 1;
  private disposed = false;

  /**
   * Creates the view.
   *
   * @param {Question} question - Question of kind `pdf`.
   * @param {string} url - Absolute URL of the PDF file.
   * @param {number} pageIndex - Zero-based page to show.
   * @param {() => string | Promise<string>} [getToken] - Bearer token source for the fetch.
   * @param {PdfLoader} [load] - pdf.js loader (injectable for tests).
   * @param {typeof fetch} [fetchImpl] - Fetch implementation (injectable for tests).
   * @throws {AppError} If the question has no asset or the page is out of range.
   */
  constructor(
    question: Question,
    url: string,
    pageIndex: number,
    getToken?: () => string | Promise<string>,
    load: PdfLoader = defaultLoader,
    fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {
    if (!question.asset) {
      throw new AppError('VALIDATION', `Question ${question.id} has no asset to display`);
    }
    if (pageIndex < 0 || pageIndex >= question.asset.pageSizes.length) {
      throw new AppError('VALIDATION', `Page ${pageIndex} is out of range for ${question.id}`);
    }
    this.question = question;
    this.url = url;
    this.pageIndex = pageIndex;
    this.getToken = getToken;
    this.load = load;
    this.fetchImpl = fetchImpl;
  }

  /**
   * Inserts the canvas, starts loading the PDF in the background and resolves with the
   * page size from the asset record.
   *
   * @param {HTMLElement} host - Element to render into.
   * @returns {Promise<PageSize>} Page size in PDF points.
   * @throws {AppError} If `configurePdf` was never called.
   */
  mount(host: HTMLElement): Promise<PageSize> {
    if (!workerSrc) {
      return Promise.reject(
        new AppError(
          'INTERNAL',
          'PDF rendering is not configured: call configurePdf({ workerSrc }) at start-up',
        ),
      );
    }
    const size = this.question.asset?.pageSizes[this.pageIndex] ?? { width: 1, height: 1 };
    const canvas = document.createElement('canvas');
    canvas.className = 'lc-question-pdf';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', this.question.altText);
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    this.canvas = canvas;
    host.appendChild(canvas);
    void this.loadAndRender(size);
    return Promise.resolve(size);
  }

  /**
   * Re-renders at a new scale so the page stays sharp.
   *
   * @param {number} scale - CSS pixels per sheet unit.
   * @param {number} dpr - Device pixel ratio.
   * @returns {void} Nothing.
   */
  onScaleChange(scale: number, dpr: number): void {
    this.scale = scale;
    this.dpr = dpr;
    void this.renderPage();
  }

  /**
   * Cancels rendering and frees the document.
   *
   * @returns {void} Nothing.
   */
  dispose(): void {
    this.disposed = true;
    this.renderTask?.cancel();
    this.renderTask = null;
    this.canvas?.remove();
    this.canvas = null;
    const document = this.document;
    this.document = null;
    this.page = null;
    if (document) void document.destroy().catch(() => undefined);
  }

  /**
   * Downloads and parses the PDF, then renders the page.
   *
   * @param {PageSize} size - Expected page size for the first paint.
   * @returns {Promise<void>} Resolves when the first render completes or the view is gone.
   */
  private async loadAndRender(size: PageSize): Promise<void> {
    try {
      const pdf = await this.load();
      if (pdf.GlobalWorkerOptions.workerSrc !== workerSrc && workerSrc) {
        pdf.GlobalWorkerOptions.workerSrc = workerSrc;
      }
      const headers: Record<string, string> = {};
      if (this.getToken) headers['Authorization'] = `Bearer ${await this.getToken()}`;
      const response = await this.fetchImpl(this.url, { headers });
      if (!response.ok) throw new AppError('NETWORK', `Could not load PDF (${response.status})`);
      const data = await response.arrayBuffer();
      if (this.isDisposed()) return;
      this.document = await pdf.getDocument({ data }).promise;
      if (this.isDisposed()) {
        await this.document.destroy();
        return;
      }
      this.page = await this.document.getPage(this.pageIndex + 1);
      if (this.canvas) {
        this.canvas.width = Math.max(1, Math.round(size.width));
        this.canvas.height = Math.max(1, Math.round(size.height));
      }
      await this.renderPage();
    } catch (error) {
      if (!this.disposed) console.error('PDF question failed to render', error);
    }
  }

  /**
   * Whether `dispose()` has run; a method so control flow does not assume the value is
   * unchanged across an `await`.
   *
   * @returns {boolean} True after disposal.
   */
  private isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Renders the current page at the current scale, cancelling any render in flight.
   *
   * @returns {Promise<void>} Resolves when rendering finishes or is cancelled.
   */
  private async renderPage(): Promise<void> {
    const { page, canvas } = this;
    if (!page || !canvas || this.disposed) return;
    this.renderTask?.cancel();
    const base = page.getViewport({ scale: 1 });
    // Device pixels per PDF point: the page is displayed LOGICAL_WIDTH units wide.
    const wanted = (1000 / base.width) * this.scale * this.dpr;
    const pixelsPerPoint = Number.isFinite(wanted) && wanted > 0 ? wanted : 1;
    const viewport = page.getViewport({ scale: pixelsPerPoint });
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const task = page.render({ canvas, viewport });
    this.renderTask = task;
    try {
      await task.promise;
    } catch {
      // Cancelled by a newer render; nothing to do.
    } finally {
      if (this.renderTask === task) this.renderTask = null;
    }
  }
}
