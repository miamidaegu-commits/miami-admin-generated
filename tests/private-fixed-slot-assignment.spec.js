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

async function queryFixedReservationsByPackage(packageId) {
  const snap = await getDb()
    .collection('privateLessonReservations')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('deductionPackageId', '==', packageId)
    .get();
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

async function queryFixedSlotsByPackage(packageId) {
  const reservations = await queryFixedReservationsByPackage(packageId);
  const refs = reservations
    .map((reservation) => String(reservation.slotId || '').trim())
    .filter(Boolean)
    .map((slotId) => getDb().collection('privateLessonSlots').doc(slotId));
  const snaps = await Promise.all(refs.map((ref) => ref.get()));
  return snaps
    .filter((docSnap) => docSnap.exists)
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

async function createFixture(
  unique,
  {
    totalCount = 4,
    conflict = false,
    createTemplate = true,
    time = '22:40',
    templateStatus = 'active',
    templateHasRange = true,
  } = {}
) {
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
  const otherStudentId = `e2e-fixed-assign-other-student-${unique}`;
  const otherStudentEmail = `fixed-assign-other-student-${unique}@example.com`;
  const otherStudentName = `Fixed Assign Other Student ${unique}`;
  const packageId = `pkg-fixed-assign-${unique}`;
  const otherPackageId = `pkg-fixed-assign-other-${unique}`;
  const templateId = `template-fixed-assign-${unique}`;
  const conflictLessonId = conflict ? `lesson-fixed-assign-conflict-${unique}` : '';
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
  const otherUser = await auth.createUser({
    email: otherStudentEmail,
    password: TEST_STUDENT_PASSWORD,
    displayName: otherStudentName,
  });
  await auth.setCustomUserClaims(otherUser.uid, {
    role: 'student',
    academyId: DEFAULT_E2E_ACADEMY_ID,
    studentId: otherStudentId,
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
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${teacher.uid}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      uid: teacher.uid,
      email: teacher.email,
      displayName: teacher.name,
      role: 'teacher',
      teacherName: teacher.key,
      status: 'active',
      permissions: {},
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
    db.collection('users').doc(otherUser.uid).set({
      uid: otherUser.uid,
      email: otherStudentEmail,
      displayName: otherStudentName,
      role: 'student',
      isActive: true,
      lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
      updatedAt: nowTs,
    }),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${otherUser.uid}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      uid: otherUser.uid,
      email: otherStudentEmail,
      displayName: otherStudentName,
      role: 'student',
      studentId: otherStudentId,
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
    db.collection('privateStudents').doc(otherStudentId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: otherStudentName,
      studentName: otherStudentName,
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
    db.collection('studentPackages').doc(otherPackageId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: otherStudentId,
      studentName: otherStudentName,
      title: `E2E Fixed Assign Other ${unique}`,
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
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(otherStudentId)).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: otherStudentId,
      teacherKeys: [teacher.uid, teacher.key],
      activePackageIds: [otherPackageId],
      allowedSlotIds: [],
      allowedPrivateLessonSlotIds: [],
      privateSlotBookingPilotEnabled: true,
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
  ];

  if (createTemplate) {
    writes.push(
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
        status: templateStatus === 'inactive' ? 'inactive' : 'active',
        ...(templateHasRange
          ? {
              effectiveStartDate: dates[0],
              effectiveEndDate: dates[3],
            }
          : {}),
        createdAt: nowTs,
        updatedAt: nowTs,
      })
    );
  }

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
    otherUser,
    teacher,
    studentId,
    studentEmail,
    studentName,
    otherStudentId,
    otherStudentEmail,
    otherStudentName,
    packageId,
    otherPackageId,
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
  const reservationSnap = await db
    .collection('privateLessonReservations')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('deductionPackageId', '==', fixture.packageId)
    .get()
    .catch(() => ({ docs: [] }));
  const slotRefsFromReservations = reservationSnap.docs
    .map((docSnap) => String(docSnap.data()?.slotId || '').trim())
    .filter(Boolean)
    .map((slotId) => db.collection('privateLessonSlots').doc(slotId));
  const templateSnap = await db
    .collection('privateLessonAvailabilityTemplates')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('teacherKey', '==', fixture.teacher.key)
    .get()
    .catch(() => ({ docs: [] }));
  const refs = [
    db.collection('teachers').doc(fixture.teacher.id),
    db.collection('privateStudents').doc(fixture.studentId),
    db.collection('privateStudents').doc(fixture.otherStudentId),
    db.collection('studentPackages').doc(fixture.packageId),
    db.collection('studentPackages').doc(fixture.otherPackageId),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(fixture.studentId)),
    db.collection('studentPrivateAccessSummary').doc(privateSummaryId(fixture.otherStudentId)),
    db.collection('privateLessonAvailabilityTemplates').doc(fixture.templateId),
    db.collection('users').doc(fixture.user.uid),
    db.collection('users').doc(fixture.otherUser.uid),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${fixture.teacher.uid}`),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${fixture.user.uid}`),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${fixture.otherUser.uid}`),
    ...(fixture.conflictLessonId ? [db.collection('lessons').doc(fixture.conflictLessonId)] : []),
    ...lessonSnap.docs.map((docSnap) => docSnap.ref),
    ...slotRefsFromReservations,
    ...reservationSnap.docs.map((docSnap) => docSnap.ref),
    ...templateSnap.docs.map((docSnap) => docSnap.ref),
  ];
  await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
  await auth.deleteUser(fixture.user.uid).catch(() => {});
  await auth.deleteUser(fixture.otherUser.uid).catch(() => {});
}

async function fillAssignmentForm(page, fixture) {
  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '1:1 예약 시간 관리');
  const section = page.getByTestId('private-fixed-slot-assignment-section');
  await expect(section).toBeVisible({ timeout: 15000 });
  await expect(section).toContainText(
    '먼저 선생님의 주간 1:1 시간표를 만들고, 그 시간에 학생을 고정 배정합니다.'
  );
  await expect(section).toContainText('수강권만 등록하면 수업 일정은 자동 생성되지 않습니다.');
  await expect(section).toContainText(
    '고정 배정은 ‘고정 수업 배정용’으로 켜진 주간 시간에서만 만들 수 있습니다.'
  );
  await expect(section).toContainText(
    '학생 직접 예약 허용은 학생이 직접 예약할 수 있는 공개 시간입니다.'
  );
  await expect(section.getByLabel('배정할 주간 시간 선택')).toBeVisible();
  await selectTeacherOption(
    section.getByTestId('private-fixed-assignment-teacher-select'),
    fixture.teacher.name,
    { timeout: 60000 }
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
  let otherStudentContext = null;
  try {
    testInfo.setTimeout(240000);
    fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}`, { totalCount: 4 });
    const section = await fillAssignmentForm(page, fixture);

    await section.getByTestId('private-fixed-assignment-preview-button').click();
    const preview = section.getByTestId('private-fixed-assignment-preview');
    await expect(preview).toContainText('배정 예정 4회', { timeout: 15000 });
    for (const date of fixture.dates) {
      await expect(preview).toContainText(`${date} ${fixture.time}`);
    }
    await section.getByTestId('private-fixed-assignment-submit-button').click();
    await expect(preview).toContainText('배정 완료 4회', { timeout: 60000 });
    await expect(preview).toContainText('배정 후 새 배정 가능 0회', { timeout: 60000 });

    await expect
      .poll(async () => (await queryFixedReservationsByPackage(fixture.packageId)).length, { timeout: 15000 })
      .toBe(4);
    const reservations = await queryFixedReservationsByPackage(fixture.packageId);
    const slots = await queryFixedSlotsByPackage(fixture.packageId);
    expect(reservations.map((reservation) => reservation.date).sort()).toEqual(fixture.dates);
    expect(slots.map((slot) => slot.date).sort()).toEqual(fixture.dates);
    for (const reservation of reservations) {
      expect(reservation.studentId).toBe(fixture.studentId);
      expect(reservation.studentName).toBe(fixture.studentName);
      expect(reservation.packageId).toBe(fixture.packageId);
      expect(reservation.deductionPackageId).toBe(fixture.packageId);
      expect(reservation.teacherKey).toBe(fixture.teacher.key);
      expect(reservation.teacherUid).toBe(fixture.teacher.uid);
      expect(reservation.time).toBe(fixture.time);
      expect(reservation.durationMinutes).toBe(60);
      expect(reservation.subject).toBe('E2E 고정 1:1');
      expect(reservation.sourceType).toBe('fixed-private-slot-assignment');
      expect(reservation.reservationType).toBe('fixed');
      expect(reservation.status).toBe('active');
      const slot = slots.find((row) => row.id === reservation.slotId);
      expect(slot).toBeTruthy();
      expect(slot.status).toBe('reserved');
      expect(slot.reservedStudentId).toBe(fixture.studentId);
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
    ).toContainText('고정 예약', { timeout: 15000 });

    otherStudentContext = await browser.newContext();
    const otherStudentPage = await otherStudentContext.newPage();
    await loginAsStudent(otherStudentPage, fixture.otherStudentEmail, TEST_STUDENT_PASSWORD);
    await otherStudentPage.goto(`${BASE_URL}student-booking?privateSlotBooking=enabled`);
    await expect(otherStudentPage.getByRole('heading', { name: '수업 예약', exact: true })).toBeVisible({
      timeout: 15000,
    });
    await otherStudentPage.getByTestId('private-slot-view-mode-all').click();
    const otherBusyCard = otherStudentPage
      .locator('[data-testid="student-private-busy-slot-card"]')
      .filter({ hasText: fixture.dates[0] })
      .filter({ hasText: fixture.time });
    await expect(otherBusyCard).toContainText('수업 있음', { timeout: 30000 });
    await otherStudentPage.getByTestId('private-slot-view-mode-available').click();
    await expect(
      otherStudentPage
        .locator('[data-testid="student-private-slot-card"]')
        .filter({ hasText: fixture.dates[0] })
        .filter({ hasText: fixture.time })
    ).toHaveCount(0, { timeout: 15000 });
  } finally {
    await studentContext?.close().catch(() => {});
    await otherStudentContext?.close().catch(() => {});
    await cleanupFixture(fixture);
  }
});

