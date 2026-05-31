import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';
import { expect, test } from '@playwright/test';
import {
  BASE_URL,
  getStudentRow,
  getStudentSearchInput,
  loginAsAdmin,
  loginAsStudent,
  openDashboardSection,
} from './e2e-helpers.js';
import { computePrivateTicketBalance } from '../src/features/dashboard/ticketBalanceHelpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEFAULT_E2E_ACADEMY_ID,
  DEFAULT_E2E_ACADEMY_NAME,
  TEST_STUDENT_PASSWORD,
} from './fixtures/test-data.js';

const require = createRequire(import.meta.url);
const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const TEACHER_NAME = 'Don';
const TEACHER_KEY = 'don1';
const TEACHER_UID = 'e2e-don1-teacher-uid';

function hasServiceAccount() {
  return fs.existsSync(SERVICE_ACCOUNT_PATH);
}

function getAdminApp() {
  const existing = admin.apps.find((app) => app?.name === 'private-makeup-balance');
  if (existing) return existing;
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  if (serviceAccount.project_id !== 'miami-e2e') {
    throw new Error(`Expected miami-e2e service account, received ${serviceAccount.project_id}`);
  }
  return admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
    },
    'private-makeup-balance'
  );
}

function getDb() {
  return getAdminApp().firestore();
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

async function snapshotDoc(ref) {
  const snap = await ref.get();
  return snap.exists ? snap.data() : null;
}

async function callReservePrivateLessonSlot(page, { slotId, date, time }) {
  return page.evaluate(
    async ({ firebaseConfig, academyId, slotId, date, time }) => {
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
      academyId: DEFAULT_E2E_ACADEMY_ID,
      slotId,
      date,
      time,
    }
  );
}

async function createOrGetStudentAuthUser({ email, displayName }) {
  try {
    const existingUser = await getAdminApp().auth().getUserByEmail(email);
    return {
      user: await getAdminApp().auth().updateUser(existingUser.uid, {
        email,
        password: TEST_STUDENT_PASSWORD,
        displayName,
        disabled: false,
      }),
      created: false,
    };
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
  }
  return {
    user: await getAdminApp().auth().createUser({
      email,
      password: TEST_STUDENT_PASSWORD,
      displayName,
      disabled: false,
    }),
    created: true,
  };
}

function getSeoulTodayYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysToYmd(date, days) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function ensureMondaySaturdayYmd(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  while (parsed.getUTCDay() === 0) parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function getKstDateTimeMillis(dateValue, timeValue) {
  const [year, month, day] = String(dateValue).split('-').map(Number);
  const [hour, minute] = String(timeValue).split(':').map(Number);
  return Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0);
}

function getKstWeekday(dateValue) {
  const millis = getKstDateTimeMillis(dateValue, '00:00');
  const day = new Date(millis + 9 * 60 * 60 * 1000).getUTCDay();
  return day === 0 ? 7 : day;
}

function getMondayForYmd(dateValue) {
  const weekday = getKstWeekday(dateValue);
  return addDaysToYmd(dateValue, 1 - weekday);
}

function getOpenPrivateBookingDate(today) {
  const now = Date.now();
  for (let offset = 1; offset <= 13; offset += 1) {
    const candidate = ensureMondaySaturdayYmd(addDaysToYmd(today, offset));
    if (getKstWeekday(candidate) > 6) continue;
    const startsAt = getKstDateTimeMillis(candidate, '14:00');
    const weekMonday = getMondayForYmd(candidate);
    const bookingOpensAt = getKstDateTimeMillis(addDaysToYmd(weekMonday, -3), '00:00');
    const bookingClosesAt = startsAt - 7 * 60 * 60 * 1000;
    if (bookingOpensAt <= now && now < bookingClosesAt) return candidate;
  }
  throw new Error('Could not find an open private booking date for fixture.');
}

function reservationId({ slotId, studentId }) {
  return `${DEFAULT_E2E_ACADEMY_ID}__${slotId}__${studentId}`;
}

async function createFixture(unique) {
  const db = getDb();
  const now = admin.firestore.Timestamp.now();
  const email = `private-makeup-${unique}@example.com`;
  const studentName = `E2E 보충학생 ${unique}`;
  const { user, created } = await createOrGetStudentAuthUser({
    email,
    displayName: studentName,
  });
  const studentId = `e2e-private-makeup-student-${unique}`;
  const packageId = `e2e-private-makeup-package-${unique}`;
  const pastLessonId = `e2e-private-makeup-past-${unique}`;
  const futureLessonIds = [1, 2, 3].map((index) => `e2e-private-makeup-future-${index}-${unique}`);
  const noPackageLessonId = `e2e-private-makeup-nopkg-${unique}`;
  const slotIds = [1, 2].map((index) => `e2e-private-makeup-slot-${index}-${unique}`);
  const today = getSeoulTodayYmd();
  const pastDate = addDaysToYmd(today, -1);
  const bookingDate = getOpenPrivateBookingDate(today);
  const futureDates = [bookingDate, bookingDate, bookingDate];
  const slotDates = [bookingDate, bookingDate];

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
    db.collection('users').doc(user.uid).set(
      {
        uid: user.uid,
        email,
        displayName: studentName,
        role: 'student',
        isActive: true,
        lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
        updatedAt: now,
      },
      { merge: true }
    ),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${user.uid}`).set(
      {
        academyId: DEFAULT_E2E_ACADEMY_ID,
        uid: user.uid,
        email,
        displayName: studentName,
        role: 'student',
        studentId,
        teacherName: '',
        status: 'active',
        permissions: {},
        updatedAt: now,
      },
      { merge: true }
    ),
    db.collection('privateStudents').doc(studentId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: studentName,
      studentName,
      teacher: TEACHER_KEY,
      teacherName: TEACHER_NAME,
      teacherKey: TEACHER_KEY,
      teacherUid: TEACHER_UID,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }),
    db.collection('studentPrivateAccessSummary').doc(`${DEFAULT_E2E_ACADEMY_ID}__${studentId}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId,
      teacherKeys: [TEACHER_UID, TEACHER_KEY, TEACHER_NAME],
      activePackageIds: [packageId],
      privateSlotBookingPilotEnabled: true,
      createdAt: now,
      updatedAt: now,
    }),
    db.collection('studentPackages').doc(packageId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId,
      studentName,
      title: `E2E Don1 4회 ${unique}`,
      packageType: 'private',
      teacher: TEACHER_KEY,
      teacherName: TEACHER_NAME,
      teacherKey: TEACHER_KEY,
      teacherUid: TEACHER_UID,
      totalCount: 4,
      usedCount: 0,
      remainingCount: 4,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }),
  ]);

  await Promise.all([
    db.collection('lessons').doc(pastLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: TEACHER_KEY,
      teacherName: TEACHER_NAME,
      teacherKey: TEACHER_KEY,
      teacherUid: TEACHER_UID,
      teacherUID: TEACHER_UID,
      studentId,
      studentID: studentId,
      studentName,
      student: studentName,
      date: pastDate,
      time: '10:00',
      subject: `E2E 보충취소 ${unique}`,
      isDeductCancelled: true,
      deductMemo: 'makeup e2e',
      packageId,
      packageType: 'private',
      createdAt: now,
      updatedAt: now,
    }),
    ...futureLessonIds.map((lessonId, index) =>
      db.collection('lessons').doc(lessonId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        teacher: TEACHER_NAME,
        teacherName: TEACHER_NAME,
        teacherUID: TEACHER_UID,
        studentId,
        studentID: studentId,
        studentName,
        student: studentName,
        date: futureDates[index],
        time: '10:00',
        subject: `E2E 예정고정 ${index + 1} ${unique}`,
        isDeductCancelled: false,
        packageId: index === 0 ? packageId : `legacy-private-package-${unique}`,
        packageType: 'private',
        createdAt: now,
        updatedAt: now,
      })
    ),
    db.collection('lessons').doc(noPackageLessonId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: 'no-package-teacher',
      teacherName: 'no-package-teacher',
      studentId,
      studentID: studentId,
      studentName,
      student: studentName,
      date: today,
      time: '12:00',
      subject: `E2E 수강권없음 ${unique}`,
      isDeductCancelled: false,
      packageId: '',
      packageType: 'private',
      createdAt: now,
      updatedAt: now,
    }),
    ...slotIds.map((slotId, index) =>
      db.collection('privateLessonSlots').doc(slotId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        teacher: TEACHER_KEY,
        teacherName: TEACHER_NAME,
        teacherKey: TEACHER_KEY,
        teacherUid: TEACHER_UID,
        date: slotDates[index],
        time: `14:0${index}`,
        subject: `E2E 보충슬롯 ${index + 1} ${unique}`,
        durationMinutes: 50,
        status: 'open',
        reservedStudentId: '',
        reservationId: '',
        reservedCount: 0,
        createdAt: now,
        updatedAt: now,
      })
    ),
  ]);

  return {
    email,
    authUid: user.uid,
    authCreated: created,
    studentId,
    studentName,
    packageId,
    pastLessonId,
    futureLessonIds,
    noPackageLessonId,
    slotIds,
    pastDate,
    today,
    slotDates,
  };
}

