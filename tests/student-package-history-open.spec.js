import { test, expect } from '@playwright/test';
import {
  getStudentRow,
  getStudentSearchInput,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TEST_STUDENT_NAME,
} from './fixtures/test-data.js';

async function openStudentPackageHistory(page) {
  await openDashboardSection(page, '학생 관리');

  const studentSearchInput = getStudentSearchInput(page);
  await studentSearchInput.fill(TEST_STUDENT_NAME);

  const studentRow = getStudentRow(page, TEST_STUDENT_NAME);
  await expect(studentRow).toBeVisible();

  await studentRow.getByRole('button', { name: '수강권 보기', exact: true }).click();

  const studentDetail = page
    .locator(
      `[data-testid="student-detail-panel"][data-student-name="${TEST_STUDENT_NAME}"]`
    )
    .first();
  await expect(studentDetail).toBeVisible();

  let historyButton = studentDetail.getByTestId('student-package-history-button').first();
  if ((await historyButton.count()) === 0) {
    const showAllButton = studentDetail.getByTestId('student-package-show-all-button');
    if ((await showAllButton.count()) > 0) {
      await showAllButton.click();
    }
    historyButton = studentDetail.getByTestId('student-package-history-button').first();
  }

  await expect(historyButton).toBeVisible();
  await historyButton.click();
}

test('관리자가 학생의 수강권 이력 모달을 열 수 있다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openStudentPackageHistory(page);

  const historyDialog = page.getByRole('dialog', { name: '수강권 이력' });
  await expect(historyDialog).toBeVisible();
  await expect(historyDialog.getByRole('heading', { name: '수강권 이력' })).toBeVisible();

  const historyRows = historyDialog.locator('text=메모:');
  const historyEmptyText = historyDialog.getByText('등록된 이력이 없습니다.', { exact: true });
  const historyMetaText = historyDialog.getByText('처리 역할:', { exact: false });

  await expect
    .poll(async () => {
      const rowCount = await historyRows.count();
      const hasEmptyText = await historyEmptyText.isVisible().catch(() => false);
      const hasMetaText = await historyMetaText.first().isVisible().catch(() => false);
      return rowCount > 0 || hasEmptyText || hasMetaText;
    })
    .toBe(true);
});
