import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';
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
  DEFAULT_E2E_ACADEMY_ID,
  DEFAULT_E2E_ACADEMY_NAME,
  TEST_TEACHER_EMAIL,
} from './fixtures/test-data.js';

const require = createRequire(import.meta.url);
const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const TEACHER_NAME = 'teacher';

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

function getLessonRow(page, subject) {
  return page
    .locator('[data-testid="group-lesson-row"]')
    .filter({ hasText: subject })
    .first();
}

function formatLocalYmd(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function nextWeekdayYmd(targetDay) {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  while (date.getDay() !== targetDay) {
    date.setDate(date.getDate() + 1);
  }
  return formatLocalYmd(date);
}

async function deleteGroupClassLessons(db, groupClassId) {
  if (!groupClassId) return;
  const snap = await db
    .collection('groupLessons')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('groupClassId', '==', groupClassId)
    .get();
  await Promise.all(snap.docs.map((docSnap) => docSnap.ref.delete().catch(() => {})));
}

async function openReservationAdd(row) {
  await row.getByTestId('group-lesson-reserve-add-button').click();
  return row.page().getByTestId('group-reservation-modal');
}

async function openReservationView(row) {
  await row.getByTestId('group-lesson-reserve-view-button').click();
  return row.page().getByTestId('group-reservation-modal');
}

async function closeReservationModal(modal) {
  await modal.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(modal).toBeHidden();
}

async function clickExpectingNoDialog(page, locator) {
  const dialogPromise = page
    .waitForEvent('dialog', { timeout: 5000 })
    .then(async (dialog) => {
      const message = dialog.message();
      await dialog.accept();
      throw new Error(`Unexpected dialog while reserving group lesson: ${message}`);
    })
    .catch((error) => {
      if (/Timeout/.test(String(error?.message || ''))) return null;
      throw error;
    });

  await locator.click();
  await dialogPromise;
}

test('admin can create a free_talking group class and generated lessons inherit groupCourseType', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 group course type setup을 실행합니다.');
  test.setTimeout(120000);

  initializeAdmin();
  const db = admin.firestore();
  const groupName = `E2E 프리토킹반 ${Date.now()}-${testInfo.workerIndex}`;
  let groupClassId = '';

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '단체반 관리');
    await page.getByRole('button', { name: '정규반 만들기' }).click();

    const dialog = page.getByRole('dialog', { name: '정규반 만들기' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('반 이름').fill(groupName);
    await dialog.getByLabel('담당 선생님').selectOption(TEACHER_NAME);
    await dialog.getByLabel('정원 (명)').fill('3');
    await dialog.getByLabel('수업 시작일 (자동 일정 기준)').fill(nextWeekdayYmd(0));
    await dialog.getByLabel('기본 시간 (HH:mm)').fill('10:30');
    await dialog.getByLabel('과목').fill('E2E Course Type');
    await dialog.getByLabel('코스 유형').selectOption('free_talking');
    await dialog.getByRole('button', { name: '일', exact: true }).click();
    await dialog.getByRole('button', { name: '저장' }).click();

    await expect
      .poll(async () => {
        const snap = await db
          .collection('groupClasses')
          .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
          .where('name', '==', groupName)
          .limit(1)
          .get();
        const createdGroup = snap.docs[0];
        if (!createdGroup) return '';
        groupClassId = createdGroup.id;
        return createdGroup.data().groupCourseType === 'free_talking' ? createdGroup.id : '';
      }, { timeout: 60000 })
      .not.toBe('');

    await expect
      .poll(async () => {
        const snap = await db
          .collection('groupLessons')
          .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
          .where('groupClassId', '==', groupClassId)
          .limit(3)
          .get();
        return snap.docs.filter((docSnap) => docSnap.data().groupCourseType === 'free_talking').length;
      }, { timeout: 90000 })
      .toBeGreaterThan(0);

    if (await dialog.isVisible().catch(() => false)) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      const groupSectionButton = page.getByRole('button', { name: '단체반 관리', exact: true });
      await expect(groupSectionButton)
        .toBeVisible({ timeout: 5000 })
        .catch(async () => {
          await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
        });
      await openDashboardSection(page, '단체반 관리');
    }

    await expect(getGroupRow(page, groupName)).toContainText('프리토킹');
  } finally {
    await deleteGroupClassLessons(db, groupClassId).catch(() => {});
    if (groupClassId) {
      await db.collection('groupClasses').doc(groupClassId).delete().catch(() => {});
    }
  }
});

