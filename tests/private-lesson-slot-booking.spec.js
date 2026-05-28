import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import admin from 'firebase-admin';
import { test, expect } from '@playwright/test';
import { loginAsAdmin, loginAsStudent, openDashboardSection } from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEFAULT_E2E_ACADEMY_ID,
  DEFAULT_E2E_ACADEMY_NAME,
  TEST_STUDENT_PASSWORD,
  TEST_TEACHER_EMAIL,
} from './fixtures/test-data.js';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const TEACHER_NAME = 'teacher';
const HIDDEN_TEACHER_NAME = 'hidden-teacher';

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

async function createOrGetStudentAuthUser({ email, displayName }) {
  try {
    const existingUser = await admin.auth().getUserByEmail(email);
    const updatedUser = await admin.auth().updateUser(existingUser.uid, {
      email,
      password: TEST_STUDENT_PASSWORD,
      displayName,
      disabled: false,
    });
    return { user: updatedUser, created: false };
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
  }

  const user = await admin.auth().createUser({
    email,
    password: TEST_STUDENT_PASSWORD,
    displayName,
    disabled: false,
  });
  return { user, created: true };
}

async function linkStudentAccountWithScript({ studentId, email, displayName }) {
  await execFileAsync(
    process.execPath,
    [
      'scripts/link-student-account.mjs',
      '--academy-id',
      DEFAULT_E2E_ACADEMY_ID,
      '--student-id',
      studentId,
      '--email',
      email,
      '--display-name',
      displayName,
      '--password',
      TEST_STUDENT_PASSWORD,
    ],
    {
      cwd: process.cwd(),
      timeout: 30000,
    }
  );
}

function reservationId({ slotId, studentId }) {
  return `${DEFAULT_E2E_ACADEMY_ID}__${slotId}__${studentId}`;
}

function privateSummaryId({ studentId }) {
  return `${DEFAULT_E2E_ACADEMY_ID}__${studentId}`;
}

function lessonId(prefix, unique) {
  return `${prefix}-${unique}`;
}

function formatYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addWeeksToYmd(date, weeks) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + weeks * 7);
  return formatYmd(next);
}

function addDaysToYmd(date, days) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return formatYmd(next);
}

function formatSeoulYmd(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
}

function ensureMondaySaturdayYmd(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  while (parsed.getUTCDay() === 0) {
    parsed.setUTCDate(parsed.getUTCDate() + 1);
  }
  return parsed.toISOString().slice(0, 10);
}

function upcomingMondaySaturdayYmd(daysFromNow) {
  return ensureMondaySaturdayYmd(
    formatSeoulYmd(new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000))
  );
}

function futureTuesdayYmd(unique) {
  const offsetWeeks = (Number.parseInt(String(unique).split('-')[0], 10) || Date.now()) % 400;
  const date = new Date('2098-01-01T00:00:00');
  while (date.getDay() !== 2) date.setDate(date.getDate() + 1);
  date.setDate(date.getDate() + offsetWeeks * 7);
  return formatYmd(date);
}

function privateSlotCard(page, text) {
  return page.locator('[data-testid="student-private-slot-card"]').filter({ hasText: text }).first();
}

function privateBusySlotCard(page, text) {
  return page
    .locator('[data-testid="student-private-busy-slot-card"]')
    .filter({ hasText: text })
    .first();
}

function privateReservationCard(page, text) {
  return page
    .locator('[data-testid="student-private-reservation-card"]')
    .filter({ hasText: text })
    .first();
}

function lessonHistoryCard(page, text) {
  return page
    .locator('[data-testid="student-lesson-history-card"]')
    .filter({ hasText: text })
    .first();
}

async function queryMatchingSlots(db, { date, time }) {
  const snap = await db
    .collection('privateLessonSlots')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('teacher', '==', TEACHER_NAME)
    .where('date', '==', date)
    .where('time', '==', time)
    .get();
  return snap.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() || {} }));
}

async function deleteMatchingSlots(db, { dates, time }) {
  const snaps = await Promise.all(dates.map((date) => queryMatchingSlots(db, { date, time })));
  await Promise.all(
    snaps.flat().map((slot) => db.collection('privateLessonSlots').doc(slot.id).delete())
  );
}

