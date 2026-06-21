import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';
import { test, expect } from '@playwright/test';
import { BASE_URL, loginAsAdmin, loginAsStudent, openDashboardSection } from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
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

function ensureMondaySaturdayYmd(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  while (parsed.getUTCDay() === 0) {
    parsed.setUTCDate(parsed.getUTCDate() + 1);
  }
  return parsed.toISOString().slice(0, 10);
}

function upcomingMondaySaturdayYmd(daysFromNow) {
  return ensureMondaySaturdayYmd(
    formatSeoulDateTime(new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000)).date
  );
}

function getSeoulWeekdayNumber(ymd) {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay();
}

function templateSlotId(templateId, date, time) {
  return `template__${String(templateId).replace(/[^A-Za-z0-9_-]/g, '_')}__${date.replace(/-/g, '')}__${time.replace(/:/g, '')}`;
}

function studentSlotCard(page, date) {
  return page.locator('[data-testid="student-private-slot-card"]').filter({ hasText: date }).first();
}

function studentSlotCardById(page, slotId) {
  return page.locator(`[data-testid="student-private-slot-card"][data-slot-id="${slotId}"]`);
}

function studentPrivateAvailabilityCardById(page, slotId) {
  return page
    .locator(
      [
        `[data-testid="student-private-slot-card"][data-slot-id="${slotId}"]`,
        `[data-testid="student-private-busy-slot-card"][data-slot-id="${slotId}"]`,
      ].join(', ')
    )
    .first();
}

function privateSlotCardForDateTime(page, date, time) {
  return page
    .getByTestId('student-private-slot-card')
    .filter({ hasText: date })
    .filter({ hasText: time });
}

function bookablePrivateSlotCardForDateTime(page, date, time) {
  return privateSlotCardForDateTime(page, date, time).filter({
    has: page.getByRole('button', { name: '1:1 수업 예약' }),
  });
}

function studentBusySlotCard(page, date) {
  return page
    .locator('[data-testid="student-private-busy-slot-card"]')
    .filter({ hasText: date })
    .first();
}

function privateReservationCard(page, text) {
  return page.locator('[data-testid="student-private-reservation-card"]').filter({ hasText: text }).first();
}

async function expectPrivateSlotCardCount(page, date, expected, message) {
  const cards = page.locator('[data-testid="student-private-slot-card"]').filter({ hasText: date });
  try {
    await expect(cards, message).toHaveCount(expected, { timeout: 15000 });
  } catch (error) {
    const [cardTexts, busyTexts, packageTexts, bodyText] = await Promise.all([
      page.locator('[data-testid="student-private-slot-card"]').allInnerTexts().catch(() => []),
      page.locator('[data-testid="student-private-busy-slot-card"]').allInnerTexts().catch(() => []),
      page.locator('[data-testid="student-private-package-summary"]').allInnerTexts().catch(() => []),
      page.locator('body').innerText().catch(() => ''),
    ]);
    throw new Error(
      [
        message,
        `Expected count: ${expected}`,
        `Date filter: ${date}`,
        `Current URL: ${page.url()}`,
        `Visible private slot cards: ${JSON.stringify(cardTexts)}`,
        `Visible busy cards: ${JSON.stringify(busyTexts)}`,
        `Visible package summary: ${JSON.stringify(packageTexts)}`,
        'Visible page text:',
        bodyText.slice(0, 1500),
        '',
        `Original error: ${error.message}`,
      ].join('\n')
    );
  }
  return cards;
}

async function expectPrivateBusyCardCount(page, date, expected, message) {
  const cards = page
    .locator('[data-testid="student-private-busy-slot-card"]')
    .filter({ hasText: date });
  try {
    await expect(cards, message).toHaveCount(expected, { timeout: 15000 });
  } catch (error) {
    const [slotTexts, busyTexts, packageTexts, bodyText] = await Promise.all([
      page.locator('[data-testid="student-private-slot-card"]').allInnerTexts().catch(() => []),
      page.locator('[data-testid="student-private-busy-slot-card"]').allInnerTexts().catch(() => []),
      page.locator('[data-testid="student-private-package-summary"]').allInnerTexts().catch(() => []),
      page.locator('body').innerText().catch(() => ''),
    ]);
    throw new Error(
      [
        message,
        `Expected count: ${expected}`,
        `Date filter: ${date}`,
        `Current URL: ${page.url()}`,
        `Visible private slot cards: ${JSON.stringify(slotTexts)}`,
        `Visible busy cards: ${JSON.stringify(busyTexts)}`,
        `Visible package summary: ${JSON.stringify(packageTexts)}`,
        'Visible page text:',
        bodyText.slice(0, 1500),
        '',
        `Original error: ${error.message}`,
      ].join('\n')
    );
  }
  return cards;
}

async function expectStudentBookingHeadingVisible(page, message) {
  try {
    await expect(page.getByRole('heading', { name: '수업 예약', exact: true }), message).toBeVisible({
      timeout: 15000,
    });
  } catch (error) {
    const [bodyText, cardTexts] = await Promise.all([
      page.locator('body').innerText().catch(() => ''),
      page.locator('[data-testid="student-private-slot-card"]').allInnerTexts().catch(() => []),
    ]);
    throw new Error(
      [
        message,
        `Current URL: ${page.url()}`,
        'Visible page text:',
        bodyText.slice(0, 1500),
        `Visible private slot cards: ${JSON.stringify(cardTexts)}`,
        '',
        `Original error: ${error.message}`,
      ].join('\n')
    );
  }
}

async function expectPrivateSlotReserveButtonEnabled(page, card, message) {
  const button = card.getByTestId('student-private-slot-reserve-button');
  try {
    await expect(button, message).toBeEnabled();
  } catch (error) {
    const [cardText, buttonTexts, bodyText] = await Promise.all([
      card.innerText().catch(() => ''),
      card.locator('button').allInnerTexts().catch(() => []),
      page.locator('body').innerText().catch(() => ''),
    ]);
    throw new Error(
      [
        message,
        `Current URL: ${page.url()}`,
        `Card text: ${cardText}`,
        `Visible buttons: ${JSON.stringify(buttonTexts)}`,
        'Visible page text:',
        bodyText.slice(0, 1500),
        '',
        `Original error: ${error.message}`,
      ].join('\n')
    );
  }
  return button;
}

async function listPrivateLessonSlotAvailabilityViaPage(page, { academyId }) {
  return page.evaluate(
    async ({ firebaseConfig, academyId }) => {
      const [{ getApp, getApps, initializeApp }, authModule, functionsModule] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js'),
      ]);
      const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
      const auth = authModule.getAuth(app);
      if (!auth.currentUser) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Auth user not ready.')), 15000);
          const unsubscribe = authModule.onAuthStateChanged(auth, (user) => {
            if (!user) return;
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          });
        });
      }
      const functions = functionsModule.getFunctions(app, 'us-central1');
      const listPrivateLessonSlotAvailability = functionsModule.httpsCallable(
        functions,
        'listPrivateLessonSlotAvailability'
      );
      const result = await listPrivateLessonSlotAvailability({
        academyId,
        privateSlotBooking: 'enabled',
      });
      return result.data;
    },
    {
      firebaseConfig: getFirebaseConfigFromEnv(),
      academyId,
    }
  );
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

async function expectPrivateSummaryAllowsSlot(db, studentId, slotId) {
  await expect
    .poll(async () => {
      const snap = await db.collection('studentPrivateAccessSummary').doc(privateSummaryId(studentId)).get();
      const summary = snap.exists ? snap.data() || {} : {};
      const allowedSlotIds = Array.isArray(summary.allowedSlotIds) ? summary.allowedSlotIds : [];
      const allowedPrivateLessonSlotIds = Array.isArray(summary.allowedPrivateLessonSlotIds)
        ? summary.allowedPrivateLessonSlotIds
        : [];
      return `${allowedSlotIds.includes(slotId)}:${allowedPrivateLessonSlotIds.includes(slotId)}`;
    }, { timeout: 15000 })
    .toBe('true:true');
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

async function expectNotificationEvent(db, {
  type,
  slotId,
  studentId,
  reservationId: expectedReservationId,
  teacher = TEACHER_NAME,
}) {
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
  expect(eventData?.teacher).toBe(teacher);
  expect(eventData?.createdAt?.toMillis?.() || 0).toBeGreaterThan(0);
  return eventData;
}

async function loginAsStudentWithPrivateBooking(page, email) {
  await loginAsStudent(page, email, TEST_STUDENT_PASSWORD);
  await page.goto(new URL('/student-booking?privateSlotBooking=enabled', BASE_URL).toString());
  await expectStudentBookingHeadingVisible(
    page,
    'student booking page should remain available after enabling private slot booking flag'
  );
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
  createPackage = teacherAccess,
}) {
  const nowTs = admin.firestore.Timestamp.now();
  const email = `private-reservation-${roleName}-${unique}@example.com`;
  const displayName = `Private Reservation ${roleName} ${unique}`;
  const packageId = `pkg-private-reservation-${roleName}-${unique}`;
  const user = await auth.createUser({
    email,
    password: TEST_STUDENT_PASSWORD,
    displayName,
  });
  await auth.setCustomUserClaims(user.uid, {
    role: 'student',
    academyId: DEFAULT_E2E_ACADEMY_ID,
    studentId,
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
      status: 'active',
      paidLessons,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    createPackage
      ? db.collection('studentPackages').doc(packageId).set({
          academyId: DEFAULT_E2E_ACADEMY_ID,
          studentId,
          title: `E2E Private Package ${roleName} ${unique}`,
          packageType: 'private',
          teacher: teacherKey,
          teacherName: teacherKey,
          status: 'active',
          totalCount: Math.max(Number(paidLessons || 0), 1),
          usedCount: 0,
          remainingCount: Math.max(Number(paidLessons || 0), 1),
          createdAt: nowTs,
          updatedAt: nowTs,
        })
      : Promise.resolve(),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(studentId)).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId,
      teacherKeys: teacherAccess ? [teacherKey] : [],
      activePackageIds: createPackage ? [packageId] : [],
      allowedSlotIds,
      allowedPrivateLessonSlotIds: allowedSlotIds,
      privateSlotBookingPilotEnabled,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
  ]);

  return { uid: user.uid, email, studentId, displayName, packageId };
}

