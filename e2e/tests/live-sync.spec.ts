import { expect, test } from '@playwright/test';

import { createSessionWithQuestion, signIn } from './helpers.js';

test.describe('live class between a mentor and a student', () => {
  test('mentor opens a question and ink reaches the student', async ({ browser }) => {
    const { sessionId } = await createSessionWithQuestion('E2E algebra');
    const mentorContext = await browser.newContext();
    const studentContext = await browser.newContext();
    const mentor = await mentorContext.newPage();
    const student = await studentContext.newPage();

    await signIn(mentor, 'mentor');
    await signIn(student, 'student');
    await mentor.goto(`/room/?session=${sessionId}`);
    await student.goto(`/room/?session=${sessionId}`);

    await expect(mentor.getByRole('heading', { name: 'E2E algebra' })).toBeVisible();
    await expect(student.getByRole('heading', { name: 'E2E algebra' })).toBeVisible();
    await expect(student.getByText(/Waiting for the mentor/)).toBeVisible();

    // Both see each other through presence.
    await expect(mentor.getByText(/Student Ben \(student\)/)).toBeVisible();
    await expect(student.getByText(/Mentor Asha \(mentor\)/)).toBeVisible();

    // The mentor opens the planned question; the sheet appears for both.
    await mentor.getByRole('button', { name: 'Open' }).first().click();
    const mentorStage = mentor.getByTestId('lc-sheet-stage');
    const studentStage = student.getByTestId('lc-sheet-stage');
    await expect(mentorStage).toBeVisible();
    await expect(studentStage).toBeVisible();
    await expect(mentor.getByRole('tab', { name: /Solve for x/ })).toBeVisible();
    await expect(student.getByRole('tab', { name: /Solve for x/ })).toBeVisible();
    await expect(student.locator('.lc-question-text .katex').first()).toBeVisible();

    // The mentor draws a stroke on the live canvas.
    const canvas = mentorStage.locator('canvas.lc-ink-live');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no size');
    const startX = box.x + box.width * 0.3;
    const startY = box.y + 80;
    await mentor.mouse.move(startX, startY);
    await mentor.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await mentor.mouse.move(startX + i * 15, startY + i * 6);
    }
    await mentor.mouse.up();

    await expect(mentorStage).toHaveAttribute('data-stroke-count', '1');
    await expect(studentStage).toHaveAttribute('data-stroke-count', '1');

    // Undo on the mentor side removes it for both.
    await mentor.getByRole('button', { name: 'Undo' }).click();
    await expect(mentorStage).toHaveAttribute('data-stroke-count', '0');
    await expect(studentStage).toHaveAttribute('data-stroke-count', '0');

    await mentorContext.close();
    await studentContext.close();
  });

  test('student cannot write while the mentor has locked writing', async ({ browser }) => {
    const { sessionId } = await createSessionWithQuestion('E2E locked');
    const mentorContext = await browser.newContext();
    const studentContext = await browser.newContext();
    const mentor = await mentorContext.newPage();
    const student = await studentContext.newPage();
    await signIn(mentor, 'mentor');
    await signIn(student, 'student');
    await mentor.goto(`/room/?session=${sessionId}`);
    await student.goto(`/room/?session=${sessionId}`);
    await mentor.getByRole('button', { name: 'Open' }).first().click();
    const studentStage = student.getByTestId('lc-sheet-stage');
    await expect(studentStage).toBeVisible();

    await mentor.getByLabel('Student can write').uncheck();
    await expect(student.getByRole('button', { name: 'pen' })).toBeDisabled();

    await mentor.getByLabel('Student can write').check();
    await expect(student.getByRole('button', { name: 'pen' })).toBeEnabled();

    await mentorContext.close();
    await studentContext.close();
  });
});