function reservationId({ lessonId, studentId }) {
  return `${DEFAULT_E2E_ACADEMY_ID}__${lessonId}__${studentId}`;
}

async function createBookingFixture(unique) {
  initializeAdmin();
  const db = admin.firestore();
  const nowTs = admin.firestore.Timestamp.now();
  const adminUser = await admin.auth().getUserByEmail(ADMIN_EMAIL);
  const teacherUser = await admin.auth().getUserByEmail(TEST_TEACHER_EMAIL);
  const groupClassId = `e2e-booking-group-${unique}`;
  const firstStudentId = `e2e-booking-student-a-${unique}`;
  const secondStudentId = `e2e-booking-student-b-${unique}`;
  const mismatchStudentId = `e2e-booking-student-mismatch-${unique}`;
  const groupName = `E2E 예약반 ${unique}`;
  const firstStudentName = `예약학생 A ${unique}`;
  const secondStudentName = `예약학생 B ${unique}`;
  const mismatchStudentName = `타학원 학생 ${unique}`;
  const bookableLessonId = `e2e-booking-bookable-${unique}`;
  const fullLessonId = `e2e-booking-full-${unique}`;
  const nonBookableLessonId = `e2e-booking-closed-${unique}`;
  const academyRef = db.collection('academies').doc(DEFAULT_E2E_ACADEMY_ID);
  const adminRef = db.collection('users').doc(adminUser.uid);
  const teacherRef = db.collection('users').doc(teacherUser.uid);
  const adminMembershipRef = db
    .collection('academyMemberships')
    .doc(`${DEFAULT_E2E_ACADEMY_ID}_${adminUser.uid}`);
  const teacherMembershipRef = db
    .collection('academyMemberships')
    .doc(`${DEFAULT_E2E_ACADEMY_ID}_${teacherUser.uid}`);
  const groupRef = db.collection('groupClasses').doc(groupClassId);
  const permissionDefaults = {
    canAddStudent: true,
    canEditStudent: true,
    canDeleteStudent: true,
    canManageAttendance: true,
    canEditLesson: true,
    canDeleteLesson: true,
    canCreateLessonDirectly: true,
    requiresLessonApproval: false,
  };

  const originals = {
    admin: await readDoc(adminRef),
    teacher: await readDoc(teacherRef),
    adminMembership: await readDoc(adminMembershipRef),
    teacherMembership: await readDoc(teacherMembershipRef),
  };

  await Promise.all([
    academyRef.set(
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
    adminRef.set(
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
    teacherRef.set(
      {
        uid: teacherUser.uid,
        email: TEST_TEACHER_EMAIL,
        displayName: 'Teacher E2E',
        role: 'teacher',
        isActive: true,
        teacherName: TEACHER_NAME,
        lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
        updatedAt: nowTs,
      },
      { merge: true }
    ),
    adminMembershipRef.set(
      {
        academyId: DEFAULT_E2E_ACADEMY_ID,
        uid: adminUser.uid,
        email: ADMIN_EMAIL,
        role: 'owner',
        status: 'active',
        teacherName: '',
        displayName: 'Admin E2E',
        permissions: permissionDefaults,
        updatedAt: nowTs,
      },
      { merge: true }
    ),
    teacherMembershipRef.set(
      {
        academyId: DEFAULT_E2E_ACADEMY_ID,
        uid: teacherUser.uid,
        email: TEST_TEACHER_EMAIL,
        role: 'teacher',
        status: 'active',
        teacherName: TEACHER_NAME,
        displayName: 'Teacher E2E',
        permissions: permissionDefaults,
        updatedAt: nowTs,
      },
      { merge: true }
    ),
  ]);

  await groupRef.set({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    name: groupName,
    teacher: TEACHER_NAME,
    teacherName: TEACHER_NAME,
    maxStudents: 2,
    time: '10:00',
    subject: 'Booking',
    weekdays: ['월'],
    createdAt: nowTs,
    updatedAt: nowTs,
  });

  await Promise.all([
    db.collection('privateStudents').doc(firstStudentId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: firstStudentName,
      teacher: TEACHER_NAME,
      status: 'active',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('privateStudents').doc(secondStudentId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: secondStudentName,
      teacher: TEACHER_NAME,
      status: 'active',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('privateStudents').doc(mismatchStudentId).set({
      academyId: 'academy_e2e_other',
      name: mismatchStudentName,
      teacher: TEACHER_NAME,
      status: 'active',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
  ]);

  await Promise.all([
    db.collection('groupStudents').doc(`e2e-booking-gs-a-${unique}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      groupClassId,
      classID: groupClassId,
      studentId: firstStudentId,
      studentName: firstStudentName,
      name: firstStudentName,
      teacher: TEACHER_NAME,
      status: 'active',
      studentStatus: 'active',
      attendanceCount: 0,
      startDate: admin.firestore.Timestamp.fromDate(new Date('2099-01-01T00:00:00')),
      excludedDates: [],
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('groupStudents').doc(`e2e-booking-gs-b-${unique}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      groupClassId,
      classID: groupClassId,
      studentId: secondStudentId,
      studentName: secondStudentName,
      name: secondStudentName,
      teacher: TEACHER_NAME,
      status: 'active',
      studentStatus: 'active',
      attendanceCount: 0,
      startDate: admin.firestore.Timestamp.fromDate(new Date('2099-01-01T00:00:00')),
      excludedDates: [],
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('groupStudents').doc(`e2e-booking-gs-mismatch-${unique}`).set({
      academyId: 'academy_e2e_other',
      groupClassId,
      classID: groupClassId,
      studentId: mismatchStudentId,
      studentName: mismatchStudentName,
      name: mismatchStudentName,
      teacher: TEACHER_NAME,
      status: 'active',
      studentStatus: 'active',
      attendanceCount: 0,
      startDate: admin.firestore.Timestamp.fromDate(new Date('2099-01-01T00:00:00')),
      excludedDates: [],
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
  ]);

  const baseLesson = {
    academyId: DEFAULT_E2E_ACADEMY_ID,
    groupClassId,
    groupClassID: groupClassId,
    groupClassName: groupName,
    teacher: TEACHER_NAME,
    teacherName: TEACHER_NAME,
    completed: false,
    countedStudentIDs: [],
    attendanceAppliedAt: null,
    bookingMode: 'fixed',
    generationKind: 'manual',
    createdAt: nowTs,
    updatedAt: nowTs,
  };

  await Promise.all([
    db.collection('groupLessons').doc(bookableLessonId).set({
      ...baseLesson,
      date: '2099-01-05',
      time: '10:00',
      subject: 'Bookable',
      capacity: 2,
      bookedCount: 0,
      isBookable: true,
    }),
    db.collection('groupLessons').doc(fullLessonId).set({
      ...baseLesson,
      date: '2099-01-06',
      time: '10:00',
      subject: 'Full',
      capacity: 1,
      bookedCount: 0,
      isBookable: true,
    }),
    db.collection('groupLessons').doc(nonBookableLessonId).set({
      ...baseLesson,
      date: '2099-01-07',
      time: '10:00',
      subject: 'Closed',
      capacity: 2,
      bookedCount: 0,
      isBookable: false,
    }),
  ]);

  return {
    originals,
    refs: {
      adminRef,
      teacherRef,
      adminMembershipRef,
      teacherMembershipRef,
    },
    groupClassId,
    groupName,
    firstStudentId,
    secondStudentId,
    mismatchStudentName,
    firstStudentName,
    secondStudentName,
    bookableLessonId,
    fullLessonId,
    nonBookableLessonId,
  };
}

async function cleanupBookingFixture(setup) {
  if (!setup) return;
  initializeAdmin();
  const db = admin.firestore();
  const refs = [
    db.collection('groupClasses').doc(setup.groupClassId),
    db.collection('privateStudents').doc(setup.firstStudentId),
    db.collection('privateStudents').doc(setup.secondStudentId),
    db.collection('privateStudents').doc(`e2e-booking-student-mismatch-${setup.groupClassId.replace('e2e-booking-group-', '')}`),
    db.collection('groupStudents').doc(`e2e-booking-gs-a-${setup.groupClassId.replace('e2e-booking-group-', '')}`),
    db.collection('groupStudents').doc(`e2e-booking-gs-b-${setup.groupClassId.replace('e2e-booking-group-', '')}`),
    db.collection('groupStudents').doc(`e2e-booking-gs-mismatch-${setup.groupClassId.replace('e2e-booking-group-', '')}`),
    db.collection('groupLessons').doc(setup.bookableLessonId),
    db.collection('groupLessons').doc(setup.fullLessonId),
    db.collection('groupLessons').doc(setup.nonBookableLessonId),
    db.collection('groupLessonReservations').doc(
      reservationId({ lessonId: setup.bookableLessonId, studentId: setup.firstStudentId })
    ),
    db.collection('groupLessonReservations').doc(
      reservationId({ lessonId: setup.fullLessonId, studentId: setup.firstStudentId })
    ),
  ];

  await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
  await Promise.all([
    restoreDoc(setup.refs.adminRef, setup.originals.admin),
    restoreDoc(setup.refs.teacherRef, setup.originals.teacher),
    restoreDoc(setup.refs.adminMembershipRef, setup.originals.adminMembership),
    restoreDoc(setup.refs.teacherMembershipRef, setup.originals.teacherMembership),
  ]);
}

async function expectLessonBookedCount(db, lessonId, expected) {
  await expect
    .poll(async () => {
      const snap = await db.collection('groupLessons').doc(lessonId).get();
      return snap.data()?.bookedCount;
    }, { timeout: 15000 })
    .toBe(expected);
}

async function expectReservationStatus(db, lessonId, studentId, expected) {
  await expect
    .poll(async () => {
      const snap = await db
        .collection('groupLessonReservations')
        .doc(reservationId({ lessonId, studentId }))
        .get();
      return snap.data()?.status || '';
    }, { timeout: 15000 })
    .toBe(expected);
}

test('group lesson booking MVP reserves, blocks duplicate/full/closed cases, and cancels', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 booking setup을 실행합니다.');
  test.setTimeout(120000);

  initializeAdmin();
  const db = admin.firestore();
  let setup = null;

  try {
    const unique = `${Date.now()}-${testInfo.workerIndex}`;
    setup = await createBookingFixture(unique);

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '단체반 관리');

    const groupRow = getGroupRow(page, setup.groupName);
    await expect(groupRow).toBeVisible({ timeout: 15000 });
    await groupRow.click();
    await expect(getRegisteredStudentsHeading(page, setup.groupName)).toBeVisible();

    const bookableRow = getLessonRow(page, 'Bookable');
    await expect(bookableRow).toBeVisible({ timeout: 15000 });
    await expect(bookableRow).toContainText('0 / 2');
    await expect(bookableRow).toContainText('예약 가능');

    let modal = await openReservationAdd(bookableRow);
    await expect(modal.getByText(setup.firstStudentName)).toBeVisible();
    await expect(modal.getByText(setup.secondStudentName)).toBeVisible();
    await expect(modal.getByText(setup.mismatchStudentName)).toHaveCount(0);
    await clickExpectingNoDialog(
      page,
      modal
        .getByTestId('group-reservation-candidate-row')
        .filter({ hasText: setup.firstStudentName })
        .getByRole('button', { name: '예약', exact: true })
    );
    await expectReservationStatus(db, setup.bookableLessonId, setup.firstStudentId, 'active');
    await expectLessonBookedCount(db, setup.bookableLessonId, 1);
    await expect(bookableRow).toContainText('1 / 2', { timeout: 15000 });
    await closeReservationModal(modal);

    modal = await openReservationAdd(bookableRow);
    await expect(modal.getByText(setup.firstStudentName)).toHaveCount(0);
    await expect(modal.getByText(setup.secondStudentName)).toBeVisible();
    await closeReservationModal(modal);

    modal = await openReservationView(bookableRow);
    let activeReservation = modal
      .getByTestId('group-reservation-row')
      .filter({ hasText: setup.firstStudentName });
    await expect(activeReservation).toContainText('관리자 예약');
    await expect(activeReservation).toContainText('예약 완료');
    await activeReservation.getByRole('button', { name: '예약 취소', exact: true }).click();
    await expectReservationStatus(db, setup.bookableLessonId, setup.firstStudentId, 'cancelled');
    await expect(activeReservation).toContainText('예약 취소', { timeout: 15000 });
    await expectLessonBookedCount(db, setup.bookableLessonId, 0);
    await closeReservationModal(modal);
    await expect(bookableRow).toContainText('0 / 2', { timeout: 15000 });

    modal = await openReservationAdd(bookableRow);
    await expect(modal.getByText(setup.firstStudentName)).toBeVisible();
    await clickExpectingNoDialog(
      page,
      modal
        .getByTestId('group-reservation-candidate-row')
        .filter({ hasText: setup.firstStudentName })
        .getByRole('button', { name: '예약', exact: true })
    );
    await expectReservationStatus(db, setup.bookableLessonId, setup.firstStudentId, 'active');
    await expectLessonBookedCount(db, setup.bookableLessonId, 1);
    await closeReservationModal(modal);

    modal = await openReservationView(bookableRow);
    activeReservation = modal
      .getByTestId('group-reservation-row')
      .filter({ hasText: setup.firstStudentName });
    await activeReservation.getByRole('button', { name: '예약 취소', exact: true }).click();
    await expectReservationStatus(db, setup.bookableLessonId, setup.firstStudentId, 'cancelled');
    await expectLessonBookedCount(db, setup.bookableLessonId, 0);
    await closeReservationModal(modal);

    const fullRow = getLessonRow(page, 'Full');
    await expect(fullRow).toContainText('0 / 1');
    modal = await openReservationAdd(fullRow);
    await clickExpectingNoDialog(
      page,
      modal
        .getByTestId('group-reservation-candidate-row')
        .filter({ hasText: setup.firstStudentName })
        .getByRole('button', { name: '예약', exact: true })
    );
    await expectReservationStatus(db, setup.fullLessonId, setup.firstStudentId, 'active');
    await expectLessonBookedCount(db, setup.fullLessonId, 1);
    await expect(fullRow).toContainText('1 / 1', { timeout: 15000 });
    await expect(fullRow).toContainText('마감');
    await closeReservationModal(modal);
    await expect(fullRow.getByTestId('group-lesson-reserve-add-button')).toBeDisabled();

    const nonBookableRow = getLessonRow(page, 'Closed');
    await expect(nonBookableRow).toContainText('비활성');
    await expect(nonBookableRow.getByTestId('group-lesson-reserve-add-button')).toBeDisabled();

    await expect(page.getByRole('heading', { name: '단체반 관리', level: 1 })).toBeVisible();
  } finally {
    if (setup) {
      await cleanupBookingFixture(setup).catch(() => {});
    }
  }
});
