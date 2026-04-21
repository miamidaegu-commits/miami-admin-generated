import { test, expect } from '@playwright/test';
import { getStudentRow, getStudentSearchInput, loginAsAdmin, openDashboardSection } from './e2e-helpers.js';

const ADMIN_EMAIL = 'test-admin@miami.com';
const ADMIN_PASSWORD = '12345678';
const TEST_STUDENT_NAME = '이나규미';
const TEST_GROUP_NAME = '고급영어회화';

test('관리자가 기존 학생에게 그룹 수강권을 추가하고 후속 등록 모달을 확인한다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '학생 관리');

  const studentSearchInput = getStudentSearchInput(page);
  await studentSearchInput.fill(TEST_STUDENT_NAME);

  const studentRow = getStudentRow(page, TEST_STUDENT_NAME);
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
  await startDateInput.fill('2026-04-21');
  await packageDialog.getByLabel('등록 주수').fill('4');

  await packageDialog.getByRole('button', { name: '저장' }).click();

  const postEnrollDialog = page.getByRole('dialog', { name: '이 반에 바로 등록할까요?' });
  await expect(postEnrollDialog).toBeVisible();
  await expect(postEnrollDialog).toContainText(TEST_STUDENT_NAME);
  await expect(postEnrollDialog).toContainText(TEST_GROUP_NAME);

  await postEnrollDialog.getByRole('button', { name: '나중에 등록' }).click();
  await expect(postEnrollDialog).toBeHidden();
});
