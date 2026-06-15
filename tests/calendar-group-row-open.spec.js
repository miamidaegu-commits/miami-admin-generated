import { expect, test } from '@playwright/test';
import { loginAsAdmin, openDashboardSection, selectTeacherOption } from './e2e-helpers.js';
import {
  cleanupAdminSeededCalendarGroupLessonSetup,
  cleanupAdminSeededPrivatePackageWorkflowCopyFixture,
  cleanupAdminSeededPrivateLessonEditFixture,
  createAdminSeededCalendarGroupLessonSetup,
  createAdminSeededPrivateReservation,
  createAdminSeededPrivateLessonEditFixture,
  getAdminSeededCalendarGroupLessonState,
} from './e2e-admin-helpers.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures/test-data.js';

function formatYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTodayYmdInSeoul() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function formatDisplayYmdString(ymd) {
  return String(ymd || '').replaceAll('-', '.');
}

function formatDisplayYmd(date) {
  return formatYmd(date).replaceAll('-', '.');
}

function addDays(baseDate, days) {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + days);
  return next;
}

async function collectCalendarDiagnostics(page, selectedDate, fixture = null) {
  const [calendarRows, groupRows, selectedDateText, bodyText, currentUrl, fixtureState] = await Promise.all([
    page
      .locator('[data-testid="calendar-lesson-row"]')
      .evaluateAll((rows) =>
        rows.slice(0, 40).map((row) => ({
          lessonId: row.getAttribute('data-lesson-id') || '',
          rowKind: row.getAttribute('data-row-kind') || '',
          groupName: row.getAttribute('data-group-name') || '',
          studentName: row.getAttribute('data-student-name') || '',
          text: (row.textContent || '').trim(),
        }))
      )
      .catch((error) => ({ error: error?.message || String(error) })),
    page
      .locator('[data-testid="group-row"]')
      .evaluateAll((rows) =>
        rows.slice(0, 40).map((row) => ({
          groupName: row.getAttribute('data-group-name') || '',
          text: (row.textContent || '').trim(),
        }))
      )
      .catch((error) => ({ error: error?.message || String(error) })),
    page
      .getByTestId('group-selected-date-label')
      .innerText({ timeout: 1000 })
      .catch(() => ''),
    page
      .locator('body')
      .innerText({ timeout: 1000 })
      .catch((error) => `body unavailable: ${error?.message || String(error)}`),
    Promise.resolve(page.url()).catch((error) => `url unavailable: ${error?.message || String(error)}`),
    fixture
      ? getAdminSeededCalendarGroupLessonState(fixture).catch((error) => ({
          error: error?.message || String(error),
        }))
      : Promise.resolve(null),
  ]);

  return {
    currentUrl,
    selectedDate,
    selectedDateText,
    calendarRows,
    groupRows,
    fixtureState,
    bodyText: String(bodyText || '').slice(0, 3000),
  };
}

async function selectCalendarDateByYmd(page, ymd) {
  const dateButton = page.locator(
    `[data-testid="calendar-day-button"][data-date="${String(ymd || '').trim()}"]`
  );
  await expect(dateButton).toBeVisible({ timeout: 15000 });
  await dateButton.click();
}

async function waitForCalendarLessonsSectionReady(page, exactLessonId = '', selectedDate = '') {
  const lessonsSection = page.getByTestId('calendar-lessons-section');
  await expect(lessonsSection).toBeVisible({ timeout: 15000 });
  if (exactLessonId) {
    const exactRow = lessonsSection.locator(
      `[data-testid="calendar-lesson-row"][data-lesson-id="${exactLessonId}"]`
    );
    const selectedDateInput = page.getByTestId('group-selected-date-control').getByLabel('선택 날짜');
    await expect
      .poll(async () => await exactRow.count(), { timeout: 15000 })
      .toBeGreaterThan(0)
      .catch(async () => {});
    if ((await exactRow.count()) === 0 && selectedDate && (await selectedDateInput.count()) > 0) {
      await selectedDateInput.fill(selectedDate);
    }
    await expect.poll(async () => await exactRow.count(), { timeout: 30000 }).toBeGreaterThan(0);
    return;
  }
  await expect(lessonsSection.getByText('불러오는 중...', { exact: true })).toHaveCount(0, {
    timeout: 30000,
  });
}

async function waitForTodaySchedulePanelReady(page) {
  const todaySchedulePanel = page.getByTestId('today-schedule-panel');
  await expect(todaySchedulePanel).toBeVisible({ timeout: 15000 });
  await expect(todaySchedulePanel.getByText('불러오는 중...', { exact: true })).toHaveCount(0, {
    timeout: 30000,
  });
  return todaySchedulePanel;
}

