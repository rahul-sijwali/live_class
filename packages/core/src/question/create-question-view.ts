/**
 * Chooses the right view for a question kind.
 *
 * Owns: the kind → class mapping. Keeping it separate from the classes lets the sheet
 * controller take a factory, so tests can substitute a fake view.
 */

import { AppError } from '@live-class/shared';

import { ImageQuestionView } from './image-view.js';
import { PdfPageQuestionView } from './pdf-page-view.js';
import { type QuestionView, type QuestionViewInput } from './question-view.js';
import { TextQuestionView } from './text-view.js';

/**
 * Creates a `QuestionView` for the question's kind.
 *
 * @param {QuestionViewInput} input - Question, page, asset URL and token source.
 * @returns {QuestionView} A view ready to `mount()`.
 * @throws {AppError} If a media question has no asset URL.
 */
export function createQuestionView(input: QuestionViewInput): QuestionView {
  const { question, pageIndex, assetUrl, getToken } = input;
  switch (question.kind) {
    case 'text':
      return new TextQuestionView(question);
    case 'image':
    case 'gif':
      if (!assetUrl) throw new AppError('VALIDATION', `Question ${question.id} has no asset URL`);
      return new ImageQuestionView(question, assetUrl, getToken);
    case 'pdf':
      if (!assetUrl) throw new AppError('VALIDATION', `Question ${question.id} has no asset URL`);
      return new PdfPageQuestionView(question, assetUrl, pageIndex, getToken);
  }
}
