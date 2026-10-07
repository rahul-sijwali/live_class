/**
 * Lazy entry point for Markdown + LaTeX rendering.
 *
 * Owns: loading `markdown-renderer.ts` (KaTeX, markdown-it, DOMPurify) on first use so the
 * main bundle stays small; image, GIF and PDF questions never pay for it.
 */

import type { renderMarkdownWithMathSync } from './markdown-renderer.js';

/** Shape of the lazily loaded renderer module. */
interface RendererModule {
  readonly renderMarkdownWithMathSync: typeof renderMarkdownWithMathSync;
}

/** The loaded renderer module, cached after the first import. */
let rendererPromise: Promise<RendererModule> | null = null;

/**
 * Renders question Markdown (with `$…$` and `$$…$$` maths) to sanitised HTML, loading the
 * renderer on first call.
 *
 * @param {string} source - Markdown source written by the question author.
 * @returns {Promise<string>} HTML that is safe to assign to `innerHTML`.
 */
export async function renderMarkdownWithMath(source: string): Promise<string> {
  rendererPromise ??= import('./markdown-renderer.js');
  const renderer = await rendererPromise;
  return renderer.renderMarkdownWithMathSync(source);
}
