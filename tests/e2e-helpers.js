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

  await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toBeVisible({
    timeout: 15000,
  });
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

function normalizeTeacherTargets(teacherText, options = {}) {
  return Array.from(
    new Set(
      [
        ...(Array.isArray(teacherText) ? teacherText : [teacherText]),
        ...(Array.isArray(options.alternates) ? options.alternates : []),
      ]
        .map((target) => String(target || '').trim())
        .filter(Boolean)
    )
  );
}

function teacherOptionMatches(option, teacherTargets) {
  const targets = normalizeTeacherTargets(teacherTargets);
  if (targets.length === 0) return false;
  const value = String(option?.value || '').trim();
  const label = String(option?.label || '').trim();
  const text = String(option?.text || '').trim();
  return targets.some(
    (target) =>
      value === target ||
      label === target ||
      text === target ||
      value.includes(target) ||
      label.includes(target) ||
      text.includes(target)
  );
}

export async function selectTeacherOption(selectLocator, teacherText, options = {}) {
  const timeout = options.timeout ?? 15000;
  const targets = normalizeTeacherTargets(teacherText, options);
  await expect(selectLocator).toBeVisible({ timeout });

  let optionRows = [];
  try {
    await expect
      .poll(
        async () => {
          optionRows = await getSelectOptionRows(selectLocator);
          return optionRows.some((option) => teacherOptionMatches(option, targets));
        },
        { timeout }
      )
      .toBe(true);
  } catch (error) {
    throw new Error(
      [
        `Teacher option not found for ${targets.join(' | ')} within ${timeout}ms.`,
        `Options: ${JSON.stringify(optionRows)}`,
        `Original error: ${error.message}`,
      ].join('\n')
    );
  }

  const match = optionRows.find((option) => teacherOptionMatches(option, targets));
  if (!match) {
    throw new Error(
      `Teacher option not found for ${targets.join(' | ')}. Options: ${JSON.stringify(optionRows)}`
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

export function getStudentRowByIdOrName(page, studentId, studentName) {
  const byName = getStudentRow(page, studentName);
  return studentId ? getStudentRowById(page, studentId).or(byName).first() : byName;
}

async function collectVisibleStudentRowSnapshots(page, limit = 20) {
  return page
    .locator('[data-testid="student-row"]')
    .evaluateAll((rows, maxRows) =>
      rows.slice(0, maxRows).map((row) => ({
        id: row.getAttribute('data-student-id') || '',
        name: row.getAttribute('data-student-name') || '',
        text: String(row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      })),
      limit
    )
    .catch(() => []);
}

async function collectStudentManagementDiagnostics(page) {
  const searchInput = getStudentSearchInput(page);
  const [visibleRows, bodyText, loadingTexts, searchDisabled, searchEditable, currentUrl] =
    await Promise.all([
      collectVisibleStudentRowSnapshots(page),
      page.locator('body').innerText().catch(() => ''),
      page.getByText('불러오는 중...', { exact: true }).allInnerTexts().catch(() => []),
      searchInput.isDisabled().catch(() => null),
      searchInput.isEditable().catch(() => null),
      Promise.resolve(page.url()),
    ]);

  return {
    visibleRows,
    bodyText: String(bodyText || '').slice(0, 1500),
    loadingTexts: loadingTexts.filter(Boolean),
    searchDisabled,
    searchEditable,
    currentUrl,
  };
}

async function waitForStudentManagementSearchReady(page, timeout = 30000) {
  await expect(async () => {
    await openDashboardSection(page, '학생 관리');
    const searchInput = getStudentSearchInput(page);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    const loadingCount = await page.getByText('불러오는 중...', { exact: true }).count();
    if (loadingCount > 0) {
      throw new Error('Student list is still loading.');
    }

    const disabled = await searchInput.isDisabled().catch(() => true);
    if (disabled) {
      throw new Error('student-search-input is still disabled.');
    }

    await expect(searchInput).toBeEnabled({ timeout: 5000 });
    await expect(searchInput).toBeEditable({ timeout: 5000 });
  }).toPass({ timeout });
}

export async function prepareStudentManagementForSearch(
  page,
  { searchTerm = '', timeout = 30000, reload = false } = {}
) {
  if (reload) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toBeVisible({
      timeout: 15000,
    });
  }

  let lastDiagnostics = null;

  try {
    await expect(async () => {
      await waitForStudentManagementSearchReady(page, Math.min(timeout, 30000));

      const searchInput = getStudentSearchInput(page);
      const disabled = await searchInput.isDisabled().catch(() => true);
      if (disabled) {
        lastDiagnostics = await collectStudentManagementDiagnostics(page);
        throw new Error('Refusing to fill search while student-search-input is disabled.');
      }

      if (searchTerm) {
        await fillVisibleField(searchInput, searchTerm, {
          timeout: 15000,
          description: 'student-search-input',
        });
        await expect(searchInput).toHaveValue(searchTerm, { timeout: 5000 });
      }
    }).toPass({ timeout });
  } catch (error) {
    lastDiagnostics = lastDiagnostics || (await collectStudentManagementDiagnostics(page));
    throw new Error(
      [
        'Student management search UI was not ready.',
        `Search term: ${searchTerm || '-'}`,
        `Current URL: ${lastDiagnostics.currentUrl}`,
        `Search disabled: ${lastDiagnostics.searchDisabled}`,
        `Search editable: ${lastDiagnostics.searchEditable}`,
        `Loading text: ${JSON.stringify(lastDiagnostics.loadingTexts)}`,
        `Visible student rows: ${JSON.stringify(lastDiagnostics.visibleRows)}`,
        'Visible page text:',
        lastDiagnostics.bodyText,
        `Original error: ${error?.message || String(error || '')}`,
      ].join('\n')
    );
  }
}

export async function clickStudentRowButtonByIdOrName(
  page,
  {
    studentId = '',
    studentName,
    buttonName = '수강권 추가',
    exact = true,
    timeout = 60000,
    searchTerm = '',
  } = {}
) {
  const resolvedSearchTerm = String(searchTerm || studentName || '').trim();
  const packageDialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
  let reloadCount = 0;
  let lastDiagnostics = null;

  try {
    await expect(async () => {
      await prepareStudentManagementForSearch(page, {
        searchTerm: resolvedSearchTerm,
        timeout: Math.min(timeout, 30000),
        reload: reloadCount > 0,
      });

      lastDiagnostics = await collectStudentManagementDiagnostics(page);
      const row = getStudentRowByIdOrName(page, studentId, studentName);
      const rowVisible = await row.isVisible().catch(() => false);
      if (!rowVisible) {
        if (reloadCount === 0) {
          reloadCount += 1;
          throw new Error('Student row not visible yet; reloading page and retrying search.');
        }
        throw new Error('Student row still not visible after reload.');
      }

      const button = row.getByRole('button', { name: buttonName, exact });
      await button.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await expect(button).toBeVisible({ timeout: 5000 });
      await expect(button).toBeEnabled({ timeout: 5000 });
      await button.click({ timeout: 5000 });
      await expect(packageDialog).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout });
  } catch (error) {
    lastDiagnostics = lastDiagnostics || (await collectStudentManagementDiagnostics(page));
    throw new Error(
      [
        `Could not click ${buttonName} for student ${studentName || studentId} within ${timeout}ms.`,
        `Search term: ${resolvedSearchTerm || '-'}`,
        `Current URL: ${lastDiagnostics.currentUrl}`,
        `Search disabled: ${lastDiagnostics.searchDisabled}`,
        `Search editable: ${lastDiagnostics.searchEditable}`,
        `Loading text: ${JSON.stringify(lastDiagnostics.loadingTexts)}`,
        `Visible student rows: ${JSON.stringify(lastDiagnostics.visibleRows)}`,
        'Visible page text:',
        lastDiagnostics.bodyText,
        `Original error: ${error?.message || String(error || '')}`,
      ].join('\n')
    );
  }
}

export async function openPrivateStudentPackageAddDialog(
  page,
  { studentId = '', studentName, timeout = 60000 } = {}
) {
  await clickStudentRowButtonByIdOrName(page, {
    studentId,
    studentName,
    buttonName: '수강권 추가',
    timeout,
    searchTerm: studentName,
  });
  const dialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
  await expect(dialog).toBeVisible({ timeout: 15000 });
  await dialog.getByLabel('수강권 유형').selectOption('private');
  return dialog;
}

export async function waitForPrivatePackageDuplicateGuidanceReady(dialog, options = {}) {
  const timeout = options.timeout ?? 30000;
  const guidance = dialog.getByTestId('student-package-duplicate-guidance');

  try {
    await expect(async () => {
      await expect(guidance).toBeVisible({ timeout: 5000 });
      await expect(guidance).not.toBeEmpty({ timeout: 5000 });
    }).toPass({ timeout });
  } catch (error) {
    const dialogText = await dialog.innerText({ timeout: 2000 }).catch(() => '');
    throw new Error(
      [
        'student-package-duplicate-guidance was not visible/ready.',
        `Dialog text: ${String(dialogText || '').slice(0, 2500)}`,
        `Original error: ${error?.message || String(error || '')}`,
      ].join('\n')
    );
  }

  return guidance;
}

export async function waitForPrivatePackageTopUpSectionReady(dialog, options = {}) {
  const timeout = options.timeout ?? 30000;
  const topUpSection = dialog.getByTestId('student-package-top-up-section');
  const countInput = topUpSection.getByTestId('private-package-top-up-count-input');
  const labelInput = topUpSection.getByTestId('private-package-top-up-registration-label-input');

  try {
    await expect(async () => {
      await expect(topUpSection).toBeVisible({ timeout: 5000 });
      await expect(countInput).toBeVisible({ timeout: 5000 });
      await expect(countInput).toBeEnabled({ timeout: 5000 });
      await expect(countInput).toBeEditable({ timeout: 5000 });
      await expect(labelInput).toBeVisible({ timeout: 5000 });
      await expect(labelInput).toBeEnabled({ timeout: 5000 });
      await expect(labelInput).toBeEditable({ timeout: 5000 });
    }).toPass({ timeout });
  } catch (error) {
    const [dialogText, guidanceText, topUpVisible] = await Promise.all([
      dialog.innerText({ timeout: 2000 }).catch(() => ''),
      dialog
        .getByTestId('student-package-duplicate-guidance')
        .innerText({ timeout: 2000 })
        .catch(() => ''),
      topUpSection.isVisible().catch(() => false),
    ]);
    throw new Error(
      [
        'student-package-top-up-section was not visible/ready.',
        `Top-up section visible: ${topUpVisible}`,
        `Guidance text: ${String(guidanceText || '').slice(0, 1500)}`,
        `Dialog text: ${String(dialogText || '').slice(0, 2500)}`,
        `Original error: ${error?.message || String(error || '')}`,
      ].join('\n')
    );
  }

  return topUpSection;
}

export async function waitForStudentPackageNewPackageFormReady(dialog, options = {}) {
  const timeout = options.timeout ?? 30000;
  const titleInput = dialog.getByLabel('제목');
  const countInput = dialog.getByLabel(/총 횟수/);

  try {
    await expect(async () => {
      await expect(titleInput).toBeVisible({ timeout: 5000 });
      await expect(titleInput).toBeEnabled({ timeout: 5000 });
      await expect(titleInput).toBeEditable({ timeout: 5000 });
      await expect(countInput).toBeVisible({ timeout: 5000 });
      await expect(countInput).toBeEnabled({ timeout: 5000 });
      await expect(countInput).toBeEditable({ timeout: 5000 });
    }).toPass({ timeout });
  } catch (error) {
    const dialogText = await dialog.innerText({ timeout: 2000 }).catch(() => '');
    throw new Error(
      [
        'New private package form fields were not visible/ready.',
        `Dialog text: ${String(dialogText || '').slice(0, 2500)}`,
        `Original error: ${error?.message || String(error || '')}`,
      ].join('\n')
    );
  }

  return { titleInput, countInput };
}

export async function fillVisibleField(locator, value, options = {}) {
  const timeout = options.timeout ?? 30000;
  const nextValue = String(value ?? '');
  const stepTimeout = options.stepTimeout ?? 5000;
  const description = String(options.description || 'field').trim() || 'field';

  try {
    await expect(async () => {
      await locator.scrollIntoViewIfNeeded({ timeout: stepTimeout }).catch(() => {});
      await expect(locator).toBeVisible({ timeout: stepTimeout });
      await expect(locator).toBeEnabled({ timeout: stepTimeout });
      await expect(locator).toBeEditable({ timeout: stepTimeout });
      await locator.fill(nextValue, { timeout: stepTimeout });
      await expect(locator).toHaveValue(nextValue, { timeout: stepTimeout });
    }).toPass({ timeout });
  } catch (error) {
    const dialogText = await locator
      .page()
      .getByRole('dialog')
      .first()
      .innerText({ timeout: 2000 })
      .catch(() => '');
    throw new Error(
      [
        `Could not fill ${description} with value "${nextValue}" within ${timeout}ms.`,
        `Dialog text: ${String(dialogText || '').slice(0, 2500)}`,
        `Original error: ${error?.message || String(error || '')}`,
      ].join('\n')
    );
  }
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
