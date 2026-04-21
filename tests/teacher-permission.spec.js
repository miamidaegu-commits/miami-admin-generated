import { test, expect } from '@playwright/test';
import { BASE_URL, openDashboardSection } from './e2e-helpers.js';

const TEST_TEACHER_EMAIL = 'test-teacher@miami.com';
const TEST_TEACHER_PASSWORD = '12345678';

async function loginAsTeacher(page) {
  await page.goto(BASE_URL);

  await page.getByLabel('Email').fill(TEST_TEACHER_EMAIL);
  await page.getByLabel('Password').fill(TEST_TEACHER_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();

  const invalidCredentials = page.getByText('Invalid email or password.');
  const inactiveAccount = page.getByText('비활성 계정입니다');
  const welcomeMessage = page.locator('.page-sub');
  const studentManagementButton = page.getByRole('button', { name: '학생 관리', exact: true });
  const classManagementButton = page.getByRole('button', { name: '반 관리', exact: true });

  await Promise.race([
    page.waitForURL(/\/dashboard/, { timeout: 5000 }).catch(() => null),
    invalidCredentials.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
    inactiveAccount.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
    studentManagementButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
    classManagementButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
  ]);

  await expect
    .poll(
      async () => ({
        url: page.url(),
        welcomeText: ((await welcomeMessage.textContent()) || '').trim(),
        hasStudentNav: await studentManagementButton.isVisible().catch(() => false),
        hasClassNav: await classManagementButton.isVisible().catch(() => false),
        hasInvalidCredentials: await invalidCredentials.isVisible().catch(() => false),
        hasInactiveAccount: await inactiveAccount.isVisible().catch(() => false),
      }),
      { timeout: 5000 }
    )
    .toMatchObject({
      hasInvalidCredentials: false,
      hasInactiveAccount: false,
    });

  const bodyText = (await page.locator('body').textContent()) || '';
  const isDashboard = /\/dashboard/.test(page.url());
  const welcomeText = ((await welcomeMessage.textContent()) || '').trim();
  const hasWelcome = /님,?\s환영합니다/.test(welcomeText);
  const hasTeacherNav =
    (await studentManagementButton.isVisible().catch(() => false)) &&
    (await classManagementButton.isVisible().catch(() => false));
  const hasInvalidCredentials = bodyText.includes('Invalid email or password.');
  const hasInactiveAccount = bodyText.includes('비활성 계정입니다');

  const loginSucceeded = isDashboard && hasWelcome && hasTeacherNav;

  expect(
    loginSucceeded,
    [
      'Teacher login failed.',
      `URL: ${page.url()}`,
      `Welcome: ${welcomeText || '(empty)'}`,
      hasInvalidCredentials ? 'Reason: Invalid email or password.' : null,
      hasInactiveAccount ? 'Reason: 비활성 계정입니다' : null,
      `Body: ${bodyText}`,
    ]
      .filter(Boolean)
      .join('\n'),
  ).toBe(true);
}

async function getTeacherNameFromWelcome(page) {
  // 취약한 selector: 환영 문구 class에 직접 의존합니다.
  // 가능하면 `data-testid="dashboard-welcome-subtitle"`를 추가하세요.
  const welcomeText = (await page.locator('.page-sub').textContent()) || '';
  const match = welcomeText.match(/(.*)\s님,?\s환영합니다/);
  return match?.[1]?.trim() || '';
}

async function getColumnIndexFromHeader(tableRoot, columnName) {
  const headers = await tableRoot.locator('.table-head > span').allTextContents();
  return headers.findIndex((value) => value.trim() === columnName);
}

async function expectTeacherOnlyRows(tableRoot, tableRows, expectedTeacherName) {
  const rowCount = await tableRows.count();
  if (rowCount === 0 || !expectedTeacherName) return;

  const teacherColumnIndex = await getColumnIndexFromHeader(tableRoot, '선생님');
  expect(teacherColumnIndex, '선생님 column was not found in table header.').toBeGreaterThanOrEqual(0);

  for (let i = 0; i < rowCount; i += 1) {
    const teacherCell = tableRows.nth(i).locator(':scope > span').nth(teacherColumnIndex);
    await expect(teacherCell).toContainText(expectedTeacherName);
  }
}

test('teacher 계정은 관리자와 다른 UI 제한을 보고 본인 데이터 범위만 확인할 수 있다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  await loginAsTeacher(page);

  const teacherName = await getTeacherNameFromWelcome(page);

  await openDashboardSection(page, '반 관리');
  await expect(page.getByRole('button', { name: '정규반 만들기', exact: true })).toHaveCount(0);

  // 취약한 selector: 그룹 목록 row가 class/span 순서에 의존합니다.
  // 가능하면 `data-testid="group-row"`와 `data-testid="group-teacher-cell"`를 추가하세요.
  const groupTable = page.locator('.activity-table').first();
  const groupRows = groupTable.locator('.table-row[role="button"]');
  await expectTeacherOnlyRows(groupTable, groupRows, teacherName);

  if ((await groupRows.count()) > 0) {
    await groupRows.first().click();
    await expect(page.getByRole('heading', { name: /등록 학생/ })).toBeVisible();

    const attendanceButtons = page.getByRole('button', { name: '출결/차감', exact: true });
    if ((await attendanceButtons.count()) > 0) {
      await expect(attendanceButtons.first()).toBeVisible();
      await attendanceButtons.first().click();

      const attendanceDialog = page.getByRole('dialog', { name: /출결\s*\/\s*차감/ });
      await expect(attendanceDialog).toBeVisible();
      await expect(attendanceDialog.getByRole('heading', { name: /출결\s*\/\s*차감/ })).toBeVisible();
      await attendanceDialog.getByRole('button', { name: '닫기', exact: true }).click();
      await expect(attendanceDialog).toBeHidden();
    } else {
      await expect(attendanceButtons).toHaveCount(0);
    }
  }

  await openDashboardSection(page, '학생 관리');

  await expect(page.getByRole('button', { name: '수강권 추가', exact: true })).toHaveCount(0);

  // 취약한 selector: 학생 목록 row도 class/span 순서에 의존합니다.
  // 가능하면 `data-testid="student-row"`와 `data-testid="student-teacher-cell"`를 추가하세요.
  const studentTable = page.locator('.activity-table').first();
  const studentRows = studentTable.locator('.table-row').filter({
    has: page.getByRole('button', { name: '수정', exact: true }),
  });
  await expectTeacherOnlyRows(studentTable, studentRows, teacherName);
});
