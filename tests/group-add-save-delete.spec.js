import { test, expect } from '@playwright/test';
import { getGroupRow, loginAsAdmin, openDashboardSection } from './e2e-helpers.js';
import { cleanupAdminGroupClassByName } from './e2e-admin-helpers.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures/test-data.js';

const E2E_ACADEMY_ID = 'academy_e2e_default';

function formatYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(baseDate, days) {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + days);
  return next;
}

async function acceptNextDialog(page, timeout = 5000) {
  const dialog = await page.waitForEvent('dialog', { timeout });
  const message = dialog.message();
  await dialog.accept();
  return message;
}

async function attachGroupSaveDiagnostics(testInfo, page, groupName, groupDialog, targetGroupRow, consoleMessages) {
  const saveButton = groupDialog.getByRole('button', { name: /저장|저장 중/ });
  const diagnostics = {
    url: page.url(),
    groupName,
    dialogVisible: await groupDialog.isVisible().catch(() => false),
    dialogText: await groupDialog.textContent().catch((error) => `dialog text failed: ${error.message}`),
    saveButtonText: await saveButton.textContent().catch((error) => `save button text failed: ${error.message}`),
    saveButtonDisabled: await saveButton.isDisabled().catch(() => null),
    targetRowCount: await targetGroupRow.count().catch(() => null),
    visibleGroupRows: await page.locator('[data-testid="group-row"]').evaluateAll((rows) =>
      rows.slice(0, 12).map((row) => row.textContent?.trim() || '')
    ).catch((error) => [`group rows failed: ${error.message}`]),
    bodyText: await page.locator('body').innerText().then((text) => text.slice(0, 3000)).catch((error) => `body text failed: ${error.message}`),
    consoleMessages,
  };

  await testInfo.attach('group-add-save-delete-diagnostics.json', {
    body: JSON.stringify(diagnostics, null, 2),
    contentType: 'application/json',
  });
}

test('관리자가 그룹을 생성하고 다시 삭제해 원복할 수 있다', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(90000);

  const uniqueToken = Date.now();
  const groupName = `E2E 그룹 ${uniqueToken}`;
  const startDate = formatYmd(addDays(new Date(), 720));
  const classTime = '19:30';
  const subject = `E2E 과목 ${uniqueToken}`;
  const consoleMessages = [];

  page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    consoleMessages.push(`${message.type()}: ${message.text()}`);
    if (consoleMessages.length > 25) consoleMessages.shift();
  });

  await cleanupAdminGroupClassByName({
    academyId: E2E_ACADEMY_ID,
    groupName,
  });

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '단체반 관리');

  const targetGroupRow = getGroupRow(page, groupName);
  await expect(targetGroupRow).toHaveCount(0);

  await page.getByRole('button', { name: '정규반 만들기', exact: true }).click();

  const groupDialog = page.getByRole('dialog', { name: '정규반 만들기' });
  await expect(groupDialog).toBeVisible();

  await groupDialog.getByLabel('반 이름').fill(groupName);

  const teacherSelect = groupDialog.getByLabel('담당 선생님');
  await expect.poll(async () => await teacherSelect.locator('option').count()).toBeGreaterThan(1);

  const teacherValue = await teacherSelect.locator('option').evaluateAll((options) => {
    const matched = options.find((option) => {
      const value = option.getAttribute('value') || '';
      return value.trim() !== '';
    });
    return matched?.getAttribute('value') || '';
  });

  expect(teacherValue).not.toBe('');
  await teacherSelect.selectOption(teacherValue);

  await groupDialog.getByLabel('정원 (명)').fill('4');
  await groupDialog.getByLabel('수업 시작일 (자동 일정 기준)').fill(startDate);
  await groupDialog.getByLabel('기본 시간 (HH:mm)').fill(classTime);
  await groupDialog.getByLabel('과목').fill(subject);
  await groupDialog.getByRole('button', { name: '월', exact: true }).click();

  let groupCreated = false;

  try {
    const saveDialogPromise = acceptNextDialog(page, 60000).catch(() => null);
    await groupDialog.getByRole('button', { name: '저장', exact: true }).click();

    const saveDialogMessage = await saveDialogPromise;
    if (saveDialogMessage) {
      expect(saveDialogMessage).toContain('반을 저장했습니다.');
    }

    try {
      await expect(groupDialog).toBeHidden({ timeout: 60000 });
    } catch (error) {
      await attachGroupSaveDiagnostics(
        testInfo,
        page,
        groupName,
        groupDialog,
        targetGroupRow,
        consoleMessages
      );
      throw error;
    }

    await expect
      .poll(async () => await targetGroupRow.count(), { timeout: 20000 })
      .toBe(1);
    await expect(targetGroupRow).toBeVisible();
    groupCreated = true;

    const deleteDialogPromise = acceptNextDialog(page);
    await targetGroupRow.getByRole('button', { name: '삭제', exact: true }).click();
    const deleteDialogMessage = await deleteDialogPromise;
    expect(deleteDialogMessage).toContain('이 반을 삭제할까요?');

    await expect
      .poll(async () => await targetGroupRow.count(), { timeout: 10000 })
      .toBe(0);
    groupCreated = false;
  } finally {
    if (groupCreated && (await targetGroupRow.count()) > 0) {
      const cleanupDialogPromise = acceptNextDialog(page);
      await targetGroupRow.getByRole('button', { name: '삭제', exact: true }).click();
      await cleanupDialogPromise;

      await expect
        .poll(async () => await targetGroupRow.count(), { timeout: 10000 })
        .toBe(0);
    }

    await cleanupAdminGroupClassByName({
      academyId: E2E_ACADEMY_ID,
      groupName,
    });
  }
});