async function createFixture(unique) {
  const db = getDb();
  const auth = getAuth();
  const nowTs = admin.firestore.Timestamp.now();
  const teacherKey = `teacher-${unique}`;
  const teacherDocId = `e2e-flex-private-teacher-${unique}`;
  const ineligibleTeacherKey = `other-private-teacher-${unique}`;
  const minute = Number.parseInt(String(unique).split('-').at(-1), 10) || 0;
  const date = upcomingMondaySaturdayYmd(1);
  const time = `13:${String(minute % 10).padStart(2, '0')}`;
  const slotId = `e2e-flex-private-slot-${unique}`;
  const eligibleStudentId = `e2e-flex-private-eligible-${unique}`;
  const noRemainingStudentId = `e2e-flex-private-no-remaining-${unique}`;
  const ineligibleStudentId = `e2e-flex-private-ineligible-${unique}`;
  const noRemainingExistingSlotId = `e2e-flex-private-no-remaining-existing-slot-${unique}`;
  const noRemainingOpenSlotId = `e2e-flex-private-no-remaining-open-slot-${unique}`;
  const noRemainingFixedLessonId = `e2e-flex-private-fixed-lesson-${unique}`;
  const noTicketStudentId = `e2e-flex-private-no-ticket-${unique}`;
  const noTicketOpenSlotId = `e2e-flex-private-no-ticket-open-slot-${unique}`;
  const pilotDisabledStudentId = `e2e-flex-private-pilot-disabled-${unique}`;
  const pilotDisabledSlotId = `e2e-flex-private-pilot-disabled-slot-${unique}`;
  const busyPrivateLessonId = `e2e-flex-private-busy-lesson-${unique}`;
  const busyGroupLessonId = `e2e-flex-private-busy-group-${unique}`;
  const otherTeacherBusyLessonId = `e2e-flex-private-other-busy-${unique}`;
  const subject = `E2E Flexible Private Slot ${unique}`;
  const noRemainingExistingSubject = `E2E Existing Active Reservation ${unique}`;
  const noRemainingExistingDate = upcomingMondaySaturdayYmd(2);
  const noRemainingOpenSubject = `E2E Flexible No Remaining Slot ${unique}`;
  const noRemainingOpenDate = upcomingMondaySaturdayYmd(3);
  const noRemainingFixedLessonDate = upcomingMondaySaturdayYmd(4);
  const noTicketOpenDate = upcomingMondaySaturdayYmd(6);
  const pilotDisabledDate = upcomingMondaySaturdayYmd(5);
  const pilotDisabledTime = '14:40';
  const busyPrivateLessonDate = upcomingMondaySaturdayYmd(2);
  const busyPrivateLessonTime = '15:00';
  const busyGroupLessonDate = upcomingMondaySaturdayYmd(3);
  const busyGroupLessonTime = '16:00';
  const otherTeacherBusyDate = upcomingMondaySaturdayYmd(4);
  const otherTeacherBusyTime = '17:00';
  const otherStudentName = `Other Private Student ${unique}`;
  const busyPrivateSubject = `Private Subject Leak ${unique}`;
  const busyGroupClassName = `Group Class Leak ${unique}`;
  const busyGroupSubject = `Group Subject Leak ${unique}`;

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
    teacherKey,
    allowedSlotIds: [],
    paidLessons: 1,
    privateSlotBookingPilotEnabled: true,
  });
  const noRemainingStudent = await createStudentFixture(db, auth, {
    unique,
    roleName: 'no-remaining',
    studentId: noRemainingStudentId,
    teacherAccess: true,
    teacherKey,
    allowedSlotIds: [noRemainingOpenSlotId],
    paidLessons: 1,
    privateSlotBookingPilotEnabled: true,
  });
  const ineligibleStudent = await createStudentFixture(db, auth, {
    unique,
    roleName: 'ineligible',
    studentId: ineligibleStudentId,
    teacherAccess: true,
    teacherKey: ineligibleTeacherKey,
    allowedSlotIds: [],
    paidLessons: 1,
    privateSlotBookingPilotEnabled: true,
  });
  const noTicketStudent = await createStudentFixture(db, auth, {
    unique,
    roleName: 'no-ticket',
    studentId: noTicketStudentId,
    teacherAccess: true,
    teacherKey,
    allowedSlotIds: [],
    paidLessons: 0,
    privateSlotBookingPilotEnabled: true,
    createPackage: false,
  });
  const pilotDisabledStudent = await createStudentFixture(db, auth, {
    unique,
    roleName: 'pilot-disabled',
    studentId: pilotDisabledStudentId,
    teacherAccess: true,
    teacherKey,
    allowedSlotIds: [pilotDisabledSlotId],
    paidLessons: 1,
    privateSlotBookingPilotEnabled: false,
  });
  const bookingOpensAt = admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
  const bookingClosesAt = admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await Promise.all([
    db.collection('teachers').doc(teacherDocId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: teacherKey,
      teacherName: teacherKey,
      teacherKey,
      status: 'active',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('privateLessonSlots').doc(slotId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: teacherKey,
      teacherName: teacherKey,
      date,
      time,
      subject,
      capacity: 1,
      reservedCount: 0,
      startAt: admin.firestore.Timestamp.fromDate(new Date(`${date}T${time}:00`)),
      bookingOpensAt,
      bookingClosesAt,
      durationMinutes: 60,
      status: 'open',
      reservedStudentId: '',
      reservationId: '',
      slotType: 'open',
      isBookable: true,
      createdByUid: 'e2e-admin-sdk',
      createdAt: nowTs,
      updatedAt: nowTs,
      reservedAt: null,
      cancelledAt: null,
    }),
    db.collection('privateLessonSlots').doc(noRemainingOpenSlotId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: teacherKey,
      teacherName: teacherKey,
      date: noRemainingOpenDate,
      time: '10:40',
      subject: noRemainingOpenSubject,
      capacity: 1,
      reservedCount: 0,
      startAt: admin.firestore.Timestamp.fromDate(new Date(`${noRemainingOpenDate}T10:40:00`)),
      bookingOpensAt,
      bookingClosesAt,
      durationMinutes: 50,
      status: 'open',
      eligibleStudentIds: [noRemainingStudentId],
      reservedStudentId: '',
      reservationId: '',
      slotType: 'open',
      isBookable: true,
      createdByUid: 'e2e-admin-sdk',
      createdAt: nowTs,
      updatedAt: nowTs,
      reservedAt: null,
      cancelledAt: null,
    }),
    db.collection('privateLessonSlots').doc(noRemainingExistingSlotId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: teacherKey,
      teacherName: teacherKey,
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
      bookingOpensAt,
      bookingClosesAt,
      cancelledAt: null,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('privateLessonSlots').doc(noTicketOpenSlotId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: teacherKey,
      teacherName: teacherKey,
      date: noTicketOpenDate,
      time: '11:40',
      subject: `E2E Flexible No Ticket Slot ${unique}`,
      capacity: 1,
      reservedCount: 0,
      startAt: admin.firestore.Timestamp.fromDate(new Date(`${noTicketOpenDate}T11:40:00`)),
      bookingOpensAt,
      bookingClosesAt,
      durationMinutes: 50,
      status: 'open',
      reservedStudentId: '',
      reservationId: '',
      slotType: 'open',
      isBookable: true,
      createdByUid: 'e2e-admin-sdk',
      createdAt: nowTs,
      updatedAt: nowTs,
      reservedAt: null,
      cancelledAt: null,
    }),
    db.collection('privateLessonSlots').doc(pilotDisabledSlotId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: teacherKey,
      teacherName: teacherKey,
      date: pilotDisabledDate,
      time: pilotDisabledTime,
      subject: `E2E Pilot Disabled Private Slot ${unique}`,
      capacity: 1,
      reservedCount: 0,
      startAt: admin.firestore.Timestamp.fromDate(
        new Date(`${pilotDisabledDate}T${pilotDisabledTime}:00`)
      ),
      bookingOpensAt,
      bookingClosesAt,
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
        teacher: teacherKey,
        teacherName: teacherKey,
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
      teacher: teacherKey,
      teacherName: teacherKey,
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
    db.collection('lessons').doc(busyPrivateLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: teacherKey,
      teacherName: teacherKey,
      studentId: `other-private-student-${unique}`,
      studentName: otherStudentName,
      student: otherStudentName,
      date: busyPrivateLessonDate,
      time: busyPrivateLessonTime,
      subject: busyPrivateSubject,
      durationMinutes: 50,
      sessionNumber: 1,
      completed: false,
      isDeductCancelled: false,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('groupLessons').doc(busyGroupLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: teacherKey,
      teacherName: teacherKey,
      date: busyGroupLessonDate,
      time: busyGroupLessonTime,
      subject: busyGroupSubject,
      groupClassName: busyGroupClassName,
      groupClassId: `e2e-busy-group-class-${unique}`,
      capacity: 4,
      bookedCount: 2,
      durationMinutes: 60,
      status: 'active',
      isBookable: true,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('lessons').doc(otherTeacherBusyLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: ineligibleTeacherKey,
      teacherName: ineligibleTeacherKey,
      studentId: `other-teacher-student-${unique}`,
      studentName: `Other Teacher Student ${unique}`,
      date: otherTeacherBusyDate,
      time: otherTeacherBusyTime,
      subject: `Other Teacher Private Subject ${unique}`,
      durationMinutes: 50,
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
    teacherKey,
    teacherDocId,
    ineligibleTeacherKey,
    slotId,
    date,
    time,
    subject,
    eligibleStudent,
    noRemainingStudent,
    ineligibleStudent,
    noTicketStudent,
    pilotDisabledStudent,
    pilotDisabledSlotId,
    pilotDisabledDate,
    pilotDisabledTime,
    noRemainingExistingSlotId,
    noRemainingExistingDate,
    noRemainingOpenSlotId,
    noRemainingOpenDate,
    noTicketOpenSlotId,
    noTicketOpenDate,
    noRemainingFixedLessonId,
    busyPrivateLessonId,
    busyPrivateLessonDate,
    busyPrivateLessonTime,
    busyPrivateSubject,
    otherStudentName,
    busyGroupLessonId,
    busyGroupLessonDate,
    busyGroupLessonTime,
    busyGroupClassName,
    busyGroupSubject,
    otherTeacherBusyLessonId,
    otherTeacherBusyDate,
    otherTeacherBusyTime,
  };
}

async function cleanupFixture(fixture) {
  if (!fixture) return;
  const db = getDb();
  const auth = getAuth();
  const {
    slotId,
    eligibleStudent,
    noRemainingStudent,
    ineligibleStudent,
    noTicketStudent,
    pilotDisabledStudent,
  } =
    fixture;
  const refs = [
    db.collection('teachers').doc(fixture.teacherDocId),
    db.collection('privateLessonSlots').doc(slotId),
    db.collection('privateLessonSlots').doc(fixture.noRemainingExistingSlotId),
    db.collection('privateLessonSlots').doc(fixture.noRemainingOpenSlotId),
    db.collection('privateLessonSlots').doc(fixture.noTicketOpenSlotId),
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
    db.collection('lessons').doc(fixture.busyPrivateLessonId),
    db.collection('lessons').doc(fixture.otherTeacherBusyLessonId),
    db.collection('groupLessons').doc(fixture.busyGroupLessonId),
    db.collection('privateStudents').doc(eligibleStudent.studentId),
    db.collection('privateStudents').doc(noRemainingStudent.studentId),
    db.collection('privateStudents').doc(ineligibleStudent.studentId),
    db.collection('privateStudents').doc(noTicketStudent.studentId),
    db.collection('privateStudents').doc(pilotDisabledStudent.studentId),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(eligibleStudent.studentId)),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(noRemainingStudent.studentId)),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(ineligibleStudent.studentId)),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(noTicketStudent.studentId)),
    db.collection('studentPrivateAccessSummary').doc(
      privateSummaryId(pilotDisabledStudent.studentId)
    ),
    db.collection('studentPrivateBookingStats').doc(privateBookingStatsId(eligibleStudent.studentId)),
    db.collection('studentPrivateBookingStats').doc(privateBookingStatsId(noRemainingStudent.studentId)),
    db.collection('studentPrivateBookingStats').doc(privateBookingStatsId(ineligibleStudent.studentId)),
    db.collection('studentPrivateBookingStats').doc(privateBookingStatsId(noTicketStudent.studentId)),
    db.collection('studentPrivateBookingStats').doc(
      privateBookingStatsId(pilotDisabledStudent.studentId)
    ),
    db.collection('users').doc(eligibleStudent.uid),
    db.collection('users').doc(noRemainingStudent.uid),
    db.collection('users').doc(ineligibleStudent.uid),
    db.collection('users').doc(noTicketStudent.uid),
    db.collection('users').doc(pilotDisabledStudent.uid),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${eligibleStudent.uid}`),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${noRemainingStudent.uid}`),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${ineligibleStudent.uid}`),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${noTicketStudent.uid}`),
    db.collection('academyMemberships').doc(
      `${DEFAULT_E2E_ACADEMY_ID}_${pilotDisabledStudent.uid}`
    ),
  ];
  [
    eligibleStudent.packageId,
    noRemainingStudent.packageId,
    ineligibleStudent.packageId,
    noTicketStudent.packageId,
    pilotDisabledStudent.packageId,
  ]
    .filter(Boolean)
    .forEach((packageId) => refs.push(db.collection('studentPackages').doc(packageId)));
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
      noTicketStudent.studentId,
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
    auth.deleteUser(noTicketStudent.uid).catch(() => {}),
    auth.deleteUser(pilotDisabledStudent.uid).catch(() => {}),
  ]);
}

async function expectAdminDirectReservationCalendarRow(page, fixture) {
  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '캘린더');
  await page.locator(`[data-testid="calendar-day-button"][data-date="${fixture.date}"]`).click();
  const reservationRow = page
    .locator(
      `[data-testid="calendar-lesson-row"][data-row-kind="privateReservation"][data-time="${fixture.time}"]`
    )
    .filter({ hasText: fixture.eligibleStudent.displayName })
    .first();
  await expect(reservationRow).toBeVisible({ timeout: 45000 });
  await expect(reservationRow).toContainText(fixture.eligibleStudent.displayName);
  await expect(reservationRow).toContainText(fixture.time);
  await expect(reservationRow).toContainText('학생 예약 1:1');
  await expect(reservationRow).toContainText('60분');
  await expect(reservationRow).toContainText('예약 완료');
  await expect(reservationRow).toContainText('학생이 예약 화면에서 직접 예약한 1:1 수업입니다.');
}

async function expectTeacherRosterDirectReservationRow(page, fixture) {
  await openDashboardSection(page, '선생님 관리');
  const teacherRow = page
    .getByTestId('teacher-management-row')
    .filter({ hasText: fixture.teacherKey })
    .first();
  await expect(teacherRow).toBeVisible({ timeout: 20000 });
  await teacherRow.getByTestId('teacher-lesson-roster-open-button').click();
  const rosterModal = page.getByTestId('teacher-lesson-roster-modal');
  await expect(rosterModal).toBeVisible({ timeout: 20000 });
  const reservationRow = rosterModal
    .getByTestId('teacher-lesson-roster-upcoming-section')
    .locator('[data-testid="teacher-lesson-roster-row"]')
    .filter({ hasText: fixture.eligibleStudent.displayName })
    .first();
  await expect(reservationRow).toBeVisible({ timeout: 20000 });
  await expect(reservationRow).toContainText(fixture.time);
  await expect(reservationRow).toContainText('학생 예약 1:1');
  await expect(reservationRow).toContainText('60분');
  await expect(reservationRow).toContainText('예약 완료');
  await rosterModal.getByTestId('teacher-lesson-roster-close-button').click();
  await expect(rosterModal).toHaveCount(0);
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
  expect(source).toContain('function isPrivateSlotBookingE2eOverride');
  expect(source).toMatch(/data && data\.privateSlotBooking/);
  expect(source).toContain('"1:1 예약 기능은 아직 선택된 학생에게만 제공됩니다."');
  expect(source).toContain('exports.listPrivateLessonSlotAvailability');
  expect(source).toContain('privateSlotBookingPilotEnabled');
  expect(source).toMatch(/function requirePrivateSlotBookingPilotEnabled\(summary\)/);
  expect(source).toMatch(/summary\.privateSlotBookingPilotEnabled === true/);
  expect(source).toMatch(
    /exports\.listPrivateLessonSlotAvailability[\s\S]*isPrivateSlotAvailabilityBookingEnabled\(\s*data,\s*summary,\s*\)/
  );
  expect(source).toMatch(
    /exports\.reservePrivateLessonSlot[\s\S]*requirePrivateSlotReservationAllowed\(data, summary\)/
  );
  expect(source).toMatch(
    /exports\.cancelPrivateLessonReservation[\s\S]*requirePrivateSlotReservationEnabled\(data\)/
  );
  expect(source).toMatch(
    /exports\.reservePrivateLessonSlot[\s\S]*requirePrivateSlotBookingPilotEnabled\(summary\)/
  );
  expect(source).toMatch(
    /exports\.cancelPrivateLessonReservation[\s\S]*requirePrivateSlotBookingPilotEnabled\(summary\)/
  );
  const sanitizeSource = source.match(
    /function sanitizePrivateSlotAvailabilityRow[\s\S]*?\n}\n/
  )?.[0] || '';
  expect(sanitizeSource).toContain('isReserved');
  expect(sanitizeSource).toContain('isBookable');
  expect(source).toMatch(
    /function getPrivateSlotStudentVisibleStatus[\s\S]*bookingStatus === "blocked"[\s\S]*return "busy"/
  );
  expect(source).toMatch(
    /function buildBusyPrivateScheduleRowId[\s\S]*source !== "privateLessonReservations"[\s\S]*safeTeacher/
  );
  expect(sanitizeSource).not.toContain('reservedStudentId');
  expect(sanitizeSource).not.toContain('reservationId');
  expect(source).toMatch(/function hasSlotAccess[\s\S]*summary && summary\.teacherKeys/);
  expect(source).toMatch(/function hasSlotAccess[\s\S]*activePackageIds\.length > 0/);
});

