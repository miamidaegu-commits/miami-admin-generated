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

test('관리자가 그룹 학생 관리 모달에서 제외 날짜를 저장하고 다시 원복할 수 있다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const excludedDate = formatYmd(addDays(new Date(), 920));

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

  async function openManageDialog() {
    await manageButton.click();
    const dialog = page.getByRole('dialog', { name: '그룹 학생 관리' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(TEST_STUDENT_NAME);
    return dialog;
  }

  async function saveManageDialog(dialog) {
    const saveButton = dialog.getByRole('button', { name: '저장', exact: true });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(dialog).toBeHidden();
  }

  async function ensureDateRemovedIfPresent() {
    const dialog = await openManageDialog();
    const dateItem = dialog.locator(
      `[data-testid="group-student-excluded-date-item"][data-date="${excludedDate}"]`
    ).first();
    if ((await dateItem.count()) > 0) {
      await dateItem.getByRole('button', { name: '삭제', exact: true }).click();
      await saveManageDialog(dialog);
      return;
    }
    await dialog.getByRole('button', { name: '취소', exact: true }).click();
    await expect(dialog).toBeHidden();
  }

  let dateAdded = false;

  try {
    await ensureDateRemovedIfPresent();

    const addDialog = await openManageDialog();
    const excludeDateInput = addDialog.getByTestId('group-student-exclude-date-input');
    await expect(excludeDateInput).toBeVisible();
    await excludeDateInput.fill(excludedDate);
    await addDialog.getByRole('button', { name: '날짜 추가', exact: true }).click();
    await expect(
      addDialog.locator(
        `[data-testid="group-student-excluded-date-item"][data-date="${excludedDate}"]`
      ).first()
    ).toBeVisible();
    await saveManageDialog(addDialog);

    dateAdded = true;

    const verifyAddedDialog = await openManageDialog();
    await expect(
      verifyAddedDialog.locator(
        `[data-testid="group-student-excluded-date-item"][data-date="${excludedDate}"]`
      ).first()
    ).toBeVisible();

    await verifyAddedDialog
      .locator(
        `[data-testid="group-student-excluded-date-item"][data-date="${excludedDate}"]`
      )
      .first()
      .getByRole('button', { name: '삭제', exact: true })
      .click();
    await saveManageDialog(verifyAddedDialog);

    dateAdded = false;

    const verifyRemovedDialog = await openManageDialog();
    await expect(
      verifyRemovedDialog.locator(
        `[data-testid="group-student-excluded-date-item"][data-date="${excludedDate}"]`
      ).first()
    ).toHaveCount(0);
    await expect(
      verifyRemovedDialog.getByText('등록된 제외일이 없습니다.', { exact: true })
    ).toBeVisible();
    await verifyRemovedDialog.getByRole('button', { name: '취소', exact: true }).click();
    await expect(verifyRemovedDialog).toBeHidden();
  } finally {
    if (!dateAdded) return;

    await ensureDateRemovedIfPresent();

    const verifyCleanupDialog = await openManageDialog();
    await expect(
      verifyCleanupDialog.locator(
        `[data-testid="group-student-excluded-date-item"][data-date="${excludedDate}"]`
      ).first()
    ).toHaveCount(0);
    await verifyCleanupDialog.getByRole('button', { name: '취소', exact: true }).click();
    await expect(verifyCleanupDialog).toBeHidden();
  }
});
