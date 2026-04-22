import { test, expect } from '@playwright/test';
import {
  getGroupRow,
  getRegisteredStudentsHeading,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
import {
  cleanupTempGroupStudentAddSetup,
  createTempGroupStudentAddPackage,
} from './e2e-firebase-helpers.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, TEST_GROUP_NAME } from './fixtures/test-data.js';

async function acceptNextDialog(page, timeout = 5000) {
  const dialog = await page.waitForEvent('dialog', { timeout });
  const message = dialog.message();
  await dialog.accept();
  return message;
}

test('관리자가 그룹 학생 등록을 실제로 저장하고 다시 제거해 원복할 수 있다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const uniqueToken = Date.now();
  const tempStudentId = `e2e-group-student-add-${uniqueToken}`;
  const tempStudentName = `E2E 그룹학생 ${uniqueToken}`;
  const tempPackageTitle = `E2E 그룹등록 수강권 ${uniqueToken}`;

  let tempSetup = null;
  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    tempSetup = await createTempGroupStudentAddPackage(page, {
      groupName: TEST_GROUP_NAME,
      tempStudentId,
      tempStudentName,
      tempPackageTitle,
    });

    await openDashboardSection(page, '반 관리');

    const groupRow = getGroupRow(page, TEST_GROUP_NAME);
    await expect(groupRow).toBeVisible();
    await groupRow.click();

    await expect(getRegisteredStudentsHeading(page, TEST_GROUP_NAME)).toBeVisible();

    const groupStudentsSection = page.getByTestId('group-students-section');
    await expect(groupStudentsSection).toBeVisible();

    const tempStudentRow = groupStudentsSection.locator(
      `[data-testid="group-student-row"][data-student-name="${tempStudentName}"]`
    ).first();
    await expect(tempStudentRow).toHaveCount(0);

    await page.getByRole('button', { name: '학생 등록', exact: true }).click();

    const addDialog = page.getByRole('dialog', { name: '학생 등록' });
    await expect(addDialog).toBeVisible();

    const packageSelect = addDialog.getByLabel('이 반에서 사용할 수강권을 선택');
    await expect
      .poll(async () => {
        return await packageSelect.locator(`option[value="${tempSetup.packageId}"]`).count();
      }, { timeout: 10000 })
      .toBe(1);

    await packageSelect.selectOption(tempSetup.packageId);
    await addDialog.getByLabel('시작일').fill(tempSetup.startDateYmd);

    await expect(addDialog.getByText(`studentName: ${tempStudentName}`, { exact: true })).toBeVisible();
    await expect(addDialog.getByText(`title: ${tempPackageTitle}`, { exact: true })).toBeVisible();

    await addDialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(addDialog).toBeHidden();

    await expect
      .poll(async () => await tempStudentRow.count(), { timeout: 10000 })
      .toBe(1);
    await expect(tempStudentRow).toBeVisible();

    const removeDialogPromise = acceptNextDialog(page);
    await tempStudentRow.getByRole('button', { name: '제거', exact: true }).click();
    const removeDialogMessage = await removeDialogPromise;
    expect(removeDialogMessage).toContain('이 학생을 이 반에서 제거할까요?');

    await expect
      .poll(async () => await tempStudentRow.count(), { timeout: 10000 })
      .toBe(0);
  } finally {
    if (tempSetup) {
      await cleanupTempGroupStudentAddSetup(page, {
        packageId: tempSetup.packageId,
        groupClassId: tempSetup.groupClassId,
        tempStudentId,
      });
    }
  }
});
