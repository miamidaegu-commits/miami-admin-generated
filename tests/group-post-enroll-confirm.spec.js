import { test, expect } from '@playwright/test';
import {
  getGroupRow,
  getRegisteredStudentsHeading,
  getStudentRow,
  getStudentSearchInput,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';

const ADMIN_EMAIL = 'test-admin@miami.com';
const ADMIN_PASSWORD = '12345678';
const TEST_STUDENT_NAME = '이나규미';
const TEST_GROUP_NAME = '고급영어회화';

function formatYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function openStudentRow(page) {
  await openDashboardSection(page, '학생 관리');

  const studentSearchInput = getStudentSearchInput(page);
  await studentSearchInput.fill(TEST_STUDENT_NAME);

  const studentRow = getStudentRow(page, TEST_STUDENT_NAME);
  await expect(studentRow).toBeVisible();

  return studentRow;
}

async function openGroupDetail(page) {
  await openDashboardSection(page, '반 관리');

  const groupRow = getGroupRow(page, TEST_GROUP_NAME);
  await expect(groupRow).toBeVisible();
  await groupRow.click();

  await expect(getRegisteredStudentsHeading(page, TEST_GROUP_NAME)).toBeVisible();
}

test('관리자가 그룹 수강권 생성 후 후속 모달에서 바로 등록까지 완료할 수 있다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const dialogMessages = [];
  page.on('dialog', async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  const studentRow = await openStudentRow(page);
  await studentRow.getByRole('button', { name: '수강권 추가' }).click();

  const packageDialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
  await expect(packageDialog).toBeVisible();

  await packageDialog.getByLabel('수강권 유형').selectOption('group');

  const groupSelect = packageDialog.getByLabel('그룹 수업');
  await expect.poll(async () => await groupSelect.locator('option').count()).toBeGreaterThan(1);

  const groupValue = await groupSelect.locator('option').evaluateAll((options, groupName) => {
    const matched = options.find((option) => option.textContent?.includes(String(groupName)));
    return matched?.getAttribute('value') || '';
  }, TEST_GROUP_NAME);

  expect(groupValue).not.toBe('');
  await groupSelect.selectOption(groupValue);

  await packageDialog.getByLabel('시작일').fill(formatYmd(new Date()));
  await packageDialog.getByLabel('등록 주수').fill('4');
  await packageDialog.getByRole('button', { name: '저장' }).click();

  const postEnrollDialog = page.getByRole('dialog', { name: '이 반에 바로 등록할까요?' });
  await expect(postEnrollDialog).toBeVisible();
  await expect(postEnrollDialog).toContainText(TEST_STUDENT_NAME);
  await expect(postEnrollDialog).toContainText(TEST_GROUP_NAME);

  await postEnrollDialog.getByRole('button', { name: '지금 등록', exact: true }).click();
  await expect(postEnrollDialog).toBeHidden();

  await openGroupDetail(page);

  const enrolledStudentsSection = page.getByTestId('group-students-section');
  const enrolledStudentRow = enrolledStudentsSection.locator('.table-row').filter({
    hasText: TEST_STUDENT_NAME,
  });

  await expect(enrolledStudentRow.first()).toBeVisible();

  expect(
    dialogMessages.every((message) => !message.includes('실패')),
    `Unexpected dialog messages: ${dialogMessages.join(' | ')}`
  ).toBe(true);
});
