import { test, expect } from '@playwright/test';
import {
  getGroupRow,
  getRegisteredStudentsHeading,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
import {
  cleanupTempGroupAttendanceSetup,
  createTempGroupAttendanceSetup,
} from './e2e-firebase-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TEST_GROUP_NAME,
  TEST_STUDENT_NAME,
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

async function getTodayInSeoul(page) {
  return page.evaluate(() =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  );
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

test('관리자가 그룹 출결 모달에서 실제 차감 후 다시 복구할 수 있다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const todayYmd = await getTodayInSeoul(page);
  const lessonDate = formatYmd(addDays(new Date(`${todayYmd}T00:00:00`), -2));
  const lessonTime = '22:35';
  const uniqueToken = Date.now();
  const lessonSubject = `E2E 그룹출결 ${uniqueToken}`;
  const tempPackageTitle = `E2E 그룹출결 수강권 ${uniqueToken}`;

  let lessonCreated = false;
  let attendanceDialog = null;
  let tempSetup = null;

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    tempSetup = await createTempGroupAttendanceSetup(page, {
      groupName: TEST_GROUP_NAME,
      studentName: TEST_STUDENT_NAME,
      lessonDate,
      tempPackageTitle,
    });

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
    await lessonDialog.getByLabel('날짜').fill(lessonDate);
    await lessonDialog.getByLabel('시간').fill(lessonTime);
    await lessonDialog.getByLabel('과목').fill(lessonSubject);
    await lessonDialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(lessonDialog).toBeHidden();

    await expect
      .poll(async () => await targetLessonRow.count(), { timeout: 10000 })
      .toBe(1);
    lessonCreated = true;

    const attendanceButton = targetLessonRow.first().getByRole('button', {
      name: '출결/차감',
      exact: true,
    });
    await expect(attendanceButton).toBeVisible();
    await attendanceButton.click();

    attendanceDialog = page.getByRole('dialog', { name: /출결\s*\/\s*차감/ });
    await expect(attendanceDialog).toBeVisible();

    const tempStudentRow = attendanceDialog
      .locator('.table-row')
      .filter({ hasText: TEST_STUDENT_NAME })
      .filter({ hasText: tempPackageTitle })
      .first();

    await expect(tempStudentRow).toBeVisible();

    const getStatusText = async () =>
      ((await tempStudentRow.locator('span').nth(3).textContent()) || '').trim();

    const restoreButton = tempStudentRow.getByRole('button', { name: '차감복구', exact: true });
    const deductButton = tempStudentRow.getByRole('button', { name: '차감', exact: true });

    if ((await restoreButton.count()) > 0) {
      await expect(restoreButton).toBeEnabled();
      await restoreButton.click();

      await expect.poll(getStatusText, { timeout: 10000 }).toBe('차감취소됨');

      await expect(deductButton).toBeVisible();
      await expect(deductButton).toBeEnabled();
      await deductButton.click();

      await expect.poll(getStatusText, { timeout: 10000 }).toBe('차감됨');

      const secondRestoreButton = tempStudentRow.getByRole('button', {
        name: '차감복구',
        exact: true,
      });
      await expect(secondRestoreButton).toBeVisible();
      await expect(secondRestoreButton).toBeEnabled();
      await secondRestoreButton.click();

      await expect.poll(getStatusText, { timeout: 10000 }).toBe('차감취소됨');
    } else {
      await expect(deductButton).toBeVisible();
      await expect(deductButton).toBeEnabled();
      await deductButton.click();

      await expect.poll(getStatusText, { timeout: 10000 }).toBe('차감됨');

      const visibleRestoreButton = tempStudentRow.getByRole('button', {
        name: '차감복구',
        exact: true,
      });
      await expect(visibleRestoreButton).toBeVisible();
      await expect(visibleRestoreButton).toBeEnabled();
      await visibleRestoreButton.click();

      await expect.poll(getStatusText, { timeout: 10000 }).toBe('차감취소됨');
    }

    await expect(tempStudentRow.getByRole('button', { name: '차감', exact: true })).toBeVisible();
  } finally {
    if (attendanceDialog && (await attendanceDialog.isVisible().catch(() => false))) {
      await attendanceDialog.getByRole('button', { name: '닫기', exact: true }).click();
      await expect(attendanceDialog).toBeHidden();
    }

    if (lessonCreated) {
      const lessonSection = page.getByTestId('group-lessons-section').locator('..');
      const targetLessonRow = lessonSection
        .locator('.table-row')
        .filter({ hasText: lessonDate })
        .filter({ hasText: lessonTime })
        .filter({ hasText: lessonSubject });

      if ((await targetLessonRow.count()) > 0) {
        const deleteDialogHandled = acceptNextDialog(page);
        await targetLessonRow.first().getByRole('button', { name: '삭제', exact: true }).click();
        await deleteDialogHandled;
        await expect
          .poll(async () => await targetLessonRow.count(), { timeout: 10000 })
          .toBe(0);
      }
    }

    if (tempSetup) {
      await cleanupTempGroupAttendanceSetup(page, tempSetup);
    }
  }
});
