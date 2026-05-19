import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import admin from 'firebase-admin';
import { test, expect } from '@playwright/test';
import { loginAsStudent } from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  DEFAULT_E2E_ACADEMY_ID,
  DEFAULT_E2E_ACADEMY_NAME,
  TEST_STUDENT_EMAIL,
  TEST_STUDENT_PASSWORD,
  TEST_TEACHER_EMAIL,
} from './fixtures/test-data.js';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const TEACHER_NAME = 'teacher';

test.describe.configure({ mode: 'serial' });

function hasServiceAccount() {
  return fs.existsSync(SERVICE_ACCOUNT_PATH);
}

function initializeAdmin() {
  if (admin.apps.find((app) => app?.name === '[DEFAULT]')) return;
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

async function readDoc(ref) {
  const snap = await ref.get();
  return snap.exists ? snap.data() : null;
}

async function restoreDoc(ref, data) {
  if (data) {
    await ref.set(data);
  } else {
    await ref.delete().catch(() => {});
  }
}

async function linkStudentAccountWithScript({ studentId }) {
  await execFileAsync(
    process.execPath,
    [
      'scripts/link-student-account.mjs',
      '--academy-id',
      DEFAULT_E2E_ACADEMY_ID,
      '--student-id',
      studentId,
      '--email',
      TEST_STUDENT_EMAIL,
      '--display-name',
      'Student E2E',
      '--password',
      TEST_STUDENT_PASSWORD,
    ],
    {
      cwd: process.cwd(),
      timeout: 30000,
    }
  );
}

function reservationId({ lessonId, studentId }) {
  return `${DEFAULT_E2E_ACADEMY_ID}__${lessonId}__${studentId}`;
}

function accessId({ groupClassId, studentId }) {
  return `${DEFAULT_E2E_ACADEMY_ID}__${groupClassId}__${studentId}`;
}

function accessSummaryId({ studentId }) {
  return `${DEFAULT_E2E_ACADEMY_ID}__${studentId}`;
}

function getLessonCard(page, subject) {
  return page
    .locator('[data-testid="student-booking-lesson-card"]')
    .filter({ hasText: subject })
    .first();
}

async function getStudentGroupAccessSummary(ref) {
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    academyId: data.academyId || null,
    studentId: data.studentId || null,
    groupClassIds: Array.isArray(data.groupClassIds) ? data.groupClassIds : [],
    groupCourseTypes: Array.isArray(data.groupCourseTypes) ? data.groupCourseTypes : [],
  };
}

async function expectLessonCardVisible(page, subject, summaryRef) {
  const card = getLessonCard(page, subject);

  try {
    await expect(card).toBeVisible({ timeout: 30000 });
  } catch (error) {
    const [summary, visibleCards, bodyText] = await Promise.all([
      getStudentGroupAccessSummary(summaryRef).catch((summaryError) => ({
        error: summaryError?.message || String(summaryError),
      })),
      page
        .locator('[data-testid="student-booking-lesson-card"]')
        .evaluateAll((cards) => cards.map((cardEl) => cardEl.textContent || ''))
        .catch(() => []),
      page.locator('body').innerText().catch(() => ''),
    ]);

    throw new Error(
      [
        `Student booking lesson card was not visible for ${subject}.`,
        `Firestore studentGroupAccessSummary snapshot: ${JSON.stringify(summary)}`,
        `Visible lesson cards: ${JSON.stringify(visibleCards.slice(0, 40))}`,
        'Visible page text:',
        bodyText.slice(0, 1500),
        '',
        `Original assertion: ${error.message}`,
      ].join('\n')
    );
  }

  return card;
}

function getReservationCard(page, subject) {
  return page
    .locator('[data-testid="student-booking-reservation-card"]')
    .filter({ hasText: subject })
    .first();
}

function getHistoryCard(page, text) {
  return page
    .locator('[data-testid="student-lesson-history-card"]')
    .filter({ hasText: text })
    .first();
}

async function expectReservationStatus(db, lessonId, studentId, expected) {
  await expect
    .poll(async () => {
      const snap = await db
        .collection('groupLessonReservations')
        .doc(reservationId({ lessonId, studentId }))
        .get();
      return snap.exists ? snap.data()?.status || null : null;
    })
    .toBe(expected);
}

async function expectBookedCount(db, lessonId, expected) {
  await expect
    .poll(async () => {
      const snap = await db.collection('groupLessons').doc(lessonId).get();
      return snap.exists ? snap.data()?.bookedCount : null;
    })
    .toBe(expected);
}

