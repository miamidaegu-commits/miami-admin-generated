import { expect, test } from '@playwright/test';
import { loginAsAdmin, openDashboardSection } from './e2e-helpers.js';
import {
  cleanupTempCalendarGroupLessonSetup,
  createTempCalendarGroupLessonSetup,
} from './e2e-firebase-helpers.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures/test-data.js';

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

test('캘린더에서 그룹 수업 row를 클릭하면 출결/차감 모달이 열린다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const uniqueToken = Date.now();
  const lessonDate = formatYmd(addDays(new Date(), 1));
  const tempGroupName = `E2E 캘린더 그룹 ${uniqueToken}`;
  const tempLessonSubject = `E2E 캘린더 과목 ${uniqueToken}`;
  const tempLessonTime = '09:00';

  let tempSetup = null;

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    tempSetup = await createTempCalendarGroupLessonSetup(page, {
      groupName: tempGroupName,
      lessonDate,
      lessonTime: tempLessonTime,
      lessonSubject: tempLessonSubject,
    });

    await openDashboardSection(page, '캘린더');

    const showAllButton = page.getByRole('button', { name: '전체 보기', exact: true });
    if (await showAllButton.isVisible().catch(() => false)) {
      await showAllButton.click();
    }

    const groupLessonRow = page.locator(
      `[data-testid="calendar-lesson-row"][data-row-kind="group"][data-group-name="${tempGroupName}"]`
    );

    await expect
      .poll(async () => await groupLessonRow.count(), { timeout: 15000 })
      .toBeGreaterThan(0);
    await expect(groupLessonRow.first()).toBeVisible();
    await expect(groupLessonRow.first()).toContainText(tempLessonSubject);

    await groupLessonRow.first().click();

    const attendanceDialog = page.getByRole('dialog', { name: /출결\s*\/\s*차감/ });
    await expect(attendanceDialog).toBeVisible();
    await expect(attendanceDialog.getByRole('heading', { name: /출결\s*\/\s*차감/ })).toBeVisible();
    await expect(attendanceDialog).toContainText(tempGroupName);
    await expect(attendanceDialog).toContainText(lessonDate);
    await expect(attendanceDialog).toContainText(tempLessonTime);
    await expect(attendanceDialog).toContainText(tempLessonSubject);
  } finally {
    const attendanceDialog = page.getByRole('dialog', { name: /출결\s*\/\s*차감/ });
    if (await attendanceDialog.isVisible().catch(() => false)) {
      await attendanceDialog.getByRole('button', { name: '닫기', exact: true }).click();
      await expect(attendanceDialog).toBeHidden();
    }

    if (tempSetup) {
      await cleanupTempCalendarGroupLessonSetup(page, tempSetup);
    }
  }
});
