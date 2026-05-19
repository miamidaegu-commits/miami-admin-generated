import { expect, test } from '@playwright/test';
import { loginAsAdmin, openDashboardSection } from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TEST_PRIVATE_LESSON_STUDENT_NAME,
} from './fixtures/test-data.js';

test.setTimeout(90000);

async function collectPrivateEditDiagnostics(page, privateLessonRow) {
  const [currentUrl, rowText, dialogText, bodyText] = await Promise.all([
    Promise.resolve(page.url()).catch((error) => `url unavailable: ${error?.message || String(error)}`),
    privateLessonRow
      .innerText({ timeout: 1000 })
      .catch((error) => `row unavailable: ${error?.message || String(error)}`),
    page
      .getByRole('dialog', { name: '개인 수업 수정' })
      .innerText({ timeout: 1000 })
      .catch((error) => `dialog unavailable: ${error?.message || String(error)}`),
    page
      .locator('body')
      .innerText({ timeout: 1000 })
      .catch((error) => `body unavailable: ${error?.message || String(error)}`),
  ]);

  return {
    currentUrl,
    rowText: String(rowText || '').slice(0, 2000),
    dialogText: String(dialogText || '').slice(0, 2000),
    bodyText: String(bodyText || '').slice(0, 3000),
  };
}

test('admin can save a private lesson subject change and restore it', async ({
  page,
  browserName,
}, testInfo) => {
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
    await expect(privateLessonRow).toBeVisible({ timeout: 15000 });
    const editButton = privateLessonRow.getByRole('button', { name: '수정', exact: true });
    await expect(editButton).toBeEnabled({ timeout: 15000 });
    await editButton.dispatchEvent('click');

    const editDialog = page.getByRole('dialog', { name: '개인 수업 수정' });
    await expect(editDialog).toBeVisible({ timeout: 15000 });
    return editDialog;
  }

  async function saveSubject(subject) {
    const editDialog = await openEditDialog();
    const subjectInput = editDialog.getByLabel('과목');
    await expect(subjectInput).toBeVisible();
    await subjectInput.fill(subject);
    await submitEditDialog(editDialog);
  }

  async function submitEditDialog(editDialog) {
    const saveButton = editDialog.getByRole('button', { name: '저장', exact: true });
    await expect(saveButton).toBeEnabled({ timeout: 15000 });
    await saveButton.dispatchEvent('click');
    await expect(editDialog).toBeHidden({ timeout: 15000 });
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
    await submitEditDialog(editDialog);

    shouldRestore = true;
    await expect(privateLessonRow).toContainText(tempSubject, { timeout: 15000 });

    const restoreDialog = await openEditDialog();
    await expect(restoreDialog.getByLabel('과목')).toHaveValue(tempSubject);
    await restoreDialog.getByLabel('과목').fill(originalSubject);
    await submitEditDialog(restoreDialog);

    shouldRestore = false;
    await expect(privateLessonRow).toContainText(originalSubject, { timeout: 15000 });
  } catch (error) {
    await testInfo.attach('private-lesson-edit-save-diagnostics', {
      body: JSON.stringify(await collectPrivateEditDiagnostics(page, privateLessonRow), null, 2),
      contentType: 'application/json',
    });
    throw error;
  } finally {
    if (!shouldRestore || !originalSubject) return;

    await saveSubject(originalSubject);
    await expect(privateLessonRow).toContainText(originalSubject, { timeout: 15000 });
  }
});