async function queryCreatedSlot(db, { date, time, existingSlotIds }) {
  const beforeIds = existingSlotIds instanceof Set ? existingSlotIds : new Set(existingSlotIds || []);
  let slotId = '';
  await expect
    .poll(async () => {
      const docs = await queryMatchingSlots(db, { date, time });
      const newDocs = docs.filter((docItem) => !beforeIds.has(docItem.id));
      if (newDocs.length === 1) slotId = newDocs[0].id;
      return newDocs.length;
    }, { timeout: 15000 })
    .toBe(1);
  expect(beforeIds.has(slotId)).toBe(false);
  return slotId;
}

async function expectSlotStatus(db, slotId, expected) {
  await expect
    .poll(async () => {
      const snap = await db.collection('privateLessonSlots').doc(slotId).get();
      return snap.exists ? snap.data()?.status || null : null;
    }, { timeout: 15000 })
    .toBe(expected);
}

async function expectReservationStatus(db, slotId, studentId, expected) {
  await expect
    .poll(async () => {
      const snap = await db
        .collection('privateLessonReservations')
        .doc(reservationId({ slotId, studentId }))
        .get();
      return snap.exists ? snap.data()?.status || null : null;
    }, { timeout: 15000 })
    .toBe(expected);
}

async function expectSummarySlotAccess(db, studentId, slotId, expected) {
  await expect
    .poll(async () => {
      const data = await readDoc(
        db.collection('studentPrivateAccessSummary').doc(privateSummaryId({ studentId }))
      );
      const allowedSlotIds = Array.isArray(data?.allowedSlotIds) ? data.allowedSlotIds : [];
      const allowedPrivateLessonSlotIds = Array.isArray(data?.allowedPrivateLessonSlotIds)
        ? data.allowedPrivateLessonSlotIds
        : [];
      return allowedSlotIds.includes(slotId) && allowedPrivateLessonSlotIds.includes(slotId);
    }, { timeout: 15000 })
    .toBe(expected);
}

