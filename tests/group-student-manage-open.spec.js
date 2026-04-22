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
  TEST_STUDENT_NAME,
} from './fixtures/test-data.js';

test('관리자가 그룹 학생 관리 모달을 열 수 있다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '반 관리');

  const groupRow = getGroupRow(page, TEST_GROUP_NAME);
  await expect(groupRow).toBeVisible();
  await groupRow.click();

  await expect(getRegisteredStudentsHeading(page, TEST_GROUP_NAME)).toBeVisible();

  const groupStudentsSection = page.getByTestId('group-students-section');
  await expect(groupStudentsSection).toBeVisible();

  const studentRow = groupStudentsSection.locator(
    `[data-testid="group-student-row"][data-student-name="${TEST_STUDENT_NAME}"]`
  ).first();
  await expect(studentRow).toBeVisible();

  const manageButton = studentRow.getByRole('button', { name: '관리', exact: true });
  await expect(manageButton).toBeVisible();
  await expect(manageButton).toBeEnabled();
  await manageButton.click();

  const manageDialog = page.getByRole('dialog', { name: '그룹 학생 관리' });
  await expect(manageDialog).toBeVisible();
  await expect(manageDialog).toContainText(TEST_STUDENT_NAME);

  await expect(manageDialog.getByLabel('시작일')).toBeVisible();
  await expect(manageDialog.getByLabel('운영 상태')).toBeVisible();
  await expect(manageDialog.getByText('제외 날짜 (yyyy-MM-dd)', { exact: true })).toBeVisible();
  await expect(manageDialog.getByRole('button', { name: '날짜 추가', exact: true })).toBeVisible();
});
