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
const YMD_REGEX_SOURCE = '\\b\\d{4}-\\d{2}-\\d{2}\\b';

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

test('관리자가 특정 그룹의 미래 일정을 실제로 생성한다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const today = new Date();
  const rangeStart = formatYmd(addDays(today, 400));
  const rangeEnd = formatYmd(addDays(today, 430));

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '반 관리');

  const groupRow = getGroupRow(page, TEST_GROUP_NAME);
  await expect(groupRow).toBeVisible();
  await groupRow.click();

  await expect(getRegisteredStudentsHeading(page, TEST_GROUP_NAME)).toBeVisible();
  await expect(page.getByRole('heading', { name: '수업 일정' })).toBeVisible();

  await page.getByRole('button', { name: '추가 일정 생성' }).click();

  const seriesDialog = page.getByRole('dialog', { name: '추가 일정 생성' });
  await expect(seriesDialog).toBeVisible();
  await expect(seriesDialog).toContainText(TEST_GROUP_NAME);

  await seriesDialog.getByLabel('시작일').fill(rangeStart);
  await seriesDialog.getByLabel('종료일').fill(rangeEnd);

  const createButton = seriesDialog.getByRole('button', { name: '일정 생성' });
  await expect(createButton).toBeEnabled();
  let dialogMessage = '';
  const dialogHandled = new Promise((resolve) => {
    page.once('dialog', async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.accept();
      resolve();
    });
  });

  await Promise.all([dialogHandled, createButton.click()]);

  expect(dialogMessage).toContain('추가 일정 생성 완료');
  await expect(seriesDialog).toBeHidden();

  const lessonSection = page.getByTestId('group-lessons-section').locator('..');

  // 취약한 selector: 일정 row는 현재 class 기반입니다.
  // 가능하면 `data-testid="group-lesson-row"`를 추가하세요.
  const lessonRows = lessonSection.locator('.table-row');
  await expect(lessonRows.first()).toBeVisible();

  await expect
    .poll(async () => {
      const lessonSectionText = (await lessonSection.textContent()) || '';
      const lessonDates = lessonSectionText.match(/\d{4}-\d{2}-\d{2}/g) || [];

      return lessonDates.filter((date) => date >= rangeStart && date <= rangeEnd).length;
    }, { timeout: 10000 })
    .toBeGreaterThan(0);
});