async function createFixture(unique) {
  initializeAdmin();
  const db = admin.firestore();
  const nowTs = admin.firestore.Timestamp.now();
  const adminUser = await admin.auth().getUserByEmail(ADMIN_EMAIL);
  const teacherUser = await admin.auth().getUserByEmail(TEST_TEACHER_EMAIL);
  const firstEmail = `private-slot-mvp-${unique}@example.com`;
  const firstDisplayName = `Private Slot First ${unique}`;
  const { user: firstStudentUser, created: firstStudentAuthCreated } =
    await createOrGetStudentAuthUser({
      email: firstEmail,
      displayName: firstDisplayName,
    });
  const secondEmail = `private-slot-${unique}@example.com`;
  const secondUser = await admin.auth().createUser({
    email: secondEmail,
    password: TEST_STUDENT_PASSWORD,
    displayName: `Private Slot Second ${unique}`,
  });

  const firstStudentId = `e2e-private-slot-student-a-${unique}`;
  const secondStudentId = `e2e-private-slot-student-b-${unique}`;
  const hiddenSlotId = `e2e-private-slot-hidden-${unique}`;
  const otherAcademySlotId = `e2e-private-slot-other-academy-${unique}`;
  const firstStudentName = `개인예약학생 A ${unique}`;
  const secondStudentName = `개인예약학생 B ${unique}`;
  const numericUnique = Number.parseInt(String(unique).split('-')[0], 10) || Date.now();
  const createdDate = upcomingMondaySaturdayYmd(3);
  const workerSuffix = Number.parseInt(String(unique).split('-').at(-1), 10) || 0;
  const createdHour = 8 + ((Math.floor(numericUnique / 60000) + workerSuffix) % 10);
  const createdTime = `${String(createdHour).padStart(2, '0')}:${String(numericUnique % 60).padStart(2, '0')}`;
  const hiddenDate = addDaysToYmd(createdDate, 1);
  const otherAcademyDate = addDaysToYmd(createdDate, 2);
  const approvedLessonDate = addDaysToYmd(createdDate, 93);
  const hiddenApprovedLessonDate = addDaysToYmd(createdDate, 124);
  const pastApprovedLessonDate = '2020-01-04';
  const approvedLessonTime = `11:${String(workerSuffix % 10).padStart(2, '0')}`;
  const approvedLessonSubject = `Approved Private Lesson ${unique}`;
  const hiddenApprovedLessonSubject = `Hidden Other Private Lesson ${unique}`;
  const pastApprovedLessonSubject = `Past Approved Private Lesson ${unique}`;
  const approvedLessonId = lessonId('e2e-approved-private-lesson', unique);
  const hiddenApprovedLessonId = lessonId('e2e-hidden-approved-private-lesson', unique);
  const pastApprovedLessonId = lessonId('e2e-past-approved-private-lesson', unique);

  const firstMembershipRef = db
    .collection('academyMemberships')
    .doc(`${DEFAULT_E2E_ACADEMY_ID}_${firstStudentUser.uid}`);
  const firstUserRef = db.collection('users').doc(firstStudentUser.uid);

  const permissionDefaults = {
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
    db.collection('users').doc(teacherUser.uid).set(
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
    firstUserRef.set(
      {
        uid: firstStudentUser.uid,
        email: firstEmail,
        displayName: firstDisplayName,
        role: 'student',
        isActive: true,
        lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
        updatedAt: nowTs,
      },
      { merge: true }
    ),
    firstMembershipRef.set(
      {
        academyId: DEFAULT_E2E_ACADEMY_ID,
        uid: firstStudentUser.uid,
        email: firstEmail,
        displayName: firstDisplayName,
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
          permissions: permissionDefaults,
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
          permissions: permissionDefaults,
          updatedAt: nowTs,
        },
        { merge: true }
      ),
    db.collection('users').doc(secondUser.uid).set({
      uid: secondUser.uid,
      email: secondEmail,
      displayName: `Private Slot Second ${unique}`,
      role: 'student',
      isActive: true,
      lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
      updatedAt: nowTs,
    }),
    db.collection('privateStudents').doc(firstStudentId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: firstStudentName,
      teacher: TEACHER_NAME,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('privateStudents').doc(secondStudentId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: secondStudentName,
      teacher: TEACHER_NAME,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${secondUser.uid}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      uid: secondUser.uid,
      email: secondEmail,
      displayName: `Private Slot Second ${unique}`,
      role: 'student',
      studentId: secondStudentId,
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
    }),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId({ studentId: firstStudentId })).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: firstStudentId,
      teacherKeys: [TEACHER_NAME],
      activePackageIds: [`pkg-private-a-${unique}`],
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('studentPackages').doc(`pkg-private-a-${unique}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: firstStudentId,
      title: `E2E Private Slot Package A ${unique}`,
      packageType: 'private',
      teacher: TEACHER_NAME,
      teacherName: TEACHER_NAME,
      status: 'active',
      totalCount: 4,
      usedCount: 0,
      remainingCount: 4,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId({ studentId: secondStudentId })).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: secondStudentId,
      teacherKeys: [TEACHER_NAME],
      activePackageIds: [`pkg-private-b-${unique}`],
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('studentPackages').doc(`pkg-private-b-${unique}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: secondStudentId,
      title: `E2E Private Slot Package B ${unique}`,
      packageType: 'private',
      teacher: TEACHER_NAME,
      teacherName: TEACHER_NAME,
      status: 'active',
      totalCount: 4,
      usedCount: 0,
      remainingCount: 4,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('privateLessonSlots').doc(hiddenSlotId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: HIDDEN_TEACHER_NAME,
      date: hiddenDate,
      time: '10:30',
      startAt: admin.firestore.Timestamp.fromDate(new Date(`${hiddenDate}T10:30:00`)),
      durationMinutes: 50,
      status: 'open',
      reservedStudentId: '',
      reservationId: '',
      createdByUid: adminUser.uid,
      createdAt: nowTs,
      updatedAt: nowTs,
      reservedAt: null,
      cancelledAt: null,
    }),
    db.collection('privateLessonSlots').doc(otherAcademySlotId).set({
      academyId: 'academy_e2e_other',
      teacher: TEACHER_NAME,
      date: otherAcademyDate,
      time: '10:30',
      startAt: admin.firestore.Timestamp.fromDate(new Date(`${otherAcademyDate}T10:30:00`)),
      durationMinutes: 50,
      status: 'open',
      reservedStudentId: '',
      reservationId: '',
      createdByUid: adminUser.uid,
      createdAt: nowTs,
      updatedAt: nowTs,
      reservedAt: null,
      cancelledAt: null,
    }),
    db.collection('lessons').doc(approvedLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: TEACHER_NAME,
      teacherName: TEACHER_NAME,
      studentId: firstStudentId,
      studentID: firstStudentId,
      studentName: firstStudentName,
      student: firstStudentName,
      date: approvedLessonDate,
      time: approvedLessonTime,
      subject: approvedLessonSubject,
      sessionNumber: 3,
      sourceType: 'lessonRequest',
      completed: false,
      isDeductCancelled: false,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('lessons').doc(hiddenApprovedLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: TEACHER_NAME,
      teacherName: TEACHER_NAME,
      studentId: secondStudentId,
      studentID: secondStudentId,
      studentName: secondStudentName,
      student: secondStudentName,
      date: hiddenApprovedLessonDate,
      time: '12:30',
      subject: hiddenApprovedLessonSubject,
      sessionNumber: 9,
      sourceType: 'lessonRequest',
      completed: false,
      isDeductCancelled: false,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('lessons').doc(pastApprovedLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: TEACHER_NAME,
      teacherName: TEACHER_NAME,
      studentId: firstStudentId,
      studentID: firstStudentId,
      studentName: firstStudentName,
      student: firstStudentName,
      date: pastApprovedLessonDate,
      time: '08:30',
      subject: pastApprovedLessonSubject,
      sessionNumber: 1,
      sourceType: 'lessonRequest',
      completed: true,
      isDeductCancelled: false,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
  ]);

  await linkStudentAccountWithScript({
    studentId: firstStudentId,
    email: firstEmail,
    displayName: firstDisplayName,
  });

  return {
    unique,
    firstEmail,
    firstUid: firstStudentUser.uid,
    firstAuthCreated: firstStudentAuthCreated,
    secondEmail,
    secondUid: secondUser.uid,
    firstStudentId,
    secondStudentId,
    firstStudentName,
    secondStudentName,
    createdDate,
    createdTime,
    hiddenDate,
    otherAcademyDate,
    approvedLessonDate,
    approvedLessonTime,
    approvedLessonSubject,
    pastApprovedLessonDate,
    pastApprovedLessonSubject,
    hiddenApprovedLessonSubject,
    approvedLessonId,
    hiddenApprovedLessonId,
    pastApprovedLessonId,
    hiddenSlotId,
    otherAcademySlotId,
  };
}

async function cleanupFixture(fixture) {
  if (!fixture) return;
  const db = admin.firestore();
  const refs = [
    db.collection('privateStudents').doc(fixture.firstStudentId),
    db.collection('privateStudents').doc(fixture.secondStudentId),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId({ studentId: fixture.firstStudentId })),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId({ studentId: fixture.secondStudentId })),
    db.collection('studentPackages').doc(`pkg-private-a-${fixture.unique}`),
    db.collection('studentPackages').doc(`pkg-private-b-${fixture.unique}`),
    db.collection('privateLessonSlots').doc(fixture.hiddenSlotId),
    db.collection('privateLessonSlots').doc(fixture.otherAcademySlotId),
    db.collection('lessons').doc(fixture.approvedLessonId),
    db.collection('lessons').doc(fixture.hiddenApprovedLessonId),
    db.collection('lessons').doc(fixture.pastApprovedLessonId),
    db.collection('users').doc(fixture.firstUid),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${fixture.firstUid}`),
    db.collection('users').doc(fixture.secondUid),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${fixture.secondUid}`),
  ];
  if (fixture.createdSlotId) {
    refs.push(db.collection('privateLessonSlots').doc(fixture.createdSlotId));
  }
  const reservationSnap = await db
    .collection('privateLessonReservations')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('studentId', 'in', [fixture.firstStudentId, fixture.secondStudentId])
    .get();
  reservationSnap.docs.forEach((docSnap) => refs.push(docSnap.ref));

  await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
  await Promise.all([
    fixture.firstAuthCreated
      ? admin.auth().deleteUser(fixture.firstUid).catch(() => {})
      : Promise.resolve(),
    admin.auth().deleteUser(fixture.secondUid).catch(() => {}),
  ]);
}

