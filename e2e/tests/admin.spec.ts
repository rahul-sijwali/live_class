import { expect, test } from '@playwright/test';

import { signInViaForm } from './helpers.js';

test.describe('admin screens', () => {
  test('admin creates a session, adds participants and a text question', async ({ page }) => {
    await signInViaForm(page, 'admin');
    await page.goto('/admin/');
    await expect(page.getByRole('heading', { name: 'Sessions', level: 1 })).toBeVisible();

    const title = `Admin flow ${Date.now()}`;
    await page.getByLabel('Session title').fill(title);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();

    await page.getByLabel('Add mentor').selectOption({ label: 'Mentor Asha' });
    await expect(page.getByText(/Mentor Asha \(mentor\)/)).toBeVisible();
    await page.getByLabel('Add student').selectOption({ label: 'Student Ben' });
    await expect(page.getByText(/Student Ben \(student\)/)).toBeVisible();

    const form = page.getByRole('form', { name: 'Add a question' });
    await form.getByLabel('Type text with maths').check();
    await form.getByLabel(/Markdown/).fill('What is $\\sqrt{16}$?');
    await form.getByLabel('Title', { exact: true }).fill('Square roots');
    await form
      .getByLabel('Description for screen readers')
      .fill('What is the square root of sixteen');
    await form.getByLabel(/Tags/).fill('arithmetic, e2e');
    await form.getByRole('button', { name: 'Add to bank' }).click();
    await expect(
      page.getByRole('list', { name: 'Questions' }).getByText('Square roots').first(),
    ).toBeVisible();
  });
});
