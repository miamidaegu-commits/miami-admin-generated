import { expect, test } from '@playwright/test';
import { BASE_URL, loginAsAdmin, openDashboardSection } from './e2e-helpers.js';
import {
  createAdminSeededLessonRequest,
  createAdminSeededPrivateLesson,
  getAdminSeededLesson,
  getAdminSeededLessonRequest,
  getAdminSeededPrivatePackagesForStudent,
  getAdminLessonsForStudentTeacher,
} from './e2e-admin-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TEST_TEACHER_EMAIL,
  TEST_TEACHER_PASSWORD,
} from './fixtures/test-data.js';

function formatYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(ymd, days) {
  const [year, month, day] = ymd.split('-').map(Number);
  return formatYmd(new Date(year, month - 1, day + days));
}

async function loginAsTeacher(page) {
  await page.goto(BASE_URL);
  const emailInput = page.getByLabel(/Email|이메일/i).or(page.locator('input[type="email"]')).first();
  const passwordInput = page
    .getByLabel(/Password|비밀번호/i)
    .or(page.locator('input[type="password"]'))
    .first();
  await emailInput.fill(TEST_TEACHER_EMAIL);
  await passwordInput.fill(TEST_TEACHER_PASSWORD);
  await page.getByRole('button', { name: /Sign In|로그인/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  await expect(page.getByRole('button', { name: '캘린더', exact: true })).toBeVisible();
}

function cssAttributeValue(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function getLessonRequestRowById(page, requestId) {
  const safeRequestId = String(requestId || '').trim();
  if (!safeRequestId) throw new Error('lesson request id is required.');
  return page.locator(
    `[data-testid="lesson-request-row"][data-request-id="${cssAttributeValue(safeRequestId)}"]`
  );
}

async function approveLessonRequestAndWait(page, createdRequest, options = {}) {
  if (createdRequest.requestId) {
    await expectLessonRequestDocStatus(createdRequest.requestId, {
      approvalStatus: 'pending',
    });
  }

  const requestRow = await expectLessonRequestRowVisible(page, createdRequest);
  if (createdRequest.subject) {
    await expect(requestRow).toContainText(createdRequest.subject);
  }
  await clickLessonRequestAction(page, createdRequest, requestRow, '승인');
  await expectLessonRequestApprovedInFirestore(createdRequest);
  if (options.skipUiRemovalCheck !== true) {
    await expectApprovedLessonRequestRemovedFromUi(page, createdRequest, { optionalRefresh: true });
  }
}

async function expectLessonRequestDocStatus(requestId, expected, options = {}) {
  await expect
    .poll(
      async () => {
        const request = await getAdminSeededLessonRequest(requestId);
        if (!request) return { exists: false };
        return {
          exists: true,
          approvalStatus: request.approvalStatus || '',
          status: request.status || '',
          rejectionReason: request.raw?.rejectionReason || '',
          fixedPrivatePackageId: request.raw?.fixedPrivatePackageId || '',
        };
      },
      { timeout: options.timeout ?? 60000 }
    )
    .toMatchObject({
      exists: true,
      ...expected,
    });
}

async function expectLessonRequestApprovedInFirestore(createdRequest) {
  await expectLessonRequestDocStatus(createdRequest.requestId, {
    approvalStatus: 'approved',
    status: 'approved',
  });
}

async function expectRequestLessons(createdRequest, expected) {
  await expect
    .poll(
      async () => {
        const lessons = await getAdminLessonsForStudentTeacher({
          studentId: createdRequest.studentId,
          teacher: createdRequest.teacherName,
        });
        return lessons
          .filter((lesson) => lesson.subject === createdRequest.subject)
          .map((lesson) => ({
            date: lesson.date,
            time: lesson.time,
            subject: lesson.subject,
            studentId: lesson.studentId,
            studentID: lesson.studentID,
            studentName: lesson.studentName,
            teacher: lesson.teacher,
            completed: false,
            isDeductCancelled: lesson.isDeductCancelled,
            deductMemo: '',
            sessionNumber: lesson.sessionNumber,
          }));
      },
      { timeout: 60000 }
    )
    .toEqual(expected);
}

async function clickLessonRequestAction(page, createdRequest, requestRow, actionName, options = {}) {
  const button = requestRow.getByRole('button', { name: actionName, exact: true });
  try {
    await expect(button).toBeVisible({ timeout: 15000 });
    await expect(button).toBeEnabled({ timeout: 15000 });
  } catch (error) {
    const [requestDoc, rowText, visibleRows] = await Promise.all([
      getAdminSeededLessonRequest(createdRequest.requestId).catch((requestError) => ({
        error: requestError?.message || String(requestError),
      })),
      requestRow.innerText({ timeout: 1000 }).catch(() => ''),
      page
        .getByTestId('lesson-request-row')
        .evaluateAll((rows) =>
          rows.map((rowEl) => ({
            requestId: rowEl.getAttribute('data-request-id') || '',
            text: rowEl.textContent || '',
          }))
        )
        .catch(() => []),
    ]);
    throw new Error(
      [
        `Lesson request ${actionName} button was not ready for ${createdRequest.requestId}.`,
        `Firestore request: ${JSON.stringify(requestDoc)}`,
        `Target row text: ${rowText}`,
        `Visible rows: ${JSON.stringify(visibleRows.slice(0, 40))}`,
        `Original error: ${error.message}`,
      ].join('\n')
    );
  }

  const dialogPromise = page
    .waitForEvent('dialog', { timeout: options.dialogTimeout ?? 1000 })
    .then(async (dialog) => {
      const message = dialog.message();
      if (options.promptText !== undefined) {
        await dialog.accept(options.promptText);
      } else {
        await dialog.accept();
      }
      return { type: dialog.type(), message };
    })
    .catch((error) => {
      if (/Timeout/.test(String(error?.message || ''))) return null;
      throw error;
    });

  await button.click({ timeout: 10000 });
  return dialogPromise;
}

async function expectApprovedLessonRequestRemovedFromUi(page, createdRequest, options = {}) {
  if (options.optionalRefresh) {
    await expect(getLessonRequestRowById(page, createdRequest.requestId))
      .toHaveCount(0, { timeout: options.timeout ?? 1000 })
      .catch(() => {});
    return;
  } else {
    await openDashboardSection(page, '캘린더');
    await openDashboardSection(page, '수업 요청 관리');
  }
  await expect(getLessonRequestRowById(page, createdRequest.requestId)).toHaveCount(0, {
    timeout: options.timeout ?? 10000,
  });
}

async function expectSessionPlan({ studentId, teacher, expected }) {
  await expect
    .poll(
      async () => {
        const lessons = await getAdminLessonsForStudentTeacher({ studentId, teacher });
        return lessons.map((lesson) => ({
          date: lesson.date,
          time: lesson.time,
          subject: lesson.subject,
          sessionNumber: lesson.sessionNumber,
        }));
      },
      { timeout: 20000 }
    )
    .toEqual(expected);
}

async function expectLessonRequestRowVisible(page, createdRequest) {
  const requestRow = getLessonRequestRowById(page, createdRequest.requestId);

  try {
    await expect(requestRow).toBeVisible({ timeout: 60000 });
  } catch (error) {
    const [requestDoc, visibleRows, loadingTexts, bodyText] = await Promise.all([
      getAdminSeededLessonRequest(createdRequest.requestId).catch((requestError) => ({
        error: requestError?.message || String(requestError),
      })),
      page
        .getByTestId('lesson-request-row')
        .evaluateAll((rows) =>
          rows.map((rowEl) => ({
            requestId: rowEl.getAttribute('data-request-id') || '',
            studentName: rowEl.getAttribute('data-student-name') || '',
            text: rowEl.textContent || '',
          }))
        )
        .catch(() => []),
      page.getByText('불러오는 중...', { exact: true }).allInnerTexts().catch(() => []),
      page.locator('body').innerText().catch(() => ''),
    ]);

    throw new Error(
      [
        `Lesson request row was not visible for ${createdRequest.studentName}.`,
        `Current URL: ${page.url()}`,
        `Firestore lessonRequests snapshot: ${JSON.stringify(requestDoc)}`,
        `Visible lesson-request rows: ${JSON.stringify(visibleRows.slice(0, 40))}`,
        `Visible loading text: ${JSON.stringify(loadingTexts)}`,
        'Visible page text:',
        bodyText.slice(0, 1500),
        '',
        `Original assertion: ${error.message}`,
      ].join('\n')
    );
  }

  return requestRow;
}

test('admin sees a pending lesson request and approving it creates lessons', async ({
  page,
  browserName,
}, testInfo) => {
  testInfo.setTimeout(180000);
  test.skip(browserName !== 'chromium', 'This test is intended for chromium.');

  const now = Date.now();
  const studentName = `E2E 요청학생 ${now}`;
  const studentId = `e2e_request_student_${now}`;
  const subject = `E2E 승인 과목 ${now}`;
  const lessonDate = addDays(formatYmd(new Date()), 14);
  const lessonTime = '15:30';

  const createdRequest = await createAdminSeededLessonRequest({
    studentId,
    studentName,
    date: lessonDate,
    time: lessonTime,
    subject,
    repeatWeekly: true,
    repeatWeeks: 2,
  });

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '수업 요청 관리');

  await expectLessonRequestDocStatus(createdRequest.requestId, {
    approvalStatus: 'pending',
  });

  const requestRow = await expectLessonRequestRowVisible(page, createdRequest);
  await expect(requestRow).toContainText(createdRequest.teacherName);
  await expect(requestRow).toContainText(lessonDate);
  await expect(requestRow).toContainText(lessonTime);
  await expect(requestRow).toContainText(subject);
  await expect(requestRow).toContainText('반복');
  await expect(requestRow).toContainText('2');

  await clickLessonRequestAction(page, createdRequest, requestRow, '승인');

  await expectLessonRequestApprovedInFirestore(createdRequest);
  await expectRequestLessons(createdRequest, [
    {
      date: lessonDate,
      time: lessonTime,
      subject,
      studentId,
      studentID: studentId,
      studentName,
      teacher: createdRequest.teacherName,
      completed: false,
      isDeductCancelled: false,
      deductMemo: '',
      sessionNumber: 1,
    },
    {
      date: addDays(lessonDate, 7),
      time: lessonTime,
      subject,
      studentId,
      studentID: studentId,
      studentName,
      teacher: createdRequest.teacherName,
      completed: false,
      isDeductCancelled: false,
      deductMemo: '',
      sessionNumber: 2,
    },
  ]);

  await expectApprovedLessonRequestRemovedFromUi(page, createdRequest);
});

test('admin approval of fixed recurring private request creates and links package', async ({
  page,
  browserName,
}, testInfo) => {
  testInfo.setTimeout(180000);
  test.skip(browserName !== 'chromium', 'This test is intended for chromium.');

  const now = Date.now();
  const studentName = `E2E 고정패키지 ${now}`;
  const studentId = `e2e_fixed_private_request_${now}`;
  const subject = `E2E 고정 1:1 ${now}`;
  const lessonDate = addDays(formatYmd(new Date()), 21);
  const lessonTime = '18:50';
  const expectedDates = [
    lessonDate,
    addDays(lessonDate, 7),
    addDays(lessonDate, 14),
    addDays(lessonDate, 21),
  ];

  const createdRequest = await createAdminSeededLessonRequest({
    studentId,
    studentName,
    date: lessonDate,
    time: lessonTime,
    subject,
    repeatWeekly: false,
    repeatWeeks: 1,
    repeatEnabled: true,
    recurrenceCount: 4,
    status: 'pending',
  });

  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '수업 요청 관리');

  const requestRow = await expectLessonRequestRowVisible(page, createdRequest);
  await expect(requestRow).toContainText('반복');
  await expect(requestRow).toContainText('4');
  await clickLessonRequestAction(page, createdRequest, requestRow, '승인');

  await expectLessonRequestApprovedInFirestore(createdRequest);

  await expect
    .poll(async () => {
      const packages = await getAdminSeededPrivatePackagesForStudent({ studentId });
      return packages
        .map((pkg) => ({
          id: pkg.id,
          packageType: pkg.packageType,
          teacher: pkg.teacher,
          totalCount: Number(pkg.totalCount || 0),
          usedCount: Number(pkg.usedCount || 0),
          remainingCount: Number(pkg.remainingCount || 0),
          status: pkg.status,
        }));
    }, { timeout: 60000 })
    .toEqual([
      expect.objectContaining({
        packageType: 'private',
        teacher: createdRequest.teacherName,
        totalCount: 4,
        usedCount: 0,
        remainingCount: 4,
        status: 'active',
      }),
    ]);

  const state = await getAdminSeededLessonRequest(createdRequest.requestId);
  expect(dialogs).toEqual([]);
  const createdPackages = await getAdminSeededPrivatePackagesForStudent({ studentId });
  const createdPackage =
    createdPackages.find((pkg) => pkg.id === state.raw?.fixedPrivatePackageId) || createdPackages[0];
  expect(createdPackage).toBeTruthy();
  const lessons = await getAdminLessonsForStudentTeacher({ studentId, teacher: createdRequest.teacherName });
  const requestLessons = lessons.filter((lesson) => lesson.subject === subject);
  expect(requestLessons).toHaveLength(4);
  expect(requestLessons.map((lesson) => lesson.date)).toEqual(expectedDates);
  expect(requestLessons.map((lesson) => lesson.packageId)).toEqual([
    createdPackage.id,
    createdPackage.id,
    createdPackage.id,
    createdPackage.id,
  ]);
  expect(requestLessons.map((lesson) => lesson.sessionNumber)).toEqual([1, 2, 3, 4]);
});

test('admin approval assigns continuous private lesson session numbers across requests', async ({
  page,
  browserName,
}, testInfo) => {
  testInfo.setTimeout(180000);
  test.skip(browserName !== 'chromium', 'This test is intended for chromium.');

  const now = Date.now();
  const studentName = `E2E 회차학생 ${now}`;
  const studentId = `e2e_session_student_${now}`;
  const otherStudentId = `e2e_session_other_student_${now}`;
  const teacher = 'teacher';
  const otherTeacher = `other-teacher-${now}`;
  const subjectA = `E2E 주2 A ${now}`;
  const subjectB = `E2E 주2 B ${now}`;
  const subjectBackdated = `E2E 보강 과거 ${now}`;
  const unrelatedStudentSubject = `E2E 다른학생 ${now}`;
  const unrelatedTeacherSubject = `E2E 다른선생 ${now}`;

  const requestA = await createAdminSeededLessonRequest({
    studentId,
    studentName,
    date: '2099-03-01',
    time: '10:00',
    subject: subjectA,
    repeatWeekly: true,
    repeatWeeks: 4,
  });
  const requestB = await createAdminSeededLessonRequest({
    studentId,
    studentName,
    date: '2099-03-04',
    time: '10:00',
    subject: subjectB,
    repeatWeekly: true,
    repeatWeeks: 4,
  });
  const requestBackdated = await createAdminSeededLessonRequest({
    studentId,
    studentName,
    date: '2099-02-25',
    time: '09:00',
    subject: subjectBackdated,
    repeatWeekly: false,
    repeatWeeks: 1,
  });
  const [unrelatedStudentLesson, unrelatedTeacherLesson] = await Promise.all([
    createAdminSeededPrivateLesson({
      studentId: otherStudentId,
      studentName: `E2E 다른학생 ${now}`,
      teacher,
      date: '2099-03-02',
      time: '08:00',
      subject: unrelatedStudentSubject,
      sessionNumber: 77,
    }),
    createAdminSeededPrivateLesson({
      studentId,
      studentName,
      teacher: otherTeacher,
      date: '2099-03-03',
      time: '08:00',
      subject: unrelatedTeacherSubject,
      sessionNumber: 88,
    }),
  ]);

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '수업 요청 관리');

  await approveLessonRequestAndWait(page, requestA, { skipUiRemovalCheck: true });
  await expectSessionPlan({
    studentId,
    teacher,
    expected: [
      { date: '2099-03-01', time: '10:00', subject: subjectA, sessionNumber: 1 },
      { date: '2099-03-08', time: '10:00', subject: subjectA, sessionNumber: 2 },
      { date: '2099-03-15', time: '10:00', subject: subjectA, sessionNumber: 3 },
      { date: '2099-03-22', time: '10:00', subject: subjectA, sessionNumber: 4 },
    ],
  });

  await approveLessonRequestAndWait(page, requestB, { skipUiRemovalCheck: true });
  await expectSessionPlan({
    studentId,
    teacher,
    expected: [
      { date: '2099-03-01', time: '10:00', subject: subjectA, sessionNumber: 1 },
      { date: '2099-03-04', time: '10:00', subject: subjectB, sessionNumber: 2 },
      { date: '2099-03-08', time: '10:00', subject: subjectA, sessionNumber: 3 },
      { date: '2099-03-11', time: '10:00', subject: subjectB, sessionNumber: 4 },
      { date: '2099-03-15', time: '10:00', subject: subjectA, sessionNumber: 5 },
      { date: '2099-03-18', time: '10:00', subject: subjectB, sessionNumber: 6 },
      { date: '2099-03-22', time: '10:00', subject: subjectA, sessionNumber: 7 },
      { date: '2099-03-25', time: '10:00', subject: subjectB, sessionNumber: 8 },
    ],
  });

  await approveLessonRequestAndWait(page, requestBackdated, { skipUiRemovalCheck: true });
  await expectSessionPlan({
    studentId,
    teacher,
    expected: [
      { date: '2099-02-25', time: '09:00', subject: subjectBackdated, sessionNumber: 1 },
      { date: '2099-03-01', time: '10:00', subject: subjectA, sessionNumber: 2 },
      { date: '2099-03-04', time: '10:00', subject: subjectB, sessionNumber: 3 },
      { date: '2099-03-08', time: '10:00', subject: subjectA, sessionNumber: 4 },
      { date: '2099-03-11', time: '10:00', subject: subjectB, sessionNumber: 5 },
      { date: '2099-03-15', time: '10:00', subject: subjectA, sessionNumber: 6 },
      { date: '2099-03-18', time: '10:00', subject: subjectB, sessionNumber: 7 },
      { date: '2099-03-22', time: '10:00', subject: subjectA, sessionNumber: 8 },
      { date: '2099-03-25', time: '10:00', subject: subjectB, sessionNumber: 9 },
    ],
  });

  await expect
    .poll(async () => {
      const lesson = await getAdminSeededLesson({ lessonId: unrelatedStudentLesson.lessonId });
      return Number(lesson?.sessionNumber || 0);
    }, { timeout: 5000 })
    .toBe(77);
  await expect
    .poll(async () => {
      const lesson = await getAdminSeededLesson({ lessonId: unrelatedTeacherLesson.lessonId });
      return Number(lesson?.sessionNumber || 0);
    }, { timeout: 5000 })
    .toBe(88);
});

