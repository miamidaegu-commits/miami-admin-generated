import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';
import { test, expect } from '@playwright/test';
import {
  getStudentRow,
  getStudentSearchInput,
  BASE_URL,
  loginAsAdmin,
  loginAsStudent,
  openDashboardSection,
} from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEFAULT_E2E_ACADEMY_ID,
  DEFAULT_E2E_ACADEMY_NAME,
  TEST_STUDENT_EMAIL,
  TEST_STUDENT_PASSWORD,
  TEST_TEACHER_EMAIL,
  TEST_TEACHER_PASSWORD,
} from './fixtures/test-data.js';

const require = createRequire(import.meta.url);
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
  if (data) await ref.set(data);
  else await ref.delete().catch(() => {});
}

async function loginAsTeacher(page) {
  await page.goto(`${BASE_URL}login/`);
  await page
    .getByLabel(/Email|이메일/i)
    .or(page.locator('input[type="email"]'))
    .first()
    .fill(TEST_TEACHER_EMAIL);
  await page
    .getByLabel(/Password|비밀번호/i)
    .or(page.locator('input[type="password"]'))
    .first()
    .fill(TEST_TEACHER_PASSWORD);
  await page.getByRole('button', { name: /Sign In|로그인/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  await expect(page.getByTestId('dashboard-welcome-subtitle')).toBeVisible({ timeout: 15000 });
}

function reservationId({ lessonId, studentId }) {
  return `${DEFAULT_E2E_ACADEMY_ID}__${lessonId}__${studentId}`;
}

function privateReservationId({ slotId, studentId }) {
  return `${DEFAULT_E2E_ACADEMY_ID}__${slotId}__${studentId}`;
}

async function createFixture(unique) {
  initializeAdmin();
  const db = admin.firestore();
  const auth = admin.auth();
  const nowTs = admin.firestore.Timestamp.now();
  const adminUser = await auth.getUserByEmail(ADMIN_EMAIL);
  const teacherUser = await auth.getUserByEmail(TEST_TEACHER_EMAIL);
  const studentUser = await auth.getUserByEmail(TEST_STUDENT_EMAIL);
  const studentId = `e2e-admin-history-student-${unique}`;
  const otherStudentId = `e2e-admin-history-other-${unique}`;
  const studentName = `수업내역학생 ${unique}`;
  const otherStudentName = `다른내역학생 ${unique}`;
  const groupClassId = `e2e-admin-history-group-${unique}`;
  const groupLessonId = `e2e-admin-history-group-lesson-${unique}`;
  const otherGroupLessonId = `e2e-admin-history-other-group-lesson-${unique}`;
  const privateSlotId = `e2e-admin-history-private-slot-${unique}`;
  const cancelledPrivateSlotId = `e2e-admin-history-cancelled-private-slot-${unique}`;
  const otherPrivateSlotId = `e2e-admin-history-other-private-slot-${unique}`;
  const activePackageId = `e2e-admin-history-active-package-${unique}`;
  const endedPackageId = `e2e-admin-history-ended-package-${unique}`;
  const creditId = `e2e-admin-history-credit-${unique}`;
  const restoreCreditId = `e2e-admin-history-restore-credit-${unique}`;
  const studentMembershipRef = db
    .collection('academyMemberships')
    .doc(`${DEFAULT_E2E_ACADEMY_ID}_${studentUser.uid}`);
  const studentUserRef = db.collection('users').doc(studentUser.uid);
  const originals = {
    studentMembership: await readDoc(studentMembershipRef),
    studentUser: await readDoc(studentUserRef),
  };
  const permissions = {
    canManageAttendance: true,
    canAddStudent: true,
    canEditStudent: true,
    canDeleteStudent: true,
    canEditLesson: true,
    canDeleteLesson: true,
    canCreateLessonDirectly: true,
    requiresLessonApproval: false,
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
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${adminUser.uid}`).set(
      {
        academyId: DEFAULT_E2E_ACADEMY_ID,
        uid: adminUser.uid,
        email: ADMIN_EMAIL,
        displayName: 'Admin E2E',
        role: 'owner',
        teacherName: '',
        status: 'active',
        permissions,
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
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${teacherUser.uid}`).set(
      {
        academyId: DEFAULT_E2E_ACADEMY_ID,
        uid: teacherUser.uid,
        email: TEST_TEACHER_EMAIL,
        displayName: 'Teacher E2E',
        role: 'teacher',
        teacherName: TEACHER_NAME,
        status: 'active',
        permissions,
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
    studentMembershipRef.set(
      {
        academyId: DEFAULT_E2E_ACADEMY_ID,
        uid: studentUser.uid,
        email: TEST_STUDENT_EMAIL,
        displayName: 'Student E2E',
        role: 'student',
        studentId,
        teacherName: '',
        status: 'active',
        permissions: {},
        updatedAt: nowTs,
      },
      { merge: true }
    ),
    db.collection('privateStudents').doc(studentId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: studentName,
      teacher: TEACHER_NAME,
      phone: '010-1111-2222',
      status: 'active',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('privateStudents').doc(otherStudentId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: otherStudentName,
      teacher: TEACHER_NAME,
      status: 'active',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('studentPackages').doc(activePackageId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId,
      title: 'Active Private Pack',
      packageType: 'private',
      teacher: TEACHER_NAME,
      totalCount: 10,
      usedCount: 3,
      remainingCount: 7,
      status: 'active',
      startDate: '2026-01-01',
      expiresAt: '2099-01-01',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('studentPackages').doc(endedPackageId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId,
      title: 'Ended Group Pack',
      packageType: 'group',
      teacher: TEACHER_NAME,
      totalCount: 8,
      usedCount: 8,
      remainingCount: 0,
      status: 'ended',
      startDate: '2025-01-01',
      expiresAt: '2025-12-31',
      createdAt: admin.firestore.Timestamp.fromDate(new Date('2025-01-01T00:00:00')),
      updatedAt: nowTs,
    }),
    db.collection('groupClasses').doc(groupClassId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: 'History Group',
      teacher: TEACHER_NAME,
      subject: 'History',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('groupStudents').doc(`gs-${studentId}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      groupClassId,
      studentId,
      studentName,
      teacher: TEACHER_NAME,
      packageId: endedPackageId,
      status: 'active',
      studentStatus: 'active',
      startDate: '2025-01-01',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('groupLessons').doc(groupLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      groupClassId,
      groupClassName: 'History Group',
      teacher: TEACHER_NAME,
      date: '2099-03-01',
      time: '15:00',
      subject: 'Admin Group Reservation',
      isBookable: true,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('groupLessons').doc(otherGroupLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      groupClassId,
      groupClassName: 'History Group',
      teacher: TEACHER_NAME,
      date: '2099-03-02',
      time: '15:00',
      subject: 'Other Student History',
      isBookable: true,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('groupLessonReservations').doc(reservationId({ lessonId: groupLessonId, studentId })).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      lessonId: groupLessonId,
      groupClassId,
      studentId,
      status: 'active',
      source: 'student',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('groupLessonReservations').doc(reservationId({ lessonId: otherGroupLessonId, studentId: otherStudentId })).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      lessonId: otherGroupLessonId,
      groupClassId,
      studentId: otherStudentId,
      status: 'active',
      source: 'student',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('privateLessonReservations').doc(privateReservationId({ slotId: privateSlotId, studentId })).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      slotId: privateSlotId,
      studentId,
      teacher: TEACHER_NAME,
      date: '2099-02-01',
      time: '10:00',
      status: 'active',
      packageId: activePackageId,
      source: 'student',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('privateLessonReservations').doc(privateReservationId({ slotId: cancelledPrivateSlotId, studentId })).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      slotId: cancelledPrivateSlotId,
      studentId,
      teacher: TEACHER_NAME,
      date: '2099-02-02',
      time: '11:00',
      status: 'cancelled',
      packageId: activePackageId,
      source: 'student',
      createdAt: nowTs,
      updatedAt: nowTs,
      cancelledAt: nowTs,
    }),
    db.collection('privateLessonReservations').doc(privateReservationId({ slotId: otherPrivateSlotId, studentId: otherStudentId })).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      slotId: otherPrivateSlotId,
      studentId: otherStudentId,
      teacher: TEACHER_NAME,
      date: '2099-02-03',
      time: '12:00',
      status: 'active',
      source: 'student',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('creditTransactions').doc(creditId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId,
      teacher: TEACHER_NAME,
      packageId: endedPackageId,
      packageType: 'group',
      packageTitle: 'Ended Group Pack',
      sourceType: 'groupLesson',
      sourceId: groupLessonId,
      actionType: 'group_deduct',
      deltaCount: -1,
      memo: 'Admin Deduct History',
      createdAt: nowTs,
    }),
    db.collection('creditTransactions').doc(restoreCreditId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId,
      teacher: TEACHER_NAME,
      packageId: endedPackageId,
      packageType: 'group',
      packageTitle: 'Ended Group Pack',
      sourceType: 'groupLesson',
      sourceId: groupLessonId,
      actionType: 'group_deduct_restore',
      deltaCount: 1,
      memo: 'Admin Restore History',
      createdAt: nowTs,
    }),
  ]);

  return {
    studentId,
    otherStudentId,
    studentName,
    originals,
    refs: [
      db.collection('privateStudents').doc(studentId),
      db.collection('privateStudents').doc(otherStudentId),
      db.collection('studentPackages').doc(activePackageId),
      db.collection('studentPackages').doc(endedPackageId),
      db.collection('groupClasses').doc(groupClassId),
      db.collection('groupStudents').doc(`gs-${studentId}`),
      db.collection('groupLessons').doc(groupLessonId),
      db.collection('groupLessons').doc(otherGroupLessonId),
      db.collection('groupLessonReservations').doc(reservationId({ lessonId: groupLessonId, studentId })),
      db.collection('groupLessonReservations').doc(reservationId({ lessonId: otherGroupLessonId, studentId: otherStudentId })),
      db.collection('privateLessonReservations').doc(privateReservationId({ slotId: privateSlotId, studentId })),
      db.collection('privateLessonReservations').doc(privateReservationId({ slotId: cancelledPrivateSlotId, studentId })),
      db.collection('privateLessonReservations').doc(privateReservationId({ slotId: otherPrivateSlotId, studentId: otherStudentId })),
      db.collection('creditTransactions').doc(creditId),
      db.collection('creditTransactions').doc(restoreCreditId),
    ],
  };
}

async function cleanupFixture(fixture) {
  if (!fixture) return;
  const db = admin.firestore();
  const studentUser = await admin.auth().getUserByEmail(TEST_STUDENT_EMAIL);
  await Promise.all(fixture.refs.map((ref) => ref.delete().catch(() => {})));
  await Promise.all([
    restoreDoc(
      db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${studentUser.uid}`),
      fixture.originals.studentMembership
    ),
    restoreDoc(db.collection('users').doc(studentUser.uid), fixture.originals.studentUser),
  ]);
}

test('admin can open student lesson history with packages and student-only reservations', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'chromium only.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json is required.');
  test.setTimeout(120000);

  const fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}`);

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '학생 관리');
    await getStudentSearchInput(page).fill(fixture.studentName);
    const row = getStudentRow(page, fixture.studentName);
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.getByTestId('student-history-open-button').click();

    const modal = page.getByTestId('student-history-modal');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await expect(modal.getByRole('heading', { name: '학생 수업 내역' })).toBeVisible();
    await expect(modal.getByTestId('student-history-profile')).toContainText(fixture.studentName);

    const summary = modal.getByTestId('student-history-package-summary');
    await expect(summary).toContainText('사용 중 수강권');
    await expect(summary).toContainText('1');
    await expect(summary).toContainText('종료 수강권');
    await expect(summary).toContainText('남은 횟수 합계');
    await expect(summary).toContainText('7');

    const activePackage = modal.getByTestId('student-history-package-row').filter({ hasText: 'Active Private Pack' });
    await expect(activePackage).toContainText('1:1');
    await expect(activePackage).toContainText('남은 7');
    const endedPackage = modal.getByTestId('student-history-package-row').filter({ hasText: 'Ended Group Pack' });
    await expect(endedPackage).toContainText('단체반');
    await expect(endedPackage).toContainText('종료');

    const privateReservationRow = modal.getByTestId('student-history-lesson-row').filter({ hasText: '2099-02-01' });
    await expect(privateReservationRow).toContainText('1:1 수업');
    await expect(privateReservationRow).toContainText('예약 완료');
    await expect(modal.getByTestId('student-history-lesson-row').filter({ hasText: 'Admin Group Reservation' })).toContainText('단체반 수업');
    await expect(modal.getByTestId('student-history-lesson-row').filter({ hasText: '2099-02-02' })).toContainText('예약 취소');
    await expect(modal.getByTestId('student-history-lesson-row').filter({ hasText: 'Admin Deduct History' })).toContainText('출석 처리됨');
    await expect(modal.getByTestId('student-history-lesson-row').filter({ hasText: 'Admin Restore History' })).toContainText('차감 취소');
    await expect(modal).not.toContainText('Other Student History');
  } finally {
    await cleanupFixture(fixture).catch(() => {});
  }
});

test('teacher and student cannot access admin-only student history view', async ({
  browser,
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'chromium only.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json is required.');
  test.setTimeout(120000);

  const fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}`);
  const contexts = [];

  try {
    await loginAsTeacher(page);
    if ((await page.getByRole('button', { name: '학생 관리', exact: true }).count()) > 0) {
      await openDashboardSection(page, '학생 관리');
      await getStudentSearchInput(page).fill(fixture.studentName);
      const row = getStudentRow(page, fixture.studentName);
      await expect(row).toBeVisible({ timeout: 15000 });
      await expect(row.getByTestId('student-history-open-button')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('student-history-open-button')).toHaveCount(0);
    }

    const studentContext = await browser.newContext();
    contexts.push(studentContext);
    const studentPage = await studentContext.newPage();
    await loginAsStudent(studentPage, TEST_STUDENT_EMAIL, TEST_STUDENT_PASSWORD);
    await expect(studentPage.getByText('학생 수업 내역')).toHaveCount(0);
    await expect(studentPage.getByTestId('student-history-modal')).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await cleanupFixture(fixture).catch(() => {});
  }
});
