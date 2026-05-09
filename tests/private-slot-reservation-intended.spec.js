import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';
import { test, expect } from '@playwright/test';
import { BASE_URL, loginAsStudent } from './e2e-helpers.js';
import {
  DEFAULT_E2E_ACADEMY_ID,
  DEFAULT_E2E_ACADEMY_NAME,
  TEST_STUDENT_PASSWORD,
} from './fixtures/test-data.js';

const require = createRequire(import.meta.url);
const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const ADMIN_APP_NAME = 'private-slot-reservation-intended-e2e';
const TEACHER_NAME = 'teacher';

function hasServiceAccount() {
  return fs.existsSync(SERVICE_ACCOUNT_PATH);
}

function initializeAdmin() {
  const existing = admin.apps.find((app) => app?.name === ADMIN_APP_NAME);
  if (existing) return existing;
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  return admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
    },
    ADMIN_APP_NAME
  );
}

function getDb() {
  return initializeAdmin().firestore();
}

function getAuth() {
  return admin.auth(initializeAdmin());
}

function privateSummaryId(studentId) {
  return `${DEFAULT_E2E_ACADEMY_ID}__${studentId}`;
}

function reservationId(slotId, studentId) {
  return `${DEFAULT_E2E_ACADEMY_ID}__${slotId}__${studentId}`;
}

function privateBookingStatsId(studentId) {
  return `${DEFAULT_E2E_ACADEMY_ID}__${studentId}`;
}

function formatSeoulDateTime(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return {
    date: `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`,
    time: `${byType.get('hour')}:${byType.get('minute')}`,
  };
}

function studentSlotCard(page, date) {
  return page.locator('[data-testid="student-private-slot-card"]').filter({ hasText: date }).first();
}

function privateReservationCard(page, text) {
  return page.locator('[data-testid="student-private-reservation-card"]').filter({ hasText: text }).first();
}

async function expectReservationStatus(db, slotId, studentId, expected) {
  await expect
    .poll(async () => {
      const reservation = await getReservation(db, slotId, studentId);
      return reservation?.status || null;
    }, { timeout: 15000 })
    .toBe(expected);
}

async function expectSlotStatus(db, slotId, expected) {
  await expect
    .poll(async () => {
      const snap = await db.collection('privateLessonSlots').doc(slotId).get();
      return snap.exists ? snap.data()?.status || null : null;
    }, { timeout: 15000 })
    .toBe(expected);
}

async function expectPrivateBookingStatsCount(db, studentId, expected) {
  await expect
    .poll(async () => {
      const snap = await db
        .collection('studentPrivateBookingStats')
        .doc(privateBookingStatsId(studentId))
        .get();
      return snap.exists ? Number(snap.data()?.studentCancelCount || 0) : 0;
    }, { timeout: 15000 })
    .toBe(expected);
}

async function expectNotificationEvent(db, { type, slotId, studentId, reservationId: expectedReservationId }) {
  let eventData = null;
  await expect
    .poll(async () => {
      const snap = await db
        .collection('notificationEvents')
        .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
        .where('type', '==', type)
        .where('slotId', '==', slotId)
        .where('studentId', '==', studentId)
        .get();
      const matching = snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .find((event) => event.reservationId === expectedReservationId);
      eventData = matching || null;
      return Boolean(matching);
    }, { timeout: 15000 })
    .toBe(true);
  expect(eventData).toMatchObject({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    type,
    studentId,
    slotId,
    reservationId: expectedReservationId,
    source: 'student',
  });
  expect(eventData?.date).toBeTruthy();
  expect(eventData?.time).toBeTruthy();
  expect(eventData?.teacher).toBe(TEACHER_NAME);
  expect(eventData?.createdAt?.toMillis?.() || 0).toBeGreaterThan(0);
  return eventData;
}

async function loginAsStudentWithPrivateBooking(page, email) {
  await loginAsStudent(page, email, TEST_STUDENT_PASSWORD);
  await page.goto(new URL('/student-booking?privateSlotBooking=enabled', BASE_URL).toString());
  await expect(page.getByRole('heading', { name: '수업 예약', exact: true })).toBeVisible({
    timeout: 15000,
  });
}

