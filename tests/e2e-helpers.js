import { expect } from '@playwright/test';

export const BASE_URL = 'http://127.0.0.1:5173/';

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LOGIN_ATTEMPT_TIMEOUT_MS = 10000;

async function waitForLoginOutcome(page, pathPattern) {
  const signInError = page
    .locator('[role="alert"], .error-msg, .error, [data-testid*="error"]')
    .filter({ hasText: /sign-in failed|로그인|실패|failed/i })
    .first()
    .waitFor({ state: 'visible', timeout: LOGIN_ATTEMPT_TIMEOUT_MS })
    .then(() => 'error')
    .catch(() => null);
  const redirect = page
    .waitForURL(pathPattern, { timeout: LOGIN_ATTEMPT_TIMEOUT_MS })
    .then(() => 'redirect')
    .catch(() => null);

  return Promise.race([redirect, signInError]);
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
      const signInButton = page.getByRole('button', { name: /Sign In|로그인/i });
      await expect(signInButton).toBeEnabled({ timeout: LOGIN_ATTEMPT_TIMEOUT_MS });
      await signInButton.click({ timeout: LOGIN_ATTEMPT_TIMEOUT_MS });

      try {
        const outcome = await waitForLoginOutcome(page, pathPattern);
        if (outcome !== 'redirect') {
          throw new Error(`Login attempt ended with ${outcome || 'no redirect'}.`);
        }
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
        await page.goto(`${BASE_URL}login/`);
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

async function getSelectOptionRows(selectLocator) {
  return selectLocator.locator('option').evaluateAll((items) =>
    items.map((option) => ({
      value: option.value,
      label: option.label || option.textContent || '',
      text: option.textContent || '',
    }))
  );
}

function teacherOptionMatches(option, teacherText) {
  const target = String(teacherText || '').trim();
  if (!target) return false;
  const value = String(option?.value || '').trim();
  const label = String(option?.label || '').trim();
  const text = String(option?.text || '').trim();
  return (
    value === target ||
    label === target ||
    text === target ||
    label.includes(target) ||
    text.includes(target)
  );
}

export async function selectTeacherOption(selectLocator, teacherText, options = {}) {
  const timeout = options.timeout ?? 15000;
  await expect(selectLocator).toBeVisible({ timeout });

  let optionRows = [];
  await expect
    .poll(
      async () => {
        optionRows = await getSelectOptionRows(selectLocator);
        return optionRows.some((option) => teacherOptionMatches(option, teacherText));
      },
      { timeout }
    )
    .toBe(true);

  const match = optionRows.find((option) => teacherOptionMatches(option, teacherText));
  if (!match) {
    throw new Error(
      `Teacher option not found for ${teacherText}. Options: ${JSON.stringify(optionRows)}`
    );
  }
  await selectLocator.selectOption(match.value);
}

export function getStudentSearchInput(page) {
  return page.getByTestId('student-search-input');
}

export function getStudentRow(page, studentName) {
  return page.locator(`[data-testid="student-row"][data-student-name="${studentName}"]`).first();
}

export function getStudentRowById(page, studentId) {
  return page.locator(`[data-testid="student-row"][data-student-id="${studentId}"]`).first();
}

export function getGroupRow(page, groupName) {
  return page.locator(`[data-testid="group-row"][data-group-name="${groupName}"]`).first();
}

export async function expectPrivateCalendarLessonRowVisible(page, studentName, options = {}) {
  const timeout = options.timeout ?? 15000;
  const privateLessonRows = page
    .locator('[data-testid="calendar-lesson-row"][data-row-kind="private"]')
    .filter({ hasText: studentName });

  try {
    await expect(privateLessonRows, 'created private lesson row should be visible').toHaveCount(1, {
      timeout,
    });
  } catch (error) {
    const [rowTexts, bodyText] = await Promise.all([
      page.locator('[data-testid="calendar-lesson-row"]').allInnerTexts().catch(() => []),
      page.locator('body').innerText().catch(() => ''),
    ]);
    throw new Error(
      [
        'Created private lesson row was not visible.',
        `Student: ${studentName}`,
        `Visible rows: ${JSON.stringify(rowTexts)}`,
        `Current URL: ${page.url()}`,
        'Body:',
        bodyText.slice(0, 1500),
        `Original error: ${error.message}`,
      ].join('\n')
    );
  }

  return privateLessonRows.first();
}

export async function expectGroupRowVisible(page, groupName, options = {}) {
  const timeout = options.timeout ?? 30000;
  const groupRow = getGroupRow(page, groupName);

  try {
    await expect(page.getByRole('heading', { name: /단체반 관리|내 단체반 관리/, level: 1 })).toBeVisible({
      timeout,
    });
    await expect
      .poll(
        async () => {
          const count = await groupRow.count();
          if (count > 0) return 'ready';
          const loadingCount = await page.getByText('불러오는 중...', { exact: true }).count();
          return loadingCount > 0 ? 'loading' : 'missing';
        },
        { timeout }
      )
      .toBe('ready');
    await expect(groupRow).toBeVisible({ timeout });
  } catch (error) {
    const [visibleRows, bodyText, loadingTexts, alertTexts] = await Promise.all([
      page
        .locator('[data-testid="group-row"]')
        .evaluateAll((rows) =>
          rows.map((rowEl) => ({
            dataGroupName: rowEl.getAttribute('data-group-name') || '',
            text: rowEl.textContent || '',
          }))
        )
        .catch(() => []),
      page.locator('body').innerText().catch(() => ''),
      page.getByText('불러오는 중...', { exact: true }).allInnerTexts().catch(() => []),
      page
        .locator('[role="alert"], .error-msg, .error, [data-testid*="error"]')
        .allInnerTexts()
        .catch(() => []),
    ]);

    throw new Error(
      [
        `Group row was not visible for ${groupName}.`,
        `Current URL: ${page.url()}`,
        `Visible loading text: ${JSON.stringify(loadingTexts)}`,
        `Visible alert/error text: ${JSON.stringify(alertTexts.filter(Boolean))}`,
        `Visible group rows: ${JSON.stringify(visibleRows.slice(0, 40))}`,
        'Visible page text:',
        bodyText.slice(0, 1500),
        '',
        `Original assertion: ${error.message}`,
      ].join('\n')
    );
  }

  return groupRow;
}

export async function clickGroupRow(page, groupName, options = {}) {
  const timeout = options.timeout ?? 30000;
  const groupRow = await expectGroupRowVisible(page, groupName, { timeout });
  await groupRow.scrollIntoViewIfNeeded({ timeout });
  await groupRow.click({ timeout });
  return groupRow;
}

export function getRegisteredStudentsHeading(page, groupName) {
  return page.getByRole('heading', {
    name: new RegExp(`등록 학생\\s*[—-]\\s*${escapeRegExp(groupName)}`),
  });
}