test('private 1:1 lesson slot booking MVP enforces eligibility, pairing, and tenant scope', async ({
  browser,
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 private slot setup을 실행합니다.');
  test.setTimeout(180000);

  initializeAdmin();
  const db = admin.firestore();
  let fixture = null;
  const contexts = [];

  try {
    const unique = `${Date.now()}-${testInfo.workerIndex}`;
    fixture = await createFixture(unique);
    await deleteMatchingSlots(db, { dates: [fixture.createdDate], time: fixture.createdTime });

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '1:1 예약 시간 관리');
    await expect(page.getByRole('heading', { name: '1:1 예약 시간 관리', level: 1 })).toBeVisible();
    await expect(page.getByText(fixture.hiddenDate).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(fixture.otherAcademyDate)).toHaveCount(0);

    const existingMatchingSlots = await queryMatchingSlots(db, {
      date: fixture.createdDate,
      time: fixture.createdTime,
    });
    const existingMatchingSlotIds = new Set(existingMatchingSlots.map((slot) => slot.id));

    await page.getByLabel('1:1 수업 선생님').selectOption(TEACHER_NAME);
    await page.getByLabel('1:1 수업 날짜').fill(fixture.createdDate);
    await page.getByLabel('1:1 수업 시작 시간').fill(fixture.createdTime);
    await page.getByLabel('1:1 수업 진행 시간').fill('50');
    await expect(page.getByText('대상 학생')).toHaveCount(0);
    await page.getByTestId('private-slot-create-button').click();
    await expect(page.getByText(fixture.createdDate).first()).toBeVisible({ timeout: 15000 });
    fixture.createdSlotId = await queryCreatedSlot(db, {
      date: fixture.createdDate,
      time: fixture.createdTime,
      existingSlotIds: existingMatchingSlotIds,
    });
    const createdSlot = await readDoc(db.collection('privateLessonSlots').doc(fixture.createdSlotId));
    expect(createdSlot).toMatchObject({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: TEACHER_NAME,
      date: fixture.createdDate,
      time: fixture.createdTime,
    });
    expect(Array.isArray(createdSlot?.eligibleStudentIds) ? createdSlot.eligibleStudentIds : []).toEqual([]);
    await expectSummarySlotAccess(db, fixture.firstStudentId, fixture.createdSlotId, false);
    await expectSlotStatus(db, fixture.createdSlotId, 'open');

    const createdDashboardSlotRow = page
      .locator(`[data-testid="private-slot-row"][data-slot-id="${fixture.createdSlotId}"]`);
    await createdDashboardSlotRow.getByTestId('private-slot-edit-eligibility-button').click();
    const eligibilityEditor = createdDashboardSlotRow.getByTestId('private-slot-eligibility-editor');
    await eligibilityEditor.getByLabel(`${fixture.firstStudentName} · ${TEACHER_NAME}`).uncheck();
    await eligibilityEditor.getByLabel(`${fixture.secondStudentName} · ${TEACHER_NAME}`).check();
    await eligibilityEditor.getByTestId('private-slot-save-eligibility-button').click();
    await expect
      .poll(async () => {
        const slot = await readDoc(db.collection('privateLessonSlots').doc(fixture.createdSlotId));
        return Array.isArray(slot?.eligibleStudentIds) ? slot.eligibleStudentIds : [];
      }, { timeout: 15000 })
      .toEqual([fixture.secondStudentId]);
    await expectSummarySlotAccess(db, fixture.firstStudentId, fixture.createdSlotId, false);
    await expectSummarySlotAccess(db, fixture.secondStudentId, fixture.createdSlotId, true);

    const studentContext = await browser.newContext();
    contexts.push(studentContext);
    const studentPage = await studentContext.newPage();
    await loginAsStudent(studentPage, fixture.firstEmail, TEST_STUDENT_PASSWORD);
    const approvedLessonCard = studentPage
      .locator('[data-testid="student-upcoming-private-lesson-card"]')
      .filter({ hasText: fixture.approvedLessonSubject })
      .first();
    await expect(approvedLessonCard).toBeVisible({ timeout: 15000 });
    await expect(approvedLessonCard).toContainText(fixture.approvedLessonDate);
    await expect(approvedLessonCard).toContainText(fixture.approvedLessonTime);
    await expect(approvedLessonCard).toContainText(TEACHER_NAME);
    await expect(approvedLessonCard).toContainText('3회차');
    await expect(studentPage.getByText(fixture.hiddenApprovedLessonSubject)).toHaveCount(0);
    const pastApprovedLessonCard = lessonHistoryCard(studentPage, fixture.pastApprovedLessonSubject);
    await expect(pastApprovedLessonCard).toBeVisible({ timeout: 15000 });
    await expect(pastApprovedLessonCard).toContainText('1:1 수업');
    await expect(pastApprovedLessonCard).toContainText(fixture.pastApprovedLessonDate);
    await expect(pastApprovedLessonCard).toContainText('지난 수업');
    await expect(
      studentPage.locator('[data-testid="student-private-slot-card"]').filter({
        hasText: fixture.createdDate,
      })
    ).toHaveCount(0);
    await expect(
      studentPage.locator('[data-testid="student-private-busy-slot-card"]').filter({
        hasText: fixture.createdDate,
      })
    ).toHaveCount(0);
    await expect(studentPage.getByText(fixture.hiddenDate)).toHaveCount(0);
    await expect(studentPage.locator('body')).not.toContainText(fixture.secondStudentName);

    const secondStudentContext = await browser.newContext();
    contexts.push(secondStudentContext);
    const secondStudentPage = await secondStudentContext.newPage();
    await loginAsStudent(secondStudentPage, fixture.secondEmail, TEST_STUDENT_PASSWORD);
    const secondStudentSlotCard = privateSlotCard(secondStudentPage, fixture.createdDate);
    await expect(secondStudentSlotCard).toBeVisible({ timeout: 15000 });
    await expect(secondStudentSlotCard).toContainText(fixture.createdTime);
    await expect(secondStudentSlotCard).toContainText('Teacher E2E');
    await expect(privateBusySlotCard(secondStudentPage, fixture.createdDate)).toHaveCount(0);
    await expect(
      secondStudentSlotCard.getByTestId('student-private-slot-reserve-button')
    ).toBeDisabled();
    await expectSlotStatus(db, fixture.createdSlotId, 'open');

    await openDashboardSection(page, '1:1 예약 시간 관리');
    const dashboardSlotRow = page
      .locator(`[data-testid="private-slot-row"][data-slot-id="${fixture.createdSlotId}"]`);
    await expect(dashboardSlotRow).toBeVisible({ timeout: 15000 });
    await expect(dashboardSlotRow).toContainText(fixture.secondStudentName);
    await Promise.all([
      page.waitForEvent('dialog').then((dialog) => dialog.accept()),
      dashboardSlotRow.getByTestId('private-slot-cancel-button').click(),
    ]);
    await expectSlotStatus(db, fixture.createdSlotId, 'cancelled');
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    if (fixture) {
      await cleanupFixture(fixture).catch(() => {});
    }
  }
});

