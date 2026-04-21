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

test('관리자가 특정 그룹의 출결/차감 모달을 열 수 있다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '반 관리');

  const groupRow = getGroupRow(page, TEST_GROUP_NAME);
  await expect(groupRow).toBeVisible();
  await groupRow.click();

  await expect(getRegisteredStudentsHeading(page, TEST_GROUP_NAME)).toBeVisible();

  const lessonSection = page.getByTestId('group-lessons-section').locator('..');

  await expect(lessonSection).toBeVisible();

  const firstAttendanceButton = lessonSection
    .getByRole('button', { name: '출결/차감', exact: true })
    .first();

  await expect(firstAttendanceButton).toBeVisible();
  await expect(firstAttendanceButton).toBeEnabled();
  await firstAttendanceButton.click();

  const attendanceDialog = page.getByRole('dialog', { name: /출결\s*\/\s*차감/ });
  await expect(attendanceDialog).toBeVisible();
  await expect(attendanceDialog.getByRole('heading', { name: /출결\s*\/\s*차감/ })).toBeVisible();

  // 취약한 selector: 모달 내부 목록도 table class 구조에 의존합니다.
  // 가능하면 `data-testid="attendance-student-row"`를 추가해 교체하세요.
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
});
