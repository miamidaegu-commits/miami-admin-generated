import { test, expect } from '@playwright/test';
import { getGroupRow, loginAsAdmin, openDashboardSection } from './e2e-helpers.js';
import {
  cleanupAdminGroupClassByName,
  createAdminSeededCalendarGroupLessonSetup,
  getAdminGroupClassByName,
} from './e2e-admin-helpers.js';
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

async function acceptOptionalDialog(page, timeout = 5000) {
  return acceptNextDialog(page, timeout).catch((error) => {
    if (/Timeout/i.test(String(error?.message || ''))) return null;
    throw error;
  });
}

async function expectGroupClassByName(groupName, predicate, timeout = 20000) {
  let latest = null;
  await expect
    .poll(
      async () => {
        latest = await getAdminGroupClassByName({
          academyId: E2E_ACADEMY_ID,
          groupName,
        });
        return predicate(latest);
      },
      { timeout }
    )
    .toBe(true);
  return latest;
}

async function closeGroupClassThroughClosureModal(page, targetGroupRow, groupName, reason) {
  await targetGroupRow.getByRole('button', { name: '반 운영 종료', exact: true }).click();

  const closureDialog = page.getByRole('dialog', { name: '반 운영 종료' });
  await expect(closureDialog).toBeVisible({ timeout: 10000 });
  await closureDialog.getByLabel('종료 사유').fill(reason);

  const confirmDialogPromise = acceptOptionalDialog(page, 3000);
  await closureDialog.getByRole('button', { name: '운영 종료', exact: true }).click();
  const confirmMessage = await confirmDialogPromise;
  if (confirmMessage) expect(confirmMessage).toContain('반 운영을 종료할까요?');

  const resultMessage = await acceptOptionalDialog(page, 3000);
  if (resultMessage) expect(resultMessage).toContain('반 운영을 종료했습니다.');
  await expectGroupClassByName(
    groupName,
    (group) => String(group?.status || '') === 'closed',
    60000
  );
  if (await closureDialog.isVisible().catch(() => false)) {
    await expect(closureDialog).toBeHidden({ timeout: 5000 }).catch(async () => {
      await closureDialog.getByRole('button', { name: '취소', exact: true }).click().catch(() => {});
    });
  }
}

test('관리자가 그룹을 생성하고 다시 삭제해 원복할 수 있다', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(90000);

  const uniqueToken = Date.now();
  const groupName = `E2E 그룹 ${uniqueToken}`;
  const startDate = formatYmd(addDays(new Date(), 720));
  const classTime = '19:30';
  const subject = `E2E 과목 ${uniqueToken}`;
  let setup = null;

  await cleanupAdminGroupClassByName({
    academyId: E2E_ACADEMY_ID,
    groupName,
  });

  try {
    setup = await createAdminSeededCalendarGroupLessonSetup({
      groupName,
      lessonDate: startDate,
      lessonTime: classTime,
      lessonSubject: subject,
      teacherName: 'teacher',
      maxStudents: 4,
    });
    await expectGroupClassByName(groupName, (group) => Boolean(group?.id), 60000);

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '단체반 관리');
    const targetGroupRow = getGroupRow(page, groupName);

    await expect.poll(async () => await targetGroupRow.count(), { timeout: 20000 }).toBe(1);
    await expect(targetGroupRow).toBeVisible();

    await closeGroupClassThroughClosureModal(
      page,
      targetGroupRow,
      groupName,
      `E2E cleanup ${uniqueToken}`
    );

    await expect(targetGroupRow).toBeVisible({ timeout: 10000 });
    await cleanupAdminGroupClassByName({
      academyId: E2E_ACADEMY_ID,
      groupName,
    });
    await expectGroupClassByName(groupName, (group) => group === null, 10000);
  } catch (error) {
    await testInfo.attach('group-add-save-delete-diagnostics.json', {
      body: JSON.stringify(
        {
          groupName,
          setup,
          group: await getAdminGroupClassByName({ academyId: E2E_ACADEMY_ID, groupName }).catch(
            (snapshotError) => ({ error: snapshotError?.message || String(snapshotError) })
          ),
          url: page.url(),
          bodyText: await page.locator('body').innerText().then((text) => text.slice(0, 3000)).catch(() => ''),
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
    throw error;
  } finally {
    await cleanupAdminGroupClassByName({
      academyId: E2E_ACADEMY_ID,
      groupName,
    });
    await expectGroupClassByName(groupName, (group) => group === null, 10000);
  }
});
