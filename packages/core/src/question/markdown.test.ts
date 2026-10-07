import { describe, expect, it } from 'vitest';

import { renderMarkdownWithMath } from './markdown.js';
import { renderMarkdownWithMathSync } from './markdown-renderer.js';

describe('renderMarkdownWithMath', () => {
  it('renders Markdown and inline maths', async () => {
    const html = await renderMarkdownWithMath('Solve **this**: $x^2 - 4 = 0$');
    expect(html).toContain('<strong>this</strong>');
    expect(html).toContain('class="katex"');
  });

  it('renders display maths blocks', () => {
    const html = renderMarkdownWithMathSync('$$\n\\int_0^1 x\\,dx\n$$');
    expect(html).toContain('katex-display');
  });

  /**
   * Parses rendered HTML and returns every element with its attribute names.
   *
   * @param {string} html - Rendered HTML.
   * @returns {{ tags: string[]; attributes: string[] }} Lower-case tag and attribute names.
   */
  function inspect(html: string) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const elements = Array.from(doc.body.querySelectorAll('*'));
    return {
      tags: elements.map((el) => el.tagName.toLowerCase()),
      attributes: elements.flatMap((el) =>
        Array.from(el.attributes).map((a) => a.name.toLowerCase()),
      ),
    };
  }

  it('strips script, images, event handlers and links', () => {
    const { tags, attributes } = inspect(
      renderMarkdownWithMathSync(
        '<script>alert(1)</script><img src=x onerror=alert(1)> [click](javascript:alert(1)) <a href="https://x">x</a>',
      ),
    );
    expect(tags).not.toContain('script');
    expect(tags).not.toContain('img');
    expect(tags).not.toContain('a');
    expect(attributes.some((name) => name.startsWith('on'))).toBe(false);
    expect(attributes).not.toContain('href');
    expect(attributes).not.toContain('src');
  });

  it('does not throw on invalid LaTeX', () => {
    const html = renderMarkdownWithMathSync('$\\frac{1}$ and $\\unknowncommand$');
    expect(typeof html).toBe('string');
    expect(inspect(html).tags).not.toContain('script');
  });

  it('refuses KaTeX trust features such as \\href', () => {
    const { tags, attributes } = inspect(
      renderMarkdownWithMathSync('$\\href{javascript:alert(1)}{x}$'),
    );
    expect(tags).not.toContain('a');
    expect(attributes).not.toContain('href');
  });
});
