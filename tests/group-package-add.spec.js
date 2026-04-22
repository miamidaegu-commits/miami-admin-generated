import { test, expect } from '@playwright/test';
import { getStudentRow, getStudentSearchInput, loginAsAdmin, openDashboardSection } from './e2e-helpers.js';
import {
  cleanupTempStudentData,
  createTempStudent,
  getGroupPackageStartDate,
} from './e2e-firebase-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TEST_GROUP_NAME,
} from './fixtures/test-data.js';

test('관리자가 기존 학생에게 그룹 수강권을 추가하고 후속 등록 모달을 확인한다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  const uniqueToken = Date.now();
  const tempStudentName = `E2E 그룹수강권 ${uniqueToken}`;
  let tempStudent = null;

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    tempStudent = await createTempStudent(page, {
      studentName: tempStudentName,
      note: 'E2E temporary student for group package add test',
    });
    await openDashboardSection(page, '학생 관리');

    const studentSearchInput = getStudentSearchInput(page);
    await studentSearchInput.fill(tempStudentName);

    const studentRow = getStudentRow(page, tempStudentName);
    await expect(studentRow).toBeVisible();
    await studentRow.getByRole('button', { name: '수강권 추가' }).click();

    const packageDialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
    await expect(packageDialog).toBeVisible();

    await packageDialog.getByLabel('수강권 유형').selectOption('group');

    const groupSelect = packageDialog.getByLabel('그룹 수업');
    await expect.poll(async () => await groupSelect.locator('option').count()).toBeGreaterThan(1);

    const groupValue = await groupSelect.locator('option').evaluateAll((options, groupName) => {
      const matched = options.find((option) =>
        option.textContent?.includes(String(groupName))
      );
      return matched?.getAttribute('value') || '';
    }, TEST_GROUP_NAME);

    expect(groupValue).not.toBe('');
    await groupSelect.selectOption(groupValue);

    const startDateInput = packageDialog.getByLabel('시작일');
    await startDateInput.fill(await getGroupPackageStartDate(page, { groupName: TEST_GROUP_NAME }));
    await packageDialog.getByLabel('등록 주수').fill('4');

    await packageDialog.getByRole('button', { name: '저장' }).click();

    const postEnrollDialog = page.getByRole('dialog', { name: '이 반에 바로 등록할까요?' });
    await expect(postEnrollDialog).toBeVisible();
    await expect(postEnrollDialog).toContainText(tempStudentName);
    await expect(postEnrollDialog).toContainText(TEST_GROUP_NAME);

    await postEnrollDialog.getByRole('button', { name: '나중에 등록' }).click();
    await expect(postEnrollDialog).toBeHidden();
  } finally {
    if (tempStudent) {
      await cleanupTempStudentData(page, tempStudent);
    }
  }
});