async function createStudentFixture(db, auth, {
  unique,
  roleName,
  studentId,
  teacherAccess,
  teacherKey = TEACHER_NAME,
  allowedSlotIds,
  paidLessons,
  privateSlotBookingPilotEnabled = false,
}) {
  const nowTs = admin.firestore.Timestamp.now();
  const email = `private-reservation-${roleName}-${unique}@example.com`;
  const displayName = `Private Reservation ${roleName} ${unique}`;
  const user = await auth.createUser({
    email,
    password: TEST_STUDENT_PASSWORD,
    displayName,
  });

  await Promise.all([
    db.collection('users').doc(user.uid).set({
      uid: user.uid,
      email,
      displayName,
      role: 'student',
      isActive: true,
      lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
      updatedAt: nowTs,
    }),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${user.uid}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      uid: user.uid,
      email,
      displayName,
      role: 'student',
      studentId,
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
    db.collection('privateStudents').doc(studentId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: displayName,
      teacher: teacherKey,
      paidLessons,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(studentId)).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId,
      teacherKeys: teacherAccess ? [teacherKey] : [],
      activePackageIds: teacherAccess ? [`pkg-private-reservation-${roleName}-${unique}`] : [],
      allowedSlotIds,
      allowedPrivateLessonSlotIds: allowedSlotIds,
      privateSlotBookingPilotEnabled,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
  ]);

  return { uid: user.uid, email, studentId, displayName };
}

