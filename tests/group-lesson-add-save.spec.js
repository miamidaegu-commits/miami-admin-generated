import { test, expect } from '@playwright/test';
import {
  getGroupRow,
  getRegisteredStudentsHeading,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TEST_GROUP_NAME,
} from './fixtures/test-data.js';

function formatYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(baseDate, days) {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + days);
  return next;
}

async function acceptNextDialog(page) {
  const dialogHandled = new Promise((resolve) => {
    page.once('dialog', async (dialog) => {
      await dialog.accept();
      resolve(dialog.message());
    });
  });

  return dialogHandled;
}

test('관리자가 그룹의 특별 수업을 추가한 뒤 삭제로 원복할 수 있다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const lessonDate = formatYmd(addDays(new Date(), 540));
  const lessonTime = '21:45';
  const lessonSubject = `E2E 특별수업 ${Date.now()}`;

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '반 관리');

  const groupRow = getGroupRow(page, TEST_GROUP_NAME);
  await expect(groupRow).toBeVisible();
  await groupRow.click();

  await expect(getRegisteredStudentsHeading(page, TEST_GROUP_NAME)).toBeVisible();

  const lessonSection = page.getByTestId('group-lessons-section').locator('..');
  await expect(lessonSection).toBeVisible();

  const targetLessonRow = lessonSection
    .locator('.table-row')
    .filter({ hasText: lessonDate })
    .filter({ hasText: lessonTime })
    .filter({ hasText: lessonSubject });

  await expect(targetLessonRow).toHaveCount(0);

  await page.getByRole('button', { name: '특별 수업 추가', exact: true }).click();

  const lessonDialog = page.getByRole('dialog', { name: '특별 수업 추가' });
  await expect(lessonDialog).toBeVisible();
  await expect(lessonDialog).toContainText(TEST_GROUP_NAME);

  await lessonDialog.getByLabel('날짜').fill(lessonDate);
  await lessonDialog.getByLabel('시간').fill(lessonTime);
  await lessonDialog.getByLabel('과목').fill(lessonSubject);

  const saveButton = lessonDialog.getByRole('button', { name: '저장', exact: true });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(lessonDialog).toBeHidden();

  let lessonCreated = false;

  try {
    await expect
      .poll(async () => await targetLessonRow.count(), { timeout: 10000 })
      .toBe(1);
    lessonCreated = true;

    await expect(targetLessonRow.first()).toBeVisible();

    const deleteDialogHandled = acceptNextDialog(page);
    await targetLessonRow.first().getByRole('button', { name: '삭제', exact: true }).click();
    await deleteDialogHandled;

    await expect
      .poll(async () => await targetLessonRow.count(), { timeout: 10000 })
      .toBe(0);
  } finally {
    if (!lessonCreated) return;

    const remainingCount = await targetLessonRow.count();
    if (remainingCount === 0) return;

    const cleanupDialogHandled = acceptNextDialog(page);
    await targetLessonRow.first().getByRole('button', { name: '삭제', exact: true }).click();
    await cleanupDialogHandled;

    await expect
      .poll(async () => await targetLessonRow.count(), { timeout: 10000 })
      .toBe(0);
  }
});