test.setTimeout(90000);

test('캘린더에서 그룹 수업 row를 클릭하면 출결/차감 모달이 열린다', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const uniqueToken = Date.now();
  const lessonDate = getTodayYmdInSeoul();
  const tempGroupName = `E2E 캘린더 그룹 ${uniqueToken}`;
  const tempLessonSubject = `E2E 캘린더 과목 ${uniqueToken}`;
  const tempLessonTime = '09:00';
  const tempGroupClassId = `e2e-calendar-group-class-${uniqueToken}`;
  const tempGroupLessonId = `e2e-calendar-group-lesson-${uniqueToken}`;

  let tempSetup = null;

  try {
    tempSetup = await createAdminSeededCalendarGroupLessonSetup({
      groupClassId: tempGroupClassId,
      groupLessonId: tempGroupLessonId,
      groupName: tempGroupName,
      lessonDate,
      lessonTime: tempLessonTime,
      lessonSubject: tempLessonSubject,
    });

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '캘린더');
    await selectCalendarDateByYmd(page, lessonDate);
    await waitForCalendarLessonsSectionReady(page, tempGroupLessonId, lessonDate);

    const groupLessonRow = page.locator(
      `[data-testid="calendar-lesson-row"][data-row-kind="group"][data-lesson-id="${tempGroupLessonId}"]`
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
      body: JSON.stringify(await collectCalendarDiagnostics(page, lessonDate, tempSetup), null, 2),
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
  const lessonDate = getTodayYmdInSeoul();
  const tempGroupName = `E2E 그룹필터 ${uniqueToken}`;
  const tempGroupSubject = `E2E 그룹필터 과목 ${uniqueToken}`;
  const tempPrivateStudentName = `E2E 개인필터 ${uniqueToken}`;
  const tempPrivateSubject = `E2E 개인필터 과목 ${uniqueToken}`;
  const tempGroupClassId = `e2e-group-filter-class-${uniqueToken}`;
  const tempGroupLessonId = `e2e-group-filter-lesson-${uniqueToken}`;

  let tempGroupSetup = null;
  let tempPrivateFixture = null;

  try {
    tempGroupSetup = await createAdminSeededCalendarGroupLessonSetup({
      groupClassId: tempGroupClassId,
      groupLessonId: tempGroupLessonId,
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
    await selectCalendarDateByYmd(page, lessonDate);
    await waitForCalendarLessonsSectionReady(page, tempGroupLessonId, lessonDate);

    const calendarGroupRow = page.locator(
      `[data-testid="calendar-lesson-row"][data-row-kind="group"][data-lesson-id="${tempGroupLessonId}"]`
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
    await expect
      .poll(async () => {
        const state = await getAdminSeededCalendarGroupLessonState(tempGroupSetup);
        return {
          groupClass: state?.groupClass?.exists === true,
          groupLesson: state?.groupLesson?.exists === true,
          lessonDate: state?.groupLesson?.date || '',
          lessonSubject: state?.groupLesson?.subject || '',
        };
      }, { timeout: 15000 })
      .toEqual({
        groupClass: true,
        groupLesson: true,
        lessonDate,
        lessonSubject: tempGroupSubject,
      });
    await waitForCalendarLessonsSectionReady(page, tempGroupLessonId, lessonDate);

    const todaySchedulePanel = await waitForTodaySchedulePanelReady(page);
    await expect(
      todaySchedulePanel.getByRole('heading', { name: '오늘의 단체반 일정', exact: true })
    ).toBeVisible();
    const todayGroupRow = todaySchedulePanel
      .getByTestId('today-schedule-row')
      .filter({ hasText: tempGroupSubject })
      .filter({ hasText: tempGroupName });
    await expect
      .poll(async () => await todayGroupRow.count(), { timeout: 20000 })
      .toBeGreaterThan(0);
    await expect(todayGroupRow.first()).toBeVisible();
    await expect(todaySchedulePanel).not.toContainText(tempPrivateStudentName);
    await expect(todaySchedulePanel).not.toContainText(tempPrivateSubject);

    const selectedDateControl = page.getByTestId('group-selected-date-control');
    await expect(selectedDateControl).toBeVisible();
    await expect(page.getByTestId('group-selected-date-label')).toContainText(
      `선택 날짜: ${formatDisplayYmdString(lessonDate)}`
    );

    await selectedDateControl.getByRole('button', { name: '다음 날짜', exact: true }).click();
    await expect(page.getByTestId('group-selected-date-label')).toContainText(
      `선택 날짜: ${formatDisplayYmd(addDays(new Date(`${lessonDate}T00:00:00`), 1))}`
    );

    await selectedDateControl.getByRole('button', { name: '이전 날짜', exact: true }).click();
    await expect(page.getByTestId('group-selected-date-label')).toContainText(
      `선택 날짜: ${formatDisplayYmdString(lessonDate)}`
    );

    const groupSectionGroupRow = page.locator(
      `[data-testid="calendar-lesson-row"][data-row-kind="group"][data-lesson-id="${tempGroupLessonId}"]`
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
      body: JSON.stringify(await collectCalendarDiagnostics(page, lessonDate, tempGroupSetup), null, 2),
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

test('관리자 캘린더 선생님 필터가 월 달력과 선택 날짜 목록, 1:1 예약 기록에 적용된다', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const uniqueToken = Date.now();
  const baseDate = new Date(`${getTodayYmdInSeoul()}T00:00:00`);
  const lessonDate = formatYmd(addDays(baseDate, 19));
  const teacherA = `calendar-filter-teacher-a-${uniqueToken}`;
  const teacherB = `calendar-filter-teacher-b-${uniqueToken}`;
  const groupNameA = `E2E 필터 그룹 A ${uniqueToken}`;
  const groupSubjectA = `E2E 필터 그룹 과목 A ${uniqueToken}`;
  const privateStudentA = `E2E 필터 개인 A ${uniqueToken}`;
  const privateSubjectA = `E2E 필터 개인 과목 A ${uniqueToken}`;
  const privateStudentB = `E2E 필터 개인 B ${uniqueToken}`;
  const privateSubjectB = `E2E 필터 개인 과목 B ${uniqueToken}`;
  const reservationStudentA = `E2E 필터 예약 A ${uniqueToken}`;
  const reservationStudentB = `E2E 필터 예약 B ${uniqueToken}`;
  const cancelledReservationStudentA = `E2E 필터 취소 A ${uniqueToken}`;
  const cancelledReservationStudentB = `E2E 필터 취소 B ${uniqueToken}`;

  let groupSetupA = null;
  let privateFixtureA = null;
  let privateFixtureB = null;
  const reservationIds = [];

  try {
    groupSetupA = await createAdminSeededCalendarGroupLessonSetup({
      groupClassId: `e2e-calendar-filter-group-a-${uniqueToken}`,
      groupLessonId: `e2e-calendar-filter-group-lesson-a-${uniqueToken}`,
      groupName: groupNameA,
      teacher: teacherA,
      teacherName: teacherA,
      lessonDate,
      lessonTime: '11:00',
      lessonSubject: groupSubjectA,
    });
    privateFixtureA = await createAdminSeededPrivateLessonEditFixture({
      unique: `calendar-teacher-filter-a-${uniqueToken}`,
      studentName: privateStudentA,
      teacher: teacherA,
      teacherName: teacherA,
      date: lessonDate,
      time: '10:00',
      subject: privateSubjectA,
    });
    privateFixtureB = await createAdminSeededPrivateLessonEditFixture({
      unique: `calendar-teacher-filter-b-${uniqueToken}`,
      studentName: privateStudentB,
      teacher: teacherB,
      teacherName: teacherB,
      date: lessonDate,
      time: '10:30',
      subject: privateSubjectB,
    });

    for (const reservationParams of [
      {
        reservationId: `e2e-calendar-filter-reservation-a-${uniqueToken}`,
        studentName: reservationStudentA,
        teacher: teacherA,
        teacherName: teacherA,
        time: '09:00',
        status: 'active',
      },
      {
        reservationId: `e2e-calendar-filter-reservation-b-${uniqueToken}`,
        studentName: reservationStudentB,
        teacher: teacherB,
        teacherName: teacherB,
        time: '09:05',
        status: 'active',
      },
      {
        reservationId: `e2e-calendar-filter-cancelled-a-${uniqueToken}`,
        studentName: cancelledReservationStudentA,
        teacher: teacherA,
        teacherName: teacherA,
        time: '12:00',
        status: 'cancelled',
      },
      {
        reservationId: `e2e-calendar-filter-cancelled-b-${uniqueToken}`,
        studentName: cancelledReservationStudentB,
        teacher: teacherB,
        teacherName: teacherB,
        time: '12:05',
        status: 'cancelled',
      },
    ]) {
      const reservation = await createAdminSeededPrivateReservation({
        ...reservationParams,
        date: lessonDate,
      });
      reservationIds.push(reservation.reservationId);
    }

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '캘린더');

    const teacherFilter = page.getByTestId('calendar-teacher-filter-select');
    if ((await teacherFilter.count()) === 0) {
      test.skip(true, '이 product-version 화면에서는 캘린더 선생님 필터가 렌더링되지 않습니다.');
    }
    await expect(teacherFilter).toBeVisible({ timeout: 20000 });
    await expect(teacherFilter).toHaveValue('');
    await expect(page.getByRole('heading', { name: /전체 선생님 일정/ })).toBeVisible();

    const dateButton = page.locator(`[data-testid="calendar-day-button"][data-date="${lessonDate}"]`);
    await expect(dateButton).toBeVisible({ timeout: 20000 });
    await expect(dateButton).toContainText(reservationStudentA, { timeout: 20000 });
    await expect(dateButton).toContainText(reservationStudentB, { timeout: 20000 });
    await dateButton.click();
    await waitForCalendarLessonsSectionReady(page, groupSetupA.groupLessonId, lessonDate);

    await expect(page.locator(`[data-testid="calendar-lesson-row"][data-lesson-id="${groupSetupA.groupLessonId}"]`)).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(`[data-testid="calendar-lesson-row"][data-lesson-id="${privateFixtureA.lessonId}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="calendar-lesson-row"][data-lesson-id="${privateFixtureB.lessonId}"]`)).toBeVisible();
    await expect(
      page.locator('[data-testid="calendar-lesson-row"][data-row-kind="privateReservation"]').filter({
        hasText: reservationStudentA,
      })
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="calendar-lesson-row"][data-row-kind="privateReservation"]').filter({
        hasText: reservationStudentB,
      })
    ).toBeVisible();

    await selectTeacherOption(teacherFilter, teacherA);
    await expect(page.getByRole('heading', { name: new RegExp(`${teacherA} 선생님 일정`) })).toBeVisible();
    await expect(dateButton).toContainText('수업 3개', { timeout: 20000 });
    await expect(dateButton).toContainText(reservationStudentA);
    await expect(dateButton).toContainText(privateStudentA);
    await expect(dateButton).not.toContainText(reservationStudentB);
    await expect(dateButton).not.toContainText(privateStudentB);

    await expect(page.locator(`[data-testid="calendar-lesson-row"][data-lesson-id="${groupSetupA.groupLessonId}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="calendar-lesson-row"][data-lesson-id="${privateFixtureA.lessonId}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="calendar-lesson-row"][data-lesson-id="${privateFixtureB.lessonId}"]`)).toHaveCount(0, {
      timeout: 15000,
    });
    await expect(
      page.locator('[data-testid="calendar-lesson-row"][data-row-kind="privateReservation"]').filter({
        hasText: reservationStudentA,
      })
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="calendar-lesson-row"][data-row-kind="privateReservation"]').filter({
        hasText: reservationStudentB,
      })
    ).toHaveCount(0, { timeout: 15000 });

    const historySection = page.getByTestId('private-reservation-history-section');
    await expect(historySection).toBeVisible({ timeout: 20000 });
    await expect(historySection.getByTestId('private-reservation-history-row').filter({ hasText: reservationStudentA })).toBeVisible();
    await expect(
      historySection.getByTestId('private-reservation-history-row').filter({ hasText: cancelledReservationStudentA })
    ).toBeVisible();
    await expect(
      historySection.getByTestId('private-reservation-history-row').filter({ hasText: reservationStudentB })
    ).toHaveCount(0, { timeout: 15000 });
    await expect(
      historySection.getByTestId('private-reservation-history-row').filter({ hasText: cancelledReservationStudentB })
    ).toHaveCount(0, { timeout: 15000 });
  } catch (error) {
    await testInfo.attach('admin-calendar-teacher-filter-diagnostics', {
      body: JSON.stringify(await collectCalendarDiagnostics(page, lessonDate, groupSetupA), null, 2),
      contentType: 'application/json',
    });
    throw error;
  } finally {
    await cleanupAdminSeededPrivatePackageWorkflowCopyFixture({ reservationIds }).catch(() => {});
    if (privateFixtureB) {
      await cleanupAdminSeededPrivateLessonEditFixture(privateFixtureB).catch(() => {});
    }
    if (privateFixtureA) {
      await cleanupAdminSeededPrivateLessonEditFixture(privateFixtureA).catch(() => {});
    }
    if (groupSetupA) {
      await cleanupAdminSeededCalendarGroupLessonSetup(groupSetupA).catch(() => {});
    }
  }
});
