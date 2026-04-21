import { test, expect } from '@playwright/test';
import { getStudentRow, getStudentSearchInput, loginAsAdmin, openDashboardSection } from './e2e-helpers.js';

const ADMIN_EMAIL = 'test-admin@miami.com';
const ADMIN_PASSWORD = '12345678';

test('관리자가 학생을 실제로 추가하고 목록에서 확인한다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const timestamp = Date.now();
  const studentName = `E2E학생-${timestamp}`;
  const firstRegisteredAt = new Date().toISOString().slice(0, 10);

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '학생 관리');

  await page.getByRole('button', { name: '학생 추가' }).click();

  const studentDialog = page.getByRole('dialog', { name: '학생 추가' });
  await expect(studentDialog).toBeVisible();

  await studentDialog.getByLabel('이름').fill(studentName);

  const teacherSelect = studentDialog.getByLabel('담당 선생님');
  await expect.poll(async () => await teacherSelect.locator('option').count()).toBeGreaterThan(1);
  await teacherSelect.selectOption({ index: 1 });

  await studentDialog.getByLabel('첫 등록일').fill(firstRegisteredAt);
  await studentDialog.getByRole('button', { name: '저장' }).click();

  await expect(studentDialog).toBeHidden();

  const postCreateDialog = page.getByRole('dialog', { name: '학생을 등록했습니다' });
  await expect(postCreateDialog).toBeVisible();
  await postCreateDialog.getByRole('button', { name: '나중에 하기' }).click();
  await expect(postCreateDialog).toBeHidden();

  // 취약한 selector: placeholder 문구 변경에 민감합니다.
  // 가능하면 `data-testid="student-search-input"`를 추가하세요.
  const studentSearchInput = getStudentSearchInput(page);
  await studentSearchInput.fill(studentName);

  // 취약한 selector: 학생 row에 고유 test id가 없어 class+버튼명+텍스트 조합을 사용합니다.
  // 가능하면 `data-testid="student-row"`와 `data-student-name`을 추가하세요.
  const studentRow = getStudentRow(page, studentName);
  await expect(studentRow).toBeVisible();
});