async function createFixture(unique) {
  const db = getDb();
  const auth = getAuth();
  const nowTs = admin.firestore.Timestamp.now();
  const numericUnique = Number.parseInt(String(unique).split('-')[0], 10) || Date.now();
  const day = 10 + (numericUnique % 18);
  const minute = Number.parseInt(String(unique).split('-').at(-1), 10) || 0;
  const date = `2099-09-${String(day).padStart(2, '0')}`;
  const time = `13:${String(minute % 10).padStart(2, '0')}`;
  const slotId = `e2e-flex-private-slot-${unique}`;
  const eligibleStudentId = `e2e-flex-private-eligible-${unique}`;
  const noRemainingStudentId = `e2e-flex-private-no-remaining-${unique}`;
  const ineligibleStudentId = `e2e-flex-private-ineligible-${unique}`;
  const noRemainingExistingSlotId = `e2e-flex-private-no-remaining-existing-slot-${unique}`;
  const noRemainingOpenSlotId = `e2e-flex-private-no-remaining-open-slot-${unique}`;
  const noRemainingFixedLessonId = `e2e-flex-private-fixed-lesson-${unique}`;
  const pilotDisabledStudentId = `e2e-flex-private-pilot-disabled-${unique}`;
  const pilotDisabledSlotId = `e2e-flex-private-pilot-disabled-slot-${unique}`;
  const subject = `E2E Flexible Private Slot ${unique}`;
  const noRemainingExistingSubject = `E2E Existing Active Reservation ${unique}`;
  const noRemainingExistingDate = `2099-10-${String(day).padStart(2, '0')}`;
  const noRemainingOpenSubject = `E2E Flexible No Remaining Slot ${unique}`;
  const noRemainingOpenDate = `2099-11-${String(day).padStart(2, '0')}`;
  const noRemainingFixedLessonDate = `2099-12-${String(day).padStart(2, '0')}`;

  await db.collection('academies').doc(DEFAULT_E2E_ACADEMY_ID).set(
    {
      id: DEFAULT_E2E_ACADEMY_ID,
      name: DEFAULT_E2E_ACADEMY_NAME,
      slug: DEFAULT_E2E_ACADEMY_ID,
      status: 'active',
      timezone: 'Asia/Seoul',
      updatedAt: nowTs,
    },
    { merge: true }
  );

  const eligibleStudent = await createStudentFixture(db, auth, {
    unique,
    roleName: 'eligible',
    studentId: eligibleStudentId,
    teacherAccess: true,
    allowedSlotIds: [],
    paidLessons: 1,
    privateSlotBookingPilotEnabled: true,
  });
  const noRemainingStudent = await createStudentFixture(db, auth, {
    unique,
    roleName: 'no-remaining',
    studentId: noRemainingStudentId,
    teacherAccess: true,
    allowedSlotIds: [noRemainingOpenSlotId],
    paidLessons: 1,
    privateSlotBookingPilotEnabled: true,
  });
  const ineligibleStudent = await createStudentFixture(db, auth, {
    unique,
    roleName: 'ineligible',
    studentId: ineligibleStudentId,
    teacherAccess: true,
    teacherKey: 'other-private-teacher',
    allowedSlotIds: [],
    paidLessons: 1,
    privateSlotBookingPilotEnabled: true,
  });
  const pilotDisabledStudent = await createStudentFixture(db, auth, {
    unique,
    roleName: 'pilot-disabled',
    studentId: pilotDisabledStudentId,
    teacherAccess: true,
    allowedSlotIds: [pilotDisabledSlotId],
    paidLessons: 1,
    privateSlotBookingPilotEnabled: false,
  });

  await Promise.all([
    db.collection('privateLessonSlots').doc(slotId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: TEACHER_NAME,
      teacherName: TEACHER_NAME,
      date,
      time,
      subject,
      capacity: 1,
      reservedCount: 0,
      startAt: admin.firestore.Timestamp.fromDate(new Date(`${date}T${time}:00`)),
      durationMinutes: 50,
      status: 'open',
      reservedStudentId: '',
      reservationId: '',
      createdByUid: 'e2e-admin-sdk',
      createdAt: nowTs,
      updatedAt: nowTs,
      reservedAt: null,
      cancelledAt: null,
    }),
    db.collection('privateLessonSlots').doc(noRemainingOpenSlotId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: TEACHER_NAME,
      teacherName: TEACHER_NAME,
      date: noRemainingOpenDate,
      time: '10:40',
      subject: noRemainingOpenSubject,
      capacity: 1,
      reservedCount: 0,
      startAt: admin.firestore.Timestamp.fromDate(new Date(`${noRemainingOpenDate}T10:40:00`)),
      durationMinutes: 50,
      status: 'open',
      reservedStudentId: '',
      reservationId: '',
      createdByUid: 'e2e-admin-sdk',
      createdAt: nowTs,
      updatedAt: nowTs,
      reservedAt: null,
      cancelledAt: null,
    }),
    db.collection('privateLessonSlots').doc(noRemainingExistingSlotId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: TEACHER_NAME,
      teacherName: TEACHER_NAME,
      date: noRemainingExistingDate,
      time: '10:30',
      subject: noRemainingExistingSubject,
      capacity: 1,
      reservedCount: 1,
      startAt: admin.firestore.Timestamp.fromDate(new Date(`${noRemainingExistingDate}T10:30:00`)),
      durationMinutes: 50,
      status: 'reserved',
      eligibleStudentIds: [noRemainingStudentId],
      reservedStudentId: noRemainingStudentId,
      reservationId: reservationId(noRemainingExistingSlotId, noRemainingStudentId),
      createdByUid: 'e2e-admin-sdk',
      reservedAt: nowTs,
      cancelledAt: null,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('privateLessonSlots').doc(pilotDisabledSlotId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: TEACHER_NAME,
      teacherName: TEACHER_NAME,
      date: `2099-08-${String(day).padStart(2, '0')}`,
      time: '14:40',
      subject: `E2E Pilot Disabled Private Slot ${unique}`,
      capacity: 1,
      reservedCount: 0,
      durationMinutes: 50,
      status: 'open',
      reservedStudentId: '',
      reservationId: '',
      createdByUid: 'e2e-admin-sdk',
      reservedAt: null,
      cancelledAt: null,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db
      .collection('privateLessonReservations')
      .doc(reservationId(noRemainingExistingSlotId, noRemainingStudentId))
      .set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        slotId: noRemainingExistingSlotId,
        studentId: noRemainingStudentId,
        teacher: TEACHER_NAME,
        teacherName: TEACHER_NAME,
        date: noRemainingExistingDate,
        time: '10:30',
        subject: noRemainingExistingSubject,
        status: 'active',
        source: 'student',
        reservedAt: nowTs,
        cancelledAt: null,
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
    db.collection('lessons').doc(noRemainingFixedLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: TEACHER_NAME,
      teacherName: TEACHER_NAME,
      studentId: noRemainingStudentId,
      studentID: noRemainingStudentId,
      studentName: noRemainingStudent.displayName,
      student: noRemainingStudent.displayName,
      date: noRemainingFixedLessonDate,
      time: '15:30',
      subject: `E2E Fixed Scheduled Private Lesson ${unique}`,
      sessionNumber: 1,
      completed: false,
      isDeductCancelled: false,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(noRemainingStudentId)).set(
      {
        allowedSlotIds: [noRemainingOpenSlotId, noRemainingExistingSlotId],
        allowedPrivateLessonSlotIds: [noRemainingOpenSlotId, noRemainingExistingSlotId],
        updatedAt: nowTs,
      },
      { merge: true }
    ),
  ]);

  return {
    slotId,
    date,
    time,
    subject,
    eligibleStudent,
    noRemainingStudent,
    ineligibleStudent,
    pilotDisabledStudent,
    pilotDisabledSlotId,
    pilotDisabledDate: `2099-08-${String(day).padStart(2, '0')}`,
    noRemainingExistingSlotId,
    noRemainingOpenSlotId,
    noRemainingOpenDate,
    noRemainingFixedLessonId,
  };
}

