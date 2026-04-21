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

async function openStudentPackageSection(page) {
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

  let packageCard = studentDetail.getByTestId('student-package-card').first();
  if ((await packageCard.count()) === 0) {
    const showAllButton = studentDetail.getByTestId('student-package-show-all-button');
    if ((await showAllButton.count()) > 0) {
      await showAllButton.click();
    }
    packageCard = studentDetail.getByTestId('student-package-card').first();
  }

  await expect(packageCard).toBeVisible();
  return { studentDetail, packageCard };
}

async function openStudentPackageEditModal(packageCard) {
  const editButton = packageCard.getByTestId('student-package-edit-button').first();
  await expect(editButton).toBeVisible();
  await editButton.click();

  const editDialog = packageCard.page().getByRole('dialog', { name: '수강권 수정' });
  await expect(editDialog).toBeVisible();
  return editDialog;
}

test('관리자가 학생 수강권 수정 모달에서 값을 저장하고 다시 원복할 수 있다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const tempMemo = `E2E 수강권 메모 ${Date.now()}`;
  let originalMemo = '';
  let shouldRestore = false;

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const { packageCard } = await openStudentPackageSection(page);

  try {
    const editDialog = await openStudentPackageEditModal(packageCard);
    const memoInput = editDialog.getByLabel('메모 (선택)');
    await expect(memoInput).toBeVisible();

    originalMemo = await memoInput.inputValue();

    await memoInput.fill(tempMemo);
    await editDialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(editDialog).toBeHidden();

    shouldRestore = true;
    await expect(packageCard).toContainText(tempMemo);

    const restoreDialog = await openStudentPackageEditModal(packageCard);
    await expect(restoreDialog.getByLabel('메모 (선택)')).toHaveValue(tempMemo);
    await restoreDialog.getByLabel('메모 (선택)').fill(originalMemo);
    await restoreDialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(restoreDialog).toBeHidden();

    shouldRestore = false;
    if (originalMemo.trim()) {
      await expect(packageCard).toContainText(originalMemo);
    } else {
      await expect(packageCard).toContainText('메모');
    }

    const finalDialog = await openStudentPackageEditModal(packageCard);
    await expect(finalDialog.getByLabel('메모 (선택)')).toHaveValue(originalMemo);
    await finalDialog.getByRole('button', { name: '취소', exact: true }).click();
    await expect(finalDialog).toBeHidden();
  } finally {
    if (!shouldRestore) return;

    const restoreDialog = await openStudentPackageEditModal(packageCard);
    await restoreDialog.getByLabel('메모 (선택)').fill(originalMemo);
    await restoreDialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(restoreDialog).toBeHidden();
  }
});