test('admin can create repeated weekly private slots and skips duplicate Tuesday 15:00 slots', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 private slot setup을 실행합니다.');
  test.setTimeout(120000);

  initializeAdmin();
  const db = admin.firestore();
  const adminUser = await admin.auth().getUserByEmail(ADMIN_EMAIL);
  const unique = `${Date.now()}-${testInfo.workerIndex}-weekly`;
  const startDate = futureTuesdayYmd(unique);
  const repeatedDates = [0, 1, 2, 3].map((index) => addWeeksToYmd(startDate, index));
  const time = '15:00';
  const duplicateDate = repeatedDates[1];
  const duplicateSlotId = `e2e-private-weekly-duplicate-${unique}`;

  try {
    await deleteMatchingSlots(db, { dates: repeatedDates, time });
    await db.collection('privateLessonSlots').doc(duplicateSlotId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: TEACHER_NAME,
      teacherName: TEACHER_NAME,
      date: duplicateDate,
      time,
      subject: '1:1 수업',
      capacity: 1,
      reservedCount: 0,
      startAt: admin.firestore.Timestamp.fromDate(new Date(`${duplicateDate}T${time}:00`)),
      durationMinutes: 50,
      status: 'open',
      reservedStudentId: '',
      reservationId: '',
      createdByUid: adminUser.uid,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
      reservedAt: null,
      cancelledAt: null,
    });

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '1:1 예약 시간 관리');
    await page.getByLabel('1:1 수업 선생님').selectOption(TEACHER_NAME);
    await page.getByLabel('1:1 수업 날짜').fill(startDate);
    await page.getByLabel('1:1 수업 시작 시간').fill(time);
    await page.getByLabel('1:1 수업 진행 시간').fill('50');
    await page.getByLabel('매주 반복 생성').check();
    await page.getByLabel('1:1 수업 반복 주 수').fill('4');
    await page.getByTestId('private-slot-create-button').click();

    const result = page.getByTestId('private-slot-create-result');
    await expect(result).toContainText('생성 3개', { timeout: 15000 });
    await expect(result).toContainText('중복 1개 건너뜀');

    await expect
      .poll(async () => {
        const counts = await Promise.all(
          repeatedDates.map(async (date) => {
            const docs = await queryMatchingSlots(db, { date, time });
            return docs.length;
          })
        );
        return counts.join(',');
      }, { timeout: 15000 })
      .toBe('1,1,1,1');

    for (const date of repeatedDates) {
      await expect(page.getByText(`${date} ${time}`).first()).toBeVisible({ timeout: 15000 });
    }
  } finally {
    await deleteMatchingSlots(db, { dates: repeatedDates, time }).catch(() => {});
  }
});
