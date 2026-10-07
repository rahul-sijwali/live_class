/**
 * Small helpers for uncontrolled forms.
 */

import { type SubmitEvent as ReactSubmitEvent } from 'react';

/** Submit event of a form element. */
export type FormSubmit = ReactSubmitEvent<HTMLFormElement>;

/**
 * Reads a text field from form data, trimmed. Files and missing fields read as `''`.
 *
 * @param {FormData} data - Entries captured from the submitted form element.
 * @param {string} name - The input's `name` attribute to look up.
 * @returns {string} The trimmed value or an empty string.
 */
export function field(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Reads a comma-separated tag field.
 *
 * @param {FormData} data - Entries captured from the submitted form element.
 * @param {string} name - The input's `name` attribute to look up.
 * @returns {string[]} Non-empty trimmed tags.
 */
export function tagField(data: FormData, name: string): string[] {
  return field(data, name)
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * Reads a file field.
 *
 * @param {FormData} data - Entries captured from the submitted form element.
 * @param {string} name - The input's `name` attribute to look up.
 * @returns {File | null} The file when one with content was chosen.
 */
export function fileField(data: FormData, name: string): File | null {
  const value = data.get(name);
  return value instanceof File && value.size > 0 ? value : null;
}
