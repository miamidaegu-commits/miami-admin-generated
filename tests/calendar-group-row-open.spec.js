import { expect, test } from '@playwright/test';
import { loginAsAdmin, openDashboardSection } from './e2e-helpers.js';
import {
  cleanupAdminSeededCalendarGroupLessonSetup,
  cleanupAdminSeededPrivateLessonEditFixture,
  createAdminSeededCalendarGroupLessonSetup,
  createAdminSeededPrivateLessonEditFixture,
} from './e2e-admin-helpers.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures/test-data.js';

function formatYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayYmd(date) {
  return formatYmd(date).replaceAll('-', '.');
}

function addDays(baseDate, days) {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + days);
  return next;
}

async function collectCalendarDiagnostics(page, selectedDate) {
  const [calendarRows, groupRows, bodyText, currentUrl] = await Promise.all([
    page
      .locator('[data-testid="calendar-lesson-row"]')
      .evaluateAll((rows) => rows.slice(0, 40).map((row) => (row.textContent || '').trim()))
      .catch((error) => ({ error: error?.message || String(error) })),
    page
      .locator('[data-testid="group-row"]')
      .evaluateAll((rows) => rows.slice(0, 40).map((row) => (row.textContent || '').trim()))
      .catch((error) => ({ error: error?.message || String(error) })),
    page
      .locator('body')
      .innerText({ timeout: 1000 })
      .catch((error) => `body unavailable: ${error?.message || String(error)}`),
    Promise.resolve(page.url()).catch((error) => `url unavailable: ${error?.message || String(error)}`),
  ]);

  return {
    currentUrl,
    selectedDate,
    calendarRows,
    groupRows,
    bodyText: String(bodyText || '').slice(0, 3000),
  };
}

test.setTimeout(90000);

test('캘린더에서 그룹 수업 row를 클릭하면 출결/차감 모달이 열린다', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const uniqueToken = Date.now();
  const lessonDate = formatYmd(new Date());
  const tempGroupName = `E2E 캘린더 그룹 ${uniqueToken}`;
  const tempLessonSubject = `E2E 캘린더 과목 ${uniqueToken}`;
  const tempLessonTime = '09:00';

  let tempSetup = null;

  try {
    tempSetup = await createAdminSeededCalendarGroupLessonSetup({
      groupName: tempGroupName,
      lessonDate,
      lessonTime: tempLessonTime,
      lessonSubject: tempLessonSubject,
    });

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '캘린더');

    const selectedDateOnlyButton = page.getByRole('button', {
      name: '선택 날짜만 보기',
      exact: true,
    });
    if (await selectedDateOnlyButton.isVisible().catch(() => false)) {
      await selectedDateOnlyButton.click();
    }

    const groupLessonRow = page.locator(
      `[data-testid="calendar-lesson-row"][data-row-kind="group"][data-group-name="${tempGroupName}"]`
    );

    await expect
      .poll(async () => await groupLessonRow.count(), { timeout: 15000 })
      .toBeGreaterThan(0);
    await expect(groupLessonRow.first()).toBeVisible();
    await expect(groupLessonRow.first()).toContainText(tempLessonSubject);

    await groupLessonRow.first().click();

    const attendanceDialog = page.getByRole('dialog', { name: /출결\s*\/\s*차감/ });
    await expect(attendanceDialog).toBeVisible();
    await expect(attendanceDialog.getByRole('heading', { name: /출결\s*\/\s*차감/ })).toBeVisible();
    await expect(attendanceDialog).toContainText(tempGroupName);
    await expect(attendanceDialog).toContainText(lessonDate);
    await expect(attendanceDialog).toContainText(tempLessonTime);
    await expect(attendanceDialog).toContainText(tempLessonSubject);
  } catch (error) {
    await testInfo.attach('calendar-group-row-open-diagnostics', {
      body: JSON.stringify(await collectCalendarDiagnostics(page, lessonDate), null, 2),
      contentType: 'application/json',
    });
    throw error;
  } finally {
    const attendanceDialog = page.getByRole('dialog', { name: /출결\s*\/\s*차감/ });
    if (await attendanceDialog.isVisible().catch(() => false)) {
      await attendanceDialog.getByRole('button', { name: '닫기', exact: true }).click();
      await expect(attendanceDialog).toBeHidden();
    }

    if (tempSetup) {
      await cleanupAdminSeededCalendarGroupLessonSetup(tempSetup);
    }
  }
});