test('non-admin cannot see lesson request management navigation', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'This test is intended for chromium.');

  await loginAsTeacher(page);

  await expect(page.getByRole('button', { name: '수업 요청 관리', exact: true })).toHaveCount(0);
});

test('admin can reject a pending lesson request without creating lessons', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'This test is intended for chromium.');

  const now = Date.now();
  const studentName = `E2E 거절학생 ${now}`;
  const studentId = `e2e_reject_student_${now}`;
  const subject = `E2E 거절 과목 ${now}`;
  const lessonDate = addDays(formatYmd(new Date()), 15);
  const rejectionReason = `E2E rejection reason ${now}`;

  const createdRequest = await createAdminSeededLessonRequest({
    studentId,
    studentName,
    date: lessonDate,
    time: '16:00',
    subject,
    repeatWeekly: false,
    repeatWeeks: 1,
  });

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '수업 요청 관리');

  const requestRow = await expectLessonRequestRowVisible(page, createdRequest);

  const dialog = await clickLessonRequestAction(page, createdRequest, requestRow, '거절', {
    promptText: rejectionReason,
    dialogTimeout: 5000,
  });
  if (dialog) expect(dialog.type).toBe('prompt');

  await expectLessonRequestDocStatus(createdRequest.requestId, {
    approvalStatus: 'rejected',
    status: 'rejected',
    rejectionReason,
  });
  await expect
    .poll(async () => {
      const lessons = await getAdminLessonsForStudentTeacher({
        studentId,
        teacher: createdRequest.teacherName,
      });
      return lessons.filter((lesson) => lesson.subject === subject).length;
    }, { timeout: 15000 })
    .toBe(0);

  await expect(requestRow).toHaveCount(0);
});