async function createStudentBookingFixture(unique, options = {}) {
  initializeAdmin();
  const db = admin.firestore();
  const nowTs = admin.firestore.Timestamp.now();
  const adminUser = await admin.auth().getUserByEmail(ADMIN_EMAIL);
  const teacherUser = await admin.auth().getUserByEmail(TEST_TEACHER_EMAIL);
  const studentUser = await admin.auth().getUserByEmail(TEST_STUDENT_EMAIL);
  const studentLinked = options.studentLinked !== false;

  const eligibleGroupClassId = `e2e-student-booking-group-${unique}`;
  const hiddenGroupClassId = `e2e-student-booking-hidden-group-${unique}`;
  const studentId = `e2e-student-booking-student-${unique}`;
  const otherStudentId = `e2e-student-booking-other-${unique}`;
  const eligibleLessonId = `e2e-student-booking-bookable-${unique}`;
  const fullLessonId = `e2e-student-booking-full-${unique}`;
  const closedLessonId = `e2e-student-booking-closed-${unique}`;
  const hiddenLessonId = `e2e-student-booking-hidden-${unique}`;
  const pastLessonId = `e2e-student-booking-past-${unique}`;
  const cancelledLessonId = `e2e-student-booking-cancelled-${unique}`;
  const otherHistoryLessonId = `e2e-student-booking-other-history-${unique}`;
  const blockedGroupName = `숨김반 ${unique}`;
  const eligibleGroupName = `예약반 ${unique}`;
  const studentMembershipRef = db
    .collection('academyMemberships')
    .doc(`${DEFAULT_E2E_ACADEMY_ID}_${studentUser.uid}`);
  const studentUserRef = db.collection('users').doc(studentUser.uid);

  const originals = {
    studentMembership: await readDoc(studentMembershipRef),
    studentUser: await readDoc(studentUserRef),
  };

  await Promise.all([
    db.collection('academies').doc(DEFAULT_E2E_ACADEMY_ID).set(
      {
        id: DEFAULT_E2E_ACADEMY_ID,
        name: DEFAULT_E2E_ACADEMY_NAME,
        slug: DEFAULT_E2E_ACADEMY_ID,
        status: 'active',
        timezone: 'Asia/Seoul',
        updatedAt: nowTs,
      },
      { merge: true }
    ),
    db.collection('users').doc(adminUser.uid).set(
      {
        uid: adminUser.uid,
        email: ADMIN_EMAIL,
        role: 'admin',
        isActive: true,
        lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
        updatedAt: nowTs,
      },
      { merge: true }
    ),
    db.collection('users').doc(teacherUser.uid).set(
      {
        uid: teacherUser.uid,
        email: TEST_TEACHER_EMAIL,
        role: 'teacher',
        isActive: true,
        teacherName: TEACHER_NAME,
        lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
        updatedAt: nowTs,
      },
      { merge: true }
    ),
    studentUserRef.set(
      {
        uid: studentUser.uid,
        email: TEST_STUDENT_EMAIL,
        role: 'student',
        isActive: true,
        lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
        updatedAt: nowTs,
      },
      { merge: true }
    ),
    db
      .collection('academyMemberships')
      .doc(`${DEFAULT_E2E_ACADEMY_ID}_${adminUser.uid}`)
      .set(
        {
          academyId: DEFAULT_E2E_ACADEMY_ID,
          uid: adminUser.uid,
          email: ADMIN_EMAIL,
          displayName: 'Admin E2E',
          role: 'owner',
          teacherName: '',
          status: 'active',
          permissions: {
            canManageAttendance: true,
            canAddStudent: true,
            canEditStudent: true,
            canDeleteStudent: true,
            canEditLesson: true,
            canDeleteLesson: true,
            canCreateLessonDirectly: true,
            requiresLessonApproval: false,
          },
          updatedAt: nowTs,
        },
        { merge: true }
      ),
    db
      .collection('academyMemberships')
      .doc(`${DEFAULT_E2E_ACADEMY_ID}_${teacherUser.uid}`)
      .set(
        {
          academyId: DEFAULT_E2E_ACADEMY_ID,
          uid: teacherUser.uid,
          email: TEST_TEACHER_EMAIL,
          displayName: 'Teacher E2E',
          role: 'teacher',
          teacherName: TEACHER_NAME,
          status: 'active',
          permissions: {
            canManageAttendance: true,
            canAddStudent: true,
            canEditStudent: true,
            canDeleteStudent: true,
            canEditLesson: true,
            canDeleteLesson: true,
            canCreateLessonDirectly: true,
            requiresLessonApproval: false,
          },
          updatedAt: nowTs,
        },
        { merge: true }
      ),
    studentMembershipRef.set(
      {
        academyId: DEFAULT_E2E_ACADEMY_ID,
        uid: studentUser.uid,
        email: TEST_STUDENT_EMAIL,
        displayName: 'Student E2E',
        role: 'student',
        studentId: '',
        teacherName: '',
        status: 'active',
        permissions: {
          canManageAttendance: false,
          canAddStudent: false,
          canEditStudent: false,
          canDeleteStudent: false,
          canEditLesson: false,
          canDeleteLesson: false,
          canCreateLessonDirectly: false,
          requiresLessonApproval: false,
        },
        updatedAt: nowTs,
      },
      { merge: true }
    ),
  ]);

  const docsToDelete = [
    db.collection('groupClasses').doc(eligibleGroupClassId),
    db.collection('groupClasses').doc(hiddenGroupClassId),
    db.collection('privateStudents').doc(studentId),
    db.collection('privateStudents').doc(otherStudentId),
    db.collection('groupStudents').doc(`gs-${studentId}`),
    db.collection('groupStudents').doc(`gs-${otherStudentId}`),
    db.collection('studentGroupAccess').doc(accessId({ groupClassId: eligibleGroupClassId, studentId })),
    db.collection('studentGroupAccessSummary').doc(accessSummaryId({ studentId })),
    db.collection('groupLessons').doc(eligibleLessonId),
    db.collection('groupLessons').doc(fullLessonId),
    db.collection('groupLessons').doc(closedLessonId),
    db.collection('groupLessons').doc(hiddenLessonId),
    db.collection('groupLessons').doc(pastLessonId),
    db.collection('groupLessons').doc(cancelledLessonId),
    db.collection('groupLessons').doc(otherHistoryLessonId),
    db.collection('groupLessonReservations').doc(
      reservationId({ lessonId: fullLessonId, studentId: otherStudentId })
    ),
    db.collection('groupLessonReservations').doc(
      reservationId({ lessonId: hiddenLessonId, studentId: otherStudentId })
    ),
    db.collection('groupLessonReservations').doc(
      reservationId({ lessonId: pastLessonId, studentId })
    ),
    db.collection('groupLessonReservations').doc(
      reservationId({ lessonId: cancelledLessonId, studentId })
    ),
    db.collection('groupLessonReservations').doc(
      reservationId({ lessonId: otherHistoryLessonId, studentId: otherStudentId })
    ),
    db.collection('groupLessonReservations').doc(
      reservationId({ lessonId: eligibleLessonId, studentId })
    ),
  ];

  await Promise.all([
    db.collection('groupClasses').doc(eligibleGroupClassId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: eligibleGroupName,
      teacher: TEACHER_NAME,
      teacherName: TEACHER_NAME,
      maxStudents: 6,
      time: '10:00',
      subject: 'Student Booking',
      weekdays: ['월'],
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('groupClasses').doc(hiddenGroupClassId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: blockedGroupName,
      teacher: TEACHER_NAME,
      teacherName: TEACHER_NAME,
      maxStudents: 6,
      time: '12:00',
      subject: 'Hidden Booking',
      weekdays: ['화'],
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('privateStudents').doc(studentId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: `학생 ${unique}`,
      teacher: TEACHER_NAME,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('privateStudents').doc(otherStudentId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: `다른학생 ${unique}`,
      teacher: TEACHER_NAME,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('groupStudents').doc(`gs-${studentId}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      groupClassId: eligibleGroupClassId,
      classID: eligibleGroupClassId,
      studentId,
      studentName: `학생 ${unique}`,
      name: `학생 ${unique}`,
      teacher: TEACHER_NAME,
      packageId: `pkg-${studentId}`,
      packageType: 'group',
      paidLessons: 8,
      attendanceCount: 0,
      status: 'active',
      studentStatus: 'active',
      excludedDates: [],
      breakStartDate: '',
      breakEndDate: '',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('groupStudents').doc(`gs-${otherStudentId}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      groupClassId: eligibleGroupClassId,
      classID: eligibleGroupClassId,
      studentId: otherStudentId,
      studentName: `다른학생 ${unique}`,
      name: `다른학생 ${unique}`,
      teacher: TEACHER_NAME,
      packageId: `pkg-${otherStudentId}`,
      packageType: 'group',
      paidLessons: 8,
      attendanceCount: 0,
      status: 'active',
      studentStatus: 'active',
      excludedDates: [],
      breakStartDate: '',
      breakEndDate: '',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    studentLinked
      ? db.collection('studentGroupAccess').doc(accessId({ groupClassId: eligibleGroupClassId, studentId })).set({
          academyId: DEFAULT_E2E_ACADEMY_ID,
          groupClassId: eligibleGroupClassId,
          groupStudentId: `gs-${studentId}`,
          studentId,
          packageId: `pkg-${studentId}`,
          status: 'active',
          studentStatus: 'active',
          createdAt: nowTs,
          updatedAt: nowTs,
        })
      : Promise.resolve(),
    studentLinked
      ? db.collection('studentGroupAccessSummary').doc(accessSummaryId({ studentId })).set({
          academyId: DEFAULT_E2E_ACADEMY_ID,
          studentId,
          groupClassIds: [eligibleGroupClassId],
          createdAt: nowTs,
          updatedAt: nowTs,
        })
      : Promise.resolve(),
    db.collection('groupLessons').doc(eligibleLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      groupClassId: eligibleGroupClassId,
      groupClassName: eligibleGroupName,
      teacher: TEACHER_NAME,
      date: '2099-05-03',
      time: '10:00',
      subject: 'Bookable',
      capacity: 2,
      bookedCount: 0,
      isBookable: true,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('groupLessons').doc(fullLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      groupClassId: eligibleGroupClassId,
      groupClassName: eligibleGroupName,
      teacher: TEACHER_NAME,
      date: '2099-05-04',
      time: '11:00',
      subject: 'Full',
      capacity: 1,
      bookedCount: 1,
      isBookable: true,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('groupLessons').doc(closedLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      groupClassId: eligibleGroupClassId,
      groupClassName: eligibleGroupName,
      teacher: TEACHER_NAME,
      date: '2099-05-05',
      time: '13:00',
      subject: 'Closed',
      capacity: 2,
      bookedCount: 0,
      isBookable: false,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('groupLessons').doc(hiddenLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      groupClassId: hiddenGroupClassId,
      groupClassName: blockedGroupName,
      teacher: TEACHER_NAME,
      date: '2099-05-06',
      time: '14:00',
      subject: 'Hidden',
      capacity: 2,
      bookedCount: 1,
      isBookable: true,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    options.includeHistory
      ? db.collection('groupLessons').doc(pastLessonId).set({
          academyId: DEFAULT_E2E_ACADEMY_ID,
          groupClassId: eligibleGroupClassId,
          groupClassName: eligibleGroupName,
          teacher: TEACHER_NAME,
          date: '2020-01-03',
          time: '09:00',
          subject: 'Past History',
          capacity: 2,
          bookedCount: 1,
          isBookable: true,
          createdAt: nowTs,
          updatedAt: nowTs,
        })
      : Promise.resolve(),
    options.includeHistory
      ? db.collection('groupLessons').doc(cancelledLessonId).set({
          academyId: DEFAULT_E2E_ACADEMY_ID,
          groupClassId: eligibleGroupClassId,
          groupClassName: eligibleGroupName,
          teacher: TEACHER_NAME,
          date: '2099-05-07',
          time: '15:00',
          subject: 'Cancelled History',
          capacity: 2,
          bookedCount: 0,
          isBookable: true,
          createdAt: nowTs,
          updatedAt: nowTs,
        })
      : Promise.resolve(),
    options.includeHistory
      ? db.collection('groupLessons').doc(otherHistoryLessonId).set({
          academyId: DEFAULT_E2E_ACADEMY_ID,
          groupClassId: eligibleGroupClassId,
          groupClassName: eligibleGroupName,
          teacher: TEACHER_NAME,
          date: '2099-05-08',
          time: '16:00',
          subject: 'Other History',
          capacity: 2,
          bookedCount: 1,
          isBookable: true,
          createdAt: nowTs,
          updatedAt: nowTs,
        })
      : Promise.resolve(),
    db.collection('groupLessonReservations').doc(
      reservationId({ lessonId: fullLessonId, studentId: otherStudentId })
    ).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      lessonId: fullLessonId,
      groupClassId: eligibleGroupClassId,
      studentId: otherStudentId,
      status: 'active',
      source: 'student',
      createdAt: nowTs,
      updatedAt: nowTs,
      cancelledAt: null,
    }),
    db.collection('groupLessonReservations').doc(
      reservationId({ lessonId: hiddenLessonId, studentId: otherStudentId })
    ).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      lessonId: hiddenLessonId,
      groupClassId: hiddenGroupClassId,
      studentId: otherStudentId,
      status: 'active',
      source: 'student',
      createdAt: nowTs,
      updatedAt: nowTs,
      cancelledAt: null,
    }),
    options.includeHistory
      ? db.collection('groupLessonReservations').doc(
          reservationId({ lessonId: pastLessonId, studentId })
        ).set({
          academyId: DEFAULT_E2E_ACADEMY_ID,
          lessonId: pastLessonId,
          groupClassId: eligibleGroupClassId,
          studentId,
          status: 'active',
          source: 'student',
          createdAt: nowTs,
          updatedAt: nowTs,
          cancelledAt: null,
        })
      : Promise.resolve(),
    options.includeHistory
      ? db.collection('groupLessonReservations').doc(
          reservationId({ lessonId: cancelledLessonId, studentId })
        ).set({
          academyId: DEFAULT_E2E_ACADEMY_ID,
          lessonId: cancelledLessonId,
          groupClassId: eligibleGroupClassId,
          studentId,
          status: 'cancelled',
          source: 'student',
          createdAt: nowTs,
          updatedAt: nowTs,
          cancelledAt: nowTs,
        })
      : Promise.resolve(),
    options.includeHistory
      ? db.collection('groupLessonReservations').doc(
          reservationId({ lessonId: otherHistoryLessonId, studentId: otherStudentId })
        ).set({
          academyId: DEFAULT_E2E_ACADEMY_ID,
          lessonId: otherHistoryLessonId,
          groupClassId: eligibleGroupClassId,
          studentId: otherStudentId,
          status: 'active',
          source: 'student',
          createdAt: nowTs,
          updatedAt: nowTs,
          cancelledAt: null,
        })
      : Promise.resolve(),
  ]);

  if (studentLinked) {
    await linkStudentAccountWithScript({ studentId });
    const linkedMembership = await readDoc(studentMembershipRef);
    expect(linkedMembership?.studentId).toBe(studentId);
    expect(linkedMembership?.role).toBe('student');
    expect(linkedMembership?.status).toBe('active');
  }

  return {
    studentId,
    eligibleLessonId,
    fullLessonId,
    closedLessonId,
    hiddenLessonId,
    pastLessonId,
    cancelledLessonId,
    otherHistoryLessonId,
    docsToDelete,
    originals,
  };
}

async function cleanupStudentBookingFixture(fixture) {
  if (!fixture) return;
  await Promise.all(
    fixture.docsToDelete.map((ref) => ref.delete().catch(() => {}))
  );
  await Promise.all([
    restoreDoc(
      admin
        .firestore()
        .collection('academyMemberships')
        .doc(`${DEFAULT_E2E_ACADEMY_ID}_${(await admin.auth().getUserByEmail(TEST_STUDENT_EMAIL)).uid}`),
      fixture.originals.studentMembership
    ),
    restoreDoc(
      admin
        .firestore()
        .collection('users')
        .doc((await admin.auth().getUserByEmail(TEST_STUDENT_EMAIL)).uid),
      fixture.originals.studentUser
    ),
  ]);
}

test('student self-booking only shows eligible lessons and supports reserve/cancel/re-reserve', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 student booking setup을 실행합니다.');
  test.setTimeout(120000);

  initializeAdmin();
  const db = admin.firestore();
  let fixture = null;

  try {
    fixture = await createStudentBookingFixture(`${Date.now()}-${testInfo.workerIndex}`);

    await loginAsStudent(page, TEST_STUDENT_EMAIL, TEST_STUDENT_PASSWORD);

    await expect(page.getByText('지금 예약 가능한 단체반 수업이 없습니다. 학원 안내 후 다시 확인해 주세요.')).toHaveCount(0);
    await expect(page.getByText('예약 후 결제는 학원에서 오프라인으로 진행됩니다.')).toBeVisible();
    await expect(getLessonCard(page, 'Bookable')).toBeVisible({ timeout: 15000 });
    await expect(getLessonCard(page, 'Full')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Closed')).toHaveCount(0);
    await expect(page.getByText('Hidden')).toHaveCount(0);
    await expect(page.getByText('아직 단체반 예약이 없습니다. 예약을 완료하면 이곳에 표시됩니다.')).toBeVisible();
    await expect(page.getByText('아직 수업 내역이 없습니다. 예약한 수업이 생기면 이곳에서 확인할 수 있습니다.')).toBeVisible();

    const fullCard = getLessonCard(page, 'Full');
    await expect(fullCard.getByTestId('student-booking-reserve-button')).toBeDisabled();

    const bookableCard = getLessonCard(page, 'Bookable');
    await bookableCard.getByTestId('student-booking-reserve-button').click();
    await expectReservationStatus(db, fixture.eligibleLessonId, fixture.studentId, 'active');
    await expectBookedCount(db, fixture.eligibleLessonId, 1);
    await expect(bookableCard).toContainText('예약 완료', { timeout: 15000 });

    const reservationCard = getReservationCard(page, 'Bookable');
    await expect(reservationCard).toBeVisible({ timeout: 15000 });
    await expect(reservationCard).toContainText('결제는 학원 안내에 따라 진행됩니다.');
    await expect(page.locator('[data-testid="student-booking-reservation-card"]')).toHaveCount(1);
    await expect(getHistoryCard(page, 'Bookable')).toContainText('단체반 수업', { timeout: 15000 });
    await expect(getHistoryCard(page, 'Bookable')).toContainText('예약 완료');

    await reservationCard.getByTestId('student-booking-reservation-cancel-button').click();
    await expectReservationStatus(db, fixture.eligibleLessonId, fixture.studentId, 'cancelled');
    await expectBookedCount(db, fixture.eligibleLessonId, 0);
    await expect(reservationCard).toContainText('예약 취소', { timeout: 15000 });
    await expect(getHistoryCard(page, 'Bookable')).toContainText('예약 취소', { timeout: 15000 });

    await bookableCard.getByTestId('student-booking-reserve-button').click();
    await expectReservationStatus(db, fixture.eligibleLessonId, fixture.studentId, 'active');
    await expectBookedCount(db, fixture.eligibleLessonId, 1);
  } finally {
    if (fixture) {
      await cleanupStudentBookingFixture(fixture).catch(() => {});
    }
  }
});

test('student lesson history shows own group lessons and hides another student reservations', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 student booking setup을 실행합니다.');
  test.setTimeout(120000);

  let fixture = null;

  try {
    fixture = await createStudentBookingFixture(`${Date.now()}-${testInfo.workerIndex}`, {
      includeHistory: true,
    });

    await loginAsStudent(page, TEST_STUDENT_EMAIL, TEST_STUDENT_PASSWORD);
    await expect(page.getByRole('heading', { name: '내 수업 내역' })).toBeVisible();

    const pastHistoryCard = getHistoryCard(page, 'Past History');
    await expect(pastHistoryCard).toBeVisible({ timeout: 15000 });
    await expect(pastHistoryCard).toContainText('단체반 수업');
    await expect(pastHistoryCard).toContainText('지난 수업');

    const cancelledHistoryCard = getHistoryCard(page, 'Cancelled History');
    await expect(cancelledHistoryCard).toBeVisible({ timeout: 15000 });
    await expect(cancelledHistoryCard).toContainText('단체반 수업');
    await expect(cancelledHistoryCard).toContainText('예약 취소');

    await expect(
      page.locator('[data-testid="student-lesson-history-card"]').filter({ hasText: 'Other History' })
    ).toHaveCount(0);
  } finally {
    if (fixture) {
      await cleanupStudentBookingFixture(fixture).catch(() => {});
    }
  }
});

test('student group lesson visibility supports groupCourseTypes and legacy groupClassIds', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 student booking setup을 실행합니다.');
  test.setTimeout(120000);

  initializeAdmin();
  const db = admin.firestore();
  const nowTs = admin.firestore.Timestamp.now();
  const studentUser = await admin.auth().getUserByEmail(TEST_STUDENT_EMAIL);
  const unique = `${Date.now()}-${testInfo.workerIndex}`;
  const studentId = `e2e-course-visibility-student-${unique}`;
  const freeClassId = `e2e-course-free-class-${unique}`;
  const beginnerClassId = `e2e-course-beginner-class-${unique}`;
  const legacyClassId = `e2e-course-legacy-class-${unique}`;
  const freeLessonId = `e2e-course-free-lesson-${unique}`;
  const beginnerLessonId = `e2e-course-beginner-lesson-${unique}`;
  const legacyLessonId = `e2e-course-legacy-lesson-${unique}`;
  const summaryRef = db.collection('studentGroupAccessSummary').doc(accessSummaryId({ studentId }));
  const studentMembershipRef = db
    .collection('academyMemberships')
    .doc(`${DEFAULT_E2E_ACADEMY_ID}_${studentUser.uid}`);
  const studentUserRef = db.collection('users').doc(studentUser.uid);
  const originals = {
    studentMembership: await readDoc(studentMembershipRef),
    studentUser: await readDoc(studentUserRef),
  };
  const refsToDelete = [
    db.collection('privateStudents').doc(studentId),
    db.collection('groupClasses').doc(freeClassId),
    db.collection('groupClasses').doc(beginnerClassId),
    db.collection('groupClasses').doc(legacyClassId),
    db.collection('groupLessons').doc(freeLessonId),
    db.collection('groupLessons').doc(beginnerLessonId),
    db.collection('groupLessons').doc(legacyLessonId),
    db.collection('studentPackages').doc(`e2e-course-beginner-package-${unique}`),
    db.collection('studentPackages').doc(`e2e-course-free-package-${unique}`),
    db.collection('studentPackages').doc(`e2e-course-private-package-${unique}`),
    summaryRef,
  ];

  try {
    await Promise.all([
      studentUserRef.set(
        {
          uid: studentUser.uid,
          email: TEST_STUDENT_EMAIL,
          role: 'student',
          isActive: true,
          lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
          updatedAt: nowTs,
        },
        { merge: true }
      ),
      studentMembershipRef.set(
        {
          academyId: DEFAULT_E2E_ACADEMY_ID,
          uid: studentUser.uid,
          email: TEST_STUDENT_EMAIL,
          displayName: 'Student E2E',
          role: 'student',
          studentId: '',
          teacherName: '',
          status: 'active',
          permissions: {},
          updatedAt: nowTs,
        },
        { merge: true }
      ),
      db.collection('privateStudents').doc(studentId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        name: `코스학생 ${unique}`,
        teacher: TEACHER_NAME,
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
      db.collection('groupClasses').doc(freeClassId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        name: `프리토킹 ${unique}`,
        teacher: TEACHER_NAME,
        teacherName: TEACHER_NAME,
        maxStudents: 6,
        time: '10:00',
        subject: 'Course Free',
        groupCourseType: 'free_talking',
        weekdays: ['월'],
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
      db.collection('groupClasses').doc(beginnerClassId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        name: `초급 ${unique}`,
        teacher: TEACHER_NAME,
        teacherName: TEACHER_NAME,
        maxStudents: 6,
        time: '11:00',
        subject: 'Course Beginner',
        groupCourseType: 'beginner_conversation',
        weekdays: ['화'],
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
      db.collection('groupClasses').doc(legacyClassId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        name: `레거시 ${unique}`,
        teacher: TEACHER_NAME,
        teacherName: TEACHER_NAME,
        maxStudents: 6,
        time: '12:00',
        subject: 'Course Legacy',
        weekdays: ['수'],
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
      db.collection('groupLessons').doc(freeLessonId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        groupClassId: freeClassId,
        groupClassName: `프리토킹 ${unique}`,
        teacher: TEACHER_NAME,
        date: '2099-06-01',
        time: '10:00',
        subject: 'Course Free Visible',
        groupCourseType: 'free_talking',
        capacity: 4,
        bookedCount: 0,
        isBookable: true,
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
      db.collection('groupLessons').doc(beginnerLessonId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        groupClassId: beginnerClassId,
        groupClassName: `초급 ${unique}`,
        teacher: TEACHER_NAME,
        date: '2099-06-02',
        time: '11:00',
        subject: 'Course Beginner Only',
        groupCourseType: 'beginner_conversation',
        capacity: 4,
        bookedCount: 0,
        isBookable: true,
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
      db.collection('groupLessons').doc(legacyLessonId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        groupClassId: legacyClassId,
        groupClassName: `레거시 ${unique}`,
        teacher: TEACHER_NAME,
        date: '2099-06-03',
        time: '12:00',
        subject: 'Course Legacy Visible',
        capacity: 4,
        bookedCount: 0,
        isBookable: true,
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
      db.collection('studentPackages').doc(`e2e-course-beginner-package-${unique}`).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        studentId,
        studentName: `코스학생 ${unique}`,
        teacher: TEACHER_NAME,
        packageType: 'group',
        groupClassId: beginnerClassId,
        groupCourseType: 'beginner_conversation',
        title: 'Beginner Course Package',
        totalCount: 4,
        usedCount: 0,
        remainingCount: 4,
        status: 'active',
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
      db.collection('studentPackages').doc(`e2e-course-private-package-${unique}`).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        studentId,
        studentName: `코스학생 ${unique}`,
        teacher: TEACHER_NAME,
        packageType: 'private',
        groupCourseType: 'free_talking',
        title: 'Private Package Must Not Grant Course',
        totalCount: 4,
        usedCount: 0,
        remainingCount: 4,
        status: 'active',
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
    ]);

    await summaryRef.set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId,
      groupClassIds: [],
      groupCourseTypes: ['beginner_conversation'],
      createdAt: nowTs,
      updatedAt: nowTs,
    });
    await linkStudentAccountWithScript({ studentId });

    // linkStudentAccountWithScript may rewrite membership/access summary.
    // Re-apply the intended course-type access after linking, then wait for it.
    await summaryRef.set(
      {
        academyId: DEFAULT_E2E_ACADEMY_ID,
        studentId,
        groupClassIds: [],
        groupCourseTypes: ['beginner_conversation'],
        updatedAt: nowTs,
      },
      { merge: true }
    );

    await expect
      .poll(async () => {
        const snap = await summaryRef.get();
        const summary = snap.exists ? snap.data() || {} : {};
        return Array.isArray(summary.groupCourseTypes) ? summary.groupCourseTypes : [];
      }, { timeout: 15000 })
      .toContain('beginner_conversation');

    await loginAsStudent(page, TEST_STUDENT_EMAIL, TEST_STUDENT_PASSWORD);
    const beginnerCard = getLessonCard(page, 'Course Beginner Only');
    const groupLoadError = page.getByText('예약 가능한 수업을 불러오지 못했습니다.');

    await expect
      .poll(
        async () => {
          if (await beginnerCard.isVisible().catch(() => false)) return 'card';
          if (await groupLoadError.isVisible().catch(() => false)) return 'error';
          return 'waiting';
        },
        { timeout: 15000 }
      )
      .toBe('card');

    await expect(page.getByText('Course Free Visible')).toHaveCount(0);
    await summaryRef.set(
      {
        groupClassIds: [freeClassId, legacyClassId],
        groupCourseTypes: ['beginner_conversation'],
        updatedAt: nowTs,
      },
      { merge: true }
    );
    await expect
      .poll(async () => getStudentGroupAccessSummary(summaryRef), { timeout: 15000 })
      .toMatchObject({
        groupClassIds: expect.arrayContaining([freeClassId, legacyClassId]),
        groupCourseTypes: expect.arrayContaining(['beginner_conversation']),
      });
    await expectLessonCardVisible(page, 'Course Free Visible', summaryRef);
    await expectLessonCardVisible(page, 'Course Legacy Visible', summaryRef);

    await summaryRef.set(
      {
        groupClassIds: [legacyClassId],
        groupCourseTypes: ['free_talking'],
        updatedAt: nowTs,
      },
      { merge: true }
    );
    await expect
      .poll(async () => getStudentGroupAccessSummary(summaryRef), { timeout: 15000 })
      .toMatchObject({
        groupClassIds: [legacyClassId],
        groupCourseTypes: ['free_talking'],
      });
    await expectLessonCardVisible(page, 'Course Free Visible', summaryRef);
    await expect(page.getByText('Course Beginner Only')).toHaveCount(0);
    await expectLessonCardVisible(page, 'Course Legacy Visible', summaryRef);
  } finally {
    await Promise.all(refsToDelete.map((ref) => ref.delete().catch(() => {})));
    await Promise.all([
      restoreDoc(studentMembershipRef, originals.studentMembership),
      restoreDoc(studentUserRef, originals.studentUser),
    ]);
  }
});

test('student booking page fails closed when membership is not linked to a studentId', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 student booking setup을 실행합니다.');
  test.setTimeout(120000);

  let fixture = null;

  try {
    fixture = await createStudentBookingFixture(`${Date.now()}-${testInfo.workerIndex}`, {
      studentLinked: false,
    });

    await loginAsStudent(page, TEST_STUDENT_EMAIL, TEST_STUDENT_PASSWORD);
    await expect(page.getByText('학생 계정 연결 정보가 없어 예약 페이지를 사용할 수 없습니다.')).toBeVisible();
    await expect(page.locator('[data-testid="student-booking-lesson-card"]')).toHaveCount(0);
  } finally {
    if (fixture) {
      await cleanupStudentBookingFixture(fixture).catch(() => {});
    }
  }
});
