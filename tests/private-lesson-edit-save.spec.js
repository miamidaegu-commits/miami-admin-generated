import { expect, test } from '@playwright/test';
import { loginAsAdmin, openDashboardSection } from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TEST_PRIVATE_LESSON_STUDENT_NAME,
} from './fixtures/test-data.js';

test('admin can save a private lesson subject change and restore it', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'This test is intended for chromium.');

  const tempSubject = `E2E 개인수업 과목 ${Date.now()}`;
  const privateLessonRow = page
    .locator(
      `[data-testid="calendar-lesson-row"][data-row-kind="private"][data-student-name="${TEST_PRIVATE_LESSON_STUDENT_NAME}"]`
    )
    .first();

  let originalSubject = '';
  let shouldRestore = false;

  async function openEditDialog() {
    await expect(privateLessonRow).toBeVisible();
    await privateLessonRow.getByRole('button', { name: '수정', exact: true }).click();

    const editDialog = page.getByRole('dialog', { name: '개인 수업 수정' });
    await expect(editDialog).toBeVisible();
    return editDialog;
  }

  async function saveSubject(subject) {
    const editDialog = await openEditDialog();
    const subjectInput = editDialog.getByLabel('과목');
    await expect(subjectInput).toBeVisible();
    await subjectInput.fill(subject);
    await editDialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(editDialog).toBeHidden();
  }

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '캘린더');

  const showAllButton = page.getByRole('button', { name: '전체 보기', exact: true });
  if (await showAllButton.isVisible().catch(() => false)) {
    await showAllButton.click();
  }

  try {
    const editDialog = await openEditDialog();
    await expect(editDialog.getByLabel('날짜')).toBeVisible();
    await expect(editDialog.getByLabel('시간')).toBeVisible();

    const subjectInput = editDialog.getByLabel('과목');
    originalSubject = await subjectInput.inputValue();
    await expect.soft(originalSubject.trim()).not.toBe('');

    await subjectInput.fill(tempSubject);
    await editDialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(editDialog).toBeHidden();

    shouldRestore = true;
    await expect(privateLessonRow).toContainText(tempSubject);

    const restoreDialog = await openEditDialog();
    await expect(restoreDialog.getByLabel('과목')).toHaveValue(tempSubject);
    await restoreDialog.getByLabel('과목').fill(originalSubject);
    await restoreDialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(restoreDialog).toBeHidden();

    shouldRestore = false;
    await expect(privateLessonRow).toContainText(originalSubject);
  } finally {
    if (!shouldRestore || !originalSubject) return;

    await saveSubject(originalSubject);
    await expect(privateLessonRow).toContainText(originalSubject);
  }
});
