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
const ADMIN_APP_NAME = 'private-slot-teacher-identity-e2e';
const HOUR_MS = 60 * 60 * 1000;

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

function addDaysYmd(ymd, days) {
  const parsed = new Date(`${ymd}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function getMondayForYmd(ymd) {
  const parsed = new Date(`${ymd}T00:00:00Z`);
  const weekday = parsed.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  parsed.setUTCDate(parsed.getUTCDate() + mondayOffset);
  return parsed.toISOString().slice(0, 10);
}

function seoulDateTimeMillis(ymd, time) {
  const [year, month, day] = String(ymd).split('-').map(Number);
  const [hour, minute] = String(time).split(':').map(Number);
  return Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0);
}

function uniqueMinute(unique, offset = 0) {
  const digits = String(unique).replace(/\D/g, '');
  const seed = Number(digits.slice(-4)) || 0;
  return String((seed + offset) % 50).padStart(2, '0');
}

function nextBookablePrivateSlotDateTime(unique, minuteOffset = 0) {
  const nowMillis = Date.now();
  const minimumStartMillis = nowMillis + 8 * HOUR_MS;
  const today = formatSeoulDateTime(new Date(nowMillis)).date;
  const minute = uniqueMinute(unique, minuteOffset);
  const candidateTimes = [`10:${minute}`, `13:${minute}`, `16:${minute}`, `20:${minute}`];

  for (let offset = 0; offset <= 12; offset += 1) {
    const date = ensureMondaySaturdayYmd(addDaysYmd(today, offset));
    if (date !== addDaysYmd(today, offset)) continue;
    const bookingOpensAt = seoulDateTimeMillis(addDaysYmd(getMondayForYmd(date), -3), '00:00');
    if (nowMillis < bookingOpensAt) continue;
    for (const time of candidateTimes) {
      if (seoulDateTimeMillis(date, time) > minimumStartMillis) {
        return { date, time };
      }
    }
  }

  throw new Error('Unable to find a bookable private slot date/time for the E2E fixture.');
}

function privateSummaryId(studentId) {
  return `${DEFAULT_E2E_ACADEMY_ID}__${studentId}`;
}

async function querySlotByTeacherKeyDateTime(db, { teacherKey, date, time }) {
  const snap = await db
    .collection('privateLessonSlots')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('teacherKey', '==', teacherKey)
    .where('date', '==', date)
    .where('time', '==', time)
    .get();
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

async function createFixture(unique) {
  const db = getDb();
  const auth = getAuth();
  const nowTs = admin.firestore.Timestamp.now();
  const don0 = {
    id: `e2e-teacher-don0-${unique}`,
    uid: `uid-don0-${unique}`,
    key: `don0-${unique}`,
    email: `don0-${unique}@example.com`,
  };
  const don1 = {
    id: `e2e-teacher-don1-${unique}`,
    uid: `uid-don1-${unique}`,
    key: `don1-${unique}`,
    email: `don1-${unique}@example.com`,
  };
  const studentId = `e2e-private-identity-student-${unique}`;
  const studentEmail = `private-identity-${unique}@example.com`;
  const studentName = `Private Identity Student ${unique}`;
  const packageId = `pkg-private-identity-${unique}`;
  const legacyPackageId = `pkg-private-identity-legacy-${unique}`;
  const legacyTeacherKey = `legacy-don-${unique}`;
  const otherSlotId = `e2e-private-identity-other-slot-${unique}`;
  const legacySlotId = `e2e-private-identity-legacy-slot-${unique}`;
  const primarySlotTime = nextBookablePrivateSlotDateTime(unique, 0);
  const otherSlotTime = nextBookablePrivateSlotDateTime(unique, 11);
  const legacySlotTime = nextBookablePrivateSlotDateTime(unique, 22);
  const date = primarySlotTime.date;
  const time = primarySlotTime.time;
  const otherDate = otherSlotTime.date;
  const otherTime = otherSlotTime.time;
  const legacyDate = legacySlotTime.date;
  const legacyTime = legacySlotTime.time;
  const user = await auth.createUser({
    email: studentEmail,
    password: TEST_STUDENT_PASSWORD,
    displayName: studentName,
  });
  await auth.setCustomUserClaims(user.uid, {
    role: 'student',
    academyId: DEFAULT_E2E_ACADEMY_ID,
    studentId,
  });

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
    db.collection('teachers').doc(don0.id).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: 'Don',
      teacherName: don0.key,
      teacherKey: don0.key,
      teacherUid: don0.uid,
      teacherEmail: don0.email,
      status: 'active',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('teachers').doc(don1.id).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: 'Don',
      teacherName: don1.key,
      teacherKey: don1.key,
      teacherUid: don1.uid,
      teacherEmail: don1.email,
      status: 'active',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('users').doc(user.uid).set({
      uid: user.uid,
      email: studentEmail,
      displayName: studentName,
      role: 'student',
      isActive: true,
      lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
      updatedAt: nowTs,
    }),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${user.uid}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      uid: user.uid,
      email: studentEmail,
      displayName: studentName,
      role: 'student',
      studentId,
      teacherName: '',
      status: 'active',
      permissions: {},
      updatedAt: nowTs,
    }),
    db.collection('privateStudents').doc(studentId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: studentName,
      teacher: don1.key,
      status: 'active',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('studentPackages').doc(packageId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId,
      title: `E2E Private Identity ${unique}`,
      packageType: 'private',
      teacher: don1.key,
      teacherName: 'Don',
      teacherKey: don1.key,
      teacherUid: don1.uid,
      status: 'active',
      totalCount: 2,
      usedCount: 0,
      remainingCount: 2,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('studentPackages').doc(legacyPackageId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId,
      title: `E2E Private Identity Legacy ${unique}`,
      packageType: 'private',
      teacher: legacyTeacherKey,
      teacherName: legacyTeacherKey,
      status: 'active',
      totalCount: 1,
      usedCount: 0,
      remainingCount: 1,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(studentId)).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId,
      teacherKeys: [don1.uid, don1.key, legacyTeacherKey],
      activePackageIds: [packageId, legacyPackageId],
      allowedSlotIds: [],
      allowedPrivateLessonSlotIds: [],
      privateSlotBookingPilotEnabled: true,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('privateLessonSlots').doc(otherSlotId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: don0.key,
      teacherName: 'Don',
      teacherKey: don0.key,
      teacherUid: don0.uid,
      teacherEmail: don0.email,
      date: otherDate,
      time: otherTime,
      subject: '1:1 수업',
      capacity: 1,
      reservedCount: 0,
      startAt: admin.firestore.Timestamp.fromDate(new Date(`${otherDate}T${otherTime}:00`)),
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
    db.collection('privateLessonSlots').doc(legacySlotId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: legacyTeacherKey,
      teacherName: legacyTeacherKey,
      date: legacyDate,
      time: legacyTime,
      subject: '1:1 수업',
      capacity: 1,
      reservedCount: 0,
      startAt: admin.firestore.Timestamp.fromDate(new Date(`${legacyDate}T${legacyTime}:00`)),
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
  ]);

  return {
    user,
    studentId,
    studentEmail,
    don0,
    don1,
    date,
    time,
    otherSlotId,
    legacySlotId,
    legacyDate,
    packageId,
    legacyPackageId,
  };
}

async function cleanupFixture(fixture) {
  if (!fixture) return;
  const db = getDb();
  const auth = getAuth();
  const slotDocs = fixture.createdSlotId ? [fixture.createdSlotId] : [];
  const refs = [
    db.collection('teachers').doc(fixture.don0.id),
    db.collection('teachers').doc(fixture.don1.id),
    db.collection('privateLessonSlots').doc(fixture.otherSlotId),
    db.collection('privateLessonSlots').doc(fixture.legacySlotId),
    db.collection('privateStudents').doc(fixture.studentId),
    db.collection('studentPackages').doc(fixture.packageId),
    db.collection('studentPackages').doc(fixture.legacyPackageId),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(fixture.studentId)),
    db.collection('users').doc(fixture.user.uid),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${fixture.user.uid}`),
    ...slotDocs.map((slotId) => db.collection('privateLessonSlots').doc(slotId)),
  ];
  await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
  await auth.deleteUser(fixture.user.uid).catch(() => {});
}

