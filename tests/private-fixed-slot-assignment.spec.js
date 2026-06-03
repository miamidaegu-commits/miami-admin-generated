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
import {
  BASE_URL,
  loginAsAdmin,
  loginAsStudent,
  openDashboardSection,
  selectTeacherOption,
} from './e2e-helpers.js';

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const ADMIN_APP_NAME = 'private-fixed-slot-assignment-e2e';

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

function addDays(ymd, days) {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getNextMondaySaturdayDate(daysAhead = 1) {
  const today = formatSeoulDate(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + daysAhead);
  while (date.getUTCDay() === 0) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

function getWeekday(ymd) {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay();
}

function buildWeeklyDates(startDate, count) {
  return Array.from({ length: count }, (_, index) => addDays(startDate, index * 7));
}

function startAtTimestamp(date, time) {
  return admin.firestore.Timestamp.fromDate(new Date(`${date}T${time}:00`));
}

async function queryLessonsByPackage(packageId) {
  const snap = await getDb()
    .collection('lessons')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('packageId', '==', packageId)
    .get();
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

async function createFixture(unique, { totalCount = 4, conflict = false } = {}) {
  const db = getDb();
  const auth = getAuth();
  const nowTs = admin.firestore.Timestamp.now();
  const startDate = getNextMondaySaturdayDate(1);
  const dates = buildWeeklyDates(startDate, 4);
  const teacher = {
    id: `e2e-fixed-assign-teacher-${unique}`,
    uid: `uid-fixed-assign-${unique}`,
    key: `fixed-assign-teacher-${unique}`,
    name: `Fixed Assign Teacher ${unique}`,
    email: `fixed-assign-teacher-${unique}@example.com`,
  };
  const studentId = `e2e-fixed-assign-student-${unique}`;
  const studentEmail = `fixed-assign-student-${unique}@example.com`;
  const studentName = `Fixed Assign Student ${unique}`;
  const packageId = `pkg-fixed-assign-${unique}`;
  const templateId = `template-fixed-assign-${unique}`;
  const conflictLessonId = conflict ? `lesson-fixed-assign-conflict-${unique}` : '';
  const time = '22:40';

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

  const writes = [
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
    db.collection('teachers').doc(teacher.id).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: teacher.name,
      teacherName: teacher.key,
      teacherKey: teacher.key,
      teacherUid: teacher.uid,
      teacherEmail: teacher.email,
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
      studentName,
      teacher: teacher.key,
      teacherName: teacher.name,
      status: 'active',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('studentPackages').doc(packageId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId,
      studentName,
      title: `E2E Fixed Assign ${unique}`,
      packageType: 'private',
      teacher: teacher.key,
      teacherName: teacher.name,
      teacherKey: teacher.key,
      teacherUid: teacher.uid,
      status: 'active',
      totalCount,
      usedCount: 0,
      remainingCount: totalCount,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(studentId)).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId,
      teacherKeys: [teacher.uid, teacher.key],
      activePackageIds: [packageId],
      allowedSlotIds: [],
      allowedPrivateLessonSlotIds: [],
      privateSlotBookingPilotEnabled: true,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('privateLessonAvailabilityTemplates').doc(templateId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: teacher.key,
      teacherName: teacher.name,
      teacherKey: teacher.key,
      teacherUid: teacher.uid,
      teacherEmail: teacher.email,
      weekday: getWeekday(startDate),
      time,
      durationMinutes: 60,
      status: 'active',
      effectiveStartDate: dates[0],
      effectiveEndDate: dates[3],
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
  ];

  if (conflict) {
    writes.push(
      db.collection('lessons').doc(conflictLessonId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        teacher: teacher.key,
        teacherName: teacher.name,
        teacherKey: teacher.key,
        teacherUid: teacher.uid,
        studentId: `other-student-${unique}`,
        studentName: `Other Student ${unique}`,
        date: dates[1],
        time,
        subject: 'Existing conflict',
        durationMinutes: 60,
        completed: false,
        isDeductCancelled: false,
        deductMemo: '',
        createdAt: nowTs,
        updatedAt: nowTs,
        startAt: startAtTimestamp(dates[1], time),
      })
    );
  }

  await Promise.all(writes);

  return {
    user,
    teacher,
    studentId,
    studentEmail,
    studentName,
    packageId,
    templateId,
    conflictLessonId,
    dates,
    time,
  };
}

async function cleanupFixture(fixture) {
  if (!fixture) return;
  const db = getDb();
  const auth = getAuth();
  const lessonSnap = await db
    .collection('lessons')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('packageId', '==', fixture.packageId)
    .get()
    .catch(() => ({ docs: [] }));
  const refs = [
    db.collection('teachers').doc(fixture.teacher.id),
    db.collection('privateStudents').doc(fixture.studentId),
    db.collection('studentPackages').doc(fixture.packageId),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(fixture.studentId)),
    db.collection('privateLessonAvailabilityTemplates').doc(fixture.templateId),
    db.collection('users').doc(fixture.user.uid),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${fixture.user.uid}`),
    ...(fixture.conflictLessonId ? [db.collection('lessons').doc(fixture.conflictLessonId)] : []),
    ...lessonSnap.docs.map((docSnap) => docSnap.ref),
  ];
  await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
  await auth.deleteUser(fixture.user.uid).catch(() => {});
}

async function fillAssignmentForm(page, fixture) {
  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '1:1 예약 시간 관리');
  const section = page.getByTestId('private-fixed-slot-assignment-section');
  await expect(section).toBeVisible({ timeout: 15000 });
  await selectTeacherOption(
    section.getByTestId('private-fixed-assignment-teacher-select'),
    fixture.teacher.name,
    { timeout: 30000 }
  );
  await expect
    .poll(
      () =>
        section
          .getByTestId('private-fixed-assignment-template-select')
          .locator('option')
          .evaluateAll((options) => options.map((option) => option.value)),
      { timeout: 15000 }
    )
    .toContain(fixture.templateId);
  await section.getByTestId('private-fixed-assignment-template-select').selectOption(fixture.templateId);
  await section.getByTestId('private-fixed-assignment-student-select').selectOption(fixture.studentId);
  await expect
    .poll(
      () =>
        section
          .getByTestId('private-fixed-assignment-package-select')
          .locator('option')
          .evaluateAll((options) => options.map((option) => option.value)),
      { timeout: 15000 }
    )
    .toContain(fixture.packageId);
  await expect(section.getByTestId('private-fixed-assignment-package-select')).toContainText(
    `${fixture.teacher.name} · ${fixture.teacher.key} 전용`
  );
  await expect(section.getByTestId('private-fixed-assignment-package-select')).toContainText(
    '새 배정 가능'
  );
  await section.getByTestId('private-fixed-assignment-package-select').selectOption(fixture.packageId);
  await section.getByTestId('private-fixed-assignment-subject-input').fill('E2E 고정 1:1');
  await section.getByTestId('private-fixed-assignment-start-date-input').fill(addDays(fixture.dates[0], -7));
  await section.getByTestId('private-fixed-assignment-end-date-input').fill(addDays(fixture.dates[3], 7));
  return section;
}

test('admin can assign fixed private lessons from a weekly template', async ({
  page,
  browser,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 fixed slot assignment E2E를 실행합니다.');
  test.setTimeout(180000);

  let fixture = null;
  let studentContext = null;
  try {
    fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}`, { totalCount: 4 });
    const section = await fillAssignmentForm(page, fixture);

    await section.getByTestId('private-fixed-assignment-preview-button').click();
    const preview = section.getByTestId('private-fixed-assignment-preview');
    await expect(preview).toContainText('생성 예정 4회', { timeout: 15000 });
    for (const date of fixture.dates) {
      await expect(preview).toContainText(`${date} ${fixture.time}`);
    }
    await section.getByTestId('private-fixed-assignment-submit-button').click();
    await expect(preview).toContainText('생성 완료 4회', { timeout: 15000 });

    await expect
      .poll(async () => (await queryLessonsByPackage(fixture.packageId)).length, { timeout: 15000 })
      .toBe(4);
    const lessons = await queryLessonsByPackage(fixture.packageId);
    expect(lessons.map((lesson) => lesson.date).sort()).toEqual(fixture.dates);
    for (const lesson of lessons) {
      expect(lesson.studentId).toBe(fixture.studentId);
      expect(lesson.studentName).toBe(fixture.studentName);
      expect(lesson.packageId).toBe(fixture.packageId);
      expect(lesson.teacherKey).toBe(fixture.teacher.key);
      expect(lesson.teacherUid).toBe(fixture.teacher.uid);
      expect(lesson.time).toBe(fixture.time);
      expect(lesson.durationMinutes).toBe(60);
      expect(lesson.subject).toBe('E2E 고정 1:1');
      expect(lesson.sourceType).toBe('fixed-private-slot-assignment');
      expect(lesson.privateLessonAvailabilityTemplateId).toBe(fixture.templateId);
    }

    studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await loginAsStudent(studentPage, fixture.studentEmail, TEST_STUDENT_PASSWORD);
    await studentPage.goto(`${BASE_URL}student-booking?privateSlotBooking=enabled`);
    await expect(studentPage.getByRole('heading', { name: '수업 예약', exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(studentPage.getByTestId('student-private-ticket-summary-schedule')).toContainText(
      '고정 예정 4회',
      { timeout: 15000 }
    );
    await expect(studentPage.getByTestId('student-private-ticket-summary-schedule')).toContainText(
      '예약 가능 0회',
      { timeout: 15000 }
    );
    await expect(
      studentPage
        .locator('[data-testid="student-upcoming-private-lesson-card"]')
        .filter({ hasText: fixture.dates[0] })
    ).toContainText('수업 예정', { timeout: 15000 });

    await studentPage.getByTestId('private-slot-view-mode-all').click();
    const busyCard = studentPage
      .locator('[data-testid="student-private-busy-slot-card"]')
      .filter({ hasText: fixture.dates[0] })
      .filter({ hasText: fixture.time });
    await expect(busyCard).toContainText('수업 있음', { timeout: 30000 });
    await studentPage.getByTestId('private-slot-view-mode-available').click();
    await expect(
      studentPage
        .locator('[data-testid="student-private-busy-slot-card"]')
        .filter({ hasText: fixture.dates[0] })
        .filter({ hasText: fixture.time })
    ).toHaveCount(0, { timeout: 15000 });
  } finally {
    await studentContext?.close().catch(() => {});
    await cleanupFixture(fixture);
  }
});

test('fixed private slot assignment blocks conflicts without partial creation', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 fixed slot assignment E2E를 실행합니다.');
  test.setTimeout(120000);

  let fixture = null;
  try {
    fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}`, {
      totalCount: 10,
      conflict: true,
    });
    const section = await fillAssignmentForm(page, fixture);
    await section.getByTestId('private-fixed-assignment-preview-button').click();
    await expect(section.getByTestId('private-fixed-assignment-preview')).toContainText(
      '이미 같은 시간에 수업이 있습니다',
      { timeout: 15000 }
    );
    await section.getByTestId('private-fixed-assignment-submit-button').click();
    await expect
      .poll(async () => (await queryLessonsByPackage(fixture.packageId)).length, { timeout: 8000 })
      .toBe(0);
  } finally {
    await cleanupFixture(fixture);
  }
});

test('fixed private slot assignment enforces private package capacity', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 fixed slot assignment E2E를 실행합니다.');
  test.setTimeout(120000);

  let fixture = null;
  try {
    fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}`, { totalCount: 2 });
    const section = await fillAssignmentForm(page, fixture);
    await section.getByTestId('private-fixed-assignment-preview-button').click();
    await expect(section.getByTestId('private-fixed-assignment-preview')).toContainText(
      '수강권 새 배정 가능 횟수가 부족합니다',
      { timeout: 15000 }
    );
    await expect(section.getByTestId('private-fixed-assignment-preview')).toContainText(
      '필요 4회 · 새 배정 가능 2회',
      { timeout: 15000 }
    );
    await section.getByTestId('private-fixed-assignment-submit-button').click();
    await expect
      .poll(async () => (await queryLessonsByPackage(fixture.packageId)).length, { timeout: 8000 })
      .toBe(0);
  } finally {
    await cleanupFixture(fixture);
  }
});
