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

test('admin can open an existing private lesson edit modal', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'This test is intended for chromium.');

  const unique = Date.now();
  const fixture = await createAdminSeededPrivateLessonEditFixture({
    unique,
    studentName: `E2E 개인수정 ${unique}`,
    date: getTodayYmdInSeoul(),
  });

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

    const privateLessonRow = await expectPrivateCalendarLessonRowVisible(
      page,
      fixture.studentName
    );
    await privateLessonRow.getByRole('button', { name: '수정', exact: true }).click();

    const editDialog = page.getByRole('dialog', { name: '개인 수업 수정' });
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByRole('heading', { name: '개인 수업 수정' })).toBeVisible();
    await expect(editDialog.getByLabel('날짜')).toBeVisible();
    await expect(editDialog.getByLabel('시간')).toBeVisible();
    await expect(editDialog.getByLabel('과목')).toBeVisible();
  } finally {
    const editDialog = page.getByRole('dialog', { name: '개인 수업 수정' });
    if (await editDialog.isVisible().catch(() => false)) {
      await editDialog.getByRole('button', { name: '취소', exact: true }).click();
      await expect(editDialog).toBeHidden();
    }

    await cleanupAdminSeededPrivateLessonEditFixture(fixture);
  }
});
