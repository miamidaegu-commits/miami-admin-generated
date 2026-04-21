import { test, expect } from '@playwright/test';
import { loginAsAdmin, openDashboardSection } from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TEST_GROUP_NAME,
} from './fixtures/test-data.js';

test('캘린더에서 그룹 수업 row를 클릭하면 출결/차감 모달이 열린다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '캘린더');

  await page.getByRole('button', { name: '전체 보기' }).click();

  const groupLessonRow = page
    .locator(
      `[data-testid="calendar-lesson-row"][data-row-kind="group"][data-group-name="${TEST_GROUP_NAME}"]`
    )
    .first();

  await expect(groupLessonRow).toBeVisible();
  await groupLessonRow.click();

  const attendanceDialog = page.getByRole('dialog', { name: /출결\s*\/\s*차감/ });
  await expect(attendanceDialog).toBeVisible();
  await expect(attendanceDialog.getByRole('heading', { name: /출결\s*\/\s*차감/ })).toBeVisible();
  await expect(attendanceDialog).toContainText(TEST_GROUP_NAME);
});
