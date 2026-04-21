import { test, expect } from '@playwright/test';
import { getStudentRow, getStudentSearchInput, loginAsAdmin, openDashboardSection } from './e2e-helpers.js';

const ADMIN_EMAIL = 'test-admin@miami.com';
const ADMIN_PASSWORD = '12345678';
const TEST_STUDENT_NAME = '이나규미';

test('관리자가 기존 학생에게 개인 수강권을 추가한다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const packageTitle = `E2E 개인 수강권 ${Date.now()}`;

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '학생 관리');

  // 취약한 selector: placeholder 문구 변경에 민감합니다.
  // 가능하면 `data-testid="student-search-input"`를 추가하세요.
  const studentSearchInput = getStudentSearchInput(page);
  await studentSearchInput.fill(TEST_STUDENT_NAME);

  // 취약한 selector: 학생 row에 안정적인 식별자가 없어 class+버튼명+텍스트 조합을 사용합니다.
  // 가능하면 `data-testid="student-row"`와 `data-student-name`을 추가하세요.
  const studentRow = getStudentRow(page, TEST_STUDENT_NAME);
  await expect(studentRow).toBeVisible();

  await studentRow.getByRole('button', { name: '수강권 추가' }).click();

  const packageDialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
  await expect(packageDialog).toBeVisible();

  await packageDialog.getByLabel('수강권 유형').selectOption('private');
  await packageDialog.getByRole('button', { name: '횟수권' }).click();
  await packageDialog.getByLabel('제목').fill(packageTitle);
  await packageDialog.getByLabel(/총 횟수/).fill('8');

  await packageDialog.getByRole('button', { name: '저장' }).click();
  await expect(packageDialog).toBeHidden();

  const postScheduleDialog = page.getByRole('dialog', { name: '첫 수업을 바로 예약할까요?' });
  await expect(postScheduleDialog).toBeVisible();
  await expect(postScheduleDialog).toContainText(TEST_STUDENT_NAME);
  await expect(postScheduleDialog).toContainText(packageTitle);

  await postScheduleDialog.getByRole('button', { name: '나중에 하기' }).click();
  await expect(postScheduleDialog).toBeHidden();
});
