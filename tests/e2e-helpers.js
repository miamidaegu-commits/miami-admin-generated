import { expect } from '@playwright/test';

export const BASE_URL = 'http://127.0.0.1:5173/';

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function loginAndExpectPath(page, email, password, pathPattern) {
  const consoleMessages = [];
  const pageErrors = [];
  const onConsole = (message) => {
    consoleMessages.push(`${message.type()}: ${message.text()}`);
  };
  const onPageError = (error) => {
    pageErrors.push(error?.message || String(error));
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  await page.goto(`${BASE_URL}login/`);

  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const emailInput = page.getByLabel(/Email|이메일/i).or(page.locator('input[type="email"]')).first();
      const passwordInput = page
        .getByLabel(/Password|비밀번호/i)
        .or(page.locator('input[type="password"]'))
        .first();

      await emailInput.fill(email);
      await passwordInput.fill(password);
      await page.getByRole('button', { name: /Sign In|로그인/i }).click();

      try {
        await expect(page).toHaveURL(pathPattern, { timeout: 15000 });
        break;
      } catch (error) {
        if (attempt === 3) {
          const [bodyText, alertText, storageState] = await Promise.all([
            page.locator('body').innerText().catch(() => ''),
            page
              .locator('[role="alert"], .error-msg, .error, [data-testid*="error"]')
              .allInnerTexts()
              .catch(() => []),
            page
              .evaluate(() => ({
                localStorageKeys: Object.keys(window.localStorage || {}),
                sessionStorageKeys: Object.keys(window.sessionStorage || {}),
              }))
              .catch(() => null),
          ]);
          throw new Error(
            [
              `Login did not redirect to ${pathPattern}.`,
              `Current URL: ${page.url()}`,
              `Email used: ${email}`,
              `Visible alert/error text: ${alertText.filter(Boolean).join(' | ') || '-'}`,
              `Storage state: ${JSON.stringify(storageState)}`,
              `Console messages: ${consoleMessages.slice(-20).join(' || ') || '-'}`,
              `Page errors: ${pageErrors.slice(-10).join(' || ') || '-'}`,
              'Visible page text:',
              bodyText.slice(0, 1500),
              '',
              `Original error: ${error.message}`,
            ].join('\n')
          );
        }
        await page.waitForTimeout(1000);
      }
    }
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
}

export async function loginAsAdmin(page, email, password) {
  await loginAndExpectPath(page, email, password, /\/dashboard/);

  await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toBeVisible();
}

export async function loginAsStudent(page, email, password) {
  await loginAndExpectPath(page, email, password, /\/student-booking/);
  await expect(page.getByRole('heading', { name: '수업 예약', exact: true })).toBeVisible({
    timeout: 15000,
  });
}

export async function openDashboardSection(page, sectionName) {
  await page.getByRole('button', { name: sectionName, exact: true }).click();
  await expect(page.getByRole('heading', { name: sectionName, level: 1 })).toBeVisible();
}

export function getStudentSearchInput(page) {
  return page.getByTestId('student-search-input');
}

export function getStudentRow(page, studentName) {
  return page.locator(`[data-testid="student-row"][data-student-name="${studentName}"]`).first();
}

export function getGroupRow(page, groupName) {
  return page.locator(`[data-testid="group-row"][data-group-name="${groupName}"]`).first();
}

export function getRegisteredStudentsHeading(page, groupName) {
  return page.getByRole('heading', {
    name: new RegExp(`등록 학생\\s*[—-]\\s*${escapeRegExp(groupName)}`),
  });
}