test('student booking page passes private slot e2e override to callable actions', async () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'StudentBookingPage.jsx'), 'utf8');
  expect(source).toContain('PRIVATE_SLOT_BOOKING_CALLABLE_OVERRIDE');
  expect(source).toMatch(/privateSlotBooking['"]?\s*:\s*'enabled'/);
  expect(source).toMatch(
    /listPrivateLessonSlotAvailability[\s\S]*academyId: currentAcademyId[\s\S]*PRIVATE_SLOT_BOOKING_CALLABLE_OVERRIDE/
  );
  expect(source).toMatch(
    /reservePrivateLessonSlot[\s\S]*academyId: scopedAcademyId[\s\S]*slotId: slot\.id[\s\S]*PRIVATE_SLOT_BOOKING_CALLABLE_OVERRIDE/
  );
  expect(source).toMatch(
    /cancelPrivateLessonReservation[\s\S]*academyId: scopedAcademyId[\s\S]*slotId: reservation\.slotId[\s\S]*PRIVATE_SLOT_BOOKING_CALLABLE_OVERRIDE/
  );
});

test('student booking page wires mobile friendly private booking layout without changing locators', async () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'StudentBookingPage.jsx'), 'utf8');
  expect(source).toContain("STUDENT_BOOKING_VIEW_MODE_STORAGE_KEY = 'studentBookingPreferredViewMode'");
  expect(source).toContain("STUDENT_BOOKING_MOBILE_MEDIA_QUERY = '(max-width: 720px)'");
  expect(source).toContain('student-booking-view-mode-toggle');
  expect(source).toContain('PC 화면으로 보기');
  expect(source).toContain('모바일 화면으로 보기');
  expect(source).toContain('STUDENT_BOOKING_MOBILE_SAFE_AREA_PADDING_TOP');
  expect(source).toContain('env(safe-area-inset-top, 0px)');
  expect(source).toContain('STUDENT_BOOKING_MOBILE_SAFE_AREA_PADDING_BOTTOM');
  expect(source).toContain('env(safe-area-inset-bottom, 0px)');
  expect(source).toContain("'calc(140px + env(safe-area-inset-bottom, 0px))'");
  expect(source).toContain('STUDENT_BOOKING_MOBILE_CARD_LIST_BOTTOM_SPACER_HEIGHT');
  expect(source).toContain('student-upcoming-private-lessons-mobile-spacer');
  expect(source).toContain('student-booking-mobile-bottom-spacer');
  expect(source).toContain("maxWidth: '100%'");
  expect(source).toContain('minWidth: 0');
  expect(source).toContain("overflowX: 'hidden'");
  expect(source).toContain('resetHorizontalScroll');
  expect(source).toContain('requestAnimationFrame');
  expect(source).toContain('scrollLeft = 0');
  expect(source).toContain('document.documentElement');
  expect(source).toContain('document.body');
  expect(source).toContain("document.getElementById('root')");
  expect(source).toContain("document.querySelector('.student-booking-mobile-overflow-root')");
  expect(source).toContain("'pageshow'");
  expect(source).toContain("'visibilitychange'");
  expect(source).toContain('STUDENT_BOOKING_MOBILE_TEXT_WRAP_STYLE');
  expect(source).toContain("overflowWrap: 'anywhere'");
  expect(source).toContain("wordBreak: 'break-word'");
  expect(source).toContain('student-booking-mobile-overflow-root');
  expect(source).toContain("width: isMobileStudentBooking ? '100%' : undefined");
  expect(source).toContain("maxWidth: isMobileStudentBooking ? '100%' : undefined");
  expect(source).not.toContain("document.body.style.overflowX = 'hidden'");
  expect(source).not.toContain("document.documentElement.style.overflowX = 'hidden'");
  expect(source).toContain("display: isMobileStudentBooking ? 'grid' : 'flex'");
  expect(source).toContain("gridTemplateColumns: isMobileStudentBooking");
  expect(source).toContain("'repeat(3, minmax(0, 1fr))'");
  expect(source).toContain("whiteSpace: 'normal'");
  expect(source).toContain("gridTemplateColumns: 'repeat(2, minmax(0, 1fr))'");
  expect(source).toContain("maxWidth: isMobileStudentBooking ? '100%' : 420");
  expect(source).toContain('student-booking-mobile-tabs');
  expect(source).toContain('학생 예약 빠른 이동');
  expect(source).toContain('내 수강권');
  expect(source).toContain('예정 수업');
  expect(source).toContain('1:1 예약');
  expect(source).toContain('수업 내역');
  expect(source).toContain('student-upcoming-private-lessons-section');
  expect(source).toContain('student-private-booking-section');
  expect(source).toContain('student-lesson-history-section');
  expect(source).toContain("gridTemplateColumns: isMobileStudentBooking");
  expect(source).toContain('data-booking-status={bookingStatus}');
  expect(source).toContain('student-private-slot-card');
  expect(source).toContain('student-private-busy-slot-card');
  expect(source).toContain('student-private-slot-reserve-button');
  expect(source).toContain('student-private-slot-reserve-confirm-modal');
  expect(source).toContain('privateSlotReserveConfirm');
  expect(source).toContain('confirmPrivateSlotReserve');
  expect(source).toContain('예약을 취소할까요?');
  expect(source).not.toContain('window.confirm');
  expect(source).not.toContain('window.confirm(buildPrivateSlotReserveConfirmMessage(privateCancelAllowance))');
  expect(source).not.toMatch(/window\.confirm\s*\(/);
  expect(source).not.toMatch(/window\.confirm\s*\(\s*buildPrivateSlotReserveConfirmMessage/);
  expect(source).not.toMatch(/window\.confirm\s*\(\s*buildPrivateReservationCancelConfirmMessage/);
  expect(source).toMatch(/setPrivateSlotReserveConfirm[\s\S]*buildPrivateSlotReserveConfirmMessage/);
  expect(source).toMatch(/bookingStatus === 'available'[\s\S]*slot\.isBookable === true[\s\S]*slot\.status === 'open'/);
});

test('student booking page uses in-app private cancellation confirm modal', async () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'StudentBookingPage.jsx'), 'utf8');
  const { buildPrivateReservationCancelConfirmMessage } = await import(
    '../src/features/booking/studentPrivateCancelAllowance.js'
  );
  const message = buildPrivateReservationCancelConfirmMessage(
    { used: 1, limit: 3, remaining: 2 },
    { loaded: true }
  );

  expect(source).not.toContain('window.confirm');
  expect(source).toContain('privateSlotCancelConfirm');
  expect(source).toContain('confirmPrivateSlotCancel');
  expect(source).toContain('closePrivateSlotCancelConfirm');
  expect(source).toContain('예약을 취소할까요?');
  expect(source).not.toMatch(/(?:window\.)?confirm\s*\(/);
  expect(source).toContain('student-private-reservation-cancel-confirm-modal');
  expect(source).toContain('student-private-reservation-cancel-confirm-message');
  expect(source).toContain('student-private-reservation-cancel-confirm-cancel');
  expect(source).toContain('student-private-reservation-cancel-confirm-submit');
  expect(source).toMatch(/setPrivateSlotCancelConfirm[\s\S]*buildPrivateReservationCancelConfirmMessage/);
  expect(source).toMatch(/confirmPrivateSlotCancel[\s\S]*cancelPrivateReservation\(pending\.reservation, \{ confirmed: true \}\)/);
  expect(message).toContain('취소 사용 1/3회');
  expect(message).toContain('남은 취소 가능 2회');
  expect(message).toContain('이번 취소 후 남은 취소 가능 1회');
});

test('weekly private booking window helper is deterministic for Monday-Saturday', async () => {
  const helper = await import('../src/features/booking/privateBookingWindow.js');
  const window = helper.getBookingWindowForPrivateLesson('2026-06-08', '15:00');
  expect(window.weekStartsOn).toBe('2026-06-08');
  expect(window.weekEndsOn).toBe('2026-06-13');
  expect(helper.formatKstDotDateTime(window.bookingOpensAt)).toBe('2026.06.05 00:00');
  expect(window.bookingClosesAt).toBe(window.startsAt - 7 * 60 * 60 * 1000);
  expect(helper.getKstWeekday('2026-06-14')).toBe(7);
  expect(helper.buildMondaySaturdayWeekDays('2026-06-08')).toEqual([
    '2026-06-08',
    '2026-06-09',
    '2026-06-10',
    '2026-06-11',
    '2026-06-12',
    '2026-06-13',
  ]);
});

test('weekly private booking templates are wired through UI, rules, and callables', async () => {
  const functionSource = fs.readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');
  const pageSource = fs.readFileSync(path.join(process.cwd(), 'StudentBookingPage.jsx'), 'utf8');
  const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'Dashboard.jsx'), 'utf8');
  const sectionSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/PrivateLessonSlotsSection.jsx'),
    'utf8'
  );
  const helperSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/booking/privateBookingWindow.js'),
    'utf8'
  );
  const rulesSource = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');
  const adminReopenBlock = functionSource.match(
    /exports\.adminReopenPrivateLessonSlot[\s\S]*?exports\.adminCancelPrivateLessonReservation/
  )?.[0] || '';

  expect(functionSource).toContain('privateLessonAvailabilityTemplates');
  expect(functionSource).toContain('PRIVATE_SLOT_BOOKING_CUTOFF_MS = 7 * 60 * 60 * 1000');
  expect(functionSource).toContain('not-open-yet');
  expect(functionSource).toContain('booking-closed');
  expect(functionSource).toContain('no-remaining-package');
  expect(functionSource).toContain('buildPrivateTemplateSlotId');
  expect(functionSource).toContain('function privateAvailabilityTemplateOpenForStudentBooking');
  expect(functionSource).toContain('exports.adminClosePrivateLessonSlot');
  expect(functionSource).toContain('exports.adminReopenPrivateLessonSlot');
  expect(functionSource).toMatch(
    /adminClosePrivateLessonSlot[\s\S]*requireAcademyAdmin\(db, academyId, uid\)/
  );
  expect(functionSource).toMatch(
    /adminReopenPrivateLessonSlot[\s\S]*requireAcademyAdmin\(db, academyId, uid\)/
  );
  expect(functionSource).toMatch(
    /adminReopenPrivateLessonSlot[\s\S]*buildAdminReopenedPrivateSlotUpdates/
  );
  expect(functionSource).toMatch(
    /buildAdminReopenedPrivateSlotUpdates[\s\S]*status: "open"[\s\S]*isBookable: true/
  );
  expect(adminReopenBlock).toContain('transaction.update(slotRef');
  expect(adminReopenBlock).not.toContain('privateLessonAvailabilityTemplates');
  const adminCloseBlock =
    functionSource.match(
      /exports\.adminClosePrivateLessonSlot[\s\S]*?(?=\nexports\.|$)/
    )?.[0] || '';

  const adminClosedFromTemplateBlock =
    functionSource.match(
      /function buildAdminClosedPrivateSlotFromTemplate[\s\S]*?\n}\n/
    )?.[0] || '';

  expect(adminCloseBlock).toContain(
    'buildAdminClosedPrivateSlotFromTemplate'
  );
  expect(adminClosedFromTemplateBlock).toContain(
    'buildSlotFromAvailabilityTemplate'
  );
  expect(adminClosedFromTemplateBlock).toContain(
    'buildAdminClosedPrivateSlotUpdates'
  );
  expect(adminCloseBlock).toContain(
    'buildCancelledPrivateReservationUpdates'
  );
  expect(functionSource).toMatch(
    /listPrivateLessonSlotAvailability[\s\S]*"open", "reserved", "blocked", "cancelled"/
  );
  expect(functionSource).toMatch(
    /addVisibleSlot[\s\S]*isClosedByTeacherUnavailable[\s\S]*isTeacherUnavailablePrivateCancellationReason/
  );
  expect(functionSource).toMatch(
    /buildTemplateSlots[\s\S]*privateAvailabilityTemplateOpenForStudentBooking\(data\)/
  );
  expect(functionSource).toMatch(
    /reservePrivateLessonSlot[\s\S]*privateAvailabilityTemplateOpenForStudentBooking\(template\)/
  );
  expect(functionSource).toMatch(/reservePrivateLessonSlot[\s\S]*computePrivateBookingWindow/);
  expect(functionSource).toMatch(/reservePrivateLessonSlot[\s\S]*window\.weekday < 1/);
  expect(functionSource).toMatch(/reservePrivateLessonSlot[\s\S]*window\.weekday > 6/);
  expect(functionSource).toMatch(/transaction\.set\(slotRef[\s\S]*slotReservationUpdate/);

  expect(pageSource).toContain('student-private-calendar');
  expect(pageSource).toContain('예약은 수업 시작 7시간 전까지만 가능합니다.');
  expect(pageSource).toContain('예약 마감 · 수업 준비 중');
  expect(pageSource).toContain('예약 가능');
  expect(pageSource).not.toContain('예약 가능 보충');
  expect(helperSource).toContain("not_open: '예약 오픈 대기'");

  expect(dashboardSource).toContain('createPrivateAvailabilityTemplate');
  expect(dashboardSource).toContain('getPrivateAvailabilityTemplateUsagePatch');
  expect(dashboardSource).toContain('isPrivateAvailabilityTemplateForFixedAssignment');
  expect(sectionSource).toContain('private-availability-template-section');
  expect(sectionSource).toContain('private-teacher-weekly-board-section');
  expect(sectionSource).toContain('선생님별 1:1 시간표/예약판');
  expect(sectionSource).toContain('private-teacher-weekly-board-close-button');
  expect(sectionSource).toContain('학생 예약 있음');
  expect(sectionSource).toContain('고정 예약');
  expect(sectionSource).toContain('예약 취소 후 공개');
  expect(sectionSource).toContain('수업불가로 닫기');
  expect(sectionSource).toContain('수업불가 해제');
  expect(sectionSource).toContain('private-teacher-weekly-board-reopen-button');
  expect(sectionSource).toContain('showPrivateBoardActions');
  expect(sectionSource).toContain('이 화면은 읽기 전용입니다.');
  expect(sectionSource).toContain('선생님 주간 1:1 시간표');
  expect(sectionSource).toContain('private-availability-template-start-date-input');
  expect(sectionSource).toContain('private-availability-template-end-date-input');
  expect(sectionSource).toContain('private-availability-template-use-fixed-checkbox');
  expect(sectionSource).toContain('private-availability-template-open-booking-checkbox');
  expect(sectionSource).toContain('private-weekly-bulk-use-fixed-checkbox');
  expect(sectionSource).toContain('private-weekly-bulk-open-booking-checkbox');
  expect(sectionSource).toContain('private-availability-template-edit-button');
  expect(sectionSource).toContain('private-availability-template-edit-start-date-input');
  expect(sectionSource).toContain('private-availability-template-edit-status-select');
  expect(sectionSource).toContain('학생 직접 예약 허용');
  expect(sectionSource).toContain('기간 제한 없음');
  expect(sectionSource).toContain('날짜별 1:1 예약 가능 시간 (학생 직접 예약 허용)');
  expect(sectionSource).toContain('등록된 주간 1:1 시간이 없습니다.');
  expect(sectionSource).toContain('등록된 고정 수업 배정용 주간 시간이 없습니다.');
  expect(sectionSource).toContain('private-availability-template-add-button');

  expect(rulesSource).toContain('match /privateLessonAvailabilityTemplates/{templateId}');
  expect(rulesSource).toContain('privateAvailabilityTemplateBelongsToTeacher');
  expect(rulesSource).toContain('"useForFixedAssignment"');
  expect(rulesSource).toContain('"openForStudentBooking"');
  expect(rulesSource).toMatch(/data\.weekday >= 1[\s\S]*data\.weekday <= 6/);
  expect(rulesSource).toMatch(/allow create:[\s\S]*isAcademyAdmin/);
  expect(rulesSource).toContain(
    'changedOnly([\n          "status",\n          "effectiveStartDate",\n          "effectiveEndDate",\n          "useForFixedAssignment",\n          "openForStudentBooking",\n          "updatedAt"\n        ])'
  );
});

