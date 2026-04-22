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

async function acceptNextDialogs(page, expectedCount) {
  const messages = [];

  await new Promise((resolve) => {
    function onDialog(dialog) {
      messages.push(dialog.message());
      dialog.accept().then(() => {
        if (messages.length >= expectedCount) {
          page.off('dialog', onDialog);
          resolve();
        }
      });
    }

    page.on('dialog', onDialog);
  });

  return messages;
}

test('관리자가 그룹의 이후 일정 삭제 흐름으로 생성한 미래 일정 범위를 정리할 수 있다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const today = new Date();
  const rangeStart = formatYmd(addDays(today, 900));
  const rangeEnd = formatYmd(addDays(today, 930));

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '반 관리');

  const groupRow = getGroupRow(page, TEST_GROUP_NAME);
  await expect(groupRow).toBeVisible();
  await groupRow.click();

  await expect(getRegisteredStudentsHeading(page, TEST_GROUP_NAME)).toBeVisible();
  await expect(page.getByRole('heading', { name: '수업 일정' })).toBeVisible();

  const lessonTable = page.getByTestId('group-lessons-section').locator('.activity-table').last();

  await expect(lessonTable).toBeVisible();

  const lessonRows = lessonTable.getByTestId('group-lesson-row');

  async function countLessonsInRange() {
    return lessonRows.evaluateAll((rows, { start, end }) => {
      return rows.filter((row) => {
        const dateText = row.getAttribute('data-lesson-date') || '';
        return dateText >= start && dateText <= end;
      }).length;
    }, { start: rangeStart, end: rangeEnd });
  }

  await expect
    .poll(countLessonsInRange, { timeout: 5000 })
    .toBe(0);

  await page.getByRole('button', { name: '추가 일정 생성', exact: true }).click();

  const createDialog = page.getByRole('dialog', { name: '추가 일정 생성' });
  await expect(createDialog).toBeVisible();
  await expect(createDialog).toContainText(TEST_GROUP_NAME);

  await createDialog.getByLabel('시작일').fill(rangeStart);
  await createDialog.getByLabel('종료일').fill(rangeEnd);

  const createDialogHandled = acceptNextDialogs(page, 1);
  await createDialog.getByRole('button', { name: '일정 생성', exact: true }).click();
  const createMessages = await createDialogHandled;

  expect(createMessages[0]).toContain('추가 일정 생성 완료');
  await expect(createDialog).toBeHidden();

  await expect
    .poll(countLessonsInRange, { timeout: 10000 })
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: '이후 일정 삭제', exact: true }).click();

  const purgeDialog = page.getByRole('dialog', { name: '이후 일정 삭제' });
  await expect(purgeDialog).toBeVisible();
  await expect(purgeDialog).toContainText(TEST_GROUP_NAME);

  await purgeDialog.getByLabel('삭제 기준일').fill(rangeStart);

  const purgeDialogsHandled = acceptNextDialogs(page, 2);
  await purgeDialog.getByRole('button', { name: '삭제 실행', exact: true }).click();
  const purgeMessages = await purgeDialogsHandled;

  expect(purgeMessages[0]).toContain(`기준일 ${rangeStart} 이후`);
  expect(purgeMessages[1]).toContain('기준일 이후(포함) 그룹 수업 일정 삭제 완료');
  await expect(purgeDialog).toBeHidden();

  await expect
    .poll(countLessonsInRange, { timeout: 10000 })
    .toBe(0);
});