async function cleanupFixture(fixture) {
  if (!fixture) return;
  const db = getDb();
  const auth = getAuth();
  const { slotId, eligibleStudent, noRemainingStudent, ineligibleStudent, pilotDisabledStudent } =
    fixture;
  const refs = [
    db.collection('privateLessonSlots').doc(slotId),
    db.collection('privateLessonSlots').doc(fixture.noRemainingExistingSlotId),
    db.collection('privateLessonSlots').doc(fixture.noRemainingOpenSlotId),
    db.collection('privateLessonSlots').doc(fixture.pilotDisabledSlotId),
    db.collection('privateLessonReservations').doc(reservationId(slotId, eligibleStudent.studentId)),
    db.collection('privateLessonReservations').doc(reservationId(slotId, noRemainingStudent.studentId)),
    db.collection('privateLessonReservations').doc(
      reservationId(fixture.noRemainingExistingSlotId, noRemainingStudent.studentId)
    ),
    db.collection('privateLessonReservations').doc(
      reservationId(fixture.noRemainingOpenSlotId, noRemainingStudent.studentId)
    ),
    db.collection('privateLessonReservations').doc(reservationId(slotId, ineligibleStudent.studentId)),
    db.collection('privateLessonReservations').doc(
      reservationId(fixture.pilotDisabledSlotId, pilotDisabledStudent.studentId)
    ),
    db.collection('lessons').doc(fixture.noRemainingFixedLessonId),
    db.collection('privateStudents').doc(eligibleStudent.studentId),
    db.collection('privateStudents').doc(noRemainingStudent.studentId),
    db.collection('privateStudents').doc(ineligibleStudent.studentId),
    db.collection('privateStudents').doc(pilotDisabledStudent.studentId),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(eligibleStudent.studentId)),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(noRemainingStudent.studentId)),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(ineligibleStudent.studentId)),
    db.collection('studentPrivateAccessSummary').doc(
      privateSummaryId(pilotDisabledStudent.studentId)
    ),
    db.collection('studentPrivateBookingStats').doc(privateBookingStatsId(eligibleStudent.studentId)),
    db.collection('studentPrivateBookingStats').doc(privateBookingStatsId(noRemainingStudent.studentId)),
    db.collection('studentPrivateBookingStats').doc(privateBookingStatsId(ineligibleStudent.studentId)),
    db.collection('studentPrivateBookingStats').doc(
      privateBookingStatsId(pilotDisabledStudent.studentId)
    ),
    db.collection('users').doc(eligibleStudent.uid),
    db.collection('users').doc(noRemainingStudent.uid),
    db.collection('users').doc(ineligibleStudent.uid),
    db.collection('users').doc(pilotDisabledStudent.uid),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${eligibleStudent.uid}`),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${noRemainingStudent.uid}`),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${ineligibleStudent.uid}`),
    db.collection('academyMemberships').doc(
      `${DEFAULT_E2E_ACADEMY_ID}_${pilotDisabledStudent.uid}`
    ),
  ];
  (fixture.extraSlotIds || []).forEach((id) => refs.push(db.collection('privateLessonSlots').doc(id)));
  (fixture.extraLessonIds || []).forEach((id) => refs.push(db.collection('lessons').doc(id)));
  (fixture.extraReservationIds || []).forEach((id) =>
    refs.push(db.collection('privateLessonReservations').doc(id))
  );

  const notificationSnap = await db
    .collection('notificationEvents')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('studentId', 'in', [
      eligibleStudent.studentId,
      noRemainingStudent.studentId,
      ineligibleStudent.studentId,
      pilotDisabledStudent.studentId,
    ])
    .get()
    .catch(() => null);
  notificationSnap?.docs.forEach((docSnap) => refs.push(docSnap.ref));

  await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
  await Promise.all([
    auth.deleteUser(eligibleStudent.uid).catch(() => {}),
    auth.deleteUser(noRemainingStudent.uid).catch(() => {}),
    auth.deleteUser(ineligibleStudent.uid).catch(() => {}),
  ]);
}

async function getReservation(db, slotId, studentId) {
  const snap = await db.collection('privateLessonReservations').doc(reservationId(slotId, studentId)).get();
  return snap.exists ? snap.data() : null;
}

async function countGeneratedStudentRows(db, collectionName, fixture) {
  const snap = await db
    .collection(collectionName)
    .where('studentId', 'in', [
      fixture.eligibleStudent.studentId,
      fixture.ineligibleStudent.studentId,
    ])
    .get();
  return snap.docs.filter((docSnap) => {
    const data = docSnap.data() || {};
    return (
      data.academyId === DEFAULT_E2E_ACADEMY_ID &&
      data.date === fixture.date &&
      data.time === fixture.time &&
      data.subject === fixture.subject
    );
  }).length;
}

test.describe.configure({ mode: 'serial' });

test('private slot booking callable production gate is wired server-side', async () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');
  expect(source).toContain('PRIVATE_SLOT_BOOKING_ENABLED');
  expect(source).toContain('"miami-e2e"');
  expect(source).toContain('"1:1 예약 기능은 아직 선택된 학생에게만 제공됩니다."');
  expect(source).toContain('privateSlotBookingPilotEnabled');
  expect(source).toMatch(/function requirePrivateSlotBookingPilotEnabled\(summary\)/);
  expect(source).toMatch(/summary\.privateSlotBookingPilotEnabled === true/);
  expect(source).toMatch(/getRuntimeProjectId\(\) !== "miami-e2e"/);
  expect(source).toMatch(
    /exports\.reservePrivateLessonSlot[\s\S]*requirePrivateSlotReservationEnabled\(\)/
  );
  expect(source).toMatch(
    /exports\.cancelPrivateLessonReservation[\s\S]*requirePrivateSlotReservationEnabled\(\)/
  );
  expect(source).toMatch(
    /exports\.reservePrivateLessonSlot[\s\S]*requirePrivateSlotBookingPilotEnabled\(summary\)/
  );
  expect(source).toMatch(
    /exports\.cancelPrivateLessonReservation[\s\S]*requirePrivateSlotBookingPilotEnabled\(summary\)/
  );
  expect(source).toMatch(/function hasSlotAccess[\s\S]*summary && summary\.teacherKeys/);
  expect(source).toMatch(/function hasSlotAccess[\s\S]*activePackageIds\.length > 0/);
});

test('intended flexible private slot visibility honors teacher access and pilot gate', async ({
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 private reservation setup을 실행합니다.');
  test.setTimeout(120000);

  let fixture = null;
  const contexts = [];

  try {
    fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}-visibility`);

    const eligibleContext = await browser.newContext();
    contexts.push(eligibleContext);
    const eligiblePage = await eligibleContext.newPage();
    await loginAsStudentWithPrivateBooking(eligiblePage, fixture.eligibleStudent.email);
    await expect(studentSlotCard(eligiblePage, fixture.date)).toBeVisible({ timeout: 15000 });
    await expect(studentSlotCard(eligiblePage, fixture.date)).toContainText(fixture.time);

    const ineligibleContext = await browser.newContext();
    contexts.push(ineligibleContext);
    const ineligiblePage = await ineligibleContext.newPage();
    await loginAsStudentWithPrivateBooking(ineligiblePage, fixture.ineligibleStudent.email);
    await expect(
      ineligiblePage.locator('[data-testid="student-private-slot-card"]').filter({ hasText: fixture.date })
    ).toHaveCount(0);

    const pilotDisabledContext = await browser.newContext();
    contexts.push(pilotDisabledContext);
    const pilotDisabledPage = await pilotDisabledContext.newPage();
    await loginAsStudentWithPrivateBooking(
      pilotDisabledPage,
      fixture.pilotDisabledStudent.email
    );
    const pilotDisabledCard = studentSlotCard(pilotDisabledPage, fixture.pilotDisabledDate);
    await expect(pilotDisabledCard).toBeVisible({ timeout: 15000 });
    await expect(
      pilotDisabledCard.getByTestId('student-private-slot-reserve-button')
    ).toBeDisabled();
    await expect(
      pilotDisabledCard.getByTestId('student-private-slot-reserve-button')
    ).toHaveText('예약 중지');
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await cleanupFixture(fixture).catch(() => {});
  }
});