test('fixed assignment can use a single weekly default slot with a date range', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 fixed slot assignment E2E를 실행합니다.');
  test.setTimeout(240000);

  let fixture = null;
  const dialogMessages = [];
  page.on('dialog', async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });
  try {
    fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}-single`, {
      totalCount: 4,
      createTemplate: false,
      time: '22:45',
    });

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '1:1 예약 시간 관리');

    const singleSection = page.getByTestId('private-availability-template-section');
    await selectTeacherOption(
      singleSection.getByTestId('private-availability-template-teacher-select'),
      fixture.teacher.name,
      { timeout: 60000 }
    );
    await singleSection
      .getByTestId('private-availability-template-weekday')
      .selectOption(String(getWeekday(fixture.dates[0])));
    await singleSection.getByTestId('private-availability-template-time').fill(fixture.time);
    await singleSection.locator('input[type="number"]').first().fill('60');
    await singleSection
      .getByTestId('private-availability-template-start-date-input')
      .fill(fixture.dates[0]);
    await singleSection
      .getByTestId('private-availability-template-end-date-input')
      .fill(fixture.dates[3]);
    await singleSection.getByTestId('private-availability-template-add-button').click();

    await expect
      .poll(
        async () => {
          const snap = await getDb()
            .collection('privateLessonAvailabilityTemplates')
            .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
            .where('teacherKey', '==', fixture.teacher.key)
            .where('time', '==', fixture.time)
            .get();
          return snap.size === 0 && dialogMessages.length
            ? `dialog: ${dialogMessages.join('\n')}`
            : String(snap.size);
        },
        { timeout: 15000 }
      )
      .toBe('1');
    const templateSnap = await getDb()
      .collection('privateLessonAvailabilityTemplates')
      .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
      .where('teacherKey', '==', fixture.teacher.key)
      .where('time', '==', fixture.time)
      .get();
    const createdTemplate = { id: templateSnap.docs[0].id, ...templateSnap.docs[0].data() };
    fixture.templateId = createdTemplate.id;
    expect(createdTemplate).toMatchObject({
      effectiveStartDate: fixture.dates[0],
      effectiveEndDate: fixture.dates[3],
      time: fixture.time,
    });

    const fixedSection = page.getByTestId('private-fixed-slot-assignment-section');
    await selectTeacherOption(
      fixedSection.getByTestId('private-fixed-assignment-teacher-select'),
      fixture.teacher.name,
      { timeout: 60000 }
    );
    await expect(
      fixedSection.getByTestId('private-fixed-assignment-template-select')
    ).toContainText(`${fixture.dates[0]} ~ ${fixture.dates[3]}`, { timeout: 15000 });
    await fixedSection
      .getByTestId('private-fixed-assignment-template-select')
      .selectOption(createdTemplate.id);
    await expect(fixedSection.getByTestId('private-fixed-assignment-start-date-input')).toHaveValue(
      fixture.dates[0]
    );
    await expect(fixedSection.getByTestId('private-fixed-assignment-end-date-input')).toHaveValue(
      fixture.dates[3]
    );
    await fixedSection.getByTestId('private-fixed-assignment-student-select').selectOption(fixture.studentId);
    await expect
      .poll(
        () =>
          fixedSection
            .getByTestId('private-fixed-assignment-package-select')
            .locator('option')
            .evaluateAll((options) => options.map((option) => option.value)),
        { timeout: 15000 }
      )
      .toContain(fixture.packageId);
    await fixedSection.getByTestId('private-fixed-assignment-package-select').selectOption(fixture.packageId);
    await fixedSection.getByTestId('private-fixed-assignment-preview-button').click();
    const preview = fixedSection.getByTestId('private-fixed-assignment-preview');
    await expect(preview).toContainText('배정 예정 4회', { timeout: 15000 });
    for (const date of fixture.dates) {
      await expect(preview).toContainText(`${date} ${fixture.time}`);
    }
  } finally {
    await cleanupFixture(fixture);
  }
});

test('admin edits inactive whole-period weekly default slot for fixed assignment', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 fixed slot assignment E2E를 실행합니다.');
  test.setTimeout(120000);

  let fixture = null;
  try {
    fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}-edit`, {
      totalCount: 4,
      time: '22:45',
      templateStatus: 'inactive',
      templateHasRange: false,
    });

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '1:1 예약 시간 관리');

    const singleSection = page.getByTestId('private-availability-template-section');
    const row = singleSection
      .locator('[data-testid="private-availability-template-row"]')
      .filter({ hasText: fixture.teacher.name })
      .filter({ hasText: fixture.time });
    await expect(row.getByTestId('private-availability-template-status-cell')).toContainText('비활성', {
      timeout: 60000,
    });
    await expect(row.getByTestId('private-availability-template-period-cell')).toContainText(
      '기간 제한 없음',
      { timeout: 60000 }
    );

    await row.getByTestId('private-availability-template-edit-button').click();
    const editForm = singleSection.getByTestId('private-availability-template-edit-form');
    await expect(editForm).toBeVisible();
    await editForm.getByTestId('private-availability-template-edit-start-date-input').fill(fixture.dates[0]);
    await editForm.getByTestId('private-availability-template-edit-end-date-input').fill(fixture.dates[3]);
    await editForm.getByTestId('private-availability-template-edit-status-select').selectOption('active');
    await editForm.getByTestId('private-availability-template-edit-save-button').click();

    await expect
      .poll(
        async () => {
          const snap = await getDb()
            .collection('privateLessonAvailabilityTemplates')
            .doc(fixture.templateId)
            .get();
          const data = snap.data() || {};
          return [
            data.status,
            data.effectiveStartDate || '',
            data.effectiveEndDate || '',
          ].join('|');
        },
        { timeout: 60000 }
      )
      .toBe(`active|${fixture.dates[0]}|${fixture.dates[3]}`);
    await expect(row.getByTestId('private-availability-template-status-cell')).toContainText('사용', {
      timeout: 60000,
    });
    await expect(row.getByTestId('private-availability-template-period-cell')).toContainText(
      `${fixture.dates[0]} ~ ${fixture.dates[3]}`,
      { timeout: 60000 }
    );
    const updatedTemplate = (
      await getDb().collection('privateLessonAvailabilityTemplates').doc(fixture.templateId).get()
    ).data();
    expect(updatedTemplate).toMatchObject({
      status: 'active',
      effectiveStartDate: fixture.dates[0],
      effectiveEndDate: fixture.dates[3],
    });

    const fixedSection = page.getByTestId('private-fixed-slot-assignment-section');
    await selectTeacherOption(
      fixedSection.getByTestId('private-fixed-assignment-teacher-select'),
      fixture.teacher.name,
      { timeout: 60000 }
    );
    await expect
      .poll(
        () =>
          fixedSection
            .getByTestId('private-fixed-assignment-template-select')
            .locator('option')
            .evaluateAll((options) => options.map((option) => option.value)),
        { timeout: 60000 }
      )
      .toContain(fixture.templateId);
    await expect(
      fixedSection.getByTestId('private-fixed-assignment-template-select')
    ).toContainText(`${fixture.dates[0]} ~ ${fixture.dates[3]}`, { timeout: 60000 });
    await fixedSection.getByTestId('private-fixed-assignment-template-select').selectOption(fixture.templateId);
    await fixedSection.getByTestId('private-fixed-assignment-student-select').selectOption(fixture.studentId);
    await expect
      .poll(
        () =>
          fixedSection
            .getByTestId('private-fixed-assignment-package-select')
            .locator('option')
            .evaluateAll((options) => options.map((option) => option.value)),
        { timeout: 60000 }
      )
      .toContain(fixture.packageId);
    await fixedSection.getByTestId('private-fixed-assignment-package-select').selectOption(fixture.packageId);
    await fixedSection.getByTestId('private-fixed-assignment-preview-button').click();
    const preview = fixedSection.getByTestId('private-fixed-assignment-preview');
    await expect(preview).toContainText('배정 예정 4회', { timeout: 15000 });
    for (const date of fixture.dates) {
      await expect(preview).toContainText(`${date} ${fixture.time}`);
    }
  } finally {
    await cleanupFixture(fixture);
  }
});