test('admin private slot creation preserves duplicate teacher identity', async ({
  page,
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 private slot setup을 실행합니다.');
  test.setTimeout(120000);

  const db = getDb();
  let fixture = null;
  const contexts = [];
  try {
    fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}`);
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '1:1 예약 시간 관리');

    const teacherSelect = page.getByTestId('private-slot-teacher-select');
    await expect(teacherSelect).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() => teacherSelect.locator('option').allTextContents(), { timeout: 30000 })
      .toEqual(expect.arrayContaining([`Don · ${fixture.don0.key}`, `Don · ${fixture.don1.key}`]));
    const optionTexts = await teacherSelect.locator('option').allTextContents();
    expect(optionTexts).toContain(`Don · ${fixture.don0.key}`);
    expect(optionTexts).toContain(`Don · ${fixture.don1.key}`);
    await teacherSelect.selectOption({ label: `Don · ${fixture.don1.key}` });
    await page.getByLabel('1:1 수업 날짜').fill(fixture.date);
    await page.getByLabel('1:1 수업 시작 시간').fill(fixture.time);
    await page.getByRole('button', { name: '수업 시간 추가', exact: true }).click();

    await expect
      .poll(
        () =>
          querySlotByTeacherKeyDateTime(db, {
            teacherKey: fixture.don1.key,
            date: fixture.date,
            time: fixture.time,
          }).then((slots) => slots.length),
        { timeout: 20000 }
      )
      .toBe(1);
    const [createdSlot] = await querySlotByTeacherKeyDateTime(db, {
      teacherKey: fixture.don1.key,
      date: fixture.date,
      time: fixture.time,
    });
    fixture.createdSlotId = createdSlot.id;
    expect(createdSlot).toMatchObject({
      teacher: fixture.don1.key,
      teacherName: 'Don',
      teacherKey: fixture.don1.key,
      teacherUid: fixture.don1.uid,
      teacherEmail: fixture.don1.email,
    });

    const adminRow = page.locator(`[data-testid="private-slot-row"][data-slot-id="${createdSlot.id}"]`);
    await expect(adminRow).toBeVisible({ timeout: 15000 });
    await expect(adminRow).toContainText(`Don · ${fixture.don1.key}`);

    const studentContext = await browser.newContext();
    contexts.push(studentContext);
    const studentPage = await studentContext.newPage();
    await loginAsStudent(studentPage, fixture.studentEmail, TEST_STUDENT_PASSWORD);
    await studentPage.goto(`${BASE_URL}student-booking?privateSlotBooking=enabled`);
    const don1Card = studentPage.locator(
      `[data-testid="student-private-slot-card"][data-slot-id="${createdSlot.id}"]`
    );
    await expect(don1Card).toBeVisible({ timeout: 20000 });
    await expect(don1Card.getByTestId('student-private-slot-reserve-button')).toHaveText(
      '1:1 수업 예약'
    );
    await expect(
      studentPage.locator(
        `[data-testid="student-private-slot-card"][data-slot-id="${fixture.otherSlotId}"]`
      )
    ).toHaveCount(0);
    await expect(
      studentPage.locator(
        `[data-testid="student-private-slot-card"][data-slot-id="${fixture.legacySlotId}"]`
      )
    ).toBeVisible({ timeout: 20000 });

    testInfo.attach('private-slot-teacher-identity', {
      body: JSON.stringify(
        {
          selectedOptionTexts: optionTexts,
          createdSlot,
          visibleCards: await studentPage
            .locator('[data-testid="student-private-slot-card"], [data-testid="student-private-busy-slot-card"]')
            .allInnerTexts()
            .catch(() => []),
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await cleanupFixture(fixture).catch(() => {});
  }
});
