import { test, expect } from '@playwright/test';
import {
  clickGroupRow,
  getRegisteredStudentsHeading,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures/test-data.js';
import {
  cleanupAdminSeededCalendarGroupLessonSetup,
  createAdminSeededCalendarGroupLessonSetup,
  getAdminGroupLessonIdsInRange,
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

async function acceptNextDialogs(page, expectedCount, timeout = 15000) {
  const messages = [];

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      page.off('dialog', onDialog);
      resolve();
    }, timeout);
    function onDialog(dialog) {
      messages.push(dialog.message());
      dialog.accept().then(() => {
        if (messages.length >= expectedCount) {
          clearTimeout(timer);
          page.off('dialog', onDialog);
          resolve();
        }
      });
    }

    page.on('dialog', onDialog);
  });

  return messages;
}

test('관리자가 그룹의 이후 일정 삭제 흐름으로 생성한 미래 일정 범위를 정리할 수 있다', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(120000);

  const today = new Date();
  const rangeStart = formatYmd(addDays(today, 900));
  const rangeEnd = formatYmd(addDays(today, 930));
  const unique = `${Date.now()}-${testInfo.workerIndex}`;
  const groupName = `E2E purge group ${unique}`;
  const baseLessonId = `e2e-purge-base-${unique}`;
  let setup = null;

  try {
    setup = await createAdminSeededCalendarGroupLessonSetup({
      groupClassId: `e2e-purge-class-${unique}`,
      groupLessonId: baseLessonId,
      groupName,
      teacherName: 'teacher',
      lessonDate: formatYmd(addDays(today, 890)),
      lessonTime: '19:30',
      lessonSubject: `E2E purge base ${unique}`,
      weekdays: [1],
    });

    await expect
      .poll(
        async () =>
          getAdminGroupLessonIdsInRange({
            groupClassId: setup.groupClassId,
            startDate: rangeStart,
            endDate: rangeEnd,
          }),
        { timeout: 15000 }
      )
      .toEqual([]);

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '단체반 관리');

    await clickGroupRow(page, groupName);

    await expect(getRegisteredStudentsHeading(page, groupName)).toBeVisible();
    await expect(page.getByRole('heading', { name: '수업 일정' })).toBeVisible({ timeout: 15000 });

    const lessonSection = page.getByTestId('group-lessons-section');

    await expect(lessonSection).toBeVisible({ timeout: 15000 });

    async function lessonIdsInRange() {
      return getAdminGroupLessonIdsInRange({
        groupClassId: setup.groupClassId,
        startDate: rangeStart,
        endDate: rangeEnd,
      });
    }

    await page.getByRole('button', { name: '추가 일정 생성', exact: true }).click();

    const createDialog = page.getByRole('dialog', { name: '추가 일정 생성' });
    await expect(createDialog).toBeVisible();
    await expect(createDialog).toContainText(groupName);

    await createDialog.getByLabel('시작일').fill(rangeStart);
    await createDialog.getByLabel('종료일').fill(rangeEnd);

    const createDialogHandled = acceptNextDialogs(page, 1);
    await createDialog.getByRole('button', { name: '일정 생성', exact: true }).click();
    const createMessages = await createDialogHandled;

    if (createMessages[0]) expect(createMessages[0]).toContain('추가 일정 생성 완료');
    await expect(createDialog).toBeHidden({ timeout: 15000 }).catch(() => {});

    await expect.poll(async () => (await lessonIdsInRange()).length, { timeout: 30000 }).toBeGreaterThan(0);

    await openDashboardSection(page, '단체반 관리');
    await clickGroupRow(page, groupName);
    await expect(page.getByTestId('group-lessons-section')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: '이후 일정 삭제', exact: true }).click();

    const purgeDialog = page.getByRole('dialog', { name: '이후 일정 삭제' });
    await expect(purgeDialog).toBeVisible();
    await expect(purgeDialog).toContainText(groupName);

    await purgeDialog.getByLabel('삭제 기준일').fill(rangeStart);

    const purgeDialogsHandled = acceptNextDialogs(page, 2);
    await purgeDialog.getByRole('button', { name: '삭제 실행', exact: true }).click();
    const purgeMessages = await purgeDialogsHandled;

    if (purgeMessages[0]) expect(purgeMessages[0]).toContain(`기준일 ${rangeStart} 이후`);
    if (purgeMessages[1]) {
      expect(purgeMessages[1]).toContain('기준일 이후(포함) 그룹 수업 일정 삭제 완료');
    }
    await expect
      .poll(async () => (await lessonIdsInRange()).length, { timeout: 30000 })
      .toBe(0);
    await expect(purgeDialog).toBeHidden({ timeout: 15000 }).catch(() => {});

    await openDashboardSection(page, '단체반 관리');
    await clickGroupRow(page, groupName);
    await expect(page.getByTestId('group-lessons-section')).toBeVisible({ timeout: 15000 });
  } finally {
    if (setup) {
      await cleanupAdminSeededCalendarGroupLessonSetup(setup).catch(() => {});
    }
  }
});
