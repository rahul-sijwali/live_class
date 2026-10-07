/**
 * Image and animated GIF question views.
 *
 * Owns: an `<img>` sized from the asset's stored dimensions so layout is known before the
 * bytes arrive. GIFs are the same element; the browser keeps them animating.
 */

import { AppError, type PageSize, type Question } from '@live-class/shared';

import { type QuestionView } from './question-view.js';

/**
 * Renders a PNG/JPG (or GIF) question.
 */
export class ImageQuestionView implements QuestionView {
  private readonly question: Question;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch | null;
  private readonly getToken: (() => string | Promise<string>) | undefined;
  private image: HTMLImageElement | null = null;
  private objectUrl: string | null = null;

  /**
   * Creates the view.
   *
   * @param {Question} question - Question with an image or GIF asset.
   * @param {string} url - Absolute URL of the asset file.
   * @param {() => string | Promise<string>} [getToken] - Token source; when given, the
   *   image is fetched with a bearer header and shown through an object URL.
   * @param {typeof fetch} [fetchImpl] - Fetch implementation (injectable for tests).
   * @throws {AppError} If the question has no asset.
   */
  constructor(
    question: Question,
    url: string,
    getToken?: () => string | Promise<string>,
    fetchImpl?: typeof fetch,
  ) {
    if (!question.asset) {
      throw new AppError('VALIDATION', `Question ${question.id} has no asset to display`);
    }
    this.question = question;
    this.url = url;
    this.getToken = getToken;
    this.fetchImpl = fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  }

  /**
   * Inserts the image and resolves with its intrinsic size (known from the asset record,
   * so this never waits on the network).
   *
   * @param {HTMLElement} host - Element to render into.
   * @returns {Promise<PageSize>} Pixel size of the image.
   */
  async mount(host: HTMLElement): Promise<PageSize> {
    const size = this.question.asset?.pageSizes[0] ?? { width: 1, height: 1 };
    const image = document.createElement('img');
    image.alt = this.question.altText;
    image.decoding = 'async';
    image.draggable = false;
    image.style.display = 'block';
    image.style.width = '100%';
    image.style.height = 'auto';
    image.style.userSelect = 'none';
    image.width = size.width;
    image.height = size.height;
    this.image = image;
    host.appendChild(image);
    image.src = await this.resolveSource();
    return size;
  }

  /**
   * Removes the image and revokes any object URL.
   *
   * @returns {void} Nothing.
   */
  dispose(): void {
    this.image?.remove();
    this.image = null;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  /**
   * Fetches the bytes with a bearer token when one is available; otherwise uses the URL.
   *
   * @returns {Promise<string>} A URL assignable to `img.src`.
   */
  private async resolveSource(): Promise<string> {
    if (!this.getToken || !this.fetchImpl) return this.url;
    const token = await this.getToken();
    const response = await this.fetchImpl(this.url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new AppError('NETWORK', `Could not load image (${response.status})`);
    }
    const blob = await response.blob();
    this.objectUrl = URL.createObjectURL(blob);
    return this.objectUrl;
  }
}
