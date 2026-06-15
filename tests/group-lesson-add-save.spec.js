import { test, expect } from '@playwright/test';
import {
  clickGroupRow,
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
import {
  cleanupAdminGroupLessonById,
  getAdminGroupClassByName,
  getAdminGroupLessonByFields,
} from './e2e-admin-helpers.js';

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

async function acceptOptionalDialog(page, timeout = 5000) {
  return page
    .waitForEvent('dialog', { timeout })
    .then(async (dialog) => {
      const message = dialog.message();
      await dialog.accept();
      return message;
    })
    .catch((error) => {
      if (/Timeout/i.test(String(error?.message || ''))) return null;
      throw error;
    });
}

test('관리자가 그룹의 특별 수업을 추가한 뒤 삭제로 원복할 수 있다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(90000);

  const lessonDate = formatYmd(addDays(new Date(), 540));
  const lessonTime = '21:45';
  const lessonSubject = `E2E 특별수업 ${Date.now()}`;
  let groupClass = null;
  let createdLessonId = '';

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '단체반 관리');

  groupClass = await expect
    .poll(
      async () =>
        getAdminGroupClassByName({
          groupName: TEST_GROUP_NAME,
        }),
      { timeout: 15000 }
    )
    .not.toBeNull()
    .then(async () =>
      getAdminGroupClassByName({
        groupName: TEST_GROUP_NAME,
      })
    );

  const groupRow = await clickGroupRow(page, TEST_GROUP_NAME);

  await expect(getRegisteredStudentsHeading(page, TEST_GROUP_NAME)).toBeVisible();

  const lessonSection = page.getByTestId('group-lessons-section');
  await expect(lessonSection).toBeVisible();

  const targetLessonRow = lessonSection.locator(
    `[data-testid="group-lesson-row"][data-lesson-date="${lessonDate}"][data-lesson-time="${lessonTime}"][data-lesson-subject="${lessonSubject}"]`
  );

  await expect(targetLessonRow).toHaveCount(0);

  const addLessonButton = page.getByRole('button', { name: '특별 수업 추가', exact: true });
  await expect(addLessonButton).toBeEnabled({ timeout: 15000 });
  await addLessonButton.click();

  const lessonDialog = page.getByRole('dialog', { name: '특별 수업 추가' });
  await expect(lessonDialog).toBeVisible();
  await expect(lessonDialog).toContainText(TEST_GROUP_NAME);

  await lessonDialog.getByLabel('날짜').fill(lessonDate);
  await lessonDialog.getByLabel('시간').fill(lessonTime);
  await lessonDialog.getByLabel('과목').fill(lessonSubject);

  const saveButton = lessonDialog.getByRole('button', { name: '저장', exact: true });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  let lessonCreated = false;

  try {
    const createdLesson = await expect
      .poll(
        async () =>
          getAdminGroupLessonByFields({
            groupClassId: groupClass.id,
            date: lessonDate,
            time: lessonTime,
            subject: lessonSubject,
          }),
        { timeout: 30000 }
      )
      .not.toBeNull()
      .then(async () =>
        getAdminGroupLessonByFields({
          groupClassId: groupClass.id,
          date: lessonDate,
          time: lessonTime,
          subject: lessonSubject,
        })
      );
    createdLessonId = createdLesson.id;
    await expect(lessonDialog).toBeHidden({ timeout: 30000 }).catch(async () => {
      await lessonDialog.getByRole('button', { name: '닫기', exact: true }).click().catch(() => {});
      await expect(lessonDialog).toBeHidden({ timeout: 5000 }).catch(() => {});
    });

    const createdLessonRow = lessonSection.locator(
      `[data-testid="group-lesson-row"][data-lesson-id="${createdLessonId}"]`
    );
    await expect
      .poll(async () => await createdLessonRow.count(), { timeout: 10000 })
      .toBe(1);
    lessonCreated = true;

    await expect(createdLessonRow.first()).toBeVisible();

    const deleteButton = createdLessonRow.first().getByRole('button', { name: '삭제', exact: true });
    await expect(deleteButton).toBeVisible({ timeout: 10000 });
    await expect(deleteButton).toBeEnabled({ timeout: 10000 });
    const deleteDialogHandled = acceptOptionalDialog(page, 2000);
    await deleteButton.click({ timeout: 10000 });
    await deleteDialogHandled;

    await expect
      .poll(
        async () =>
          (await getAdminGroupLessonByFields({
            groupClassId: groupClass.id,
            date: lessonDate,
            time: lessonTime,
            subject: lessonSubject,
          })) === null,
        { timeout: 15000 }
      )
      .toBe(true);
  } finally {
    if (!lessonCreated) return;

    const remainingCount = await page
      .locator(`[data-testid="group-lesson-row"][data-lesson-id="${createdLessonId}"]`)
      .count();
    if (remainingCount === 0) return;

    const cleanupRow = page
      .locator(`[data-testid="group-lesson-row"][data-lesson-id="${createdLessonId}"]`)
      .first();
    const cleanupButton = cleanupRow.getByRole('button', { name: '삭제', exact: true });
    await expect(cleanupRow).toBeVisible({ timeout: 5000 });
    await expect(cleanupButton).toBeEnabled({ timeout: 5000 });
    const cleanupDialogHandled = acceptOptionalDialog(page, 2000);
    await cleanupButton.click({ timeout: 10000 });
    await cleanupDialogHandled;

    await expect
      .poll(
        async () =>
          (await getAdminGroupLessonByFields({
            groupClassId: groupClass.id,
            date: lessonDate,
            time: lessonTime,
            subject: lessonSubject,
          })) === null,
        { timeout: 10000 }
      )
      .toBe(true)
      .catch(async () => {
        await cleanupAdminGroupLessonById({ lessonId: createdLessonId });
      });
  }
});
