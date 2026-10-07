/**
 * Text (Markdown + LaTeX) question view.
 *
 * Owns: rendering sanitised HTML into a block at `LOGICAL_WIDTH` and measuring its height.
 * The height is reported in sheet units because the block is laid out at the logical width
 * before CSS scaling (one CSS px of layout equals one sheet unit).
 */

import { AppError, LOGICAL_WIDTH, type PageSize, type Question } from '@live-class/shared';

import { renderMarkdownWithMath } from './markdown.js';
import { type QuestionView } from './question-view.js';

/** Horizontal padding inside the text block, in sheet units. */
export const TEXT_PADDING_UNITS = 32;

/**
 * Renders a Markdown question.
 */
export class TextQuestionView implements QuestionView {
  private readonly question: Question;
  private block: HTMLElement | null = null;

  /**
   * Creates the view.
   *
   * @param {Question} question - Question of kind `text`.
   * @throws {AppError} If the question has no Markdown.
   */
  constructor(question: Question) {
    if (question.textMarkdown === null) {
      throw new AppError('VALIDATION', `Question ${question.id} has no text to display`);
    }
    this.question = question;
  }

  /**
   * Renders the text and measures it.
   *
   * @param {HTMLElement} host - Element to render into.
   * @returns {Promise<PageSize>} `LOGICAL_WIDTH` by the rendered height in sheet units
   *   (at least 1).
   */
  async mount(host: HTMLElement): Promise<PageSize> {
    const block = document.createElement('div');
    block.className = 'lc-question-text';
    block.setAttribute('role', 'document');
    block.setAttribute('aria-label', this.question.altText);
    block.style.boxSizing = 'border-box';
    block.style.width = `${LOGICAL_WIDTH}px`;
    block.style.padding = `${TEXT_PADDING_UNITS}px`;
    block.style.fontSize = '28px';
    block.style.lineHeight = '1.5';
    block.style.overflowWrap = 'anywhere';
    block.innerHTML = await renderMarkdownWithMath(this.question.textMarkdown ?? '');
    this.block = block;
    host.appendChild(block);
    const measured = block.getBoundingClientRect().height || block.offsetHeight;
    return { width: LOGICAL_WIDTH, height: Math.max(1, measured) };
  }

  /**
   * Removes the block.
   *
   * @returns {void} Nothing.
   */
  dispose(): void {
    this.block?.remove();
    this.block = null;
  }
}
