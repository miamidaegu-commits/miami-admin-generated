import { test, expect } from '@playwright/test';
import {
  getGroupRow,
  getRegisteredStudentsHeading,
  getStudentRow,
  getStudentSearchInput,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
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

async function openStudentRow(page) {
  await openDashboardSection(page, '학생 관리');
  const studentSearchInput = getStudentSearchInput(page);
  return { studentSearchInput };
}

async function getStudentRowByName(page, studentName) {
  const { studentSearchInput } = await openStudentRow(page);
  await studentSearchInput.fill(studentName);
  const studentRow = getStudentRow(page, studentName);
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

  const uniqueToken = Date.now();
  const tempStudentName = `E2E 반등록학생 ${uniqueToken}`;
  let tempStudent = null;

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    tempStudent = await createTempStudent(page, {
      studentName: tempStudentName,
      note: 'E2E temporary student for group post enroll confirm test',
    });

    const studentRow = await getStudentRowByName(page, tempStudentName);
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

    await packageDialog
      .getByLabel('시작일')
      .fill(await getGroupPackageStartDate(page, { groupName: TEST_GROUP_NAME }));
    await packageDialog.getByLabel('등록 주수').fill('4');
    await packageDialog.getByRole('button', { name: '저장' }).click();

    const postEnrollDialog = page.getByRole('dialog', { name: '이 반에 바로 등록할까요?' });
    await expect(postEnrollDialog).toBeVisible();
    await expect(postEnrollDialog).toContainText(tempStudentName);
    await expect(postEnrollDialog).toContainText(TEST_GROUP_NAME);

    await postEnrollDialog.getByRole('button', { name: '지금 등록', exact: true }).click();
    await expect(postEnrollDialog).toBeHidden();

    await openGroupDetail(page);

    const enrolledStudentsSection = page.getByTestId('group-students-section');
    const enrolledStudentRow = enrolledStudentsSection.locator(
      `[data-testid="group-student-row"][data-student-name="${tempStudentName}"]`
    );

    await expect(enrolledStudentRow.first()).toBeVisible();

    expect(
      dialogMessages.every((message) => !message.includes('실패')),
      `Unexpected dialog messages: ${dialogMessages.join(' | ')}`
    ).toBe(true);
  } finally {
    if (tempStudent) {
      await cleanupTempStudentData(page, tempStudent);
    }
  }
});