test('단체반 관리 선택 날짜 수업 목록은 개인 수업을 제외하고 단체반 수업만 보여준다', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const uniqueToken = Date.now();
  const lessonDate = formatYmd(new Date());
  const tempGroupName = `E2E 그룹필터 ${uniqueToken}`;
  const tempGroupSubject = `E2E 그룹필터 과목 ${uniqueToken}`;
  const tempPrivateStudentName = `E2E 개인필터 ${uniqueToken}`;
  const tempPrivateSubject = `E2E 개인필터 과목 ${uniqueToken}`;

  let tempGroupSetup = null;
  let tempPrivateFixture = null;

  try {
    tempGroupSetup = await createAdminSeededCalendarGroupLessonSetup({
      groupName: tempGroupName,
      lessonDate,
      lessonTime: '09:30',
      lessonSubject: tempGroupSubject,
    });
    tempPrivateFixture = await createAdminSeededPrivateLessonEditFixture({
      unique: `calendar-filter-${uniqueToken}`,
      studentName: tempPrivateStudentName,
      date: lessonDate,
      time: '10:30',
      subject: tempPrivateSubject,
    });

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '캘린더');

    const calendarGroupRow = page.locator(
      `[data-testid="calendar-lesson-row"][data-row-kind="group"][data-group-name="${tempGroupName}"]`
    );
    const calendarPrivateRow = page.locator(
      `[data-testid="calendar-lesson-row"][data-row-kind="private"][data-student-name="${tempPrivateStudentName}"]`
    );

    await expect
      .poll(async () => await calendarGroupRow.count(), { timeout: 15000 })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => await calendarPrivateRow.count(), { timeout: 15000 })
      .toBeGreaterThan(0);
    await expect(calendarGroupRow.first()).toContainText(tempGroupSubject);
    await expect(calendarPrivateRow.first()).toContainText(tempPrivateSubject);

    await openDashboardSection(page, '단체반 관리');

    const todaySchedulePanel = page.getByTestId('today-schedule-panel');
    await expect(
      todaySchedulePanel.getByRole('heading', { name: '오늘의 단체반 일정', exact: true })
    ).toBeVisible();
    await expect(todaySchedulePanel).toContainText(tempGroupSubject);
    await expect(todaySchedulePanel).toContainText(tempGroupName);
    await expect(todaySchedulePanel).not.toContainText(tempPrivateStudentName);
    await expect(todaySchedulePanel).not.toContainText(tempPrivateSubject);

    const selectedDateControl = page.getByTestId('group-selected-date-control');
    await expect(selectedDateControl).toBeVisible();
    await expect(page.getByTestId('group-selected-date-label')).toContainText(
      `선택 날짜: ${formatDisplayYmd(new Date(`${lessonDate}T00:00:00`))}`
    );

    await selectedDateControl.getByRole('button', { name: '다음 날짜', exact: true }).click();
    await expect(page.getByTestId('group-selected-date-label')).toContainText(
      `선택 날짜: ${formatDisplayYmd(addDays(new Date(`${lessonDate}T00:00:00`), 1))}`
    );

    await selectedDateControl.getByRole('button', { name: '이전 날짜', exact: true }).click();
    await expect(page.getByTestId('group-selected-date-label')).toContainText(
      `선택 날짜: ${formatDisplayYmd(new Date(`${lessonDate}T00:00:00`))}`
    );

    const groupSectionGroupRow = page.locator(
      `[data-testid="calendar-lesson-row"][data-row-kind="group"][data-group-name="${tempGroupName}"]`
    );
    const groupSectionPrivateRow = page.locator(
      `[data-testid="calendar-lesson-row"][data-row-kind="private"][data-student-name="${tempPrivateStudentName}"]`
    );

    await expect
      .poll(async () => await groupSectionGroupRow.count(), { timeout: 15000 })
      .toBeGreaterThan(0);
    await expect(groupSectionGroupRow.first()).toContainText(tempGroupSubject);
    await expect(groupSectionPrivateRow).toHaveCount(0);
  } catch (error) {
    await testInfo.attach('group-management-selected-date-filter-diagnostics', {
      body: JSON.stringify(await collectCalendarDiagnostics(page, lessonDate), null, 2),
      contentType: 'application/json',
    });
    throw error;
  } finally {
    if (tempPrivateFixture) {
      await cleanupAdminSeededPrivateLessonEditFixture(tempPrivateFixture);
    }
    if (tempGroupSetup) {
      await cleanupAdminSeededCalendarGroupLessonSetup(tempGroupSetup);
    }
  }
});