test('intended flexible private slot reservation contract behind e2e flag', async ({
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 private reservation setup을 실행합니다.');
  test.setTimeout(180000);

  const db = getDb();
  let fixture = null;
  const contexts = [];

  try {
    fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}-reservation`);

    expect(await countGeneratedStudentRows(db, 'lessons', fixture)).toBe(0);
    expect(await countGeneratedStudentRows(db, 'lessonRequests', fixture)).toBe(0);

    const disabledContext = await browser.newContext();
    contexts.push(disabledContext);
    const disabledPage = await disabledContext.newPage();
    await loginAsStudent(disabledPage, fixture.eligibleStudent.email, TEST_STUDENT_PASSWORD);
    const disabledCard = studentSlotCard(disabledPage, fixture.date);
    await expect(disabledCard).toBeVisible({ timeout: 15000 });
    await expect(disabledCard.getByTestId('student-private-slot-reserve-button')).toBeDisabled();
    await expect(disabledCard.getByTestId('student-private-slot-reserve-button')).toHaveText('예약 중지');

    const pilotDisabledContext = await browser.newContext();
    contexts.push(pilotDisabledContext);
    const pilotDisabledPage = await pilotDisabledContext.newPage();
    await loginAsStudentWithPrivateBooking(
      pilotDisabledPage,
      fixture.pilotDisabledStudent.email
    );
    const pilotDisabledCard = studentSlotCard(pilotDisabledPage, fixture.pilotDisabledDate);
    await expect(pilotDisabledCard).toBeVisible({ timeout: 15000 });
    await expect(
      pilotDisabledCard.getByTestId('student-private-slot-reserve-button')
    ).toBeDisabled();
    await expect(
      pilotDisabledCard.getByTestId('student-private-slot-reserve-button')
    ).toHaveText('예약 중지');
    expect(
      await getReservation(
        db,
        fixture.pilotDisabledSlotId,
        fixture.pilotDisabledStudent.studentId
      )
    ).toBeNull();

    const eligibleContext = await browser.newContext();
    contexts.push(eligibleContext);
    const eligiblePage = await eligibleContext.newPage();
    await loginAsStudentWithPrivateBooking(eligiblePage, fixture.eligibleStudent.email);
    const slotCard = studentSlotCard(eligiblePage, fixture.date);
    const bookingDialogs = [];
    eligiblePage.on('dialog', async (dialog) => {
      bookingDialogs.push(dialog.message());
      await dialog.accept();
    });
    await expect(slotCard).toBeVisible({ timeout: 15000 });
    await expect(slotCard.getByTestId('student-private-slot-reserve-button')).toBeEnabled();
    await expect(slotCard.getByTestId('student-private-slot-reserve-button')).toHaveText('1:1 수업 예약');
    const initialSlotSnap = await db.collection('privateLessonSlots').doc(fixture.slotId).get();
    const initialSlot = initialSlotSnap.data() || {};
    expect(Array.isArray(initialSlot.eligibleStudentIds) ? initialSlot.eligibleStudentIds : []).toEqual([]);
    const initialSummarySnap = await db
      .collection('studentPrivateAccessSummary')
      .doc(privateSummaryId(fixture.eligibleStudent.studentId))
      .get();
    const initialSummary = initialSummarySnap.data() || {};
    expect(initialSummary.teacherKeys).toContain(TEACHER_NAME);
    expect(initialSummary.activePackageIds?.length || 0).toBeGreaterThan(0);
    expect(Array.isArray(initialSummary.allowedSlotIds) ? initialSummary.allowedSlotIds : []).toEqual([]);
    expect(
      Array.isArray(initialSummary.allowedPrivateLessonSlotIds)
        ? initialSummary.allowedPrivateLessonSlotIds
        : []
    ).toEqual([]);

    await expectReservationStatus(
      db,
      fixture.noRemainingExistingSlotId,
      fixture.noRemainingStudent.studentId,
      'active'
    );
    const noRemainingContext = await browser.newContext();
    contexts.push(noRemainingContext);
    const noRemainingPage = await noRemainingContext.newPage();
    await loginAsStudentWithPrivateBooking(noRemainingPage, fixture.noRemainingStudent.email);
    const noRemainingSlotCard = studentSlotCard(noRemainingPage, fixture.noRemainingOpenDate);
    await expect(noRemainingSlotCard).toBeVisible({ timeout: 15000 });
    await expect(noRemainingSlotCard.getByTestId('student-private-slot-reserve-button')).toBeEnabled();
    await noRemainingSlotCard.getByTestId('student-private-slot-reserve-button').click();
    await expectReservationStatus(
      db,
      fixture.noRemainingOpenSlotId,
      fixture.noRemainingStudent.studentId,
      'active'
    );
    await expectSlotStatus(db, fixture.noRemainingOpenSlotId, 'reserved');

    await slotCard.getByTestId('student-private-slot-reserve-button').click();
    await eligiblePage.waitForTimeout(500);

    const expectedReservationId = reservationId(fixture.slotId, fixture.eligibleStudent.studentId);
    await expect
      .poll(async () => {
        const reservation = await getReservation(db, fixture.slotId, fixture.eligibleStudent.studentId);
        return reservation?.status || null;
      }, {
        message: `Expected student booking to create active reservation ${expectedReservationId}. Last booking dialog: ${
          bookingDialogs.at(-1) || 'none'
        }`,
        timeout: 45000,
      })
      .toBe('active');

    const reservation = await getReservation(db, fixture.slotId, fixture.eligibleStudent.studentId);
    const firstCreatedAtMs = reservation?.createdAt?.toMillis?.() || 0;
    expect(firstCreatedAtMs).toBeGreaterThan(0);
    expect(reservation).toMatchObject({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      slotId: fixture.slotId,
      studentId: fixture.eligibleStudent.studentId,
      teacher: TEACHER_NAME,
      date: fixture.date,
      time: fixture.time,
      status: 'active',
      source: 'student',
    });

    const slotSnap = await db.collection('privateLessonSlots').doc(fixture.slotId).get();
    expect(slotSnap.data()).toMatchObject({
      status: 'reserved',
      reservedStudentId: fixture.eligibleStudent.studentId,
      reservationId: expectedReservationId,
    });
    await expectNotificationEvent(db, {
      type: 'private_slot_reserved',
      slotId: fixture.slotId,
      studentId: fixture.eligibleStudent.studentId,
      reservationId: expectedReservationId,
    });

    const secondContext = await browser.newContext();
    contexts.push(secondContext);
    const secondPage = await secondContext.newPage();
    await loginAsStudentWithPrivateBooking(secondPage, fixture.ineligibleStudent.email);
    await expect(
      secondPage.locator('[data-testid="student-private-slot-card"]').filter({ hasText: fixture.date })
    ).toHaveCount(0);
    expect(await getReservation(db, fixture.slotId, fixture.ineligibleStudent.studentId)).toBeNull();

    const reservationCard = privateReservationCard(eligiblePage, fixture.date);
    await expect(reservationCard).toBeVisible({ timeout: 15000 });
    await reservationCard.getByTestId('student-private-reservation-cancel-button').click();
    await expectReservationStatus(
      db,
      fixture.slotId,
      fixture.eligibleStudent.studentId,
      'cancelled'
    );
    await expectSlotStatus(db, fixture.slotId, 'open');
    await expectPrivateBookingStatsCount(db, fixture.eligibleStudent.studentId, 1);
    await expectNotificationEvent(db, {
      type: 'private_slot_cancelled',
      slotId: fixture.slotId,
      studentId: fixture.eligibleStudent.studentId,
      reservationId: expectedReservationId,
    });

    const reopenedSlotCard = studentSlotCard(eligiblePage, fixture.date);
    await expect(reopenedSlotCard).toBeVisible({ timeout: 15000 });
    await reopenedSlotCard.getByTestId('student-private-slot-reserve-button').click();
    await expectReservationStatus(
      db,
      fixture.slotId,
      fixture.eligibleStudent.studentId,
      'active'
    );
    const reusedReservation = await getReservation(
      db,
      fixture.slotId,
      fixture.eligibleStudent.studentId
    );
    expect(reusedReservation?.createdAt?.toMillis?.()).toBe(firstCreatedAtMs);
    await expect(privateReservationCard(eligiblePage, fixture.date)).toBeVisible({
      timeout: 15000,
    });
    await privateReservationCard(eligiblePage, fixture.date)
      .getByTestId('student-private-reservation-cancel-button')
      .click();
    await expectReservationStatus(
      db,
      fixture.slotId,
      fixture.eligibleStudent.studentId,
      'cancelled'
    );
    await expectSlotStatus(db, fixture.slotId, 'open');
    await expectPrivateBookingStatsCount(db, fixture.eligibleStudent.studentId, 2);

    await db.collection('privateLessonSlots').doc(fixture.slotId).set(
      {
        eligibleStudentIds: [fixture.ineligibleStudent.studentId],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await db.collection('studentPrivateAccessSummary').doc(
      privateSummaryId(fixture.ineligibleStudent.studentId)
    ).set(
      {
        allowedSlotIds: [],
        allowedPrivateLessonSlotIds: [],
        privateSlotBookingPilotEnabled: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await secondPage.reload();
    await expect(studentSlotCard(secondPage, fixture.date)).toBeVisible({ timeout: 45000 });
    await studentSlotCard(secondPage, fixture.date)
      .getByTestId('student-private-slot-reserve-button')
      .click();
    await expectReservationStatus(
      db,
      fixture.slotId,
      fixture.ineligibleStudent.studentId,
      'active'
    );

    expect(await countGeneratedStudentRows(db, 'lessons', fixture)).toBe(0);
    expect(await countGeneratedStudentRows(db, 'lessonRequests', fixture)).toBe(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await cleanupFixture(fixture).catch(() => {});
  }
});

test('student flexible private cancellation cutoff blocks cancel within 6 hours', async ({
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 private reservation setup을 실행합니다.');
  test.setTimeout(120000);

  const db = getDb();
  let fixture = null;
  const contexts = [];

  try {
    fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}-cutoff`);
    const nowTs = admin.firestore.Timestamp.now();
    const nearStart = formatSeoulDateTime(new Date(Date.now() + 5 * 60 * 60 * 1000));
    const nearSlotId = `e2e-flex-private-near-cancel-${Date.now()}-${testInfo.workerIndex}`;
    const nearReservationId = reservationId(nearSlotId, fixture.eligibleStudent.studentId);
    fixture.extraSlotIds = [nearSlotId];
    fixture.extraReservationIds = [nearReservationId];

    await Promise.all([
      db.collection('privateLessonSlots').doc(nearSlotId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        teacher: TEACHER_NAME,
        teacherName: TEACHER_NAME,
        date: nearStart.date,
        time: nearStart.time,
        subject: `E2E Near Cutoff Private Slot ${testInfo.workerIndex}`,
        capacity: 1,
        reservedCount: 1,
        durationMinutes: 50,
        status: 'reserved',
        eligibleStudentIds: [fixture.eligibleStudent.studentId],
        reservedStudentId: fixture.eligibleStudent.studentId,
        reservationId: nearReservationId,
        createdByUid: 'e2e-admin-sdk',
        reservedAt: nowTs,
        cancelledAt: null,
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
      db.collection('privateLessonReservations').doc(nearReservationId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        slotId: nearSlotId,
        studentId: fixture.eligibleStudent.studentId,
        studentName: fixture.eligibleStudent.displayName,
        teacher: TEACHER_NAME,
        teacherName: TEACHER_NAME,
        date: nearStart.date,
        time: nearStart.time,
        status: 'active',
        source: 'student',
        reservedAt: nowTs,
        cancelledAt: null,
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
    ]);

    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    const dialogs = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
    });
    await loginAsStudentWithPrivateBooking(page, fixture.eligibleStudent.email);
    const reservationCard = privateReservationCard(page, nearStart.date);
    await expect(reservationCard).toBeVisible({ timeout: 15000 });
    await reservationCard.getByTestId('student-private-reservation-cancel-button').click();

    await expect
      .poll(() => dialogs.some((message) => message.includes('6 hours')), { timeout: 15000 })
      .toBe(true);
    await expectReservationStatus(db, nearSlotId, fixture.eligibleStudent.studentId, 'active');
    await expectPrivateBookingStatsCount(db, fixture.eligibleStudent.studentId, 0);
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await cleanupFixture(fixture).catch(() => {});
  }
});

