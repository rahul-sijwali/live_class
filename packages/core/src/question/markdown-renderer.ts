/**
 * Markdown + LaTeX rendering for text questions, sanitised before it touches the DOM.
 *
 * Loaded lazily through `./markdown.js` so KaTeX and markdown-it (about 100 kB) are only
 * downloaded when a text question is shown (CLAUDE.md §9 size budget).
 *
 * Owns: the markdown-it pipeline with the KaTeX plugin and the DOMPurify allowlist.
 * Security notes (CLAUDE.md §8): raw HTML in the Markdown is disabled, KaTeX runs with
 * `trust: false` and expansion limits, and the final HTML passes through DOMPurify, so a
 * malicious question author cannot run script in a participant's browser.
 */

import DOMPurify from 'dompurify';
import katexPlugin from '@vscode/markdown-it-katex';
import katex from 'katex';
import MarkdownIt from 'markdown-it';

/** The configured markdown-it instance (created once per module). */
const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: false,
});

/**
 * KaTeX wrapped with hardening options. The plugin calls `renderToString`; we intercept it
 * to force `trust: false` and expansion limits regardless of plugin defaults.
 */
const hardenedKatex: typeof katex = {
  ...katex,
  renderToString(expression: string, options?: katex.KatexOptions): string {
    return katex.renderToString(expression, {
      ...options,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      maxExpand: 1000,
      maxSize: 50,
      output: 'htmlAndMathml',
    });
  },
} as typeof katex;

/** Plugin options; the plugin ships its own (older) KaTeX typings, hence the cast. */
const katexPluginOptions = { throwOnError: false, katex: hardenedKatex };
markdown.use(
  katexPlugin as unknown as (
    md: typeof markdown,
    options: typeof katexPluginOptions,
  ) => typeof markdown,
  katexPluginOptions,
);

/** Tags DOMPurify may keep. KaTeX output needs MathML and `span`s with class/style. */
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'span',
  'div',
  'sup',
  'sub',
  'math',
  'semantics',
  'mrow',
  'mi',
  'mo',
  'mn',
  'ms',
  'mtext',
  'mspace',
  'msup',
  'msub',
  'msubsup',
  'mfrac',
  'mroot',
  'msqrt',
  'mtable',
  'mtr',
  'mtd',
  'mover',
  'munder',
  'munderover',
  'mpadded',
  'mphantom',
  'menclose',
  'mstyle',
  'annotation',
  'svg',
  'path',
  'line',
];

/** Attributes DOMPurify may keep. No `href`, `src` or event handlers. */
const ALLOWED_ATTR = [
  'class',
  'style',
  'aria-hidden',
  'aria-label',
  'role',
  'xmlns',
  'encoding',
  'mathvariant',
  'stretchy',
  'fence',
  'separator',
  'lspace',
  'rspace',
  'width',
  'height',
  'viewBox',
  'preserveAspectRatio',
  'd',
  'x1',
  'x2',
  'y1',
  'y2',
  'stroke-width',
  'columnalign',
  'rowspacing',
  'columnspacing',
  'scriptlevel',
  'displaystyle',
  'mathsize',
  'minsize',
  'maxsize',
  'accent',
  'movablelimits',
  'symmetric',
  'depth',
  'voffset',
  'lquote',
  'rquote',
];

/**
 * Renders question Markdown (with `$…$` and `$$…$$` maths) to sanitised HTML.
 *
 * @param {string} source - Markdown source written by the question author.
 * @returns {string} HTML that is safe to assign to `innerHTML`. Script, iframes, links,
 *   images and inline event handlers are removed.
 * @example
 *   renderMarkdownWithMath('Solve $x^2 - 4 = 0$') // => '<p>Solve <span class="katex">…</span></p>'
 */
export function renderMarkdownWithMathSync(source: string): string {
  const html = markdown.render(source);
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    USE_PROFILES: { html: true, mathMl: true, svg: true },
  });
}
