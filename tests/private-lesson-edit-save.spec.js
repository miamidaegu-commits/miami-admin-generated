import { expect, test } from '@playwright/test';
import {
  expectPrivateCalendarLessonRowVisible,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
import {
  cleanupAdminSeededPrivateLessonEditFixture,
  createAdminSeededPrivateLessonEditFixture,
} from './e2e-admin-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
} from './fixtures/test-data.js';

test.setTimeout(90000);

function getTodayYmdInSeoul() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

async function collectPrivateEditDiagnostics(page, studentName, privateLessonRow) {
  const [currentUrl, rowText, rowTexts, dialogText, bodyText] = await Promise.all([
    Promise.resolve(page.url()).catch((error) => `url unavailable: ${error?.message || String(error)}`),
    privateLessonRow?.innerText({ timeout: 1000 }).catch((error) => `row unavailable: ${error?.message || String(error)}`) ??
      Promise.resolve('row unavailable: locator not created'),
    page.locator('[data-testid="calendar-lesson-row"]').allInnerTexts().catch(() => []),
    page
      .getByRole('dialog', { name: '개인 수업 수정' })
      .innerText({ timeout: 1000 })
      .catch((error) => `dialog unavailable: ${error?.message || String(error)}`),
    page
      .locator('body')
      .innerText({ timeout: 1000 })
      .catch((error) => `body unavailable: ${error?.message || String(error)}`),
  ]);

  return {
    currentUrl,
    studentName,
    rowText: String(rowText || '').slice(0, 2000),
    rowTexts,
    dialogText: String(dialogText || '').slice(0, 2000),
    bodyText: String(bodyText || '').slice(0, 3000),
  };
}

test('admin can save a private lesson subject change and restore it', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'This test is intended for chromium.');

  const unique = Date.now();
  const fixture = await createAdminSeededPrivateLessonEditFixture({
    unique,
    studentName: `E2E 개인수정 ${unique}`,
    date: getTodayYmdInSeoul(),
  });
  const tempSubject = `E2E 개인수업 과목 ${unique}`;

  let originalSubject = '';
  let privateLessonRow = null;

  async function openEditDialog() {
    privateLessonRow = await expectPrivateCalendarLessonRowVisible(page, fixture.studentName);
    const editButton = privateLessonRow.getByRole('button', { name: '수정', exact: true });
    await expect(editButton).toBeEnabled({ timeout: 15000 });
    await editButton.dispatchEvent('click');

    const editDialog = page.getByRole('dialog', { name: '개인 수업 수정' });
    await expect(editDialog).toBeVisible({ timeout: 15000 });
    return editDialog;
  }

  async function submitEditDialog(editDialog) {
    const saveButton = editDialog.getByRole('button', { name: '저장', exact: true });
    await expect(saveButton).toBeEnabled({ timeout: 15000 });
    await saveButton.dispatchEvent('click');
    await expect(editDialog).toBeHidden({ timeout: 15000 });
  }

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '캘린더');

    const selectedDateOnlyButton = page.getByRole('button', {
      name: '선택 날짜만 보기',
      exact: true,
    });
    if (await selectedDateOnlyButton.isVisible().catch(() => false)) {
      await selectedDateOnlyButton.click();
    }

    const editDialog = await openEditDialog();
    await expect(editDialog.getByLabel('날짜')).toBeVisible();
    await expect(editDialog.getByLabel('시간')).toBeVisible();

    const subjectInput = editDialog.getByLabel('과목');
    originalSubject = await subjectInput.inputValue();
    await expect.soft(originalSubject.trim()).not.toBe('');

    await subjectInput.fill(tempSubject);
    await submitEditDialog(editDialog);

    await expect(privateLessonRow).toContainText(tempSubject, { timeout: 15000 });

    const restoreDialog = await openEditDialog();
    await expect(restoreDialog.getByLabel('과목')).toHaveValue(tempSubject);
    await restoreDialog.getByLabel('과목').fill(originalSubject);
    await submitEditDialog(restoreDialog);

    await expect(privateLessonRow).toContainText(originalSubject, { timeout: 15000 });
  } catch (error) {
    await testInfo.attach('private-lesson-edit-save-diagnostics', {
      body: JSON.stringify(
        await collectPrivateEditDiagnostics(page, fixture.studentName, privateLessonRow),
        null,
        2
      ),
      contentType: 'application/json',
    });
    throw error;
  } finally {
    const editDialog = page.getByRole('dialog', { name: '개인 수업 수정' });
    if (await editDialog.isVisible().catch(() => false)) {
      await editDialog.getByRole('button', { name: '취소', exact: true }).click();
      await expect(editDialog).toBeHidden();
    }

    await cleanupAdminSeededPrivateLessonEditFixture(fixture);
  }
});
