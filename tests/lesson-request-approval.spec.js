import { expect, test } from '@playwright/test';
import { BASE_URL, loginAsAdmin, openDashboardSection } from './e2e-helpers.js';
import { getLessonRequestApprovalState } from './e2e-firebase-helpers.js';
import {
  createAdminSeededLessonRequest,
  createAdminSeededPrivateLesson,
  getAdminSeededLessonRequest,
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

async function approveRequestBySubject(page, subject) {
  const requestRow = page
    .getByTestId('lesson-request-row')
    .filter({ hasText: subject })
    .first();
  await expect(requestRow).toBeVisible({ timeout: 15000 });
  await requestRow.getByRole('button', { name: '승인', exact: true }).click();
  await expect(requestRow).toHaveCount(0, { timeout: 15000 });
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
  const requestRow = page
    .getByTestId('lesson-request-row')
    .filter({ hasText: createdRequest.studentName })
    .first();

  try {
    await expect(requestRow).toBeVisible({ timeout: 15000 });
  } catch (error) {
    const [requestDoc, visibleRows, bodyText] = await Promise.all([
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
      page.locator('body').innerText().catch(() => ''),
    ]);

    throw new Error(
      [
        `Lesson request row was not visible for ${createdRequest.studentName}.`,
        `Firestore lessonRequests snapshot: ${JSON.stringify(requestDoc)}`,
        `Visible lesson-request rows: ${JSON.stringify(visibleRows.slice(0, 40))}`,
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
}) => {
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

  await expect
    .poll(
      async () =>
        getLessonRequestApprovalState(page, {
          requestId: createdRequest.requestId,
        }),
      { timeout: 15000 }
    )
    .toMatchObject({
      exists: true,
      approvalStatus: 'pending',
    });

  const requestRow = await expectLessonRequestRowVisible(page, createdRequest);
  await expect(requestRow).toContainText(createdRequest.teacherName);
  await expect(requestRow).toContainText(lessonDate);
  await expect(requestRow).toContainText(lessonTime);
  await expect(requestRow).toContainText(subject);
  await expect(requestRow).toContainText('반복');
  await expect(requestRow).toContainText('2');

  await requestRow.getByRole('button', { name: '승인', exact: true }).click();

  await expect
    .poll(
      async () =>
        getLessonRequestApprovalState(page, {
          requestId: createdRequest.requestId,
        }),
      { timeout: 15000 }
    )
    .toMatchObject({
      exists: true,
      approvalStatus: 'approved',
      lessons: [
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
      ],
    });

  await expect(requestRow).toHaveCount(0);
});

test('admin approval assigns continuous private lesson session numbers across requests', async ({
  page,
  browserName,
}) => {
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

  await createAdminSeededLessonRequest({
    studentId,
    studentName,
    date: '2099-03-01',
    time: '10:00',
    subject: subjectA,
    repeatWeekly: true,
    repeatWeeks: 4,
  });
  await createAdminSeededLessonRequest({
    studentId,
    studentName,
    date: '2099-03-04',
    time: '10:00',
    subject: subjectB,
    repeatWeekly: true,
    repeatWeeks: 4,
  });
  await createAdminSeededLessonRequest({
    studentId,
    studentName,
    date: '2099-02-25',
    time: '09:00',
    subject: subjectBackdated,
    repeatWeekly: false,
    repeatWeeks: 1,
  });
  await Promise.all([
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

  await approveRequestBySubject(page, subjectA);
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

  await approveRequestBySubject(page, subjectB);
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

  await approveRequestBySubject(page, subjectBackdated);
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
      const lessons = await getAdminLessonsForStudentTeacher({
        studentId: otherStudentId,
        teacher,
      });
      return lessons.find((lesson) => lesson.subject === unrelatedStudentSubject)?.sessionNumber;
    })
    .toBe(77);
  await expect
    .poll(async () => {
      const lessons = await getAdminLessonsForStudentTeacher({
        studentId,
        teacher: otherTeacher,
      });
      return lessons.find((lesson) => lesson.subject === unrelatedTeacherSubject)?.sessionNumber;
    })
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

  const requestRow = page
    .getByTestId('lesson-request-row')
    .filter({ hasText: createdRequest.studentName })
    .first();
  await expect(requestRow).toBeVisible();

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('prompt');
    await dialog.accept(rejectionReason);
  });
  await requestRow.getByRole('button', { name: '거절', exact: true }).click();

  await expect
    .poll(
      async () =>
        getLessonRequestApprovalState(page, {
          requestId: createdRequest.requestId,
        }),
      { timeout: 15000 }
    )
    .toMatchObject({
      exists: true,
      approvalStatus: 'rejected',
      rejectionReason,
      lessons: [],
    });

  await expect(requestRow).toHaveCount(0);
});
