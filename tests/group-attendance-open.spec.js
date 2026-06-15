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
} from './fixtures/test-data.js';
import {
  cleanupAdminSeededCalendarGroupLessonSetup,
  createAdminSeededCalendarGroupLessonSetup,
} from './e2e-admin-helpers.js';

function formatYmd(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDays(baseDate, days) {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + days);
  return next;
}

async function expectGroupRowVisible(page, groupName) {
  const groupRow = getGroupRow(page, groupName);

  try {
    await expect(groupRow).toBeVisible({ timeout: 15000 });
  } catch (error) {
    const [visibleRows, bodyText] = await Promise.all([
      page
        .locator('[data-testid="group-row"]')
        .evaluateAll((rows) =>
          rows.map((rowEl) => ({
            dataGroupName: rowEl.getAttribute('data-group-name') || '',
            text: rowEl.textContent || '',
          }))
        )
        .catch(() => []),
      page.locator('body').innerText().catch(() => ''),
    ]);

    throw new Error(
      [
        `Group row was not visible for ${groupName}.`,
        `Visible group rows: ${JSON.stringify(visibleRows.slice(0, 40))}`,
        'Visible page text:',
        bodyText.slice(0, 1500),
        '',
        `Original assertion: ${error.message}`,
      ].join('\n')
    );
  }

  return groupRow;
}

test('관리자가 특정 그룹의 출결/차감 모달을 열 수 있다', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const unique = `${Date.now()}-${testInfo.workerIndex}`;
  const groupName = `E2E 출결열기반 ${unique}`;
  const lessonId = `e2e-group-attendance-open-lesson-${unique}`;
  let setup = null;

  try {
    setup = await createAdminSeededCalendarGroupLessonSetup({
      groupClassId: `e2e-group-attendance-open-class-${unique}`,
      groupLessonId: lessonId,
      groupName,
      teacherName: 'teacher',
      lessonDate: formatYmd(addDays(new Date(), -1)),
      lessonTime: '20:40',
      lessonSubject: `E2E 출결열기 ${unique}`,
      skipPastAttendanceSync: true,
    });

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '단체반 관리');

    const groupRow = await expectGroupRowVisible(page, groupName);
    await groupRow.click({ timeout: 15000 });

    await expect(getRegisteredStudentsHeading(page, groupName)).toBeVisible();

    const lessonSection = page.getByTestId('group-lessons-section');
    await expect(lessonSection).toBeVisible();

    const targetLessonRow = lessonSection
      .locator(`[data-testid="group-lesson-row"][data-lesson-id="${lessonId}"]`)
      .first();
    await expect(targetLessonRow).toBeVisible({ timeout: 15000 });

    const firstAttendanceButton = targetLessonRow.getByRole('button', { name: '출결/차감', exact: true });

    await expect(firstAttendanceButton).toBeVisible();
    await expect(firstAttendanceButton).toBeEnabled();
    await firstAttendanceButton.click({ timeout: 10000 });

    const attendanceDialog = page.getByRole('dialog', { name: /출결\s*\/\s*차감/ });
    await expect(attendanceDialog).toBeVisible({ timeout: 15000 });
    await expect(attendanceDialog.getByRole('heading', { name: /출결\s*\/\s*차감/ })).toBeVisible();

    const tableRows = attendanceDialog.locator('.table-row');

    if ((await tableRows.count()) > 0) {
      const firstRow = tableRows.first();
      await expect(firstRow).toBeVisible();

      await expect
        .poll(async () => {
          const rowText = ((await firstRow.textContent()) || '').replace(/\s+/g, ' ').trim();
          return rowText.length;
        })
        .toBeGreaterThan(0);

      await expect(
        attendanceDialog.getByText(/남은 횟수|차감됨|차감취소됨|수강권 소진|예정/, { exact: false }).first()
      ).toBeVisible();
    } else {
      await expect(
        attendanceDialog.getByText('이 수업에 차감할 수 있는 학생이 없습니다.', { exact: false })
      ).toBeVisible();
    }
  } finally {
    if (setup) {
      await cleanupAdminSeededCalendarGroupLessonSetup({
        ...setup,
        strictLessonIdsOnly: true,
      }).catch(() => {});
    }
  }
});