async function cleanupFixture(fixture) {
  if (!fixture) return;
  const db = getDb();
  const refs = [
    db.collection('users').doc(fixture.authUid),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${fixture.authUid}`),
    db.collection('privateStudents').doc(fixture.studentId),
    db.collection('studentPrivateAccessSummary').doc(`${DEFAULT_E2E_ACADEMY_ID}__${fixture.studentId}`),
    db.collection('studentPackages').doc(fixture.packageId),
    db.collection('lessons').doc(fixture.pastLessonId),
    db.collection('lessons').doc(fixture.noPackageLessonId),
    ...fixture.futureLessonIds.map((id) => db.collection('lessons').doc(id)),
    ...fixture.slotIds.map((id) => db.collection('privateLessonSlots').doc(id)),
    ...fixture.slotIds.map((slotId) =>
      db.collection('privateLessonReservations').doc(reservationId({ slotId, studentId: fixture.studentId }))
    ),
  ];
  await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
  if (fixture.authCreated) {
    await getAdminApp().auth().deleteUser(fixture.authUid).catch(() => {});
  }
}

async function selectCalendarDate(page, date) {
  await openDashboardSection(page, '캘린더');
  const dateButton = page.locator(`[data-testid="calendar-day-button"][data-date="${date}"]`);
  await expect(dateButton).toBeVisible({ timeout: 15000 });
  await dateButton.click();
  await expect(page.getByTestId('calendar-lessons-section').getByText('불러오는 중...', { exact: true })).toHaveCount(
    0,
    { timeout: 30000 }
  );
}

test.setTimeout(180000);

test('fixed private package balance creates one makeup booking and prevents overbooking', async ({
  page,
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 Firestore fixture를 생성합니다.');

  const unique = `${Date.now()}-${testInfo.workerIndex}`;
  const fixture = await createFixture(unique);
  const db = getDb();
  const contexts = [];

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await selectCalendarDate(page, fixture.pastDate);
    const linkedRow = page.locator(`[data-testid="calendar-lesson-row"][data-lesson-id="${fixture.pastLessonId}"]`);
    await expect(linkedRow).toBeVisible({ timeout: 15000 });
    await expect(linkedRow).not.toContainText('수강권 없음');
    const initialPackageDoc = await snapshotDoc(db.collection('studentPackages').doc(fixture.packageId));
    const initialLessonDocs = await Promise.all(
      [fixture.pastLessonId, ...fixture.futureLessonIds, fixture.noPackageLessonId].map(async (lessonId) => ({
        id: lessonId,
        ...(await snapshotDoc(db.collection('lessons').doc(lessonId))),
      }))
    );
    const initialBalance = computePrivateTicketBalance({
      ticket: { id: fixture.packageId, ...initialPackageDoc },
      fixedPrivateLessons: initialLessonDocs,
      privateReservations: [],
      studentId: fixture.studentId,
      teacherScope: { teacher: TEACHER_NAME },
      academyId: DEFAULT_E2E_ACADEMY_ID,
    });
    testInfo.attach('private-makeup-initial-balance', {
      body: JSON.stringify(
        {
          balance: initialBalance,
          releasedLessonSkipped: initialBalance.futureFixedAllocatedCount === 3,
          lessons: initialLessonDocs.map((lesson) => ({
            id: lesson.id,
            date: lesson.date,
            isDeductCancelled: lesson.isDeductCancelled,
            noDeduction: lesson.noDeduction,
            status: lesson.status,
            cancellationType: lesson.cancellationType,
            cancelledReason: lesson.cancelledReason,
          })),
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
    expect(initialBalance).toMatchObject({
      remainingCount: 4,
      futureFixedAllocatedCount: 3,
      activeFutureReservationCount: 0,
      availableToBook: 1,
      makeupAvailableCount: 1,
    });
    await linkedRow.click();
    const detailModal = page.getByTestId('calendar-private-lesson-detail-modal');
    await expect(detailModal).toBeVisible({ timeout: 15000 });
    testInfo.attach('private-makeup-calendar-detail', {
      body: await detailModal.innerText(),
      contentType: 'text/plain',
    });
    await detailModal.getByRole('button', { name: '닫기' }).click();
    await expect(linkedRow).toContainText('보충 가능 1회');

    await openDashboardSection(page, '학생 관리');
    const studentSearchInput = getStudentSearchInput(page);
    await expect(studentSearchInput).toBeEnabled({ timeout: 30000 });
    await studentSearchInput.fill(fixture.studentName);
    const studentRow = getStudentRow(page, fixture.studentName);
    await expect(studentRow).toBeVisible({ timeout: 15000 });
    const privatePackageCell = studentRow.getByTestId('student-private-package-cell');
    await expect(privatePackageCell).toContainText('잔여 4회 / 총 4회 · 사용 0회');
    await expect(privatePackageCell).toContainText('고정 예정 3회');
    await expect(privatePackageCell).toContainText('보충 가능 1회');
    await expect(privatePackageCell).not.toContainText('예정 4회');

    await selectCalendarDate(page, fixture.today);
    const noPackageRow = page.locator(
      `[data-testid="calendar-lesson-row"][data-lesson-id="${fixture.noPackageLessonId}"]`
    );
    await expect(noPackageRow).toContainText('수강권 연결 필요');
    await expect(noPackageRow.getByRole('button', { name: '차감취소', exact: true })).toHaveCount(0);

    const studentContext = await browser.newContext();
    contexts.push(studentContext);
    const studentPage = await studentContext.newPage();
    await loginAsStudent(studentPage, fixture.email, TEST_STUDENT_PASSWORD);
    await studentPage.goto(`${BASE_URL}student-booking?privateSlotBooking=enabled`);
    await expect(studentPage.getByRole('heading', { name: '수업 예약', exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(studentPage.getByTestId('student-booking-identity-line')).toContainText(fixture.studentName);
    await expect(studentPage.getByTestId('student-booking-identity-line')).toContainText(fixture.email);
    await expect(studentPage.getByTestId('student-ticket-summary-section')).toBeVisible({ timeout: 15000 });
    await expect(studentPage.getByText('불러오는 중...', { exact: true })).toHaveCount(0, { timeout: 30000 });
    const privateTicketSchedule = studentPage.getByTestId('student-private-ticket-summary-schedule').first();
    await expect(privateTicketSchedule).toBeVisible({ timeout: 15000 });
    await expect(privateTicketSchedule).toContainText('고정 예정 3회', { timeout: 15000 });
    await expect(privateTicketSchedule).toContainText('보충 가능 1회');
    const firstSlotCard = studentPage.locator(
      `[data-testid="student-private-slot-card"][data-slot-id="${fixture.slotIds[0]}"]`
    );
    await expect(firstSlotCard).toBeVisible({ timeout: 20000 });
    await expect(firstSlotCard).toContainText('예약 가능 1회');
    studentPage.once('dialog', (dialog) => dialog.accept());
    await firstSlotCard.getByTestId('student-private-slot-reserve-button').click();

    await expect
      .poll(async () => (await snapshotDoc(db.collection('privateLessonSlots').doc(fixture.slotIds[0])))?.status, {
        timeout: 20000,
      })
      .toBe('reserved');
    await expect
      .poll(
        async () =>
          (await snapshotDoc(
            db
              .collection('privateLessonReservations')
              .doc(reservationId({ slotId: fixture.slotIds[0], studentId: fixture.studentId }))
          ))?.packageId,
        { timeout: 20000 }
      )
      .toBe(fixture.packageId);

    const overbookResult = await callReservePrivateLessonSlot(studentPage, {
      slotId: fixture.slotIds[1],
      date: fixture.slotDates[1],
      time: '14:01',
    });
    expect(overbookResult).toMatchObject({
      ok: false,
    });
    expect(overbookResult.message).toContain('no-makeup-available');

    await expect(privateTicketSchedule).toContainText('보충 예약 1회', { timeout: 15000 });
    await expect(privateTicketSchedule).toContainText('예약 가능 0회');
    await expect(privateTicketSchedule).not.toContainText('보충 가능 1회');

    await openDashboardSection(page, '학생 관리');
    await expect(studentSearchInput).toBeEnabled({ timeout: 30000 });
    await studentSearchInput.fill(fixture.studentName);
    await expect(privatePackageCell).toContainText('고정 예정 3회', { timeout: 15000 });
    await expect(privatePackageCell).toContainText('보충 예약 1회');
    await expect(privatePackageCell).toContainText('예약 가능 0회');
    await expect(privatePackageCell).not.toContainText('보충 가능 1회');

    await studentPage.goto(`${BASE_URL}student-booking?privateSlotBooking=enabled`);
    await expect(studentPage.getByRole('heading', { name: '수업 예약', exact: true })).toBeVisible({
      timeout: 15000,
    });
    const visiblePrivateCards = await studentPage
      .locator('[data-testid="student-private-slot-card"], [data-testid="student-private-busy-slot-card"]')
      .allInnerTexts()
      .catch(() => []);
    const packageDoc = await snapshotDoc(db.collection('studentPackages').doc(fixture.packageId));
    const reservationDocs = await Promise.all(
      fixture.slotIds.map((slotId) =>
        snapshotDoc(
          db
            .collection('privateLessonReservations')
            .doc(reservationId({ slotId, studentId: fixture.studentId }))
        )
      )
    );
    testInfo.attach('private-makeup-diagnostics', {
      body: JSON.stringify(
        {
          packageDoc,
          reservationDocs,
          visiblePrivateCards,
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
    const secondBusySlotCard = studentPage.locator(
      `[data-testid="student-private-busy-slot-card"][data-slot-id="${fixture.slotIds[1]}"]`
    );
    await expect(secondBusySlotCard).toBeVisible({ timeout: 20000 });
    await expect(secondBusySlotCard).toContainText('수업 있음');
    await expect(
      studentPage.locator(
        `[data-testid="student-private-slot-card"][data-slot-id="${fixture.slotIds[1]}"]`
      )
    ).toHaveCount(0);

    await selectCalendarDate(page, fixture.pastDate);
    const restoreRow = page.locator(`[data-testid="calendar-lesson-row"][data-lesson-id="${fixture.pastLessonId}"]`);
    await expect(restoreRow).toBeVisible({ timeout: 15000 });
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('이미 보충 예약으로 사용되어 차감복구할 수 없습니다.');
      await dialog.accept();
    });
    await restoreRow.getByRole('button', { name: '차감복구', exact: true }).click();
    await expect
      .poll(async () => (await snapshotDoc(db.collection('lessons').doc(fixture.pastLessonId)))?.isDeductCancelled)
      .toBe(true);

    const reservationCard = studentPage
      .locator('[data-testid="student-private-reservation-card"]')
      .filter({ hasText: fixture.slotDates[0] })
      .filter({ hasText: '14:00' });
    await expect(reservationCard).toBeVisible({ timeout: 15000 });
    studentPage.once('dialog', (dialog) => dialog.accept());
    await reservationCard.getByTestId('student-private-reservation-cancel-button').click();
    await expect
      .poll(
        async () =>
          (await snapshotDoc(
            db
              .collection('privateLessonReservations')
              .doc(reservationId({ slotId: fixture.slotIds[0], studentId: fixture.studentId }))
          ))?.status,
        { timeout: 20000 }
      )
      .toBe('cancelled');
    await studentPage.goto(`${BASE_URL}student-booking?privateSlotBooking=enabled`);
    const restoredSlotCard = studentPage.locator(
      `[data-testid="student-private-slot-card"][data-slot-id="${fixture.slotIds[0]}"]`
    );
    await expect(restoredSlotCard).toBeVisible({ timeout: 20000 });
    await expect(restoredSlotCard).toContainText('예약 가능 1회');
    await expect(studentPage.getByTestId('student-private-ticket-summary-schedule')).toContainText(
      '보충 가능 1회',
      { timeout: 15000 }
    );

    await openDashboardSection(page, '학생 관리');
    await expect(studentSearchInput).toBeEnabled({ timeout: 30000 });
    await studentSearchInput.fill(fixture.studentName);
    await expect(privatePackageCell).toContainText('고정 예정 3회', { timeout: 15000 });
    await expect(privatePackageCell).toContainText('보충 가능 1회');
    await expect(privatePackageCell).not.toContainText('보충 예약 1회');
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await cleanupFixture(fixture).catch(() => {});
  }
});