test('student flexible private cancellation limit allows 4 and blocks fifth', async ({
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 private reservation setup을 실행합니다.');
  test.setTimeout(240000);

  const db = getDb();
  let fixture = null;
  const contexts = [];

  try {
    fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}-cancel-limit`);
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    const dialogs = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
    });
    await loginAsStudentWithPrivateBooking(page, fixture.eligibleStudent.email);
    const expectedReservationId = reservationId(fixture.slotId, fixture.eligibleStudent.studentId);

    for (let index = 1; index <= 4; index += 1) {
      const slotCard = studentSlotCard(page, fixture.date);
      await expect(slotCard).toBeVisible({ timeout: 15000 });
      await slotCard.getByTestId('student-private-slot-reserve-button').click();
      await expectReservationStatus(db, fixture.slotId, fixture.eligibleStudent.studentId, 'active');

      const reservationCard = privateReservationCard(page, fixture.date);
      await expect(reservationCard).toBeVisible({ timeout: 15000 });
      await reservationCard.getByTestId('student-private-reservation-cancel-button').click();
      await expectReservationStatus(db, fixture.slotId, fixture.eligibleStudent.studentId, 'cancelled');
      await expectSlotStatus(db, fixture.slotId, 'open');
      await expectPrivateBookingStatsCount(db, fixture.eligibleStudent.studentId, index);
    }

    const slotCard = studentSlotCard(page, fixture.date);
    await expect(slotCard).toBeVisible({ timeout: 15000 });
    await slotCard.getByTestId('student-private-slot-reserve-button').click();
    await expectReservationStatus(db, fixture.slotId, fixture.eligibleStudent.studentId, 'active');

    const reservationCard = privateReservationCard(page, fixture.date);
    await expect(reservationCard).toBeVisible({ timeout: 15000 });
    await reservationCard.getByTestId('student-private-reservation-cancel-button').click();
    await expect
      .poll(
        () => dialogs.some((message) => message.includes('cancellation limit')),
        { timeout: 15000 }
      )
      .toBe(true);
    await expectReservationStatus(db, fixture.slotId, fixture.eligibleStudent.studentId, 'active');
    await expectPrivateBookingStatsCount(db, fixture.eligibleStudent.studentId, 4);
    await expectNotificationEvent(db, {
      type: 'private_slot_reserved',
      slotId: fixture.slotId,
      studentId: fixture.eligibleStudent.studentId,
      reservationId: expectedReservationId,
    });
    await expectNotificationEvent(db, {
      type: 'private_slot_cancelled',
      slotId: fixture.slotId,
      studentId: fixture.eligibleStudent.studentId,
      reservationId: expectedReservationId,
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await cleanupFixture(fixture).catch(() => {});
  }
});