test('fixed assignment excludes student-direct-only weekly availability', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 fixed slot assignment E2E를 실행합니다.');
  test.setTimeout(120000);

  let fixture = null;
  try {
    fixture = await createFixture(`${Date.now()}-${testInfo.workerIndex}-direct-only`, {
      totalCount: 4,
      time: '22:45',
    });
    const directOnlyTemplateId = `template-direct-only-${Date.now()}-${testInfo.workerIndex}`;
    await getDb().collection('privateLessonAvailabilityTemplates').doc(directOnlyTemplateId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: fixture.teacher.key,
      teacherName: fixture.teacher.name,
      teacherKey: fixture.teacher.key,
      teacherUid: fixture.teacher.uid,
      teacherEmail: fixture.teacher.email,
      weekday: getWeekday(fixture.dates[0]),
      time: '22:55',
      durationMinutes: 60,
      status: 'active',
      effectiveStartDate: fixture.dates[0],
      effectiveEndDate: fixture.dates[3],
      useForFixedAssignment: false,
      openForStudentBooking: true,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    });

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '1:1 예약 시간 관리');
    const fixedSection = page.getByTestId('private-fixed-slot-assignment-section');
    await selectTeacherOption(
      fixedSection.getByTestId('private-fixed-assignment-teacher-select'),
      fixture.teacher.name,
      { timeout: 60000 }
    );
    const templateOptionValues = await fixedSection
      .getByTestId('private-fixed-assignment-template-select')
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value));
    expect(templateOptionValues).toContain(fixture.templateId);
    expect(templateOptionValues).not.toContain(directOnlyTemplateId);
    await expect(
      fixedSection.getByTestId('private-fixed-assignment-template-select')
    ).toContainText(fixture.time, { timeout: 15000 });
    await expect(
      fixedSection.getByTestId('private-fixed-assignment-template-select')
    ).not.toContainText('22:55');
  } finally {
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
      .poll(async () => (await queryFixedReservationsByPackage(fixture.packageId)).length, { timeout: 8000 })
      .toBe(0);
    await expect
      .poll(async () => (await queryFixedSlotsByPackage(fixture.packageId)).length, { timeout: 8000 })
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
      .poll(async () => (await queryFixedReservationsByPackage(fixture.packageId)).length, { timeout: 8000 })
      .toBe(0);
    await expect
      .poll(async () => (await queryFixedSlotsByPackage(fixture.packageId)).length, { timeout: 8000 })
      .toBe(0);
  } finally {
    await cleanupFixture(fixture);
  }
});