test('released fixed private slot behavior is wired server-side', async () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');
  expect(source).toContain('function findActivePrivatePackageForTeacher');
  expect(source).toMatch(/Number\(pkg\.remainingCount \|\| 0\)[\s\S]*<= 0/);
  expect(source).toMatch(
    /function getReservationTeacherKey[\s\S]*getPrivateTeacherScopeKeys\(reservation, slot\)/
  );
  expect(source).toContain('function getPrivateTeacherScopeKeys');
  expect(source).toContain('row.teacherId');
  expect(source).toContain('slotType: "released_fixed"');
  expect(source).toContain('releasedFromFixed: true');
  expect(source).toContain('releasedByStudentId: studentId');
  expect(source).toContain('releaseReason = "fixed_student_cancelled"');
  expect(source).toContain('exports.adminCancelPrivateLessonReservation');
  expect(source).toContain('function isTeacherUnavailablePrivateCancellationReason');
  expect(source).toContain('releaseReason: "admin_cancelled"');
  expect(source).toContain('const shouldCloseSlot');
  expect(source).toContain('buildAdminClosedPrivateSlotUpdates');
  expect(source).toMatch(
    /adminCancelPrivateLessonReservation[\s\S]*buildReleasedPrivateSlotUpdates\(\{[\s\S]*releaseReason: "admin_cancelled"/
  );
  expect(source).toMatch(
    /exports\.reservePrivateLessonSlot[\s\S]*findUsablePrivatePackageForTeacher/
  );
  expect(source).toMatch(
    /exports\.reservePrivateLessonSlot[\s\S]*const hasAccess = hasSlotAccess\(\{slot, summary, slotId, studentId\}\)[\s\S]*!hasAccess && !packageResult\.ok/
  );
  expect(source).toMatch(
    /exports\.reservePrivateLessonSlot[\s\S]*hasExplicitSlotEligibility\(slot\)[\s\S]*!hasAccess/
  );
  const sanitizeSource = source.match(
    /function sanitizePrivateSlotAvailabilityRow[\s\S]*?\n}\n/
  )?.[0] || '';
  expect(sanitizeSource).toContain('isReleasedFixedSlot');
  expect(sanitizeSource).not.toContain('fixedStudentName');
});

test('private admin actions are restricted away from teacher execution paths', async () => {
  const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'Dashboard.jsx'), 'utf8');
  const privateSlotsSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/PrivateLessonSlotsSection.jsx'),
    'utf8'
  );
  const calendarSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/CalendarSection.jsx'),
    'utf8'
  );
  const packageFlowSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/hooks/useStudentPackageAdminFlow.js'),
    'utf8'
  );
  const functionsSource = fs.readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');
  const rulesSource = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');

  expect(privateSlotsSource).toContain('showPrivateBoardActions');
  expect(privateSlotsSource).toContain('내 주간 1:1 시간표');
  expect(privateSlotsSource).toContain('이 화면은 읽기 전용입니다.');
  expect(privateSlotsSource).toContain('예약 취소 후 공개');
  expect(privateSlotsSource).toContain('수업불가로 닫기');
  expect(privateSlotsSource).toContain('수업불가 해제');
  expect(privateSlotsSource).toContain('선생님별 1:1 시간표/예약판');
  expect(privateSlotsSource).toContain('private-teacher-weekly-board-close-button');
  expect(privateSlotsSource).toContain('private-teacher-weekly-board-reopen-button');
  expect(privateSlotsSource).toContain('private-teacher-weekly-board-release-button');
  expect(privateSlotsSource).toContain('학생 고정 배정');
  expect(calendarSource).toContain('data-testid="calendar-deduction-toggle-button"');
  expect(dashboardSource).toContain('const canManagePrivateLessonDeductions = isAdmin');
  expect(dashboardSource).toContain('adminClosePrivateLessonSlot');
  expect(dashboardSource).toContain('adminReopenPrivateLessonSlot');
  expect(dashboardSource).toContain("cancellationReason: 'teacher_unavailable'");
  expect(dashboardSource).toContain("reason: 'teacher_unavailable_reopened'");
  expect(dashboardSource).toContain('const canUseStudentPackageCountSection = false');
  expect(packageFlowSource).toMatch(
    /function canEditStudentPackageCountsForPackage[\s\S]*return isAdminPackageEditor\(\)/
  );

  const adminCancelBlock = functionsSource.match(
    /exports\.adminCancelPrivateLessonReservation[\s\S]*?exports\.updateStudentPrivateCancelAllowance/
  )?.[0] || '';
  expect(adminCancelBlock).toContain('requireAcademyAdmin(db, academyId, uid)');
  expect(adminCancelBlock).toContain('actorRole: actor.actorRole');
  expect(adminCancelBlock).toContain('actorUid: actor.actorUid');
  expect(adminCancelBlock).toContain('actorName: actor.actorName');
  expect(adminCancelBlock).toContain('reason: cancellationReason');
  expect(functionsSource).toContain('exports.adminClosePrivateLessonSlot');
  expect(functionsSource).toContain('exports.adminReopenPrivateLessonSlot');
  expect(functionsSource).toContain('buildAdminReopenedPrivateSlotUpdates');
  expect(functionsSource).toMatch(
    /adminReopenPrivateLessonSlot[\s\S]*requireAcademyAdmin\(db, academyId, uid\)/
  );
  expect(functionsSource).toMatch(
    /buildAdminReopenedPrivateSlotUpdates[\s\S]*reopenedByRole: actorRole/
  );
  expect(functionsSource).toMatch(
    /buildAdminReopenedPrivateSlotUpdates[\s\S]*reopenedReason: reason/
  );
  expect(functionsSource).toMatch(
    /buildAdminReopenedPrivateSlotUpdates[\s\S]*reopenMetadata:[\s\S]*actorUid:[\s\S]*actorRole[\s\S]*actorName[\s\S]*reason/
  );
  expect(functionsSource).toContain('buildAdminClosedPrivateSlotFromTemplate');
  expect(functionsSource).toContain('status: "blocked"');
  expect(functionsSource).toContain('buildClosedFixedPrivateLessonSlot');

  const fixedCancelBlock = functionsSource.match(
    /exports\.cancelFixedPrivateLessonOccurrence[\s\S]*?exports\.adminCancelPrivateLessonReservation/
  )?.[0] || '';
  expect(fixedCancelBlock).toContain('actorRole === "student"');
  expect(fixedCancelBlock).toContain('actorRole === "teacher"');
  expect(fixedCancelBlock).toContain('Fixed private lesson actions require admin permission.');
  expect(fixedCancelBlock).toContain('actorName');
  expect(fixedCancelBlock).toContain('reason: effectiveReason');

  const teacherPackageCallableBlock = functionsSource.match(
    /exports\.updateTeacherStudentPackageCounts[\s\S]*?exports\.reversePrivateReservationOutcome/
  )?.[0] || '';
  expect(teacherPackageCallableBlock).toContain('requireAcademyAdmin(db, academyId, uid)');
  expect(teacherPackageCallableBlock).not.toContain('requireTeacherPackageCountEditor');

  expect(functionsSource).toContain('actorName: outcomeActor.actorName');
  expect(functionsSource).toContain('reason: outcome');
  expect(functionsSource).toContain('reason,');
  expect(rulesSource).toContain('function validTeacherStudentPackageCountUpdate() {\n      return false;');
  expect(rulesSource).toContain('resource.data.packageType in ["group", "openGroup"]');
  expect(rulesSource).not.toContain('canManageOwnLessonDeductions(request.resource.data.academyId)) &&');
});

test('fixed private lesson approval creates and links private packages', async () => {
  const helperSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/privatePackageHelpers.js'),
    'utf8'
  );
  expect(helperSource).toContain('findActivePrivatePackageForTeacher');
  expect(helperSource).toContain('ensurePrivatePackageForFixedLessons');
  expect(helperSource).toContain("title: '고정 1:1'");
  expect(helperSource).toContain("packageType: 'private'");
  expect(helperSource).toContain("sourceType: 'fixedPrivateLesson'");

  const teacherRequestSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/TeacherPrivateLessonRequestsSection.jsx'),
    'utf8'
  );
  expect(teacherRequestSource).toContain('studentPayload.paidLessons = paidLessonCount');
  expect(teacherRequestSource).toContain('weeklyFrequency: frequency');

  const approvalSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/LessonRequestsSection.jsx'),
    'utf8'
  );
  expect(approvalSource).toContain('ensurePrivatePackageForFixedLessons');
  expect(approvalSource).toContain('addStudentPrivateTeacherAccessBatch');
  expect(approvalSource).toContain('actionType: \'package_created\'');
  expect(approvalSource).toContain('studentData.paidLessons');
  expect(approvalSource).toMatch(/buildLessonPayload[\s\S]*packageId: selectedPackage\.id/);
  expect(approvalSource).toContain('fixedPrivatePackageId');

  const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'Dashboard.jsx'), 'utf8');
  expect(dashboardSource).toContain('findActivePrivatePackageForTeacher');
  expect(dashboardSource).toContain('연결된 개인 수강권이 없어 차감할 수 없습니다');
  expect(dashboardSource).toContain('lessonPatch.packageId = packageId');

  const calendarSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/CalendarSection.jsx'),
    'utf8'
  );
  expect(calendarSource).toContain('수강권 등록 필요');
  expect(calendarSource).toContain('수강권 연결 필요');
  expect(calendarSource).toContain('소진');
  expect(calendarSource).toContain('formatRemainingCountFromPackage')
  expect(calendarSource).toContain('findPrivatePackageForTeacherContext');

  const dryRunSource = fs.readFileSync(
    path.join(process.cwd(), 'scripts/dry-run-fixed-private-package-backfill.cjs'),
    'utf8'
  );
  expect(dryRunSource).toContain('writesPerformed: false');
  expect(dryRunSource).toContain('wouldCreatePackage');
  expect(dryRunSource).toContain('lessonsToLinkPackageId');

  const linkAuditSource = fs.readFileSync(
    path.join(process.cwd(), 'scripts/dry-run-private-package-link-audit.cjs'),
    'utf8'
  );
  expect(linkAuditSource).toContain('dryRun: !args.apply');
  expect(linkAuditSource).toContain('confidence');
  expect(linkAuditSource).toContain('proposedUpdates');
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
    await expect(eligiblePage.getByTestId('student-private-booking-policy-notice')).toContainText(
      '예약은 수업 시작 7시간 전까지만 가능합니다.'
    );
    await expect(eligiblePage.getByTestId('student-private-booking-policy-notice')).toContainText(
      '취소는 수업 시작 6시간 전까지만 가능합니다.'
    );
    await expect(eligiblePage.getByTestId('student-private-booking-policy-notice')).toContainText(
      '예약 취소는 최대 2회까지 가능합니다.'
    );
    await expect(eligiblePage.getByTestId('student-private-booking-policy-notice')).toContainText(
      '취소 사용 0/2회 · 남은 취소 가능 2회'
    );
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
    const pilotDisabledCard = studentSlotCardById(pilotDisabledPage, fixture.pilotDisabledSlotId);
    await expect(
      pilotDisabledCard,
      'pilot disabled student should see the intended eligible disabled private slot card'
    ).toBeVisible({ timeout: 15000 });
    await expect(pilotDisabledCard).toContainText(fixture.pilotDisabledDate);
    await expect(pilotDisabledCard).toContainText(fixture.pilotDisabledTime);
    await expect(
      pilotDisabledCard.getByTestId('student-private-slot-reserve-button')
    ).toBeDisabled();
    await expect(
      pilotDisabledCard.getByTestId('student-private-slot-reserve-button')
    ).toHaveText('수업 있음');
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await cleanupFixture(fixture).catch(() => {});
  }
});

