import fs from 'node:fs';
import path from 'node:path';
import admin from 'firebase-admin';
import { test, expect } from '@playwright/test';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEFAULT_E2E_ACADEMY_ID,
  DEFAULT_E2E_ACADEMY_NAME,
  TEST_STUDENT_PASSWORD,
} from './fixtures/test-data.js';
import { loginAsAdmin, loginAsStudent, openDashboardSection } from './e2e-helpers.js';

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const ADMIN_APP_NAME = 'fixed-private-lesson-release-e2e';

function hasServiceAccount() {
  return fs.existsSync(SERVICE_ACCOUNT_PATH);
}

function initializeAdmin() {
  const existing = admin.apps.find((app) => app?.name === ADMIN_APP_NAME);
  if (existing) return existing;
  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
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

function privateBookingStatsId(studentId) {
  return `${DEFAULT_E2E_ACADEMY_ID}__${studentId}`;
}

function templateSlotId({ templateId, date, time }) {
  return `template__${templateId.replace(/[^A-Za-z0-9_-]/g, '_')}__${date.replaceAll('-', '')}__${time.replace(':', '')}`;
}

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

function formatSeoulDate(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
}

function upcomingMondaySaturdayYmd(daysAhead = 7) {
  const today = formatSeoulDate(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + daysAhead);
  while (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function getWeekday(ymd) {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay();
}

function startAtTimestamp(date, time) {
  return admin.firestore.Timestamp.fromDate(new Date(`${date}T${time}:00`));
}

async function createStudentUser({ unique, roleName, studentId, studentName }) {
  const auth = getAuth();
  const email = `fixed-release-${roleName}-${unique}@example.com`;
  const user = await auth.createUser({
    email,
    password: TEST_STUDENT_PASSWORD,
    displayName: studentName,
  });
  await auth.setCustomUserClaims(user.uid, {
    role: 'student',
    academyId: DEFAULT_E2E_ACADEMY_ID,
    studentId,
  });
  return { uid: user.uid, email };
}

async function createFixture(unique) {
  const db = getDb();
  const now = admin.firestore.Timestamp.now();
  const date = upcomingMondaySaturdayYmd(1);
  const time = '22:20';
  const cancelOnlyTime = '20:00';
  const teacher = `fixed-release-teacher-${unique}`;
  const originalStudentId = `fixed-release-original-${unique}`;
  const originalStudentName = `Fixed Release Original ${unique}`;
  const otherStudentId = `fixed-release-other-${unique}`;
  const otherStudentName = `Fixed Release Other ${unique}`;
  const templateId = `fixed-release-template-${unique}`;
  const fixedLessonId = `fixed-release-lesson-${unique}`;
  const cancelOnlyLessonId = `fixed-release-cancel-only-${unique}`;
  const originalPackageId = `fixed-release-original-package-${unique}`;
  const otherPackageId = `fixed-release-other-package-${unique}`;
  const studentUsers = [
    await createStudentUser({
      unique,
      roleName: 'original',
      studentId: originalStudentId,
      studentName: originalStudentName,
    }),
    await createStudentUser({
      unique,
      roleName: 'other',
      studentId: otherStudentId,
      studentName: otherStudentName,
    }),
  ];

  const templateSlot = templateSlotId({ templateId, date, time });
  const commonTeacherFields = {
    teacher,
    teacherName: teacher,
    teacherKey: teacher,
  };

  await Promise.all([
    db.collection('academies').doc(DEFAULT_E2E_ACADEMY_ID).set(
      {
        id: DEFAULT_E2E_ACADEMY_ID,
        name: DEFAULT_E2E_ACADEMY_NAME,
        slug: DEFAULT_E2E_ACADEMY_ID,
        status: 'active',
        timezone: 'Asia/Seoul',
        updatedAt: now,
      },
      { merge: true }
    ),
    ...studentUsers.map((studentUser, index) => {
      const studentId = index === 0 ? originalStudentId : otherStudentId;
      const studentName = index === 0 ? originalStudentName : otherStudentName;
      return db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${studentUser.uid}`).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        uid: studentUser.uid,
        email: studentUser.email,
        displayName: studentName,
        role: 'student',
        studentId,
        status: 'active',
        permissions: {},
        updatedAt: now,
      });
    }),
    ...studentUsers.map((studentUser, index) =>
      db.collection('users').doc(studentUser.uid).set({
        uid: studentUser.uid,
        email: studentUser.email,
        displayName: index === 0 ? originalStudentName : otherStudentName,
        role: 'student',
        isActive: true,
        lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
        updatedAt: now,
      })
    ),
    db.collection('privateStudents').doc(originalStudentId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: originalStudentName,
      studentName: originalStudentName,
      ...commonTeacherFields,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }),
    db.collection('privateStudents').doc(otherStudentId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: otherStudentName,
      studentName: otherStudentName,
      ...commonTeacherFields,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }),
    db.collection('studentPackages').doc(originalPackageId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: originalStudentId,
      studentName: originalStudentName,
      title: `Fixed release original package ${unique}`,
      packageType: 'private',
      ...commonTeacherFields,
      status: 'active',
      totalCount: 2,
      usedCount: 0,
      remainingCount: 2,
      createdAt: now,
      updatedAt: now,
    }),
    db.collection('studentPackages').doc(otherPackageId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: otherStudentId,
      studentName: otherStudentName,
      title: `Fixed release other package ${unique}`,
      packageType: 'private',
      ...commonTeacherFields,
      status: 'active',
      totalCount: 2,
      usedCount: 0,
      remainingCount: 2,
      createdAt: now,
      updatedAt: now,
    }),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(originalStudentId)).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: originalStudentId,
      teacherKeys: [teacher],
      activePackageIds: [originalPackageId],
      allowedSlotIds: [],
      allowedPrivateLessonSlotIds: [],
      privateSlotBookingPilotEnabled: true,
      createdAt: now,
      updatedAt: now,
    }),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(otherStudentId)).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: otherStudentId,
      teacherKeys: [teacher],
      activePackageIds: [otherPackageId],
      allowedSlotIds: [],
      allowedPrivateLessonSlotIds: [],
      privateSlotBookingPilotEnabled: true,
      createdAt: now,
      updatedAt: now,
    }),
    db.collection('studentPrivateBookingStats').doc(privateBookingStatsId(originalStudentId)).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: originalStudentId,
      studentCancelCount: 0,
      studentCancelLimit: 2,
      createdAt: now,
      updatedAt: now,
    }),
    db.collection('privateLessonAvailabilityTemplates').doc(templateId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      ...commonTeacherFields,
      weekday: getWeekday(date),
      time,
      durationMinutes: 60,
      status: 'active',
      effectiveStartDate: date,
      effectiveEndDate: date,
      createdAt: now,
      updatedAt: now,
    }),
    db.collection('lessons').doc(fixedLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      ...commonTeacherFields,
      studentId: originalStudentId,
      studentID: originalStudentId,
      studentName: originalStudentName,
      student: originalStudentName,
      date,
      time,
      subject: `Fixed release lesson ${unique}`,
      durationMinutes: 60,
      packageId: originalPackageId,
      packageType: 'private',
      billingType: 'private',
      sourceType: 'fixed-private-slot-assignment',
      privateLessonAvailabilityTemplateId: templateId,
      completed: false,
      isDeductCancelled: false,
      startAt: startAtTimestamp(date, time),
      createdAt: now,
      updatedAt: now,
    }),
    db.collection('lessons').doc(cancelOnlyLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      ...commonTeacherFields,
      studentId: originalStudentId,
      studentID: originalStudentId,
      studentName: originalStudentName,
      student: originalStudentName,
      date,
      time: cancelOnlyTime,
      subject: `Fixed cancel only lesson ${unique}`,
      durationMinutes: 60,
      packageId: originalPackageId,
      packageType: 'private',
      billingType: 'private',
      sourceType: 'fixed-private-slot-assignment',
      completed: false,
      isDeductCancelled: false,
      startAt: startAtTimestamp(date, cancelOnlyTime),
      createdAt: now,
      updatedAt: now,
    }),
  ]);

  return {
    unique,
    date,
    time,
    cancelOnlyTime,
    teacher,
    templateId,
    templateSlot,
    fixedLessonId,
    cancelOnlyLessonId,
    originalStudentId,
    originalStudentName,
    otherStudentId,
    otherStudentName,
    otherEmail: studentUsers[1].email,
    originalEmail: studentUsers[0].email,
    studentUids: studentUsers.map((user) => user.uid),
    packageIds: [originalPackageId, otherPackageId],
  };
}

async function cleanupFixture(fixture) {
  if (!fixture) return;
  const db = getDb();
  const auth = getAuth();
  const reservationSnap = await db
    .collection('privateLessonReservations')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('teacher', '==', fixture.teacher)
    .get()
    .catch(() => ({ docs: [] }));
  const refs = [
    db.collection('privateLessonAvailabilityTemplates').doc(fixture.templateId),
    db.collection('lessons').doc(fixture.fixedLessonId),
    db.collection('lessons').doc(fixture.cancelOnlyLessonId),
    db.collection('privateStudents').doc(fixture.originalStudentId),
    db.collection('privateStudents').doc(fixture.otherStudentId),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(fixture.originalStudentId)),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(fixture.otherStudentId)),
    db.collection('studentPrivateBookingStats').doc(privateBookingStatsId(fixture.originalStudentId)),
    db.collection('studentPrivateBookingStats').doc(privateBookingStatsId(fixture.otherStudentId)),
    ...fixture.packageIds.map((id) => db.collection('studentPackages').doc(id)),
    ...reservationSnap.docs.map((docSnap) => docSnap.ref),
    ...fixture.studentUids.map((uid) => db.collection('users').doc(uid)),
    ...fixture.studentUids.map((uid) =>
      db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${uid}`)
    ),
  ];
  await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
  await Promise.all(fixture.studentUids.map((uid) => auth.deleteUser(uid).catch(() => {})));
}

async function expectLessonPatch(lessonId, expected) {
  const db = getDb();
  await expect
    .poll(async () => {
      const snap = await db.collection('lessons').doc(lessonId).get();
      if (!snap.exists) return null;
      const data = snap.data() || {};
      return {
        status: data.status || '',
        cancellationType: data.cancellationType || '',
        isSeatReleased: data.isSeatReleased === true,
        releasedForPrivateBooking: data.releasedForPrivateBooking === true,
      };
    }, { timeout: 15000 })
    .toEqual(expected);
}

async function reservePrivateLessonSlotViaPage(page, {
  academyId,
  slotId,
  availabilityTemplateId = '',
  date = '',
  time = '',
}) {
  return page.evaluate(
    async ({ firebaseConfig, academyId, slotId, availabilityTemplateId, date, time }) => {
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
          availabilityTemplateId,
          date,
          time,
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
      availabilityTemplateId,
      date,
      time,
    }
  );
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

async function expectReservationStatus(slotId, studentId, expected) {
  await expect
    .poll(async () => {
      const snap = await getDb()
        .collection('privateLessonReservations')
        .doc(`${DEFAULT_E2E_ACADEMY_ID}__${slotId}__${studentId}`)
        .get();
      return snap.exists ? snap.data()?.status || null : null;
    }, { timeout: 15000 })
    .toBe(expected);
}

test.describe('fixed private lesson release', () => {
  test.setTimeout(90000);
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json is required for live e2e setup.');

  let fixture;

  test.afterEach(async () => {
    await cleanupFixture(fixture);
    fixture = null;
  });

  test('admin releases one fixed lesson and another student can reserve the time', async ({ page }) => {
    fixture = await createFixture(`admin-${Date.now()}`);

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '캘린더');
    const fixedLessonDoc = await getDb().collection('lessons').doc(fixture.fixedLessonId).get();
    expect(fixedLessonDoc.exists).toBe(true);
    await page.locator(`[data-testid="calendar-day-button"][data-date="${fixture.date}"]`).click();
    const calendarRow = page
      .locator(
        `[data-testid="calendar-lesson-row"][data-row-kind="private"][data-lesson-id="${fixture.fixedLessonId}"]`
      )
      .first();
    await expect(calendarRow).toBeVisible({ timeout: 20000 });
    await expect(calendarRow).toContainText(fixture.originalStudentName);
    await expect(calendarRow).toContainText(fixture.time);
    page.once('dialog', (dialog) => dialog.accept());
    await calendarRow.getByTestId('calendar-fixed-private-release-button').click();
    await expect(calendarRow).toContainText('자리 공개', { timeout: 15000 });
    await expectLessonPatch(fixture.fixedLessonId, {
      status: 'cancelled',
      cancellationType: 'seat_released',
      isSeatReleased: true,
      releasedForPrivateBooking: true,
    });

    await page.getByRole('button', { name: '로그아웃' }).click();
    await loginAsStudent(page, fixture.otherEmail, TEST_STUDENT_PASSWORD);
    await page.goto(`${page.url()}?privateSlotBooking=enabled`);
    await expect(page.getByRole('heading', { name: '수업 예약', exact: true })).toBeVisible({
      timeout: 15000,
    });
    const availability = await listPrivateLessonSlotAvailabilityViaPage(page, {
      academyId: DEFAULT_E2E_ACADEMY_ID,
    });
    const releasedSlot = (availability?.slots || []).find(
      (slot) => slot.date === fixture.date && slot.time === fixture.time
    );
    expect(releasedSlot, JSON.stringify(availability?.slots || [])).toBeTruthy();
    const reserveResult = await reservePrivateLessonSlotViaPage(page, {
      academyId: DEFAULT_E2E_ACADEMY_ID,
      slotId: releasedSlot.id,
      availabilityTemplateId: releasedSlot.availabilityTemplateId || '',
      date: releasedSlot.date,
      time: releasedSlot.time,
    });
    expect(reserveResult, JSON.stringify(reserveResult)).toMatchObject({ ok: true });
    await expectReservationStatus(releasedSlot.id, fixture.otherStudentId, 'active');
  });

  test('admin cancels one fixed lesson without making that time bookable', async ({ page }) => {
    fixture = await createFixture(`cancel-${Date.now()}`);

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '1:1 예약 시간 관리');
    const fixedSection = page.getByTestId('private-fixed-lessons-management-section');
    await expect(fixedSection).toContainText('고정 1:1 수업 일정');
    const row = fixedSection
      .locator('[data-testid="private-fixed-lesson-row"]')
      .filter({ hasText: fixture.cancelOnlyTime })
      .first();
    await expect(row).toBeVisible({ timeout: 45000 });
    page.once('dialog', (dialog) => dialog.accept());
    await row.getByTestId('private-fixed-lesson-cancel-button').click();
    await expect(row).toContainText('수업 취소', { timeout: 15000 });
    await expectLessonPatch(fixture.cancelOnlyLessonId, {
      status: 'cancelled',
      cancellationType: 'lesson_cancelled',
      isSeatReleased: false,
      releasedForPrivateBooking: false,
    });
  });

  test('student cancels own fixed lesson and consumes cancellation allowance', async ({ page }) => {
    fixture = await createFixture(`student-${Date.now()}`);

    await loginAsStudent(page, fixture.originalEmail, TEST_STUDENT_PASSWORD);
    const upcomingCard = page
      .locator('[data-testid="student-upcoming-private-lesson-card"][data-source="lesson"]')
      .filter({ hasText: fixture.time })
      .first();
    await expect(upcomingCard).toBeVisible({ timeout: 15000 });
    await expect(upcomingCard).toContainText('취소 가능 2회', { timeout: 15000 });
    page.once('dialog', (dialog) => dialog.accept());
    await upcomingCard.getByTestId('student-fixed-private-lesson-cancel-button').click();
    await expectLessonPatch(fixture.fixedLessonId, {
      status: 'cancelled',
      cancellationType: 'seat_released',
      isSeatReleased: true,
      releasedForPrivateBooking: true,
    });
    await expect
      .poll(async () => {
        const snap = await getDb()
          .collection('studentPrivateBookingStats')
          .doc(privateBookingStatsId(fixture.originalStudentId))
          .get();
        return Number(snap.data()?.studentCancelCount || 0);
      }, { timeout: 15000 })
      .toBe(1);
  });
});
