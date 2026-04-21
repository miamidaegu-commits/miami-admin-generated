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

async function openStudentPackageEdit(page) {
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

  let editButton = studentDetail.getByTestId('student-package-edit-button').first();
  if ((await editButton.count()) === 0) {
    const showAllButton = studentDetail.getByTestId('student-package-show-all-button');
    if ((await showAllButton.count()) > 0) {
      await showAllButton.click();
    }
    editButton = studentDetail.getByTestId('student-package-edit-button').first();
  }

  await expect(editButton).toBeVisible();
  await editButton.click();
}

test('관리자가 학생의 수강권 수정 모달을 열 수 있다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openStudentPackageEdit(page);

  const editDialog = page.getByRole('dialog', { name: '수강권 수정' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByRole('heading', { name: '수강권 수정' })).toBeVisible();

  await expect(editDialog.getByLabel('제목')).toBeVisible();
  await expect(editDialog.getByLabel(/총 횟수/)).toBeVisible();
  await expect(editDialog.getByLabel(/만료일/)).toBeVisible();
});
