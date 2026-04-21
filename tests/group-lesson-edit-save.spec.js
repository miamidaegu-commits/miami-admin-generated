import { test, expect } from '@playwright/test';
import {
  getGroupRow,
  getRegisteredStudentsHeading,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TEST_GROUP_NAME,
} from './fixtures/test-data.js';

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

async function acceptNextDialog(page) {
  const dialogHandled = new Promise((resolve) => {
    page.once('dialog', async (dialog) => {
      await dialog.accept();
      resolve(dialog.message());
    });
  });

  return dialogHandled;
}

test('관리자가 그룹 수업의 과목을 수정 저장한 뒤 원복할 수 있다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const lessonDate = formatYmd(addDays(new Date(), 560));
  const lessonTime = '22:10';
  const uniqueToken = Date.now();
  const originalSubject = `E2E 그룹수업 원본 ${uniqueToken}`;
  const updatedSubject = `E2E 그룹수업 수정 ${uniqueToken}`;

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '반 관리');

  const groupRow = getGroupRow(page, TEST_GROUP_NAME);
  await expect(groupRow).toBeVisible();
  await groupRow.click();

  await expect(getRegisteredStudentsHeading(page, TEST_GROUP_NAME)).toBeVisible();

  const lessonSection = page.getByTestId('group-lessons-section').locator('..');
  await expect(lessonSection).toBeVisible();

  const rowForSubject = (subject) =>
    lessonSection
      .locator('.table-row')
      .filter({ hasText: lessonDate })
      .filter({ hasText: lessonTime })
      .filter({ hasText: subject });

  async function openAddDialog() {
    await page.getByRole('button', { name: '특별 수업 추가', exact: true }).click();

    const lessonDialog = page.getByRole('dialog', { name: '특별 수업 추가' });
    await expect(lessonDialog).toBeVisible();
    await expect(lessonDialog).toContainText(TEST_GROUP_NAME);
    return lessonDialog;
  }

  async function openEditDialog(subject) {
    const row = rowForSubject(subject).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '수정', exact: true }).click();

    const editDialog = page.getByRole('dialog', { name: '수업 수정' });
    await expect(editDialog).toBeVisible();
    return editDialog;
  }

  async function saveEditedSubject(fromSubject, toSubject) {
    const editDialog = await openEditDialog(fromSubject);
    const subjectInput = editDialog.getByLabel('과목');
    await expect(subjectInput).toBeVisible();
    await subjectInput.fill(toSubject);
    await editDialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(editDialog).toBeHidden();
  }

  async function deleteLesson(subject) {
    const row = rowForSubject(subject).first();
    await expect(row).toBeVisible();
    const dialogHandled = acceptNextDialog(page);
    await row.getByRole('button', { name: '삭제', exact: true }).click();
    await dialogHandled;
    await expect
      .poll(async () => await rowForSubject(subject).count(), { timeout: 10000 })
      .toBe(0);
  }

  await expect(rowForSubject(originalSubject)).toHaveCount(0);
  await expect(rowForSubject(updatedSubject)).toHaveCount(0);

  let createdSubject = '';

  try {
    const addDialog = await openAddDialog();
    await addDialog.getByLabel('날짜').fill(lessonDate);
    await addDialog.getByLabel('시간').fill(lessonTime);
    await addDialog.getByLabel('과목').fill(originalSubject);
    await addDialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(addDialog).toBeHidden();

    createdSubject = originalSubject;

    await expect
      .poll(async () => await rowForSubject(originalSubject).count(), { timeout: 10000 })
      .toBe(1);
    await expect(rowForSubject(originalSubject).first()).toBeVisible();

    await saveEditedSubject(originalSubject, updatedSubject);

    createdSubject = updatedSubject;

    await expect
      .poll(async () => await rowForSubject(updatedSubject).count(), { timeout: 10000 })
      .toBe(1);
    await expect(rowForSubject(updatedSubject).first()).toBeVisible();
    await expect(rowForSubject(originalSubject)).toHaveCount(0);

    await saveEditedSubject(updatedSubject, originalSubject);

    createdSubject = originalSubject;

    await expect
      .poll(async () => await rowForSubject(originalSubject).count(), { timeout: 10000 })
      .toBe(1);
    await expect(rowForSubject(originalSubject).first()).toBeVisible();
    await expect(rowForSubject(updatedSubject)).toHaveCount(0);
  } finally {
    if (!createdSubject) return;

    if (createdSubject === updatedSubject && (await rowForSubject(updatedSubject).count()) > 0) {
      await saveEditedSubject(updatedSubject, originalSubject);
      createdSubject = originalSubject;
      await expect
        .poll(async () => await rowForSubject(originalSubject).count(), { timeout: 10000 })
        .toBe(1);
    }

    if (await rowForSubject(originalSubject).count()) {
      await deleteLesson(originalSubject);
    }
  }
});