test('student sees anonymized busy private and group teacher times', async ({
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 private reservation setup을 실행합니다.');
  test.setTimeout(120000);

  let fixture = null;
  const contexts = [];

  try {
    fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}-busy-visible`);

    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    await loginAsStudentWithPrivateBooking(page, fixture.eligibleStudent.email);

    const privateBusyCards = await expectPrivateBusyCardCount(
      page,
      `${fixture.busyPrivateLessonDate} · ${fixture.busyPrivateLessonTime}`,
      1,
      'eligible student should see one anonymized private lesson busy block'
    );
    const privateBusyCard = privateBusyCards.first();
    await expect(privateBusyCard).toContainText(fixture.teacherKey);
    await expect(privateBusyCard).toContainText(fixture.busyPrivateLessonTime);
    await expect(privateBusyCard).toContainText('수업 있음');
    await expect(privateBusyCard).not.toContainText(fixture.otherStudentName);
    await expect(privateBusyCard).not.toContainText(fixture.busyPrivateSubject);
    await expect(privateBusyCard.locator('button')).toHaveCount(0);

    const groupBusyCards = await expectPrivateBusyCardCount(
      page,
      `${fixture.busyGroupLessonDate} · ${fixture.busyGroupLessonTime}`,
      1,
      'eligible student should see one anonymized group lesson busy block'
    );
    const groupBusyCard = groupBusyCards.first();
    await expect(groupBusyCard).toContainText(fixture.teacherKey);
    await expect(groupBusyCard).toContainText(fixture.busyGroupLessonTime);
    await expect(groupBusyCard).toContainText('수업 있음');
    await expect(groupBusyCard).not.toContainText(fixture.busyGroupClassName);
    await expect(groupBusyCard).not.toContainText(fixture.busyGroupSubject);
    await expect(groupBusyCard.locator('button')).toHaveCount(0);

    await expect(page.locator('body')).not.toContainText(fixture.otherStudentName);
    await expect(page.locator('body')).not.toContainText(fixture.busyPrivateSubject);
    await expect(page.locator('body')).not.toContainText(fixture.busyGroupClassName);
    await expect(page.locator('body')).not.toContainText(fixture.busyGroupSubject);
    await expectPrivateBusyCardCount(
      page,
      `${fixture.otherTeacherBusyDate} · ${fixture.otherTeacherBusyTime}`,
      0,
      'eligible student should not see busy blocks for teachers without package access'
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await cleanupFixture(fixture).catch(() => {});
  }
});

test('student private slot view mode toggles busy and available schedules', async ({
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 private reservation setup을 실행합니다.');
  test.setTimeout(120000);

  let fixture = null;
  const contexts = [];

  try {
    fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}-view-mode`);

    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    await loginAsStudentWithPrivateBooking(page, fixture.eligibleStudent.email);

    await expect(page.getByTestId('private-slot-view-mode-all')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expectPrivateBusyCardCount(
      page,
      `${fixture.busyPrivateLessonDate} · ${fixture.busyPrivateLessonTime}`,
      1,
      'all view should show busy teacher time'
    );
    await expectPrivateSlotCardCount(
      page,
      fixture.date,
      1,
      'all view should show available teacher time'
    );

    await page.getByTestId('private-slot-view-mode-available').click();
    await expect(page.getByTestId('private-slot-view-mode-available')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expectPrivateBusyCardCount(
      page,
      `${fixture.busyPrivateLessonDate} · ${fixture.busyPrivateLessonTime}`,
      0,
      'available-only view should hide busy teacher time'
    );
    await expectPrivateSlotCardCount(
      page,
      fixture.date,
      1,
      'available-only view should keep reservable teacher time'
    );

    await page.getByTestId('private-slot-view-mode-all').click();
    await expectPrivateBusyCardCount(
      page,
      `${fixture.busyPrivateLessonDate} · ${fixture.busyPrivateLessonTime}`,
      1,
      'all view should restore busy teacher time'
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await cleanupFixture(fixture).catch(() => {});
  }
});

test('student sees matching open private slots and anonymized reserved teacher time', async ({
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 private reservation setup을 실행합니다.');
  test.setTimeout(120000);

  let fixture = null;
  const contexts = [];

  try {
    fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}-reserved-visible`);

    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    await loginAsStudentWithPrivateBooking(page, fixture.eligibleStudent.email);

    const openSlotCard = studentSlotCard(page, fixture.date);
    await expect(openSlotCard).toBeVisible({ timeout: 15000 });
    await expect(openSlotCard.getByTestId('student-private-slot-reserve-button')).toHaveText(
      '1:1 수업 예약'
    );

    await expect(
      page.locator(
        `[data-testid="student-private-slot-card"][data-slot-id="${fixture.noRemainingExistingSlotId}"]`
      )
    ).toHaveCount(0);
    const reservedBusyCard = studentBusySlotCard(
      page,
      `${fixture.noRemainingExistingDate} · 10:30`
    );
    await expect(reservedBusyCard).toBeVisible({ timeout: 15000 });
    await expect(reservedBusyCard).toContainText('수업 있음');
    await expect(page.locator('body')).not.toContainText(fixture.noRemainingStudent.displayName);
    await expect(page.locator('body')).not.toContainText(fixture.noRemainingStudent.studentId);
    await expect(page.locator('body')).not.toContainText(
      reservationId(fixture.noRemainingExistingSlotId, fixture.noRemainingStudent.studentId)
    );
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
    const disabledCards = await expectPrivateSlotCardCount(
      disabledPage,
      fixture.date,
      1,
      'eligible student should see the private slot with booking disabled'
    );
    const disabledCard = disabledCards.first();
    await expect(disabledCard).toBeVisible();
    await expect(disabledCard.getByTestId('student-private-slot-reserve-button')).toBeDisabled();
    await expect(disabledCard.getByTestId('student-private-slot-reserve-button')).toHaveText('수업 있음');

    const pilotDisabledContext = await browser.newContext();
    contexts.push(pilotDisabledContext);
    const pilotDisabledPage = await pilotDisabledContext.newPage();
    await loginAsStudentWithPrivateBooking(
      pilotDisabledPage,
      fixture.pilotDisabledStudent.email
    );
    await pilotDisabledPage.getByRole('button', { name: '전체 시간 보기' }).click();
    const pilotDisabledCard = studentPrivateAvailabilityCardById(
      pilotDisabledPage,
      fixture.pilotDisabledSlotId
    );
    await expect(
      pilotDisabledCard,
      'pilot disabled student should see the intended disabled private slot card'
    ).toBeVisible({ timeout: 15000 });
    await expect(pilotDisabledCard).toContainText(fixture.pilotDisabledDate);
    await expect(pilotDisabledCard).toContainText(fixture.pilotDisabledTime);
    await expect(pilotDisabledCard).toContainText('수업 있음');
    const pilotDisabledReserveButton = pilotDisabledCard.getByTestId(
      'student-private-slot-reserve-button'
    );
    if (await pilotDisabledReserveButton.count()) {
      await expect(pilotDisabledReserveButton).toBeDisabled();
      await expect(pilotDisabledReserveButton).toHaveText('수업 있음');
    }
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
    const slotCards = await expectPrivateSlotCardCount(
      eligiblePage,
      fixture.date,
      1,
      'eligible pilot-enabled student should see one private slot card'
    );
    const slotCard = slotCards.first();
    const bookingDialogs = [];
    eligiblePage.on('dialog', async (dialog) => {
      bookingDialogs.push(dialog.message());
      await dialog.accept();
    });
    const eligibleReserveButton = await expectPrivateSlotReserveButtonEnabled(
      eligiblePage,
      slotCard,
      'eligible pilot-enabled student should have an enabled private slot reserve button'
    );
    await expect(eligibleReserveButton).toHaveText('1:1 수업 예약');
    const eligibleAvailability = await listPrivateLessonSlotAvailabilityViaPage(eligiblePage, {
      academyId: DEFAULT_E2E_ACADEMY_ID,
    });
    const eligibleOpenSlot = (eligibleAvailability?.slots || []).find(
      (slot) => slot.id === fixture.slotId
    );
    expect(eligibleOpenSlot, JSON.stringify(eligibleAvailability?.slots || [])).toBeTruthy();
    expect(eligibleOpenSlot).toMatchObject({
      status: 'open',
      isBusy: false,
      isBookable: true,
      isReservable: true,
      bookingStatus: 'available',
      bookingStatusLabel: '예약 가능',
      studentVisibleStatus: 'available',
      studentVisibleStatusLabel: '예약 가능',
      disabledReason: '',
      durationMinutes: 60,
      packageRemainingCount: 1,
      makeupAvailableCount: 1,
    });
    expect(eligibleOpenSlot.packageSummary?.makeupAvailableCount).toBe(1);
    const initialSlotSnap = await db.collection('privateLessonSlots').doc(fixture.slotId).get();
    const initialSlot = initialSlotSnap.data() || {};
    expect(Array.isArray(initialSlot.eligibleStudentIds) ? initialSlot.eligibleStudentIds : []).toEqual([]);
    const initialSummarySnap = await db
      .collection('studentPrivateAccessSummary')
      .doc(privateSummaryId(fixture.eligibleStudent.studentId))
      .get();
    const initialSummary = initialSummarySnap.data() || {};
    expect(initialSummary.teacherKeys).toContain(fixture.teacherKey);
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
    noRemainingPage.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    await loginAsStudentWithPrivateBooking(noRemainingPage, fixture.noRemainingStudent.email);
    const noRemainingBusyCard = noRemainingPage.locator(
      `[data-testid="student-private-busy-slot-card"][data-slot-id="${fixture.noRemainingOpenSlotId}"]`
    );
    await expect(
      noRemainingBusyCard,
      'no-remaining student should see the allowed open private slot as unavailable'
    ).toBeVisible({ timeout: 15000 });
    await expect(noRemainingBusyCard).toContainText('수업 있음');
    await expect(
      noRemainingPage.locator(
        `[data-testid="student-private-slot-card"][data-slot-id="${fixture.noRemainingOpenSlotId}"]`
      )
    ).toHaveCount(0);
    await noRemainingPage.getByTestId('private-slot-view-mode-available').click();
    await expectPrivateBusyCardCount(
      noRemainingPage,
      fixture.noRemainingOpenDate,
      0,
      'available-only view should hide no-remaining unavailable private slot'
    );
    await expectPrivateSlotCardCount(
      noRemainingPage,
      fixture.noRemainingOpenDate,
      0,
      'available-only view should not show no-remaining open private slot'
    );
    expect(
      await getReservation(
        db,
        fixture.noRemainingOpenSlotId,
        fixture.noRemainingStudent.studentId
      )
    ).toBeNull();
    await expectSlotStatus(db, fixture.noRemainingOpenSlotId, 'open');

    const noTicketContext = await browser.newContext();
    contexts.push(noTicketContext);
    const noTicketPage = await noTicketContext.newPage();
    await loginAsStudentWithPrivateBooking(noTicketPage, fixture.noTicketStudent.email);
    const noTicketBusyCard = noTicketPage.locator(
      `[data-testid="student-private-busy-slot-card"][data-slot-id="${fixture.noTicketOpenSlotId}"]`
    );
    await expect(
      noTicketBusyCard,
      'no-ticket student should see teacher schedule as unavailable'
    ).toBeVisible({ timeout: 15000 });
    await expect(noTicketBusyCard).toContainText('수업 있음');
    await expect(
      noTicketPage.locator(
        `[data-testid="student-private-slot-card"][data-slot-id="${fixture.noTicketOpenSlotId}"]`
      )
    ).toHaveCount(0);
    await noTicketPage.getByTestId('private-slot-view-mode-available').click();
    await expectPrivateBusyCardCount(
      noTicketPage,
      fixture.noTicketOpenDate,
      0,
      'available-only view should hide no-ticket unavailable private slot'
    );
    await expectPrivateSlotCardCount(
      noTicketPage,
      fixture.noTicketOpenDate,
      0,
      'available-only view should not show no-ticket open private slot'
    );
    expect(
      await getReservation(
        db,
        fixture.noTicketOpenSlotId,
        fixture.noTicketStudent.studentId
      )
    ).toBeNull();
    await expectSlotStatus(db, fixture.noTicketOpenSlotId, 'open');

    await eligibleReserveButton.click();
    await expect
      .poll(
        () =>
          bookingDialogs.some(
            (message) =>
              message.includes('취소는 수업 시작 6시간 전까지만 가능') &&
              message.includes('예약 취소는 최대 2회')
          ),
        { timeout: 15000 }
      )
      .toBe(true);
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
      teacher: fixture.teacherKey,
      date: fixture.date,
      time: fixture.time,
      durationMinutes: 60,
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
      teacher: fixture.teacherKey,
    });
    await eligiblePage.getByRole('button', { name: '전체 시간 보기' }).click();
    const myReservationCard = privateSlotCardForDateTime(
      eligiblePage,
      fixture.date,
      fixture.time
    )
      .filter({ hasText: '내 예약' })
      .first();
    await expect(
      myReservationCard,
      'reserved slot should remain visible as my reservation'
    ).toBeVisible({ timeout: 15000 });
    await expect(myReservationCard).toContainText('내 예약');
    await expect(myReservationCard).toContainText(fixture.date);
    await expect(myReservationCard).toContainText(fixture.time);
    await expect(
      myReservationCard.getByRole('button', { name: '1:1 수업 예약' }),
      'my reservation card must not be bookable again'
    ).toHaveCount(0);

    await eligiblePage.getByRole('button', { name: '예약 가능한 시간만' }).click();
    await expect(
      bookablePrivateSlotCardForDateTime(eligiblePage, fixture.date, fixture.time),
      'reserved private slot should disappear from the bookable slot list'
    ).toHaveCount(0, { timeout: 15000 });
    await expect(privateReservationCard(eligiblePage, fixture.date)).toBeVisible({
      timeout: 15000,
    });
    const privateHistoryCard = eligiblePage
      .locator('[data-testid="student-lesson-history-card"]')
      .filter({ hasText: fixture.date })
      .filter({ hasText: fixture.teacherKey });
    await expect(
      privateHistoryCard,
      'reserved private slot should remain visible in lesson history'
    ).toHaveCount(1, { timeout: 15000 });
    await expect(privateHistoryCard.first()).toContainText('예약 완료');

    const adminContext = await browser.newContext();
    contexts.push(adminContext);
    const adminPage = await adminContext.newPage();
    await expectAdminDirectReservationCalendarRow(adminPage, fixture);
    await expectTeacherRosterDirectReservationRow(adminPage, fixture);

    const secondContext = await browser.newContext();
    contexts.push(secondContext);
    const secondPage = await secondContext.newPage();
    secondPage.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    await loginAsStudentWithPrivateBooking(secondPage, fixture.ineligibleStudent.email);
    await expect(
      secondPage.locator('[data-testid="student-private-slot-card"]').filter({ hasText: fixture.date })
    ).toHaveCount(0);
    expect(await getReservation(db, fixture.slotId, fixture.ineligibleStudent.studentId)).toBeNull();

    const reservationCard = privateReservationCard(eligiblePage, fixture.date);
    await expect(reservationCard).toBeVisible({ timeout: 15000 });
    await reservationCard.getByTestId('student-private-reservation-cancel-button').click();
    await expect
      .poll(
        () =>
          bookingDialogs.some(
            (message) =>
              message.includes('취소 사용 0/2회') &&
              message.includes('남은 취소 가능 2회') &&
              message.includes('이번 취소 후 남은 취소 가능 1회') &&
              message.includes('이 취소도 횟수에 포함')
          ),
        { timeout: 15000 }
      )
      .toBe(true);
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
      teacher: fixture.teacherKey,
    });

    const reopenedSlotCards = await expectPrivateSlotCardCount(
      eligiblePage,
      fixture.date,
      1,
      'eligible student should see the reopened private slot after cancellation'
    );
    const reopenedSlotCard = reopenedSlotCards.first();
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
        status: 'open',
        reservedCount: 0,
        eligibleStudentIds: [fixture.ineligibleStudent.studentId],
        reservedStudentId: '',
        reservationId: '',
        reservedAt: null,
        slotType: 'open',
        fixedStudentId: '',
        fixedStudentName: '',
        releasedFromFixed: false,
        releasedByStudentId: '',
        releaseReason: '',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await db.collection('studentPackages').doc(fixture.ineligibleStudent.packageId).set(
      {
        teacher: fixture.teacherKey,
        teacherName: fixture.teacherKey,
        status: 'active',
        totalCount: 2,
        usedCount: 0,
        remainingCount: 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await db.collection('studentPrivateAccessSummary').doc(
      privateSummaryId(fixture.ineligibleStudent.studentId)
    ).set(
      {
        teacherKeys: [fixture.teacherKey],
        activePackageIds: [fixture.ineligibleStudent.packageId],
        allowedSlotIds: [fixture.slotId],
        allowedPrivateLessonSlotIds: [fixture.slotId],
        privateSlotBookingPilotEnabled: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    const legacySlotSnap = await db.collection('privateLessonSlots').doc(fixture.slotId).get();
    const legacySlot = legacySlotSnap.data() || {};
    expect(legacySlot.status).toBe('open');
    expect(Array.isArray(legacySlot.eligibleStudentIds) ? legacySlot.eligibleStudentIds : []).toContain(
      fixture.ineligibleStudent.studentId
    );
    await expectPrivateSummaryAllowsSlot(
      db,
      fixture.ineligibleStudent.studentId,
      fixture.slotId
    );
    await secondPage.reload();
    const legacySlotCards = await expectPrivateSlotCardCount(
      secondPage,
      fixture.date,
      1,
      'legacy eligible student should see the reopened private slot after reload'
    );
    await legacySlotCards.first()
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

test('student cancellation reopens normal private slot for another eligible student', async ({
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
    fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}-normal-reopen`);

    const studentAContext = await browser.newContext();
    contexts.push(studentAContext);
    const studentAPage = await studentAContext.newPage();
    studentAPage.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    await loginAsStudentWithPrivateBooking(studentAPage, fixture.eligibleStudent.email);
    const initialSlotCards = await expectPrivateSlotCardCount(
      studentAPage,
      fixture.date,
      1,
      'student A should see the normal private slot before reservation'
    );
    const initialReserveButton = await expectPrivateSlotReserveButtonEnabled(
      studentAPage,
      initialSlotCards.first(),
      'student A should be able to reserve the normal private slot'
    );
    await initialReserveButton.click();
    await expectReservationStatus(
      db,
      fixture.slotId,
      fixture.eligibleStudent.studentId,
      'active'
    );
    const studentAReservation = await getReservation(
      db,
      fixture.slotId,
      fixture.eligibleStudent.studentId
    );
    expect(Number(studentAReservation?.durationMinutes || 0)).toBe(60);

    const studentAReservationCard = privateReservationCard(studentAPage, fixture.date);
    await expect(studentAReservationCard).toBeVisible({ timeout: 15000 });
    await studentAReservationCard.getByTestId('student-private-reservation-cancel-button').click();
    await expectReservationStatus(
      db,
      fixture.slotId,
      fixture.eligibleStudent.studentId,
      'cancelled'
    );
    await expectSlotStatus(db, fixture.slotId, 'open');

    await Promise.all([
      db.collection('privateLessonSlots').doc(fixture.slotId).set(
        {
          eligibleStudentIds: [fixture.ineligibleStudent.studentId],
          reservedStudentId: '',
          reservationId: '',
          reservedCount: 0,
          status: 'open',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
      db.collection('studentPackages').doc(fixture.ineligibleStudent.packageId).set(
        {
          teacher: fixture.teacherKey,
          teacherName: fixture.teacherKey,
          status: 'active',
          totalCount: 2,
          usedCount: 0,
          remainingCount: 2,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
      db.collection('studentPrivateAccessSummary').doc(
        privateSummaryId(fixture.ineligibleStudent.studentId)
      ).set(
        {
          teacherKeys: [fixture.teacherKey],
          activePackageIds: [fixture.ineligibleStudent.packageId],
          allowedSlotIds: [fixture.slotId],
          allowedPrivateLessonSlotIds: [fixture.slotId],
          privateSlotBookingPilotEnabled: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
    ]);

    const studentBContext = await browser.newContext();
    contexts.push(studentBContext);
    const studentBPage = await studentBContext.newPage();
    studentBPage.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    await loginAsStudentWithPrivateBooking(studentBPage, fixture.ineligibleStudent.email);
    const reopenedSlotCards = await expectPrivateSlotCardCount(
      studentBPage,
      fixture.date,
      1,
      'student B should see the reopened normal private slot'
    );
    const reopenedSlotCard = reopenedSlotCards.first();
    await expect(reopenedSlotCard).toContainText('예약 가능');
    await expect(reopenedSlotCard).toContainText('60분');
    const studentBReserveButton = await expectPrivateSlotReserveButtonEnabled(
      studentBPage,
      reopenedSlotCard,
      'student B should be able to reserve the reopened normal private slot'
    );
    await studentBReserveButton.click();
    await expectReservationStatus(
      db,
      fixture.slotId,
      fixture.ineligibleStudent.studentId,
      'active'
    );
    const studentBReservation = await getReservation(
      db,
      fixture.slotId,
      fixture.ineligibleStudent.studentId
    );
    expect(Number(studentBReservation?.durationMinutes || 0)).toBe(60);
    await expectReservationStatus(
      db,
      fixture.slotId,
      fixture.eligibleStudent.studentId,
      'cancelled'
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await cleanupFixture(fixture).catch(() => {});
  }
});

test('stale cancelled normal private slot is bookable for another eligible student', async ({
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
    fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}-normal-stale`);

    const studentAContext = await browser.newContext();
    contexts.push(studentAContext);
    const studentAPage = await studentAContext.newPage();
    studentAPage.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    await loginAsStudentWithPrivateBooking(studentAPage, fixture.eligibleStudent.email);
    const initialSlotCards = await expectPrivateSlotCardCount(
      studentAPage,
      fixture.date,
      1,
      'student A should see the normal private slot before stale regression setup'
    );
    await initialSlotCards.first().getByTestId('student-private-slot-reserve-button').click();
    await expectReservationStatus(
      db,
      fixture.slotId,
      fixture.eligibleStudent.studentId,
      'active'
    );
    const studentAReservationId = reservationId(fixture.slotId, fixture.eligibleStudent.studentId);
    await db.collection('privateLessonReservations').doc(studentAReservationId).set(
      {
        status: 'cancelled',
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await expectReservationStatus(
      db,
      fixture.slotId,
      fixture.eligibleStudent.studentId,
      'cancelled'
    );
    await expectSlotStatus(db, fixture.slotId, 'reserved');

    await Promise.all([
      db.collection('privateLessonSlots').doc(fixture.slotId).set(
        {
          eligibleStudentIds: [fixture.ineligibleStudent.studentId],
          reservedStudentId: fixture.eligibleStudent.studentId,
          reservationId: studentAReservationId,
          reservedCount: 1,
          status: 'reserved',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
      db.collection('studentPackages').doc(fixture.ineligibleStudent.packageId).set(
        {
          teacher: fixture.teacherKey,
          teacherName: fixture.teacherKey,
          status: 'active',
          totalCount: 2,
          usedCount: 0,
          remainingCount: 2,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
      db.collection('studentPrivateAccessSummary').doc(
        privateSummaryId(fixture.ineligibleStudent.studentId)
      ).set(
        {
          teacherKeys: [fixture.teacherKey],
          activePackageIds: [fixture.ineligibleStudent.packageId],
          allowedSlotIds: [fixture.slotId],
          allowedPrivateLessonSlotIds: [fixture.slotId],
          privateSlotBookingPilotEnabled: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
    ]);

    const studentBContext = await browser.newContext();
    contexts.push(studentBContext);
    const studentBPage = await studentBContext.newPage();
    studentBPage.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    await loginAsStudentWithPrivateBooking(studentBPage, fixture.ineligibleStudent.email);
    const reopenedSlotCards = await expectPrivateSlotCardCount(
      studentBPage,
      fixture.date,
      1,
      'student B should see stale cancelled normal private slot as available'
    );
    const reopenedSlotCard = reopenedSlotCards.first();
    await expect(reopenedSlotCard).toContainText('예약 가능');
    await expect(reopenedSlotCard).toContainText('60분');
    await reopenedSlotCard.getByTestId('student-private-slot-reserve-button').click();
    await expectReservationStatus(
      db,
      fixture.slotId,
      fixture.ineligibleStudent.studentId,
      'active'
    );
    const studentBReservation = await getReservation(
      db,
      fixture.slotId,
      fixture.ineligibleStudent.studentId
    );
    expect(Number(studentBReservation?.durationMinutes || 0)).toBe(60);
    await expectReservationStatus(
      db,
      fixture.slotId,
      fixture.eligibleStudent.studentId,
      'cancelled'
    );
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
        teacher: fixture.teacherKey,
        teacherName: fixture.teacherKey,
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
        teacher: fixture.teacherKey,
        teacherName: fixture.teacherKey,
        date: nearStart.date,
        time: nearStart.time,
        startAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 5 * 60 * 60 * 1000)),
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
    const upcomingReservationCard = page
      .locator('[data-testid="student-upcoming-private-lesson-card"][data-source="privateReservation"]')
      .filter({ hasText: nearStart.date })
      .first();
    await expect(upcomingReservationCard).toBeVisible({ timeout: 15000 });
    await expect(upcomingReservationCard).toContainText('수업 시작 6시간 전까지만 취소할 수 있습니다.');
    await expect(
      upcomingReservationCard.getByTestId('student-upcoming-private-reservation-cancel-button')
    ).toBeDisabled();
    const reservationCard = privateReservationCard(page, nearStart.date);
    await expect(reservationCard).toBeVisible({ timeout: 15000 });
    await expect(reservationCard).toContainText('수업 시작 6시간 전까지만 취소할 수 있습니다.');
    await expect(reservationCard.getByTestId('student-private-reservation-cancel-button')).toBeDisabled();
    expect(dialogs).toEqual([]);
    await expectReservationStatus(db, nearSlotId, fixture.eligibleStudent.studentId, 'active');
    await expectPrivateBookingStatsCount(db, fixture.eligibleStudent.studentId, 0);
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await cleanupFixture(fixture).catch(() => {});
  }
});

test('student flexible private cancellation limit allows 2 and blocks third', async ({
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
    await db.collection('studentPrivateAccessSummary').doc(
      privateSummaryId(fixture.eligibleStudent.studentId)
    ).set(
      {
        allowedSlotIds: [fixture.slotId],
        allowedPrivateLessonSlotIds: [fixture.slotId],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
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

    for (let index = 1; index <= 2; index += 1) {
      const slotCards = await expectPrivateSlotCardCount(
        page,
        fixture.date,
        1,
        `slot should be visible before reservation attempt ${index}`
      );
      const slotCard = slotCards.first();
      const reserveButton = slotCard.getByTestId('student-private-slot-reserve-button');
      await expect(
        reserveButton,
        `reserve button should be enabled before attempt ${index}`
      ).toBeEnabled();
      await expect(reserveButton).toHaveText('1:1 수업 예약');
      await reserveButton.click();
      await expectReservationStatus(db, fixture.slotId, fixture.eligibleStudent.studentId, 'active');

      const reservationCard = privateReservationCard(page, fixture.date);
      await expect(reservationCard).toBeVisible({ timeout: 15000 });
      await reservationCard.getByTestId('student-private-reservation-cancel-button').click();
      await expectReservationStatus(db, fixture.slotId, fixture.eligibleStudent.studentId, 'cancelled');
      await expectSlotStatus(db, fixture.slotId, 'open');
      await expectPrivateBookingStatsCount(db, fixture.eligibleStudent.studentId, index);
      await expect(
        page.locator('[data-testid="student-private-reservation-card"]').filter({ hasText: fixture.date }),
        `reservation card should disappear after cancellation ${index}`
      ).toHaveCount(0, { timeout: 15000 });
      await expectPrivateSlotCardCount(
        page,
        fixture.date,
        1,
        `slot should reappear after cancellation ${index}`
      );
    }

    const slotCards = await expectPrivateSlotCardCount(
      page,
      fixture.date,
      1,
      'slot should be visible before reservation attempt 3'
    );
    const slotCard = slotCards.first();
    const reserveButton = slotCard.getByTestId('student-private-slot-reserve-button');
    await expect(reserveButton, 'reserve button should be enabled before attempt 3').toBeEnabled();
    await expect(reserveButton).toHaveText('1:1 수업 예약');
    await reserveButton.click();
    await expectReservationStatus(db, fixture.slotId, fixture.eligibleStudent.studentId, 'active');

    const reservationCard = privateReservationCard(page, fixture.date);
    await expect(reservationCard).toBeVisible({ timeout: 15000 });
    await expect(reservationCard).toContainText('취소 가능 횟수를 모두 사용했습니다. 학원에 문의해 주세요.');
    await expect(reservationCard.getByTestId('student-private-reservation-cancel-button')).toBeDisabled();
    expect(dialogs.filter((message) => message.includes('예약 취소 가능 횟수를 모두 사용'))).toEqual([]);
    await expectReservationStatus(db, fixture.slotId, fixture.eligibleStudent.studentId, 'active');
    await expectPrivateBookingStatsCount(db, fixture.eligibleStudent.studentId, 2);
    await expectNotificationEvent(db, {
      type: 'private_slot_reserved',
      slotId: fixture.slotId,
      studentId: fixture.eligibleStudent.studentId,
      reservationId: expectedReservationId,
      teacher: fixture.teacherKey,
    });
    await expectNotificationEvent(db, {
      type: 'private_slot_cancelled',
      slotId: fixture.slotId,
      studentId: fixture.eligibleStudent.studentId,
      reservationId: expectedReservationId,
      teacher: fixture.teacherKey,
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await cleanupFixture(fixture).catch(() => {});
  }
});

test('private schedule overlap helper detects partial time conflicts', async () => {
  const overlap = await import('../src/features/booking/privateScheduleOverlap.js');
  const teacher = {
    academyId: 'academy-1',
    teacherUid: 'don-uid',
    teacherKey: 'don1',
    teacherName: 'Don',
  };
  const existingReservation = {
    ...teacher,
    date: '2026-06-01',
    time: '23:30',
    durationMinutes: 50,
    status: 'active',
  };
  const overlappingSlot = {
    ...teacher,
    date: '2026-06-01',
    time: '23:10',
    durationMinutes: 50,
    status: 'open',
  };
  const nonOverlappingSlot = {
    ...teacher,
    date: '2026-06-01',
    time: '21:00',
    durationMinutes: 50,
    status: 'open',
  };
  const otherTeacherSlot = {
    academyId: 'academy-1',
    teacherName: 'Other',
    date: '2026-06-01',
    time: '23:10',
    durationMinutes: 50,
    status: 'open',
  };

  expect(overlap.privateSchedulesOverlap(overlappingSlot, existingReservation)).toBe(true);
  expect(overlap.privateSchedulesOverlap(nonOverlappingSlot, existingReservation)).toBe(false);
  expect(overlap.privateSchedulesOverlap(otherTeacherSlot, existingReservation)).toBe(false);
  expect(overlap.isActivePrivateReservation({ status: 'active' })).toBe(true);
  expect(overlap.isActivePrivateReservation({ status: 'reserved' })).toBe(true);
  expect(overlap.isActivePrivateReservation({ status: 'cancelled' })).toBe(false);
  expect(overlap.isTeacherBlockingScheduleRow({ status: 'cancelled', date: '2026-06-01', time: '23:30' })).toBe(
    false
  );
  expect(overlap.isTeacherBlockingScheduleRow(existingReservation)).toBe(true);
});

test('private slot overlap guard is wired through availability and reservation callables', async () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');
  expect(source).toContain('function privateSchedulesOverlap(');
  expect(source).toContain('function hasTeacherScheduleConflict(');
  expect(source).toContain('function isBlockingPrivateLessonForAvailability(lesson)');
  expect(source).toMatch(
    /function isReleasedFixedPrivateSeatLesson[\s\S]*cancellationType === "seat_released"/
  );
  expect(source).toMatch(
    /function isCancelledLessonStatus[\s\S]*normalized === "cancelled"[\s\S]*normalized === "canceled"/
  );
  expect(source).toMatch(
    /function isBlockingPrivateLessonForAvailability[\s\S]*cancellationType === "lesson_cancelled"[\s\S]*return false/
  );
  expect(source).toMatch(
    /addBusyRowsFromQuerySnapshot[\s\S]*source === "lessons"[\s\S]*!isBlockingPrivateLessonForAvailability\(row\)/
  );
  expect(source).toMatch(
    /hasTeacherScheduleConflict[\s\S]*docSnap\.ref\.parent\.id === "lessons"[\s\S]*!isBlockingPrivateLessonForAvailability\(row\)/
  );
  expect(source).not.toContain('function hasTeacherExactConflict(');
  expect(source).toMatch(
    /listPrivateLessonSlotAvailability[\s\S]*markOverlappingPrivateSlotBusy/
  );
  expect(source).toMatch(
    /reservePrivateLessonSlot[\s\S]*hasTeacherScheduleConflict[\s\S]*slot-not-available/
  );
  expect(source).toMatch(
    /reservePrivateLessonSlot[\s\S]*durationMinutes: getPrivateScheduleDurationMinutes\(slot\)/
  );
  expect(source).toContain('function buildReleasedFixedPrivateSlotId(lessonId)');
  expect(source).toContain('function loadReleasedFixedPrivateLessonSlots(db,');
  expect(source).toContain('function parseReleasedFixedPrivateSlotId(slotId)');
  expect(source).toMatch(
    /listPrivateLessonSlotAvailability[\s\S]*releasedRowsByKey[\s\S]*busyRowsByKey\.delete\(key\)/
  );
  expect(source).toMatch(
    /reservePrivateLessonSlot[\s\S]*parseReleasedFixedPrivateSlotId\(slotId\)[\s\S]*buildSlotFromReleasedFixedPrivateLesson/
  );
  expect(source).toMatch(
    /cancelFixedPrivateLessonOccurrence[\s\S]*cancellationType === "seat_released"[\s\S]*transaction\.set\([\s\S]*releasedSlotRef/
  );
  expect(source).toMatch(
    /function privateSlotBelongsToCancelledReservation[\s\S]*slotReservationId[\s\S]*reservedStudentId/
  );
  expect(source).toContain('ACTIVE_PRIVATE_RESERVATION_STATUSES');
});

function getFirebaseConfigFromEnv() {
  return {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
  };
}

async function reservePrivateLessonSlotViaPage(page, { academyId, slotId }) {
  return page.evaluate(
    async ({ firebaseConfig, academyId, slotId }) => {
      const [{ getApp, getApps, initializeApp }, authModule, functionsModule] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js'),
      ]);
      const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
      const auth = authModule.getAuth(app);
      if (!auth.currentUser) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Auth user not ready.')), 15000);
          const unsubscribe = authModule.onAuthStateChanged(auth, (user) => {
            if (!user) return;
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          });
        });
      }
      const functions = functionsModule.getFunctions(app, 'us-central1');
      const reservePrivateLessonSlot = functionsModule.httpsCallable(functions, 'reservePrivateLessonSlot');
      try {
        const result = await reservePrivateLessonSlot({
          academyId,
          slotId,
          privateSlotBooking: 'enabled',
        });
        return { ok: true, data: result.data };
      } catch (error) {
        return {
          ok: false,
          code: error?.code || '',
          message: error?.message || '',
        };
      }
    },
    {
      firebaseConfig: getFirebaseConfigFromEnv(),
      academyId,
      slotId,
    }
  );
}

async function createOverlapFixture(unique) {
  const db = getDb();
  const auth = getAuth();
  const nowTs = admin.firestore.Timestamp.now();
  const teacherKey = 'don1';
  const teacherUid = `don-uid-${unique}`;
  const date = upcomingMondaySaturdayYmd(1);
  const existingTime = '23:30';
  const overlappingTime = '23:10';
  const openTime = '21:00';
  const existingSlotId = `e2e-overlap-existing-${unique}`;
  const overlappingSlotId = `e2e-overlap-open-${unique}`;
  const openSlotId = `e2e-overlap-clear-${unique}`;
  const existingReservationDocId = reservationId(existingSlotId, `other-student-${unique}`);
  const studentId = `e2e-overlap-student-${unique}`;
  const bookingOpensAt = admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
  const bookingClosesAt = admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const student = await createStudentFixture(db, auth, {
    unique,
    roleName: 'overlap',
    studentId,
    teacherAccess: true,
    teacherKey,
    allowedSlotIds: [overlappingSlotId, openSlotId],
    paidLessons: 2,
    privateSlotBookingPilotEnabled: true,
  });

  await Promise.all([
    db.collection('privateLessonSlots').doc(existingSlotId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: teacherKey,
      teacherKey,
      teacherUid,
      teacherName: 'Don',
      date,
      time: existingTime,
      subject: `E2E Overlap Existing ${unique}`,
      capacity: 1,
      reservedCount: 1,
      durationMinutes: 50,
      status: 'reserved',
      reservedStudentId: `other-student-${unique}`,
      reservationId: existingReservationDocId,
      bookingOpensAt,
      bookingClosesAt,
      createdByUid: 'e2e-admin-sdk',
      createdAt: nowTs,
      updatedAt: nowTs,
      reservedAt: nowTs,
      cancelledAt: null,
    }),
    db.collection('privateLessonReservations').doc(existingReservationDocId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      slotId: existingSlotId,
      studentId: `other-student-${unique}`,
      studentName: `Other Student ${unique}`,
      teacher: teacherKey,
      teacherKey,
      teacherUid,
      teacherName: 'Don',
      date,
      time: existingTime,
      status: 'active',
      source: 'student',
      reservedAt: nowTs,
      cancelledAt: null,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('privateLessonSlots').doc(overlappingSlotId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: teacherKey,
      teacherKey,
      teacherUid,
      teacherName: 'Don',
      date,
      time: overlappingTime,
      subject: `E2E Overlap Candidate ${unique}`,
      capacity: 1,
      reservedCount: 0,
      durationMinutes: 50,
      status: 'open',
      bookingOpensAt,
      bookingClosesAt,
      createdByUid: 'e2e-admin-sdk',
      createdAt: nowTs,
      updatedAt: nowTs,
      reservedAt: null,
      cancelledAt: null,
    }),
    db.collection('privateLessonSlots').doc(openSlotId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: teacherKey,
      teacherKey,
      teacherUid,
      teacherName: 'Don',
      date,
      time: openTime,
      subject: `E2E Overlap Clear ${unique}`,
      capacity: 1,
      reservedCount: 0,
      durationMinutes: 50,
      status: 'open',
      bookingOpensAt,
      bookingClosesAt,
      createdByUid: 'e2e-admin-sdk',
      createdAt: nowTs,
      updatedAt: nowTs,
      reservedAt: null,
      cancelledAt: null,
    }),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(studentId)).set(
      {
        teacherKeys: [teacherKey],
        activePackageIds: [student.packageId],
        allowedSlotIds: [overlappingSlotId, openSlotId],
        allowedPrivateLessonSlotIds: [overlappingSlotId, openSlotId],
        privateSlotBookingPilotEnabled: true,
        updatedAt: nowTs,
      },
      { merge: true }
    ),
  ]);

  return {
    student,
    teacherKey,
    teacherUid,
    date,
    existingTime,
    overlappingTime,
    openTime,
    existingSlotId,
    overlappingSlotId,
    openSlotId,
    existingReservationDocId,
  };
}

async function cleanupOverlapFixture(fixture) {
  if (!fixture) return;
  const db = getDb();
  const auth = getAuth();
  const refs = [
    db.collection('privateLessonSlots').doc(fixture.existingSlotId),
    db.collection('privateLessonSlots').doc(fixture.overlappingSlotId),
    db.collection('privateLessonSlots').doc(fixture.openSlotId),
    db.collection('privateLessonReservations').doc(fixture.existingReservationDocId),
    db.collection('privateLessonReservations').doc(
      reservationId(fixture.overlappingSlotId, fixture.student.studentId)
    ),
    db.collection('privateLessonReservations').doc(
      reservationId(fixture.openSlotId, fixture.student.studentId)
    ),
    db.collection('privateStudents').doc(fixture.student.studentId),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(fixture.student.studentId)),
    db.collection('studentPrivateBookingStats').doc(privateBookingStatsId(fixture.student.studentId)),
    db.collection('studentPackages').doc(fixture.student.packageId),
    db.collection('users').doc(fixture.student.uid),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${fixture.student.uid}`),
  ];
  await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
  await auth.deleteUser(fixture.student.uid).catch(() => {});
}

async function createWeeklyTemplateFixture(unique) {
  const db = getDb();
  const auth = getAuth();
  const nowTs = admin.firestore.Timestamp.now();
  const teacherKey = `miketest-${unique}`;
  const teacherName = 'miketest';
  const teacherUid = `uid-weekly-template-${unique}`;
  const publicDate = upcomingMondaySaturdayYmd(1);
  const fixedConflictDate = upcomingMondaySaturdayYmd(2);
  const hiddenDate = upcomingMondaySaturdayYmd(3);
  const publicTime = '13:00';
  const fixedConflictTime = '21:20';
  const hiddenTime = '21:30';
  const publicTemplateId = `template-public-direct-${unique}`;
  const fixedConflictTemplateId = `template-fixed-conflict-${unique}`;
  const hiddenTemplateId = `template-fixed-only-${unique}`;
  const publicSlotId = templateSlotId(publicTemplateId, publicDate, publicTime);
  const fixedConflictSlotId = templateSlotId(
    fixedConflictTemplateId,
    fixedConflictDate,
    fixedConflictTime
  );
  const hiddenSlotId = templateSlotId(hiddenTemplateId, hiddenDate, hiddenTime);
  const fixedLessonId = `lesson-template-fixed-conflict-${unique}`;
  const studentA = await createStudentFixture(db, auth, {
    unique,
    roleName: 'template-a',
    studentId: `e2e-template-student-a-${unique}`,
    teacherAccess: true,
    teacherKey,
    allowedSlotIds: [],
    paidLessons: 2,
    privateSlotBookingPilotEnabled: true,
  });
  const studentB = await createStudentFixture(db, auth, {
    unique,
    roleName: 'template-b',
    studentId: `e2e-template-student-b-${unique}`,
    teacherAccess: true,
    teacherKey,
    allowedSlotIds: [],
    paidLessons: 2,
    privateSlotBookingPilotEnabled: true,
  });

  const baseTemplate = {
    academyId: DEFAULT_E2E_ACADEMY_ID,
    teacher: teacherKey,
    teacherName,
    teacherKey,
    teacherUid,
    teacherEmail: `${teacherKey}@example.com`,
    durationMinutes: 60,
    status: 'active',
    createdAt: nowTs,
    updatedAt: nowTs,
  };

  await Promise.all([
    db.collection('teachers').doc(`teacher-${teacherKey}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: teacherName,
      teacherName: teacherKey,
      teacherKey,
      teacherUid,
      teacherEmail: `${teacherKey}@example.com`,
      status: 'active',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('studentPackages').doc(studentA.packageId).set(
      {
        teacher: teacherKey,
        teacherName,
        teacherKey,
        teacherUid,
        totalCount: 2,
        usedCount: 0,
        remainingCount: 2,
        updatedAt: nowTs,
      },
      { merge: true }
    ),
    db.collection('studentPackages').doc(studentB.packageId).set(
      {
        teacher: teacherKey,
        teacherName,
        teacherKey,
        teacherUid,
        totalCount: 2,
        usedCount: 0,
        remainingCount: 2,
        updatedAt: nowTs,
      },
      { merge: true }
    ),
    db.collection('privateLessonAvailabilityTemplates').doc(publicTemplateId).set({
      ...baseTemplate,
      weekday: getSeoulWeekdayNumber(publicDate),
      time: publicTime,
      effectiveStartDate: publicDate,
      effectiveEndDate: publicDate,
      useForFixedAssignment: true,
      openForStudentBooking: true,
    }),
    db.collection('privateLessonAvailabilityTemplates').doc(fixedConflictTemplateId).set({
      ...baseTemplate,
      weekday: getSeoulWeekdayNumber(fixedConflictDate),
      time: fixedConflictTime,
      effectiveStartDate: fixedConflictDate,
      effectiveEndDate: fixedConflictDate,
      useForFixedAssignment: true,
      openForStudentBooking: true,
    }),
    db.collection('privateLessonAvailabilityTemplates').doc(hiddenTemplateId).set({
      ...baseTemplate,
      weekday: getSeoulWeekdayNumber(hiddenDate),
      time: hiddenTime,
      effectiveStartDate: hiddenDate,
      effectiveEndDate: hiddenDate,
      // Legacy fixed-assignment-only behavior: omitted openForStudentBooking means not public.
    }),
    db.collection('lessons').doc(fixedLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: teacherKey,
      teacherName,
      teacherKey,
      teacherUid,
      studentId: `fixed-student-${unique}`,
      studentName: `Fixed Student ${unique}`,
      date: fixedConflictDate,
      time: fixedConflictTime,
      durationMinutes: 60,
      subject: `Fixed conflict ${unique}`,
      packageType: 'private',
      sourceType: 'fixed-private-slot-assignment',
      status: 'approved',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
  ]);

  return {
    teacherKey,
    teacherName,
    teacherUid,
    studentA,
    studentB,
    publicDate,
    publicTime,
    publicTemplateId,
    publicSlotId,
    fixedConflictDate,
    fixedConflictTime,
    fixedConflictTemplateId,
    fixedConflictSlotId,
    hiddenDate,
    hiddenTime,
    hiddenTemplateId,
    hiddenSlotId,
    fixedLessonId,
  };
}

async function cleanupWeeklyTemplateFixture(fixture) {
  if (!fixture) return;
  const db = getDb();
  const auth = getAuth();
  const refs = [
    db.collection('teachers').doc(`teacher-${fixture.teacherKey}`),
    db.collection('privateLessonAvailabilityTemplates').doc(fixture.publicTemplateId),
    db.collection('privateLessonAvailabilityTemplates').doc(fixture.fixedConflictTemplateId),
    db.collection('privateLessonAvailabilityTemplates').doc(fixture.hiddenTemplateId),
    db.collection('privateLessonSlots').doc(fixture.publicSlotId),
    db.collection('privateLessonSlots').doc(fixture.fixedConflictSlotId),
    db.collection('privateLessonSlots').doc(fixture.hiddenSlotId),
    db.collection('lessons').doc(fixture.fixedLessonId),
    db.collection('privateLessonReservations').doc(
      reservationId(fixture.publicSlotId, fixture.studentA.studentId)
    ),
    db.collection('privateLessonReservations').doc(
      reservationId(fixture.publicSlotId, fixture.studentB.studentId)
    ),
    db.collection('privateStudents').doc(fixture.studentA.studentId),
    db.collection('privateStudents').doc(fixture.studentB.studentId),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(fixture.studentA.studentId)),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(fixture.studentB.studentId)),
    db.collection('studentPrivateBookingStats').doc(privateBookingStatsId(fixture.studentA.studentId)),
    db.collection('studentPrivateBookingStats').doc(privateBookingStatsId(fixture.studentB.studentId)),
    db.collection('studentPackages').doc(fixture.studentA.packageId),
    db.collection('studentPackages').doc(fixture.studentB.packageId),
    db.collection('users').doc(fixture.studentA.uid),
    db.collection('users').doc(fixture.studentB.uid),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${fixture.studentA.uid}`),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${fixture.studentB.uid}`),
  ];
  const notificationSnap = await db
    .collection('notificationEvents')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('slotId', '==', fixture.publicSlotId)
    .get()
    .catch(() => null);
  notificationSnap?.docs.forEach((docSnap) => refs.push(docSnap.ref));
  await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
  await Promise.all([
    auth.deleteUser(fixture.studentA.uid).catch(() => {}),
    auth.deleteUser(fixture.studentB.uid).catch(() => {}),
  ]);
}

test('public weekly availability templates are bookable and blocked after reservation', async ({
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 weekly template setup을 실행합니다.');
  test.setTimeout(180000);

  const db = getDb();
  let fixture = null;
  const contexts = [];

  try {
    fixture = await createWeeklyTemplateFixture(`${Date.now()}-${testInfo.workerIndex}-template`);

    const studentAContext = await browser.newContext();
    contexts.push(studentAContext);
    const studentAPage = await studentAContext.newPage();
    studentAPage.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    await loginAsStudentWithPrivateBooking(studentAPage, fixture.studentA.email);

    const availability = await listPrivateLessonSlotAvailabilityViaPage(studentAPage, {
      academyId: DEFAULT_E2E_ACADEMY_ID,
    });
    const availabilitySlots = availability?.slots || [];
    const publicSlot = availabilitySlots.find((slot) => slot.id === fixture.publicSlotId);
    expect(publicSlot).toMatchObject({
      id: fixture.publicSlotId,
      availabilityTemplateId: fixture.publicTemplateId,
      isGeneratedFromTemplate: true,
      isBookable: true,
      date: fixture.publicDate,
      time: fixture.publicTime,
    });
    expect(availabilitySlots.some((slot) => slot.id === fixture.hiddenSlotId)).toBe(false);
    expect(availabilitySlots.some((slot) => slot.id === fixture.fixedConflictSlotId)).toBe(false);

    await studentAPage.getByRole('button', { name: '예약 가능한 시간만' }).click();
    const publicCards = studentAPage
      .locator(`[data-testid="student-private-slot-card"][data-slot-id="${fixture.publicSlotId}"]`);
    await expect(publicCards, 'public weekly template should be shown as bookable').toHaveCount(1, {
      timeout: 15000,
    });
    await expect(publicCards.first()).toContainText(fixture.publicTime);
    await expect(
      studentAPage.locator(`[data-testid="student-private-slot-card"][data-slot-id="${fixture.hiddenSlotId}"]`)
    ).toHaveCount(0);
    await expect(
      studentAPage.locator(`[data-testid="student-private-slot-card"][data-slot-id="${fixture.fixedConflictSlotId}"]`)
    ).toHaveCount(0);

    await publicCards.first().getByTestId('student-private-slot-reserve-button').click();
    await expectReservationStatus(db, fixture.publicSlotId, fixture.studentA.studentId, 'active');
    await expectSlotStatus(db, fixture.publicSlotId, 'reserved');
    const materializedSlotSnap = await db.collection('privateLessonSlots').doc(fixture.publicSlotId).get();
    expect(materializedSlotSnap.exists).toBe(true);
    expect(materializedSlotSnap.data()).toMatchObject({
      availabilityTemplateId: fixture.publicTemplateId,
      isGeneratedFromTemplate: true,
      openForStudentBooking: true,
      status: 'reserved',
      reservedStudentId: fixture.studentA.studentId,
    });

    await studentAPage.getByRole('button', { name: '전체 시간 보기' }).click();
    const studentAMyReservationCard = studentAPage
      .locator(`[data-testid="student-private-slot-card"][data-slot-id="${fixture.publicSlotId}"]`)
      .filter({ hasText: fixture.publicTime });
    await expect(studentAMyReservationCard, 'student A should still see the booked template slot').toHaveCount(1, {
      timeout: 15000,
    });
    await expect(studentAMyReservationCard.first()).toContainText('내 예약');

    const studentBContext = await browser.newContext();
    contexts.push(studentBContext);
    const studentBPage = await studentBContext.newPage();
    await loginAsStudentWithPrivateBooking(studentBPage, fixture.studentB.email);
    await studentBPage.getByRole('button', { name: '예약 가능한 시간만' }).click();
    await expect(
      studentBPage.locator(`[data-testid="student-private-slot-card"][data-slot-id="${fixture.publicSlotId}"]`)
    ).toHaveCount(0, { timeout: 15000 });
    await expect(
      studentBPage.locator('[data-testid="student-private-busy-slot-card"]').filter({ hasText: fixture.publicTime })
    ).toHaveCount(0, { timeout: 15000 });
    const studentBAvailability = await listPrivateLessonSlotAvailabilityViaPage(studentBPage, {
      academyId: DEFAULT_E2E_ACADEMY_ID,
    });
    const studentBBusySlot = (studentBAvailability?.slots || []).find(
      (slot) =>
        slot.date === fixture.publicDate &&
        slot.time === fixture.publicTime &&
        slot.isBusy === true
    );
    expect(studentBBusySlot, JSON.stringify(studentBAvailability?.slots || [])).toBeTruthy();
    expect(studentBBusySlot.bookingStatus).toMatch(/busy|reserved/);
    expect(JSON.stringify(studentBBusySlot)).not.toContain(fixture.studentA.displayName);
    expect(JSON.stringify(studentBBusySlot)).not.toContain(fixture.studentA.studentId);
    await studentBPage.getByRole('button', { name: '전체 시간 보기' }).click();
    const studentBBusyCards = studentBPage
      .locator('[data-testid="student-private-busy-slot-card"]')
      .filter({ hasText: fixture.publicDate })
      .filter({ hasText: fixture.publicTime });
    await expect(studentBBusyCards, 'student B should see the reserved template slot as busy in all view').toHaveCount(
      1,
      { timeout: 15000 }
    );
    await expect(studentBBusyCards.first()).toContainText(/수업 있음|예약 마감/);
    await expect(studentBBusyCards.first()).not.toContainText(fixture.studentA.displayName);
    await expect(studentBBusyCards.first().locator('button')).toHaveCount(0);
    expect(await getReservation(db, fixture.publicSlotId, fixture.studentB.studentId)).toBeNull();
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await cleanupWeeklyTemplateFixture(fixture).catch(() => {});
  }
});

test('overlapping private slots are hidden from available view and rejected on reserve', async ({
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 private overlap setup을 실행합니다.');
  test.setTimeout(180000);

  let fixture = null;
  const contexts = [];

  try {
    fixture = await createOverlapFixture(`${Date.now()}-${testInfo.workerIndex}-overlap`);
    const db = getDb();
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    await loginAsStudentWithPrivateBooking(page, fixture.student.email);

    await page.getByRole('button', { name: '예약 가능한 시간만' }).click();
    await expect(
      page.locator('[data-testid="student-private-slot-card"]').filter({ hasText: fixture.overlappingTime })
    ).toHaveCount(0, { timeout: 15000 });
    const clearSlotCards = page
      .locator('[data-testid="student-private-slot-card"]')
      .filter({ hasText: fixture.openTime });
    await expect(clearSlotCards, 'non-overlapping slot should remain bookable').toHaveCount(1, {
      timeout: 15000,
    });
    await expect(
      clearSlotCards.first().getByTestId('student-private-slot-reserve-button')
    ).toBeEnabled();

    await page.getByRole('button', { name: '전체 시간 보기' }).click();
    await expect(
      page.locator('[data-testid="student-private-busy-slot-card"]').filter({ hasText: fixture.overlappingTime })
    ).toHaveCount(1, { timeout: 15000 });

    const reserveResult = await reservePrivateLessonSlotViaPage(page, {
      academyId: DEFAULT_E2E_ACADEMY_ID,
      slotId: fixture.overlappingSlotId,
    });
    expect(reserveResult.ok, JSON.stringify(reserveResult)).toBe(false);
    expect(`${reserveResult.code} ${reserveResult.message}`).toMatch(/slot-not-available|failed-precondition/i);
    expect(await getReservation(db, fixture.overlappingSlotId, fixture.student.studentId)).toBeNull();
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await cleanupOverlapFixture(fixture).catch(() => {});
  }
});
