import { expect, test } from '@playwright/test';
import { loginAsAdmin, openDashboardSection } from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TEST_PRIVATE_LESSON_STUDENT_NAME,
} from './fixtures/test-data.js';

test('admin can open an existing private lesson edit modal', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'This test is intended for chromium.');

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '캘린더');

  const showAllButton = page.getByRole('button', { name: '전체 보기', exact: true });
  if (await showAllButton.isVisible().catch(() => false)) {
    await showAllButton.click();
  }

  const privateLessonRow = page.locator(
    `[data-testid="calendar-lesson-row"][data-row-kind="private"][data-student-name="${TEST_PRIVATE_LESSON_STUDENT_NAME}"]`
  ).first();

  await expect(privateLessonRow).toBeVisible();
  await privateLessonRow.getByRole('button', { name: '수정', exact: true }).click();

  const editDialog = page.getByRole('dialog', { name: '개인 수업 수정' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByRole('heading', { name: '개인 수업 수정' })).toBeVisible();
  await expect(editDialog.getByLabel('날짜')).toBeVisible();
  await expect(editDialog.getByLabel('시간')).toBeVisible();
  await expect(editDialog.getByLabel('과목')).toBeVisible();
});
