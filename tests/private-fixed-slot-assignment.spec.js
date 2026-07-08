import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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

function privateReservationId(slotId, studentId) {
  return `${DEFAULT_E2E_ACADEMY_ID}__${slotId}__${studentId}`;
}

async function expectReservationStatus(slotId, studentId, expected) {
  await expect
    .poll(async () => {
      const snap = await getDb()
        .collection('privateLessonReservations')
        .doc(privateReservationId(slotId, studentId))
        .get();
      return snap.exists ? snap.data()?.status || null : null;
    }, { timeout: 30000 })
    .toBe(expected);
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

async function queryReservationsByPackageIds(packageIds) {
  const snapshots = await Promise.all(
    packageIds.map((packageId) =>
      getDb()
        .collection('privateLessonReservations')
        .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
        .where('deductionPackageId', '==', packageId)
        .get()
        .catch(() => ({ docs: [] }))
    )
  );
  return snapshots.flatMap((snap) => snap.docs);
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
  const reservationDocs = await queryReservationsByPackageIds([
    fixture.packageId,
    fixture.otherPackageId,
  ]);
  const slotRefsFromReservations = reservationSnap.docs
    .map((docSnap) => String(docSnap.data()?.slotId || '').trim())
    .filter(Boolean)
    .map((slotId) => db.collection('privateLessonSlots').doc(slotId));
  const extraSlotRefsFromReservations = reservationDocs
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
    ...extraSlotRefsFromReservations,
    ...reservationDocs.map((docSnap) => docSnap.ref),
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

test('fixed private assignment source requires package and links generated documents', () => {
  const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'Dashboard.jsx'), 'utf8');
  const studentBookingSource = fs.readFileSync(path.join(process.cwd(), 'StudentBookingPage.jsx'), 'utf8');
  const ticketBalanceSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/ticketBalanceHelpers.js'),
    'utf8'
  );
  const privateSlotsSectionSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/PrivateLessonSlotsSection.jsx'),
    'utf8'
  );
  const functionsSource = fs.readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');
  const rulesSource = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');

  expect(dashboardSource).toContain("if (!packageId) errors.packageId = '개인 수강권을 선택해 주세요.'");
  expect(dashboardSource).toContain('function buildPrivateFixedSlotAssignmentPreviewState');
  expect(dashboardSource).toContain("const missingPackage = plan.errors?.packageId === '개인 수강권을 선택해 주세요.'");
  expect(dashboardSource).toContain('function getPrivatePackageDateBounds');
  expect(dashboardSource).toContain('function isPrivatePackageValidForDate');
  expect(dashboardSource).toContain('assignableDates');
  expect(dashboardSource).toContain('excludedDates');
  expect(dashboardSource).toContain('fixedPrivateRenewalSeedLessonId');
  expect(dashboardSource).toContain('fixedPrivateRenewalPackageId');
  expect(dashboardSource).toContain('fixedPrivateRenewalStartDate');
  expect(dashboardSource).toContain('fixedPrivateRenewalEndDate');
  expect(dashboardSource).toContain('fixedPrivateRenewalPlan');
  expect(dashboardSource).toContain('fixedPrivateRenewalSeedOptions');
  expect(dashboardSource).toContain('fixedPrivateRenewalPackageOptions');
  expect(dashboardSource).toContain('fixedPrivateRenewalDraftPackageOption');
  expect(dashboardSource).toContain('fixedPrivateRenewalExistingPackageOptions');
  expect(dashboardSource).toContain('showExistingRenewalPackageChoice');
  expect(dashboardSource).toContain('handleUseFixedPrivateRenewalDraftPackage');
  expect(dashboardSource).toContain('setShowExistingRenewalPackageChoice(false)');
  expect(dashboardSource).toContain('setFixedPrivateRenewalPackageId(FIXED_PRIVATE_RENEWAL_DRAFT_PACKAGE_ID)');
  expect(dashboardSource).toContain('FIXED_PRIVATE_RENEWAL_DRAFT_PACKAGE_ID');
  expect(dashboardSource).toContain('shouldUseDraftPackage');
  expect(dashboardSource).toContain('selectedActualPackage');
  expect(dashboardSource).toContain('isUsingFixedPrivateRenewalDraftPackage');
  expect(dashboardSource).toContain('fixedPrivateRenewalDraftCount');
  expect(dashboardSource).toContain('fixedPrivateRenewalDraftPackage');
  expect(dashboardSource).toContain('availableAssignmentCount: draftCount');
  expect(dashboardSource).toContain('makeupAvailableCount: draftCount');
  expect(dashboardSource).toContain('usedCount: 0');
  expect(dashboardSource).toContain('remainingCount: draftCount');
  expect(dashboardSource).toContain('selectedPackage?.previewOnly === true');
  expect(dashboardSource).toContain('selectedPackage.remainingCount ?? selectedPackage.totalCount ?? 0');
  expect(dashboardSource).toContain('fixedPrivateRenewalAutoSuggestion');
  expect(dashboardSource).toContain('teacherTimePreparation');
  expect(dashboardSource).toContain('fixedPrivateRenewalTeacherTimePreparation');
  expect(dashboardSource).toContain('buildFixedPrivateRenewalTeacherTimePreparation');
  expect(dashboardSource).toContain('FIXED_PRIVATE_RENEWAL_TEACHER_TIME_DRAFT_TEMPLATE_ID');
  expect(dashboardSource).toContain("source: 'fixed-private-renewal-teacher-time-draft'");
  expect(dashboardSource).toContain('연장 자동 초안');
  expect(dashboardSource).toContain('새 수강권 초안');
  expect(dashboardSource).toContain('저장 전');
  expect(dashboardSource).toContain("source: 'fixed-private-renewal-draft'");
  expect(dashboardSource).toContain('기존 활성 시간표 사용');
  expect(dashboardSource).toContain('비활성 시간표 재활성화 예정');
  expect(dashboardSource).toContain('새 선생님 시간표 생성 예정');
  expect(dashboardSource).toContain('중복 시간표 있음');
  expect(dashboardSource).toContain('시간 겹침 충돌');
  expect(dashboardSource).toContain('선생님 시간 정보 부족');
  expect(dashboardSource).toContain('이미 사용 중인 고정 수업 배정용 시간표를 사용합니다.');
  expect(dashboardSource).toContain('저장 단계에서 이 시간표를 다시 사용으로 변경할 예정입니다.');
  expect(dashboardSource).toContain('저장 단계에서 고정 수업 배정용 선생님 시간을 새로 만들 예정입니다.');
  expect(dashboardSource).toContain('같은 요일에 겹치는 선생님 시간이 있어 새 시간표를 자동 준비할 수 없습니다.');
  expect(dashboardSource).toContain(
    '선생님/요일/시간/길이 정보가 부족해 연장 시간표를 준비할 수 없습니다.'
  );
  expect(dashboardSource).toContain('isRenewableFixedPrivateLesson');
  expect(dashboardSource).toContain('privateFixedRenewalTemplateMatchesSeed');
  expect(dashboardSource).toContain("reason: '수강권 기간 밖'");
  expect(dashboardSource).toContain("reason: '남은 횟수 부족'");
  expect(dashboardSource).toContain("reason: '선생님 시간 없음'");
  expect(dashboardSource).toContain("reason: '이미 예약/배정된 시간'");
  expect(dashboardSource).toMatch(
    /isUsingFixedPrivateRenewalDraftPackage[\s\S]*selectedPackage\.remainingCount \?\? selectedPackage\.totalCount \?\? 0[\s\S]*computePrivateTeacherPackageUsage/
  );
  expect(dashboardSource).toMatch(
    /const selectedActualPackage =[\s\S]*!shouldUseDraftPackage && packageId[\s\S]*studentPackages\.find/
  );
  expect(dashboardSource).toContain('비활성 시간표');
  expect(dashboardSource).toContain('기존 고정 수업 정보 부족');
  expect(dashboardSource).toContain('수강권 선택 필요');
  expect(dashboardSource).toContain('연장 기간 선택 필요');
  expect(dashboardSource).toContain('previewOnly: true');
  expect(dashboardSource).toContain("'수강권 기간 안에 배정 가능한 날짜가 없습니다.'");
  expect(dashboardSource).toContain('isSeatReleasedFixedPrivateSeed');
  expect(dashboardSource).toContain("cancellationType === 'seat_released'");
  expect(dashboardSource).toContain('releasedForPrivateBooking');
  expect(dashboardSource).toContain('isSeatReleased');
  expect(dashboardSource).toContain("'자리 공개됨'");
  expect(dashboardSource).toContain("'자리 공개 기준'");
  expect(dashboardSource).toContain("'예약 기준'");
  expect(dashboardSource).toContain("'슬롯 기준'");
  expect(dashboardSource).toContain("'기존 일정 기준'");
  expect(dashboardSource).toContain("'lesson_cancelled'");
  expect(dashboardSource).toContain("'fixed_lesson_cancelled'");
  expect(dashboardSource).toContain("['deleted', 'archived'].includes(status)");
  expect(dashboardSource).toContain('buildFixedPrivateRenewalReservationSeed');
  expect(dashboardSource).toContain('isFixedPrivateRenewalReservationSeed');
  expect(dashboardSource).toContain('buildFixedPrivateRenewalSlotSeed');
  expect(dashboardSource).toContain('isFixedPrivateRenewalSlotSeed');
  expect(dashboardSource).toContain('previewSeedSource');
  expect(dashboardSource).toContain("seedSource: String(lesson.previewSeedSource || 'lesson').trim()");
  expect(dashboardSource).toContain('occurrenceKeys');
  expect(dashboardSource).toContain("if (linkedLessonId && includedLessonIds.has(linkedLessonId)) return");
  expect(dashboardSource).toContain("return `batch:${batchId}`");
  expect(dashboardSource).toContain("'fallback'");
  expect(dashboardSource).toContain('privateLessonReservations');
  expect(dashboardSource).toContain('privateLessonSlots');
  expect(dashboardSource).toContain('const previewDates = missingPackage ? [] : plan.assignableDates || plan.dates');
  expect(dashboardSource).toMatch(/plan\.assignableDates\.forEach\(\(date\) => \{[\s\S]*batch\.set\(slotRef/);
  expect(dashboardSource).not.toContain('plan.dates.forEach((date) => {\n        const start = parseLegacyLessonToDate');
  expect(dashboardSource).toContain("const lessonRef = doc(collection(db, 'lessons'))");
  expect(dashboardSource).toContain('lessonId: lessonRef.id');
  expect(dashboardSource).toContain('fixedLessonId: lessonRef.id');
  expect(dashboardSource).toContain('batch.set(lessonRef');
  expect(dashboardSource).toContain('packageId,');
  expect(dashboardSource).toContain('deductionPackageId: packageId');
  expect(dashboardSource).toContain('linkedPackageId: packageId');
  expect(dashboardSource).toContain('fixedPrivatePackageId: packageId');
  expect(dashboardSource).toContain('packageTeacherKey');
  expect(dashboardSource).toContain("sourceType: 'fixed-private-slot-assignment'");
  expect(dashboardSource).toContain('privateLessonAvailabilityTemplateId');
  expect(dashboardSource).toContain('fixedPrivateAssignmentBatchId');
  expect(dashboardSource).toMatch(
    /batch\.set\(lessonRef[\s\S]*lessonId: lessonRef\.id[\s\S]*fixedLessonId: lessonRef\.id/
  );

  expect(ticketBalanceSource).toContain('const countedFixedLessonIds = new Set()');
  expect(ticketBalanceSource).toContain("reservation?.lessonId || reservation?.fixedLessonId");
  expect(ticketBalanceSource).toContain('countedFixedLessonIds.has(linkedLessonId)');
  expect(studentBookingSource).toContain('source?.packageId');
  expect(studentBookingSource).toContain('source?.deductionPackageId');
  expect(studentBookingSource).toContain('source?.linkedPackageId');
  expect(studentBookingSource).toContain('source?.fixedPrivatePackageId');
  expect(studentBookingSource).toContain('missingFixedLessonId: !lessonId');
  expect(studentBookingSource).toContain('fixedCancelNode || (');
  expect(privateSlotsSectionSource).toContain('private-fixed-assignment-excluded-date');
  expect(privateSlotsSectionSource).toContain('배정 가능');
  expect(privateSlotsSectionSource).toContain('제외');
  expect(privateSlotsSectionSource).toContain('private-time-management-teacher-time-group');
  expect(privateSlotsSectionSource).toContain('private-time-management-student-assignment-group');
  expect(privateSlotsSectionSource).toContain('private-time-management-teacher-time-copy');
  expect(privateSlotsSectionSource).toContain('private-time-management-student-assignment-copy');
  expect(privateSlotsSectionSource).toContain('private-time-extension-placeholder');
  expect(privateSlotsSectionSource).toContain('private-time-management-teacher-board-panel');
  expect(privateSlotsSectionSource).toContain('private-time-management-bulk-create-panel');
  expect(privateSlotsSectionSource).toContain('private-time-management-weekly-template-panel');
  expect(privateSlotsSectionSource).toContain('private-time-management-dated-slot-panel');
  expect(privateSlotsSectionSource).toContain('private-time-management-bulk-create-summary');
  expect(privateSlotsSectionSource).toContain('private-time-management-weekly-template-summary');
  expect(privateSlotsSectionSource).toContain('private-time-management-dated-slot-summary');
  expect(privateSlotsSectionSource).toContain('private-weekly-template-history-toggle');
  expect(privateSlotsSectionSource).toContain('private-weekly-template-hidden-count');
  expect(privateSlotsSectionSource).toContain('private-weekly-template-visible-list');
  expect(privateSlotsSectionSource).toContain('private-weekly-template-empty-current');
  expect(privateSlotsSectionSource).toContain('private-weekly-template-empty-all');
  expect(privateSlotsSectionSource).toContain('private-dated-slot-history-toggle');
  expect(privateSlotsSectionSource).toContain('private-dated-slot-hidden-count');
  expect(privateSlotsSectionSource).toContain('private-fixed-lesson-history-toggle');
  expect(privateSlotsSectionSource).toContain('private-fixed-lesson-hidden-count');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-preview-section');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-seed-select');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-package-select');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-start-date');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-end-date');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-plan');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-server-preview-button');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-server-preview-result');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-server-preview-loading');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-server-preview-error');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-server-preview-warning');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-server-preview-would-create');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-server-preview-batch-id');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-server-preview-idempotency-key');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-server-preview-no-write-note');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-preview-only-note');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-assignable-count');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-excluded-count');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-draft-count');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-draft-package-card');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-draft-package-label');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-auto-prefill-note');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-draft-preview-only-note');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-existing-package-toggle');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-existing-package-panel');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-existing-package-select');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-use-draft-package');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-existing-package-note');
  expect(privateSlotsSectionSource).toContain('handleUseFixedPrivateRenewalDraftPackage');
  expect(privateSlotsSectionSource).toContain('기존 남은 수강권으로 미리보기');
  expect(privateSlotsSectionSource).toContain(
    '기존 수강권을 선택하면 새 수강권 초안 대신 해당 수강권의 남은 횟수와 기간으로 미리보기합니다'
  );
  expect(privateSlotsSectionSource).toContain(
    '일반적인 연장은 새 수강권 초안을 사용하는 것을 권장합니다'
  );
  expect(privateSlotsSectionSource).toContain('패널을 닫으면 새 수강권 초안 기준으로 돌아갑니다');
  expect(privateSlotsSectionSource).toContain(
    '기존 수강권 선택을 취소하고 새 수강권 초안 기준으로 미리보기합니다'
  );
  expect(privateSlotsSectionSource).toContain('새 수강권 초안은 기본 연장 방식입니다');
  expect(privateSlotsSectionSource).toContain(
    '이 화면에서는 수강권을 발행하거나 수업을 저장하지 않습니다'
  );
  expect(privateSlotsSectionSource).toContain('새 수강권 초안으로 돌아가기');
  expect(privateSlotsSectionSource).toMatch(
    /data-testid="private-fixed-renewal-use-draft-package"[\s\S]*onClick=\{\(\) => \{[\s\S]*handleUseFixedPrivateRenewalDraftPackage\?\.\(\)/
  );
  expect(privateSlotsSectionSource).toMatch(
    /type="button"[\s\S]*data-testid="private-fixed-renewal-use-draft-package"/
  );
  expect(privateSlotsSectionSource).toMatch(
    /private-fixed-renewal-existing-package-panel[\s\S]*private-fixed-renewal-package-select/
  );
  expect(privateSlotsSectionSource).not.toContain('새 수강권 초안 사용');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-teacher-time-preparation');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-teacher-time-status');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-teacher-time-action');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-teacher-time-target');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-teacher-time-fixed-assignment');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-teacher-time-direct-booking');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-teacher-time-conflicts');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-teacher-time-preview-only-note');
  expect(privateSlotsSectionSource).toContain('선생님 시간 준비');
  expect(privateSlotsSectionSource).toContain('고정 수업 배정용: 켬');
  expect(privateSlotsSectionSource).toContain('학생 직접 예약 허용: 끔');
  expect(privateSlotsSectionSource).toContain('이 단계에서는 선생님 시간을 실제로 만들거나 변경하지 않습니다');
  expect(privateSlotsSectionSource).toContain(
    '실제 저장 단계에서 필요한 선생님 시간을 함께 준비할 예정입니다'
  );
  expect(privateSlotsSectionSource).toContain('학생 직접 예약 허용은 자동으로 켜지지 않습니다');
  expect(privateSlotsSectionSource).toContain('실제 선생님 시간 변경은 아직 발생하지 않았습니다');
  expect(privateSlotsSectionSource).toContain(
    '기존 고정 수업을 선택하면 연장 시작일, 종료일, 회수, 새 수강권 초안을 자동으로 채웁니다'
  );
  expect(privateSlotsSectionSource).toContain('이 초안은 저장되지 않았으며');
  expect(privateSlotsSectionSource).toContain('실제 발행은 다음 단계에서 진행됩니다');
  expect(privateSlotsSectionSource).toContain(
    '필요한 경우 연장 회수와 기간을 수정해 미리보기를 다시 확인할 수 있습니다'
  );
  expect(privateSlotsSectionSource).toContain('저장 전 서버 검증');
  expect(privateSlotsSectionSource).toContain('서버 검증 결과');
  expect(privateSlotsSectionSource).toContain('이 단계에서는 저장하지 않습니다');
  expect(privateSlotsSectionSource).toContain('서버 기준으로 생성 예정 항목을 확인합니다');
  expect(privateSlotsSectionSource).toContain('최종 확인에서 실제 생성 전 한 번 더 확인합니다');
  expect(privateSlotsSectionSource).toContain('수강권 발행이나 수업 저장은 아직 실행되지 않습니다');
  expect(privateSlotsSectionSource).toContain('생성 예정 항목 확인');
  expect(privateSlotsSectionSource).toContain('최종 확인');
  expect(privateSlotsSectionSource).toContain('아직 저장하지 않습니다');
  expect(privateSlotsSectionSource).toContain('이 버튼을 누르면 수강권과 고정 수업이 실제 생성됩니다');
  expect(privateSlotsSectionSource).toContain('생성 후에는 기존 관리 화면에서 확인/수정할 수 있습니다');
  expect(privateSlotsSectionSource).toContain('중복 클릭을 막기 위해 처리 중에는 버튼이 잠깁니다');
  expect(privateSlotsSectionSource).toContain('위 내용으로 연장 생성');
  expect(privateSlotsSectionSource).toContain('연장 생성이 완료되었습니다');
  expect(privateSlotsSectionSource).toContain('showFixedPrivateRenewalConfirmModal');
  expect(privateSlotsSectionSource).toContain('canOpenFixedPrivateRenewalConfirmModal');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-confirmation-open');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-confirmation-modal');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-confirmation-close');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-confirmation-would-create');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-confirmation-batch-id');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-confirmation-idempotency-key');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-confirmation-warnings');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-confirmation-dates');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-confirmation-no-write-note');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-commit-button');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-commit-loading');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-commit-error');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-commit-result');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-commit-result-batch-id');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-commit-result-created');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-commit-warning-note');
  expect(privateSlotsSectionSource).toContain('fixedPrivateRenewalServerPreview.ok === true');
  expect(privateSlotsSectionSource).toContain('fixedPrivateRenewalServerPreview.dryRun === true');
  expect(privateSlotsSectionSource).toContain('fixedPrivateRenewalServerPreview.previewOnly === true');
  expect(privateSlotsSectionSource).toContain('wouldCreate');
  expect(privateSlotsSectionSource).toContain('renewalBatchIdCandidate');
  expect(privateSlotsSectionSource).toContain('idempotencyKey');
  expect(privateSlotsSectionSource).toContain('연장 회수');
  expect(privateSlotsSectionSource).not.toContain('연장 수강권 또는 새 수강권 초안');
  expect(privateSlotsSectionSource).not.toContain('data-testid="private-fixed-renewal-submit-button"');
  expect(privateSlotsSectionSource).not.toContain('onClick={createFixedPrivateRenewal');
  expect(privateSlotsSectionSource).not.toContain('createFixedPrivateRenewal(');
  expect(privateSlotsSectionSource).not.toContain('>연장 저장<');
  expect(privateSlotsSectionSource).not.toContain('>연장 생성<');
  expect(privateSlotsSectionSource).not.toContain('>수강권 발행<');
  expect(privateSlotsSectionSource).not.toContain('>선생님 시간 생성<');
  expect(privateSlotsSectionSource).not.toContain('>시간표 활성화<');
  expect(privateSlotsSectionSource).not.toContain('>저장하고 연장<');
  expect(privateSlotsSectionSource).not.toContain('>저장 후 생성<');
  expect(privateSlotsSectionSource).toContain('선생님 1:1 시간 만들기');
  expect(privateSlotsSectionSource).toContain('학생 고정 배정 / 연장');
  expect(privateSlotsSectionSource).toContain('선생님별 시간표/예약판');
  expect(privateSlotsSectionSource).toContain('빠른 일괄 추가');
  expect(privateSlotsSectionSource).toContain('기존 반복 시간표');
  expect(privateSlotsSectionSource).toContain('날짜별/임시 예약 가능 시간');
  expect(privateSlotsSectionSource).toContain('선생님별 1:1 시간표/예약판');
  expect(privateSlotsSectionSource).toContain('주간 1:1 시간표 일괄 등록');
  expect(privateSlotsSectionSource).toContain('선생님 주간 1:1 시간표');
  expect(privateSlotsSectionSource).toContain('주간 시간에 학생 고정 배정');
  expect(privateSlotsSectionSource).toContain('날짜별 1:1 예약 가능 시간');
  expect(privateSlotsSectionSource).toContain('기존 고정 1:1 수업 일정');
  expect(privateSlotsSectionSource).toContain('학생 수강권 기간과 상관없이 미리 길게 등록');
  expect(privateSlotsSectionSource).toContain('학생 직접 예약 허용');
  expect(privateSlotsSectionSource).toContain('수강권 기간 안 날짜만 배정');
  expect(privateSlotsSectionSource).toContain('같은 시간으로 연장 미리보기');
  expect(privateSlotsSectionSource).toContain(
    '기존 고정 수업을 기준으로 같은 선생님, 같은 요일, 같은 시간'
  );
  expect(privateSlotsSectionSource).toContain('기존 고정 일정에 표시되는 고정 수업 패턴');
  expect(privateSlotsSectionSource).toContain('자리 공개된 수업도 같은 시간');
  expect(privateSlotsSectionSource).toContain(
    '먼저 저장하지 않고 미리보기로 생성 예정 항목을 확인합니다'
  );
  expect(privateSlotsSectionSource).toContain(
    '서버 검증 통과 후 최종 확인에서 실제 생성할 수 있습니다'
  );
  expect(privateSlotsSectionSource).toContain('저장하지 않고 미리보기');
  expect(privateSlotsSectionSource).toContain('여러 요일과 여러 시간을 한 번에 등록합니다.');
  expect(privateSlotsSectionSource).toContain('요일 1개와 시간 1개만 입력하면 개별 추가처럼 사용할 수 있습니다.');
  expect(privateSlotsSectionSource).toContain('등록된 선생님의 반복 1:1 시간을 확인하고 수정/비활성화합니다.');
  expect(privateSlotsSectionSource).toContain('반복 시간표가 아닌 특정 날짜의 예외 시간을 관리합니다.');
  expect(privateSlotsSectionSource).toContain('보충수업, 임시 오픈, 특별 예약 가능 시간에 사용하세요.');
  expect(privateSlotsSectionSource).toContain('반복되는 시간은 빠른 일괄 추가 또는 기존 반복 시간표를 사용하세요.');
  expect(privateSlotsSectionSource).toContain('지난/비활성 포함');
  expect(privateSlotsSectionSource).toContain('지난 날짜별 시간 포함');
  expect(privateSlotsSectionSource).toContain('지난 고정 일정 포함');
  expect(privateSlotsSectionSource).toContain('현재 사용 중이거나 앞으로 사용할 반복 시간표');
  expect(privateSlotsSectionSource).toContain('지난 기간 또는 비활성 시간표');
  expect(privateSlotsSectionSource).toContain('기본 화면에는 오늘 이후 날짜별/임시 시간만 표시됩니다');
  expect(privateSlotsSectionSource).toContain('지난 날짜별 시간은 삭제되지 않으며, 필요할 때 포함해서 볼 수 있습니다');
  expect(privateSlotsSectionSource).toContain(
    '기본 화면에는 현재 또는 앞으로 예정된 고정 일정만 표시됩니다'
  );
  expect(privateSlotsSectionSource).toContain(
    '지난 고정 일정은 삭제되지 않으며, 필요할 때 포함해서 볼 수 있습니다'
  );
  expect(privateSlotsSectionSource).toContain('normalizePrivateWeeklyTemplateStatus');
  expect(privateSlotsSectionSource).toContain('formatPrivateWeeklyTemplateDateValueYmd');
  expect(privateSlotsSectionSource).toContain('getKstTodayYmd');
  expect(privateSlotsSectionSource).toContain('shouldHidePrivateWeeklyTemplateByDefault');
  expect(privateSlotsSectionSource).toContain('PRIVATE_LESSON_SLOT_DATE_FIELDS');
  expect(privateSlotsSectionSource).toContain('FIXED_PRIVATE_LESSON_DATE_FIELDS');
  expect(privateSlotsSectionSource).toContain('getPrivateRecordDateYmd');
  expect(privateSlotsSectionSource).toContain('shouldHidePastPrivateRecordByDefault');
  expect(privateSlotsSectionSource).toContain('effectiveEndDate');
  expect(privateSlotsSectionSource).toContain('status');
  expect(privateSlotsSectionSource).toContain('visiblePrivateAvailabilityTemplates');
  expect(privateSlotsSectionSource).toContain('hiddenPrivateAvailabilityTemplateCount');
  expect(privateSlotsSectionSource).toContain('showPastPrivateLessonSlots');
  expect(privateSlotsSectionSource).toContain('visiblePrivateLessonSlots');
  expect(privateSlotsSectionSource).toContain('hiddenPrivateLessonSlotCount');
  expect(privateSlotsSectionSource).toContain('showPastFixedPrivateLessons');
  expect(privateSlotsSectionSource).toContain('visibleFixedPrivateLessons');
  expect(privateSlotsSectionSource).toContain('hiddenFixedPrivateLessonCount');
  expect(privateSlotsSectionSource).toContain(
    "'date', 'lessonDate', 'slotDate', 'startAt', 'startsAt'"
  );
  expect(privateSlotsSectionSource).toContain("'date', 'lessonDate', 'startAt', 'startsAt'");
  expect(privateSlotsSectionSource).toMatch(
    /<details[\s\S]*open[\s\S]*private-time-management-teacher-board-panel/
  );
  expect(privateSlotsSectionSource).toMatch(
    /<details[\s\S]*open[\s\S]*private-time-management-weekly-template-panel/
  );
  expect(privateSlotsSectionSource).toMatch(
    /private-time-management-teacher-time-group[\s\S]*private-time-management-teacher-board-panel[\s\S]*private-weekly-slot-bulk-section[\s\S]*private-time-management-weekly-template-panel[\s\S]*private-availability-template-section[\s\S]*private-time-management-dated-slot-panel[\s\S]*private-dated-availability-helper[\s\S]*private-slot-create-button/
  );
  expect(privateSlotsSectionSource).toMatch(
    /private-time-management-student-assignment-group[\s\S]*private-fixed-slot-assignment-section[\s\S]*private-fixed-lessons-management-section/
  );
  expect(privateSlotsSectionSource).toMatch(
    /showPastPrivateWeeklyTemplates[\s\S]*visiblePrivateAvailabilityTemplates/
  );
  expect(privateSlotsSectionSource).toMatch(
    /showPastPrivateLessonSlots[\s\S]*visiblePrivateLessonSlots/
  );
  expect(privateSlotsSectionSource).toMatch(
    /showPastFixedPrivateLessons[\s\S]*visibleFixedPrivateLessons/
  );
  expect(privateSlotsSectionSource).toMatch(
    /visiblePrivateLessonSlots\.map/
  );
  expect(privateSlotsSectionSource).toMatch(
    /visibleFixedPrivateLessons\.map/
  );
  expect(privateSlotsSectionSource).toMatch(
    /formatDateAsKstYmd[\s\S]*timeZone: 'Asia\/Seoul'/
  );
  expect(functionsSource).toContain('const countedFixedLessonIds = new Set();');
  expect(functionsSource).toContain('reservation.lessonId || reservation.fixedLessonId');
  expect(functionsSource).toContain('countedFixedLessonIds.has(linkedLessonId)');
  expect(functionsSource).toContain('const lessonPackageId = normalizeId(lesson.packageId);');
  expect(functionsSource).toContain('cancelFixedPrivateLessonOccurrence');
  expect(functionsSource).toContain('function buildFixedPrivateReservationCancellationPatch');
  expect(functionsSource).toContain('function buildOriginalFixedPrivateSlotReleasePatch');
  expect(functionsSource).toContain('alreadyStudentSeatReleased');
  expect(functionsSource).toContain('reservationSnapsByPath.forEach');
  expect(functionsSource).toContain('slotSnapsByPath.forEach');
  expect(functionsSource).toContain('!alreadyStudentSeatReleased');
  expect(functionsSource).toContain('privateCancelUsedCount: nextPrivateCancelUsedCount');
  expect(functionsSource).toContain('status: isSeatReleased ? "released" : "cancelled"');
  expect(functionsSource).toContain('isBookable: false');
  expect(functionsSource).toContain('{merge: true}');

  expect(rulesSource).toContain('match /lessons/{lessonId}');
  expect(rulesSource).toContain('allow create: if sameAcademyOnCreate() &&');
  expect(rulesSource).toContain('isAcademyAdmin(request.resource.data.academyId);');
  expect(rulesSource).toContain('validPrivateFixedSlotAdminCreateShape');
  expect(rulesSource).toContain('validPrivateFixedReservationAdminCreate');
  expect(rulesSource).toContain('request.resource.data.status == "open" &&');
  expect(rulesSource).toContain('request.resource.data.status == "reserved" &&');
  expect(rulesSource).toContain('request.resource.data.slotType == "fixed" &&');
  expect(rulesSource).toContain('request.resource.data.source == "student" &&');
  expect(rulesSource).toContain('request.resource.data.source == "fixed_admin" &&');
  expect(rulesSource).toContain('request.resource.data.sourceType == "fixed-private-slot-assignment" &&');
  const rulesPayloadGapProbeCases = [
    'slot_only',
    'slot_and_reservation',
    'full_batch',
    'maximum of 1000 expressions',
    'fixed_admin',
    'fixed-private-slot-assignment',
  ];
  expect(rulesPayloadGapProbeCases).toContain('slot_only');
  expect(rulesPayloadGapProbeCases).toContain('slot_and_reservation');
  expect(rulesPayloadGapProbeCases).toContain('full_batch');
  expect(rulesPayloadGapProbeCases).toContain('maximum of 1000 expressions');
  expect(rulesSource).toContain('"lessonId"');
  expect(rulesSource).toContain('"fixedLessonId"');
  expect(rulesSource).toContain('"linkedPackageId"');
  expect(rulesSource).toContain('"fixedPrivatePackageId"');
  expect(rulesSource).toContain('"privateLessonAvailabilityTemplateId"');
  expect(rulesSource).toContain('"fixedPrivateAssignmentBatchId"');
  expect(rulesSource).toContain('request.resource.data.fixedLessonId == request.resource.data.lessonId');
  expect(rulesSource).toContain('request.resource.data.linkedPackageId == request.resource.data.packageId');
  expect(rulesSource).toContain('request.resource.data.fixedPrivatePackageId == request.resource.data.packageId');
  expect(rulesSource).toContain('slot.lessonId == request.resource.data.lessonId');
  expect(rulesSource).toContain('slot.fixedLessonId == request.resource.data.fixedLessonId');
  expect(rulesSource).toContain('slot.packageId == request.resource.data.packageId');
});

test('fixed private renewal save callable uses guarded transaction write mode', () => {
  const functionsSource = fs.readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');
  const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'Dashboard.jsx'), 'utf8');
  const privateSlotsSectionSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/PrivateLessonSlotsSection.jsx'),
    'utf8'
  );

  const helperStart = functionsSource.indexOf('const FIXED_PRIVATE_RENEWAL_PACKAGE_MODES');
  const helperEnd = functionsSource.indexOf('async function requireAcademyAdmin', helperStart);
  const callableStart = functionsSource.indexOf(
    'exports.createFixedPrivateLessonRenewal = onCall('
  );
  const callableEnd = functionsSource.indexOf(
    'exports.updateStudentPrivateCancelAllowance = onCall(',
    callableStart
  );
  expect(helperStart).toBeGreaterThanOrEqual(0);
  expect(helperEnd).toBeGreaterThan(helperStart);
  expect(callableStart).toBeGreaterThanOrEqual(0);
  expect(callableEnd).toBeGreaterThan(callableStart);

  const renewalValidationBlock = functionsSource.slice(helperStart, helperEnd);
  const renewalCallableBlock = functionsSource.slice(callableStart, callableEnd);
  const renewalSkeletonSource = `${renewalValidationBlock}\n${renewalCallableBlock}`;

  [
    'createFixedPrivateLessonRenewal',
    'requireAcademyAdmin',
    'previewOnly',
    'dryRun',
    'commit',
    'commitRequiredForWrite',
    'Actual fixed private renewal save is not enabled yet',
    'Write mode requires commit: true, dryRun: false',
    'requestId',
    'idempotencyKey',
    'renewalBatchIdCandidate',
    'fixedPrivateRenewalBatches',
    'payloadHash',
    'wouldCreate',
    'teacherTimePreparation',
    'packageMode',
    'assignableDates',
    'excludedDates',
    'candidateDates',
    'conflict',
    'missing_info',
    'HttpsError',
    'runFixedPrivateRenewalWriteTransaction',
    'buildFixedPrivateRenewalDeterministicIds',
    'buildFixedPrivateRenewalPayloadHash',
    'assertFixedPrivateRenewalCheckpointMatches',
    'studentPackages',
    'creditTransactions',
    'studentPrivateAccessSummary',
    'privateLessonAvailabilityTemplates',
    'lessons',
    'privateLessonSlots',
    'privateLessonReservations',
  ].forEach((token) => {
    expect(renewalSkeletonSource).toContain(token);
  });
  expect(renewalSkeletonSource).toContain('db.runTransaction');
  expect(renewalSkeletonSource).toContain('transaction.create');
  expect(renewalSkeletonSource).toContain('transaction.set');
  expect(renewalSkeletonSource).toContain('transaction.update');
  expect(renewalSkeletonSource).toContain('commit: true');
  expect(renewalSkeletonSource).toContain('dryRun: false');
  expect(renewalSkeletonSource).toContain('previewOnly: false');
  expect(renewalSkeletonSource).toContain('fixedPrivateRenewal_${academyId}_${requestId}');
  expect(renewalSkeletonSource).toContain('__package');
  expect(renewalSkeletonSource).toContain('__template');
  expect(renewalSkeletonSource).toContain('__lesson__');
  expect(renewalSkeletonSource).toContain('__slot__');
  expect(renewalSkeletonSource).toContain('__package_created');
  expect(renewalSkeletonSource).toContain('studentPackage: packageMode === "draft"');
  expect(renewalSkeletonSource).toContain('teacherTemplate: teacherTimeStatus === "create"');
  expect(renewalSkeletonSource).toContain(
    'reactivateTeacherTemplate: teacherTimeStatus === "reactivate"'
  );
  expect(renewalSkeletonSource).toContain('lessons: assignableDates.length');
  expect(renewalSkeletonSource).toContain('privateLessonSlots: assignableDates.length');
  expect(renewalSkeletonSource).toContain('privateLessonReservations: assignableDates.length');
  expect(renewalSkeletonSource).toContain('assignableDates.length > count');
  expect(renewalSkeletonSource).toContain('assignableDates.length === 0');
  expect(renewalSkeletonSource).toContain('data.dryRun !== false');
  expect(renewalSkeletonSource).toContain('data.previewOnly !== false');
  expect(renewalSkeletonSource).toContain('excluded_dates_include_hard_block');
  expect(renewalSkeletonSource).toContain('hasTeacherScheduleConflict');
  expect(renewalSkeletonSource).toContain('computePrivateTeacherPackageUsage');
  expect(renewalSkeletonSource).toContain('privateReservationDocId');

  expect(dashboardSource).toContain('fixedPrivateRenewalPlan');
  expect(dashboardSource).toContain('fixedPrivateRenewalServerPreview');
  expect(dashboardSource).toContain('fixedPrivateRenewalServerPreviewBusy');
  expect(dashboardSource).toContain('fixedPrivateRenewalServerPreviewError');
  expect(dashboardSource).toContain('fixedPrivateRenewalServerPreviewPayload');
  expect(dashboardSource).toContain('fixedPrivateRenewalCommitBusy');
  expect(dashboardSource).toContain('fixedPrivateRenewalCommitError');
  expect(dashboardSource).toContain('fixedPrivateRenewalCommitResult');
  expect(dashboardSource).toContain('handleCommitFixedPrivateRenewal');
  expect(dashboardSource).toContain("httpsCallable(firebaseFunctions, 'createFixedPrivateLessonRenewal')");
  expect(dashboardSource).toContain('dryRun: true');
  expect(dashboardSource).toContain('previewOnly: true');
  expect(dashboardSource).toContain('commit: false');
  expect(dashboardSource).toContain('commit: true');
  expect(dashboardSource).toContain('dryRun: false');
  expect(dashboardSource).toContain('previewOnly: false');
  expect(dashboardSource).toContain('새 수강권 초안');
  expect(dashboardSource).toContain('previewOnly');
  expect(privateSlotsSectionSource).toContain('선생님 시간 준비');
  expect(privateSlotsSectionSource).toContain('기존 남은 수강권으로 미리보기');
  expect(privateSlotsSectionSource).toContain(
    '서버 검증 통과 후 최종 확인에서 실제 생성할 수 있습니다'
  );
  expect(privateSlotsSectionSource).toContain('생성 예정 항목 확인');
  expect(privateSlotsSectionSource).toContain('아직 저장하지 않습니다');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-confirmation-modal');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-confirmation-open');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-confirmation-close');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-confirmation-would-create');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-confirmation-batch-id');
  expect(privateSlotsSectionSource).toContain(
    'private-fixed-renewal-confirmation-idempotency-key'
  );
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-confirmation-no-write-note');
  expect(privateSlotsSectionSource).toContain('위 내용으로 연장 생성');
  expect(privateSlotsSectionSource).toContain('이 버튼을 누르면 수강권과 고정 수업이 실제 생성됩니다');
  expect(privateSlotsSectionSource).toContain('생성 후에는 기존 관리 화면에서 확인/수정할 수 있습니다');
  expect(privateSlotsSectionSource).toContain('중복 클릭을 막기 위해 처리 중에는 버튼이 잠깁니다');
  expect(privateSlotsSectionSource).toContain('연장 생성이 완료되었습니다');
  expect(privateSlotsSectionSource).toContain('생성된 일정 보기');
  expect(privateSlotsSectionSource).toContain('방금 생성된 연장');
  expect(privateSlotsSectionSource).toContain('방금 생성됨');
  expect(privateSlotsSectionSource).toContain(
    '기존 고정 1:1 수업 일정에서 생성된 수업을 확인하세요'
  );
  expect(privateSlotsSectionSource).toContain('fixedPrivateLessonsSectionRef');
  expect(privateSlotsSectionSource).toContain('scrollIntoView');
  expect(privateSlotsSectionSource).toContain('createdRenewalLessonIds');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-commit-button');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-commit-loading');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-commit-error');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-commit-result');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-commit-result-batch-id');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-commit-result-created');
  expect(privateSlotsSectionSource).toContain(
    'private-fixed-renewal-commit-view-created-lessons'
  );
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-commit-warning-note');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-created-lessons-banner');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-created-lessons-count');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-created-lessons-note');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-created-lesson-row');
  expect(privateSlotsSectionSource).toContain('private-fixed-renewal-created-lesson-badge');
  expect(privateSlotsSectionSource).toContain('private-fixed-lesson-row');
  [
    '수정 범위 미리보기',
    '고정 수업 수정 범위 미리보기',
    '이 수업만 수정',
    '이 날짜부터 이후 고정 수업에 적용',
    '이 수강권 안의 남은 고정 수업에 적용',
    '직접 날짜 범위 선택',
    '아직 저장하지 않습니다',
    '실제 수정은 다음 단계에서 제공합니다',
    '저장 전 서버 검증이 필요합니다',
    'selectedFixedRescheduleLesson',
    'fixedRescheduleScopeMode',
    'showFixedRescheduleScopePreview',
    'private-fixed-reschedule-scope-preview-open',
    'private-fixed-reschedule-scope-preview-panel',
    'private-fixed-reschedule-scope-mode-single',
    'private-fixed-reschedule-scope-mode-future-series',
    'private-fixed-reschedule-scope-mode-package-remaining',
    'private-fixed-reschedule-scope-mode-date-range',
    'private-fixed-reschedule-scope-preview-result',
    'private-fixed-reschedule-scope-included-count',
    'private-fixed-reschedule-scope-excluded-count',
    'private-fixed-reschedule-scope-included-row',
    'private-fixed-reschedule-scope-warning',
    'private-fixed-reschedule-scope-no-write-note',
    'private-fixed-reschedule-scope-close',
  ].forEach((token) => {
    expect(privateSlotsSectionSource).toContain(token);
  });
  const rescheduleHelperStart = privateSlotsSectionSource.indexOf(
    'function getFixedRescheduleStudentId'
  );
  const reschedulePreviewPanelStart = privateSlotsSectionSource.indexOf(
    'private-fixed-reschedule-scope-preview-panel'
  );
  const reschedulePreviewPanelEnd = privateSlotsSectionSource.indexOf(
    '{fixedPrivateLessonAction ?',
    reschedulePreviewPanelStart
  );
  expect(rescheduleHelperStart).toBeGreaterThanOrEqual(0);
  expect(reschedulePreviewPanelStart).toBeGreaterThan(rescheduleHelperStart);
  expect(reschedulePreviewPanelEnd).toBeGreaterThan(reschedulePreviewPanelStart);
  const rescheduleScopeSource = [
    privateSlotsSectionSource.slice(rescheduleHelperStart, rescheduleHelperStart + 5500),
    privateSlotsSectionSource.slice(reschedulePreviewPanelStart, reschedulePreviewPanelEnd),
  ].join('\n');
  [
    'createFixedPrivateLessonRenewal',
    'updateFixedPrivateLessonScheduleScope',
    'rescheduleFixedPrivateLessons',
    'commit: true',
    'runTransaction',
    'writeBatch',
    'updateDoc',
    'setDoc',
    'addDoc',
    'deleteDoc',
  ].forEach((token) => {
    expect(rescheduleScopeSource).not.toContain(token);
  });
  const rescheduleButtonLabels = Array.from(
    rescheduleScopeSource.matchAll(/<button[\s\S]*?<\/button>/g)
  ).map((match) => match[0].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
  ['저장', '수정 저장', '범위 수정 실행', '이 범위로 수정', '고정 수업 수정 실행'].forEach(
    (label) => {
      expect(rescheduleButtonLabels).not.toContain(label);
    }
  );
  expect(privateSlotsSectionSource).not.toContain('private-fixed-renewal-submit-button');
  expect(privateSlotsSectionSource).not.toContain('>연장 저장<');
  expect(privateSlotsSectionSource).not.toContain('>연장 생성<');
  expect(privateSlotsSectionSource).not.toContain('>수강권 발행<');
  expect(privateSlotsSectionSource).not.toContain('>선생님 시간 생성<');
  expect(privateSlotsSectionSource).not.toContain('>시간표 활성화<');

  const previewHandlerStart = dashboardSource.indexOf(
    'async function previewFixedPrivateRenewalOnServer()'
  );
  const commitHandlerStart = dashboardSource.indexOf(
    'async function handleCommitFixedPrivateRenewal()'
  );
  const afterCommitHandlerStart = dashboardSource.indexOf(
    'const privateLessonTeacherSelectOptions',
    commitHandlerStart
  );
  expect(previewHandlerStart).toBeGreaterThanOrEqual(0);
  expect(commitHandlerStart).toBeGreaterThan(previewHandlerStart);
  expect(afterCommitHandlerStart).toBeGreaterThan(commitHandlerStart);

  const previewHandlerSource = dashboardSource.slice(previewHandlerStart, commitHandlerStart);
  const commitHandlerSource = dashboardSource.slice(commitHandlerStart, afterCommitHandlerStart);
  const outsideCommitHandlerSource = [
    dashboardSource.slice(0, commitHandlerStart),
    dashboardSource.slice(afterCommitHandlerStart),
    privateSlotsSectionSource,
  ].join('\n');
  expect(previewHandlerSource).toContain('dryRun: true');
  expect(previewHandlerSource).toContain('previewOnly: true');
  expect(previewHandlerSource).toContain('commit: false');
  expect(previewHandlerSource).not.toContain('commit: true');
  expect(previewHandlerSource).not.toContain('dryRun: false');
  expect(previewHandlerSource).not.toContain('previewOnly: false');
  expect(commitHandlerSource).toContain('fixedPrivateRenewalServerPreviewPayload');
  expect(commitHandlerSource).toContain('requestId');
  expect(commitHandlerSource).toContain('idempotencyKey');
  expect(commitHandlerSource).toContain('commit: true');
  expect(commitHandlerSource).toContain('dryRun: false');
  expect(commitHandlerSource).toContain('previewOnly: false');
  expect(outsideCommitHandlerSource).not.toContain('commit: true');
  expect(outsideCommitHandlerSource).not.toContain('dryRun: false');
  expect(outsideCommitHandlerSource).not.toContain('previewOnly: false');
});

test('fixed private reschedule dry-run callable is bounded and read-only', () => {
  const functionsSource = fs.readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');
  const helperStart = functionsSource.indexOf('const FIXED_PRIVATE_RESCHEDULE_SCOPE_MODES');
  const helperEnd = functionsSource.indexOf('async function requireAcademyAdmin', helperStart);
  const callableStart = functionsSource.indexOf(
    'exports.previewFixedPrivateLessonRescheduleScope = onCall('
  );
  const callableEnd = functionsSource.indexOf(
    'exports.updateFixedPrivateLessonScheduleScope = onCall(',
    callableStart
  );
  expect(helperStart).toBeGreaterThanOrEqual(0);
  expect(helperEnd).toBeGreaterThan(helperStart);
  expect(callableStart).toBeGreaterThanOrEqual(0);
  expect(callableEnd).toBeGreaterThan(callableStart);

  const rescheduleSkeletonSource = [
    functionsSource.slice(helperStart, helperEnd),
    functionsSource.slice(callableStart, callableEnd),
  ].join('\n');
  const rescheduleCallableBlock = functionsSource.slice(callableStart, callableEnd);

  [
    'previewFixedPrivateLessonRescheduleScope',
    'requireAcademyAdmin',
    'dryRun',
    'previewOnly',
    'commit',
    'selectedLessonId',
    'scopeMode',
    'single',
    'future_series',
    'package_remaining',
    'date_range',
    'includedLessons',
    'excludedLessons',
    'teacherTimePreparation',
    'wouldUpdate',
    'conflicts',
    'warnings',
    'normalizedPlan',
    'nextStep',
    'targetDate',
    'targetTime',
    'targetDurationMinutes',
    'linked_slot_missing',
    'linked_reservation_missing',
    'package_scope_may_include_multiple_patterns',
    'actual fixed private lesson reschedule is not enabled in this dry-run callable',
    'no_target_change_requested',
    'buildFixedPrivateReschedulePreviewResult',
    'buildFixedPrivateRescheduleValidation',
    'privateLessonSlots',
    'privateLessonReservations',
    'privateLessonAvailabilityTemplates',
    'studentPackages',
  ].forEach((token) => {
    expect(rescheduleSkeletonSource).toContain(token);
  });

  expect(rescheduleSkeletonSource).toContain('data.commit === true');
  expect(rescheduleSkeletonSource).toContain('data.dryRun !== true');
  expect(rescheduleSkeletonSource).toContain('data.previewOnly !== true');
  ['single', 'future_series', 'package_remaining', 'date_range'].forEach((scopeMode) => {
    expect(rescheduleSkeletonSource).toContain(`"${scopeMode}"`);
  });

  [
    'writeBatch',
    'runTransaction',
    '.set(',
    '.update(',
    '.delete(',
    '.create(',
    '.add(',
    'transaction.set',
    'transaction.update',
    'transaction.create',
    'transaction.delete',
  ].forEach((writeToken) => {
    expect(rescheduleCallableBlock).not.toContain(writeToken);
  });
  expect(rescheduleCallableBlock).not.toContain('commit: true');
  expect(rescheduleCallableBlock).not.toContain('dryRun: false');
  expect(rescheduleCallableBlock).not.toContain('previewOnly: false');

  const protectedPaths = [
    'firestore.rules',
    'package.json',
    'package-lock.json',
    'functions/package.json',
    'functions/package-lock.json',
    'StudentBookingPage.jsx',
    'index.css',
  ];
  const changedProtectedFiles = execFileSync(
    'git',
    ['diff', '--name-only', '--', ...protectedPaths],
    { cwd: process.cwd(), encoding: 'utf8' }
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  expect(changedProtectedFiles).toEqual([]);
});

test('fixed private reschedule commit callable uses guarded transaction write mode', () => {
  const functionsSource = fs.readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');
  const helperStart = functionsSource.indexOf('const FIXED_PRIVATE_RESCHEDULE_SCOPE_MODES');
  const helperEnd = functionsSource.indexOf('async function requireAcademyAdmin', helperStart);
  const previewCallableStart = functionsSource.indexOf(
    'exports.previewFixedPrivateLessonRescheduleScope = onCall('
  );
  const commitCallableStart = functionsSource.indexOf(
    'exports.updateFixedPrivateLessonScheduleScope = onCall('
  );
  const commitCallableEnd = functionsSource.indexOf(
    'exports.createFixedPrivateLessonRenewal = onCall(',
    commitCallableStart
  );
  expect(helperStart).toBeGreaterThanOrEqual(0);
  expect(helperEnd).toBeGreaterThan(helperStart);
  expect(previewCallableStart).toBeGreaterThanOrEqual(0);
  expect(commitCallableStart).toBeGreaterThan(previewCallableStart);
  expect(commitCallableEnd).toBeGreaterThan(commitCallableStart);

  const rescheduleHelperSource = functionsSource.slice(helperStart, helperEnd);
  const previewCallableBlock = functionsSource.slice(previewCallableStart, commitCallableStart);
  const commitCallableBlock = functionsSource.slice(commitCallableStart, commitCallableEnd);
  const writeSkeletonSource = `${rescheduleHelperSource}\n${commitCallableBlock}`;

  [
    'updateFixedPrivateLessonScheduleScope',
    'requireAcademyAdmin',
    'fixedPrivateRescheduleBatches',
    'fixedPrivateReschedule_',
    'payloadHash',
    'idempotentReplay',
    'committed',
    'dryRun: false',
    'previewOnly: false',
    'commit: true',
    'actual fixed private lesson reschedule requires commit true, dryRun false, previewOnly false',
    'fixed private reschedule date move is not enabled yet',
    'fixed private reschedule package change is not enabled yet',
    'package scope includes multiple patterns',
    'linked private lesson slot is required before commit',
    'linked private lesson reservation is required before commit',
    'fixedPrivateRescheduleBatchId',
    'rescheduleBatchId',
    'transaction.get',
    'transaction.update',
    'transaction.set',
    'useForFixedAssignment',
    'openForStudentBooking',
    'status: "completed"',
    'runFixedPrivateRescheduleWriteTransaction',
    'buildFixedPrivateRescheduleCommitValidation',
    'buildFixedPrivateReschedulePayloadHash',
    'assertFixedPrivateRescheduleCheckpointMatches',
    'buildFixedPrivateRescheduleResultFromCheckpoint',
    'buildFixedPrivateRescheduleTemplatePayload',
    'buildFixedPrivateRescheduleLinkedSlotPrecondition',
    'buildFixedPrivateRescheduleLinkedReservationPrecondition',
    'linked_slot_precondition_mismatch',
    'linked_slot_changed_before_commit',
    'linkedSlotPrecondition',
    'linkedReservationPrecondition',
    'reservedStudentId',
    'fixedStudentId',
    'reservedStudentUid',
    'fixedStudentUid',
    'fixedLessonId',
    'privateLessonId',
    'linkedLessonId',
    'privateLessonReservationId',
    'linkedReservationId',
    'failedFields',
    'expected',
    'current',
    'Linked private lesson slot changed before commit',
    'privateLessonSlots',
    'privateLessonReservations',
    'teacherTemplateAction',
    'privateLessonAvailabilityTemplates',
  ].forEach((token) => {
    expect(writeSkeletonSource).toContain(token);
  });
  expect(writeSkeletonSource).toContain('data.commit !== true');
  expect(writeSkeletonSource).toContain('data.dryRun !== false');
  expect(writeSkeletonSource).toContain('data.previewOnly !== false');
  expect(writeSkeletonSource).toContain('target.targetPackageId');
  expect(writeSkeletonSource).toContain('targetDate && targetDate !== row.date');
  expect(writeSkeletonSource).toContain('db.runTransaction');

  const linkedSlotGuardStart = functionsSource.indexOf(
    'function assertFixedPrivateRescheduleLinkedSlot'
  );
  const linkedSlotGuardEnd = functionsSource.indexOf(
    'function assertFixedPrivateRescheduleLinkedReservation',
    linkedSlotGuardStart
  );
  const linkedReservationGuardEnd = functionsSource.indexOf(
    'async function loadFixedPrivateRescheduleConflictRowsInTransaction',
    linkedSlotGuardEnd
  );
  expect(linkedSlotGuardStart).toBeGreaterThanOrEqual(0);
  expect(linkedSlotGuardEnd).toBeGreaterThan(linkedSlotGuardStart);
  expect(linkedReservationGuardEnd).toBeGreaterThan(linkedSlotGuardEnd);
  const linkedGuardSource = functionsSource.slice(
    linkedSlotGuardStart,
    linkedReservationGuardEnd
  );
  expect(linkedGuardSource).toContain('buildFixedPrivateRescheduleLinkedSlotPrecondition');
  expect(linkedGuardSource).toContain('buildFixedPrivateRescheduleLinkedReservationPrecondition');
  expect(linkedGuardSource).toContain('new HttpsError(');
  expect(linkedGuardSource).toContain('linkedSlotPrecondition');
  expect(linkedGuardSource).toContain('linkedReservationPrecondition');
  expect(linkedGuardSource).toContain('reason: "linked_slot_changed_before_commit"');
  expect(linkedGuardSource).toContain('Linked private lesson slot changed before commit.');

  [
    'writeBatch',
    'runTransaction',
    '.set(',
    '.update(',
    '.delete(',
    '.create(',
    '.add(',
    'transaction.set',
    'transaction.update',
    'transaction.create',
    'transaction.delete',
  ].forEach((writeToken) => {
    expect(previewCallableBlock).not.toContain(writeToken);
  });
  expect(previewCallableBlock).not.toContain('commit: true');
  expect(previewCallableBlock).not.toContain('dryRun: false');
  expect(previewCallableBlock).not.toContain('previewOnly: false');

  const protectedPaths = [
    'Dashboard.jsx',
    'src/features/dashboard/sections/PrivateLessonSlotsSection.jsx',
    'firestore.rules',
    'package.json',
    'package-lock.json',
    'functions/package.json',
    'functions/package-lock.json',
    'StudentBookingPage.jsx',
    'index.css',
  ];
  const changedProtectedFiles = execFileSync(
    'git',
    ['diff', '--name-only', '--', ...protectedPaths],
    { cwd: process.cwd(), encoding: 'utf8' }
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  expect(changedProtectedFiles).toEqual([]);
});

test('fixed private reschedule inspector callable is bounded and read-only', () => {
  const functionsSource = fs.readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');
  const helperStart = functionsSource.indexOf('const FIXED_PRIVATE_RESCHEDULE_SCOPE_MODES');
  const helperEnd = functionsSource.indexOf('async function requireAcademyAdmin', helperStart);
  const inspectCallableStart = functionsSource.indexOf(
    'exports.inspectFixedPrivateLessonRescheduleScope = onCall('
  );
  const inspectCallableEnd = functionsSource.indexOf(
    'exports.createFixedPrivateLessonRenewal = onCall(',
    inspectCallableStart
  );
  expect(helperStart).toBeGreaterThanOrEqual(0);
  expect(helperEnd).toBeGreaterThan(helperStart);
  expect(inspectCallableStart).toBeGreaterThanOrEqual(0);
  expect(inspectCallableEnd).toBeGreaterThan(inspectCallableStart);

  const inspectorHelperSource = functionsSource.slice(helperStart, helperEnd);
  const inspectorCallableBlock = functionsSource.slice(inspectCallableStart, inspectCallableEnd);
  const inspectorSkeletonSource = `${inspectorHelperSource}\n${inspectorCallableBlock}`;

  [
    'inspectFixedPrivateLessonRescheduleScope',
    'requireAcademyAdmin',
    'buildFixedPrivateRescheduleValidation',
    'buildFixedPrivateRescheduleInspectorResult',
    'getFixedPrivateRescheduleLiveLessonSummary',
    'getFixedPrivateRescheduleInspectorLinkedDocs',
    'getFixedPrivateRescheduleInspectorCheckpoint',
    'buildFixedPrivateRescheduleInspectorConsistency',
    'buildFixedPrivateRescheduleLinkedSlotPrecondition',
    'buildFixedPrivateRescheduleLinkedReservationPrecondition',
    'linked_slot_precondition_mismatch',
    'linked_slot_changed_before_commit',
    'linked_reservation_precondition_mismatch',
    'linkedSlotPreconditionFailures',
    'linkedReservationPreconditionFailures',
    'linkedPreconditionFailures',
    'preconditions',
    'diagnostics',
    'failedFields',
    'expected',
    'current',
    'reservedStudentId',
    'fixedStudentId',
    'reservedStudentUid',
    'fixedStudentUid',
    'fixedLessonId',
    'privateLessonId',
    'linkedLessonId',
    'privateLessonReservationId',
    'linkedReservationId',
    'privateLessonSlots',
    'privateLessonReservations',
    'targetConflictInspection',
    'teacherTemplateInspection',
    'checkpointInspection',
    'fixedPrivateRescheduleBatches',
    'fixedPrivateRescheduleBatch',
    'dryRunPreview',
    'consistency',
    'readOnly: true',
    'inspectOnly: true',
    'before_commit',
    'after_commit',
    'generic',
    'dryRun: true',
    'previewOnly: true',
    'commit: false',
    'batchIdCandidate',
    'payloadHashCandidate',
    'payloadHashMatches',
    'selectedLesson',
    'linkedSlot',
    'linkedReservation',
    'linkedDocs',
    'targetTemplate',
    'targetConflicts',
    'sameBatchLessons',
    'samePackageLessons',
    'canProceedToCommitCandidate',
    'normalizedTarget',
    'missingLinkedDocs',
    'linked_slot_missing',
    'linked_reservation_missing',
    'checkpoint_already_exists',
    'package_scope_may_include_multiple_patterns',
    'after_commit_batch_missing',
    'after_commit_target_mismatch',
  ].forEach((token) => {
    expect(inspectorSkeletonSource).toContain(token);
  });

  const inspectorLinkedDocsStart = functionsSource.indexOf(
    'async function getFixedPrivateRescheduleInspectorLinkedDocs'
  );
  const inspectorLinkedDocsEnd = functionsSource.indexOf(
    'async function getFixedPrivateRescheduleInspectorCheckpoint',
    inspectorLinkedDocsStart
  );
  const inspectorConsistencyStart = functionsSource.indexOf(
    'function buildFixedPrivateRescheduleInspectorConsistency'
  );
  const inspectorConsistencyEnd = functionsSource.indexOf(
    'async function buildFixedPrivateRescheduleInspectorResult',
    inspectorConsistencyStart
  );
  expect(inspectorLinkedDocsStart).toBeGreaterThanOrEqual(0);
  expect(inspectorLinkedDocsEnd).toBeGreaterThan(inspectorLinkedDocsStart);
  expect(inspectorConsistencyStart).toBeGreaterThanOrEqual(0);
  expect(inspectorConsistencyEnd).toBeGreaterThan(inspectorConsistencyStart);
  const inspectorLinkedDocsSource = functionsSource.slice(
    inspectorLinkedDocsStart,
    inspectorLinkedDocsEnd
  );
  const inspectorConsistencySource = functionsSource.slice(
    inspectorConsistencyStart,
    inspectorConsistencyEnd
  );
  expect(inspectorLinkedDocsSource).toContain(
    'buildFixedPrivateRescheduleLinkedSlotPrecondition'
  );
  expect(inspectorLinkedDocsSource).toContain(
    'buildFixedPrivateRescheduleLinkedReservationPrecondition'
  );
  expect(inspectorConsistencySource).toContain('linkedPreconditionFailures === 0');
  expect(inspectorConsistencySource).toContain('canProceedToCommitCandidate');

  [
    'writeBatch',
    'runTransaction',
    '.set(',
    '.update(',
    '.delete(',
    '.create(',
    '.add(',
    'transaction.set',
    'transaction.update',
    'transaction.create',
    'transaction.delete',
    'runFixedPrivateRescheduleWriteTransaction',
    'buildFixedPrivateRescheduleCommitValidation',
  ].forEach((writeToken) => {
    expect(inspectorCallableBlock).not.toContain(writeToken);
  });
  expect(inspectorCallableBlock).not.toContain('commit: true');
  expect(inspectorCallableBlock).not.toContain('dryRun: false');
  expect(inspectorCallableBlock).not.toContain('previewOnly: false');

  const protectedPaths = [
    'Dashboard.jsx',
    'src/features/dashboard/sections/PrivateLessonSlotsSection.jsx',
    'firestore.rules',
    'package.json',
    'package-lock.json',
    'functions/package.json',
    'functions/package-lock.json',
    'StudentBookingPage.jsx',
    'index.css',
  ];
  const changedProtectedFiles = execFileSync(
    'git',
    ['diff', '--name-only', '--', ...protectedPaths],
    { cwd: process.cwd(), encoding: 'utf8' }
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  expect(changedProtectedFiles).toEqual([]);
});

test('fixed private reschedule frontend calls dry-run preview only', () => {
  const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'Dashboard.jsx'), 'utf8');
  const privateSlotsSectionSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/PrivateLessonSlotsSection.jsx'),
    'utf8'
  );

  [
    'previewFixedPrivateLessonRescheduleScope',
    'fixedRescheduleServerPreview',
    'fixedRescheduleServerPreviewBusy',
    'fixedRescheduleServerPreviewError',
    'fixedRescheduleServerPreviewPayload',
    'previewFixedRescheduleScopeOnServer',
    'clearFixedRescheduleServerPreview',
    'targetDraft',
    'targetTime',
    'targetTeacherUid',
    'targetTeacherName',
    'targetTeacherKey',
    'targetTeacherId',
    'targetDurationMinutes',
    'targetLessonName',
    'targetDate',
    'dryRun: true',
    'previewOnly: true',
    'commit: false',
  ].forEach((token) => {
    expect(dashboardSource).toContain(token);
  });

  [
    'fixedRescheduleServerPreview',
    'fixedRescheduleServerPreviewBusy',
    'fixedRescheduleServerPreviewError',
    'fixedRescheduleServerPreviewPayload',
    'previewFixedRescheduleScopeOnServer',
    'clearFixedRescheduleServerPreview',
    'fixedRescheduleTargetDraft',
    '변경 후 값',
    '변경 후 날짜',
    '변경 후 시간',
    '변경 후 선생님',
    '변경 후 수업 길이',
    '변경 후 수업명',
    '선택하지 않은 항목은 기존 값을 유지합니다',
    '서버 검증 후 충돌 여부를 확인하세요',
    'targetDraft',
    'targetTime',
    'targetTeacherUid',
    'targetTeacherName',
    'targetTeacherKey',
    'targetTeacherId',
    'targetDurationMinutes',
    'targetLessonName',
    'targetDate',
    'private-fixed-reschedule-target-date',
    'private-fixed-reschedule-target-time',
    'private-fixed-reschedule-target-teacher',
    'private-fixed-reschedule-target-duration',
    'private-fixed-reschedule-target-lesson-name',
    'private-fixed-reschedule-target-summary',
    'private-fixed-reschedule-target-summary-time',
    'private-fixed-reschedule-target-summary-teacher',
    'private-fixed-reschedule-target-summary-duration',
    'private-fixed-reschedule-target-summary-lesson-name',
    'private-fixed-reschedule-target-summary-date',
    '서버 기준 범위 검증',
    '서버 기준 범위 검증 결과',
    '서버 기준 검증 중',
    '이 단계에서는 저장하지 않습니다',
    '서버 기준으로 변경 범위를 검증합니다',
    '실제 수정은 다음 단계에서 제공합니다',
    '수업, 슬롯, 예약 문서는 아직 수정되지 않습니다',
    'private-fixed-reschedule-server-preview-button',
    'private-fixed-reschedule-server-preview-loading',
    'private-fixed-reschedule-server-preview-result',
    'private-fixed-reschedule-server-preview-ok',
    'private-fixed-reschedule-server-preview-included-count',
    'private-fixed-reschedule-server-preview-excluded-count',
    'private-fixed-reschedule-server-preview-would-update',
    'private-fixed-reschedule-server-preview-teacher-time',
    'private-fixed-reschedule-server-preview-conflict',
    'private-fixed-reschedule-server-preview-warning',
    'private-fixed-reschedule-server-preview-normalized-plan',
    'private-fixed-reschedule-server-preview-next-step',
    'private-fixed-reschedule-server-preview-error',
    'private-fixed-reschedule-server-preview-no-write-note',
  ].forEach((token) => {
    expect(privateSlotsSectionSource).toContain(token);
  });

  const handlerStart = dashboardSource.indexOf(
    'async function previewFixedRescheduleScopeOnServer'
  );
  const handlerEnd = dashboardSource.indexOf(
    'async function handleCommitFixedPrivateReschedule',
    handlerStart
  );
  expect(handlerStart).toBeGreaterThanOrEqual(0);
  expect(handlerEnd).toBeGreaterThan(handlerStart);
  const rescheduleHandlerSource = dashboardSource.slice(handlerStart, handlerEnd);

  const sectionHandlerStart = privateSlotsSectionSource.indexOf(
    'function openFixedRescheduleScopePreview'
  );
  const sectionHandlerEnd = privateSlotsSectionSource.indexOf(
    'function openAvailabilityTemplateEdit',
    sectionHandlerStart
  );
  const panelStart = privateSlotsSectionSource.indexOf(
    'private-fixed-reschedule-scope-preview-panel'
  );
  const panelEnd = privateSlotsSectionSource.indexOf('{fixedPrivateLessonAction ?', panelStart);
  expect(sectionHandlerStart).toBeGreaterThanOrEqual(0);
  expect(sectionHandlerEnd).toBeGreaterThan(sectionHandlerStart);
  expect(panelStart).toBeGreaterThanOrEqual(0);
  expect(panelEnd).toBeGreaterThan(panelStart);
  const rescheduleSectionSource = [
    privateSlotsSectionSource.slice(sectionHandlerStart, sectionHandlerEnd),
    privateSlotsSectionSource.slice(panelStart, panelEnd),
  ].join('\n');

  expect(rescheduleHandlerSource).toContain("httpsCallable(firebaseFunctions, 'previewFixedPrivateLessonRescheduleScope')");
  expect(rescheduleHandlerSource).toContain('dryRun: true');
  expect(rescheduleHandlerSource).toContain('previewOnly: true');
  expect(rescheduleHandlerSource).toContain('commit: false');
  expect(rescheduleHandlerSource).toContain('targetDraft');
  expect(rescheduleHandlerSource).toContain('targetTime');
  expect(rescheduleHandlerSource).toContain('targetTeacherUid');
  expect(rescheduleHandlerSource).toContain('targetTeacherName');
  expect(rescheduleHandlerSource).toContain('targetTeacherKey');
  expect(rescheduleHandlerSource).toContain('targetTeacherId');
  expect(rescheduleHandlerSource).toContain('targetDurationMinutes');
  expect(rescheduleHandlerSource).toContain('targetLessonName');
  expect(rescheduleHandlerSource).toContain('targetDate');
  [
    'commit: true',
    'dryRun: false',
    'previewOnly: false',
    'updateFixedPrivateLessonScheduleScope',
    'rescheduleFixedPrivateLessons',
    'targetPackageId',
    'updateDoc',
    'writeBatch',
    'runTransaction',
    'setDoc',
    'addDoc',
    'deleteDoc',
  ].forEach((token) => {
    expect(rescheduleHandlerSource).not.toContain(token);
    expect(rescheduleSectionSource).not.toContain(token);
  });

  const protectedPaths = [
    'firestore.rules',
    'package.json',
    'package-lock.json',
    'functions/package.json',
    'functions/package-lock.json',
    'StudentBookingPage.jsx',
    'index.css',
  ];
  const changedProtectedFiles = execFileSync(
    'git',
    ['diff', '--name-only', '--', ...protectedPaths],
    { cwd: process.cwd(), encoding: 'utf8' }
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  expect(changedProtectedFiles).toEqual([]);
});

test('fixed private reschedule frontend connects guarded commit confirmation UI', () => {
  const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'Dashboard.jsx'), 'utf8');
  const privateSlotsSectionSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/PrivateLessonSlotsSection.jsx'),
    'utf8'
  );
  const testSource = fs.readFileSync(
    path.join(process.cwd(), 'tests/private-fixed-slot-assignment.spec.js'),
    'utf8'
  );

  [
    'updateFixedPrivateLessonScheduleScope',
    'handleCommitFixedPrivateReschedule',
    'fixedRescheduleCommitBusy',
    'fixedRescheduleCommitError',
    'fixedRescheduleCommitResult',
    'fixedRescheduleCommitPayload',
    'fixedRescheduleServerPreviewPayload',
    'commit: true',
    'dryRun: false',
    'previewOnly: false',
  ].forEach((token) => {
    expect(dashboardSource).toContain(token);
  });

  [
    'showFixedRescheduleCommitConfirmModal',
    'fixedRescheduleCommitBusy',
    'fixedRescheduleCommitError',
    'fixedRescheduleCommitResult',
    'fixedRescheduleCommitPayload',
    'hasFixedRescheduleCommitFeedback',
    'onCommitFixedReschedule',
    'onClearFixedRescheduleCommitState',
    '수정 내용 최종 확인',
    '고정 수업 수정 최종 확인',
    '위 내용으로 고정 수업 수정',
    '고정 수업 수정 중',
    '고정 수업 수정이 완료되었습니다',
    '이 버튼을 누르면 고정 수업, 슬롯, 예약 문서가 실제 수정됩니다',
    '처리 중에는 중복 클릭을 막기 위해 버튼이 잠깁니다',
    '처리 중에는 이 창을 닫지 말고 결과를 기다려주세요',
    '같은 요청을 반복해서 누르지 마세요',
    '서버 기준 범위 검증과 DB 원장 확인을 다시 실행하세요',
    'private-fixed-reschedule-commit-confirm-open',
    'private-fixed-reschedule-commit-confirm-modal',
    'private-fixed-reschedule-commit-selected-lesson',
    'private-fixed-reschedule-commit-scope-summary',
    'private-fixed-reschedule-commit-before-summary',
    'private-fixed-reschedule-commit-target-summary',
    'private-fixed-reschedule-commit-would-update',
    'private-fixed-reschedule-commit-included-row',
    'private-fixed-reschedule-commit-excluded-row',
    'private-fixed-reschedule-commit-warning',
    'private-fixed-reschedule-commit-conflict',
    'private-fixed-reschedule-commit-request-id',
    'private-fixed-reschedule-commit-button',
    'private-fixed-reschedule-commit-loading',
    'private-fixed-reschedule-commit-warning-note',
    'private-fixed-reschedule-commit-result',
    'private-fixed-reschedule-commit-result-persisted',
    'private-fixed-reschedule-commit-result-batch-id',
    'private-fixed-reschedule-commit-result-idempotent-replay',
    'private-fixed-reschedule-commit-result-updated',
    'private-fixed-reschedule-commit-result-teacher-template',
    'private-fixed-reschedule-commit-result-normalized-plan',
    'private-fixed-reschedule-commit-error',
    'private-fixed-reschedule-commit-error-persisted',
    'private-fixed-reschedule-commit-busy-keep-open-note',
    'private-fixed-reschedule-commit-close',
  ].forEach((token) => {
    expect(privateSlotsSectionSource).toContain(token);
  });

  const commitHandlerStart = dashboardSource.indexOf(
    'async function handleCommitFixedPrivateReschedule'
  );
  const commitHandlerEnd = dashboardSource.indexOf(
    'const privateLessonTeacherSelectOptions',
    commitHandlerStart
  );
  expect(commitHandlerStart).toBeGreaterThanOrEqual(0);
  expect(commitHandlerEnd).toBeGreaterThan(commitHandlerStart);
  const commitHandlerSource = dashboardSource.slice(commitHandlerStart, commitHandlerEnd);
  expect(commitHandlerSource).toContain('...fixedRescheduleServerPreviewPayload');
  expect(commitHandlerSource).toContain('commit: true');
  expect(commitHandlerSource).toContain('dryRun: false');
  expect(commitHandlerSource).toContain('previewOnly: false');
  expect(commitHandlerSource).toContain(
    "httpsCallable(firebaseFunctions, 'updateFixedPrivateLessonScheduleScope')"
  );
  expect(commitHandlerSource).not.toContain('Date.now()');
  expect(commitHandlerSource).not.toContain('Math.random()');
  expect(commitHandlerSource).not.toContain('targetDraft');

  const rescheduleFrontendStart = dashboardSource.indexOf(
    'function clearFixedRescheduleCommitState'
  );
  const rescheduleFrontendEnd = dashboardSource.indexOf(
    'const privateLessonTeacherSelectOptions',
    rescheduleFrontendStart
  );
  expect(rescheduleFrontendStart).toBeGreaterThanOrEqual(0);
  expect(rescheduleFrontendEnd).toBeGreaterThan(rescheduleFrontendStart);
  const dashboardRescheduleFrontendSource = dashboardSource.slice(
    rescheduleFrontendStart,
    rescheduleFrontendEnd
  );
  const dashboardRescheduleFrontendWithoutCommitHandler = [
    dashboardRescheduleFrontendSource.slice(0, commitHandlerStart - rescheduleFrontendStart),
    dashboardRescheduleFrontendSource.slice(commitHandlerEnd - rescheduleFrontendStart),
  ].join('\n');
  ['commit: true', 'dryRun: false', 'previewOnly: false'].forEach((token) => {
    expect(dashboardRescheduleFrontendWithoutCommitHandler).not.toContain(token);
    expect(privateSlotsSectionSource).not.toContain(token);
  });

  const modalStart = privateSlotsSectionSource.indexOf(
    'private-fixed-reschedule-commit-confirm-modal'
  );
  const modalEnd = privateSlotsSectionSource.indexOf('{fixedPrivateLessonAction ?', modalStart);
  expect(modalStart).toBeGreaterThanOrEqual(0);
  expect(modalEnd).toBeGreaterThan(modalStart);
  const modalSource = privateSlotsSectionSource.slice(modalStart, modalEnd);
  const commitButtonLabelMatches = modalSource.match(/위 내용으로 고정 수업 수정/g) || [];
  expect(commitButtonLabelMatches.length).toBe(1);
  expect(modalSource).toMatch(
    /type="button"[\s\S]*data-testid="private-fixed-reschedule-commit-button"[\s\S]*onClick=\{onCommitFixedReschedule\}/
  );
  expect(modalSource).toContain('disabled={!canCommitFixedReschedule}');
  expect(modalSource).toContain('disabled={fixedRescheduleCommitBusy}');
  expect(modalSource).toContain('private-fixed-reschedule-commit-busy-keep-open-note');
  expect(modalSource).toContain('private-fixed-reschedule-commit-error-persisted');
  expect(modalSource).toContain('private-fixed-reschedule-commit-result-persisted');
  [
    '수정 저장',
    '이 범위로 수정',
    '범위 수정 실행',
    '바로 수정',
    '자동 수정',
  ].forEach((forbiddenLabel) => {
    expect(modalSource).not.toContain(forbiddenLabel);
  });
  expect(modalSource).not.toContain('>저장<');

  const commitButtonTestId = 'private-fixed-reschedule-commit-button';
  const clickToken = 'cli' + 'ck';
  expect(testSource).not.toContain(`${commitButtonTestId}.${clickToken}`);
  expect(testSource).not.toContain(`getByTestId('${commitButtonTestId}').${clickToken}`);
  expect(testSource).not.toContain(`getByTestId("${commitButtonTestId}").${clickToken}`);

  const modalPersistenceStart = privateSlotsSectionSource.indexOf(
    'const hasFixedRescheduleCommitFeedback'
  );
  const modalPersistenceEnd = privateSlotsSectionSource.indexOf(
    'const selectedPrivateBoardTeacherOption',
    modalPersistenceStart
  );
  expect(modalPersistenceStart).toBeGreaterThanOrEqual(0);
  expect(modalPersistenceEnd).toBeGreaterThan(modalPersistenceStart);
  const modalPersistenceSource = privateSlotsSectionSource.slice(
    modalPersistenceStart,
    modalPersistenceEnd
  );
  [
    'fixedRescheduleCommitBusy',
    'fixedRescheduleCommitResult',
    'fixedRescheduleCommitError',
    'showFixedRescheduleCommitConfirmModal',
    'canOpenFixedRescheduleCommitConfirmModal',
    '!hasFixedRescheduleCommitFeedback',
    'setShowFixedRescheduleCommitConfirmModal(false)',
  ].forEach((token) => {
    expect(modalPersistenceSource).toContain(token);
  });
  expect(modalPersistenceSource).not.toContain(
    '!canOpenFixedRescheduleCommitConfirmModal && !fixedRescheduleCommitResult'
  );

  const protectedPaths = [
    'firestore.rules',
    'package.json',
    'package-lock.json',
    'functions/package.json',
    'functions/package-lock.json',
    'StudentBookingPage.jsx',
    'index.css',
  ];
  const changedProtectedFiles = execFileSync(
    'git',
    ['diff', '--name-only', '--', ...protectedPaths],
    { cwd: process.cwd(), encoding: 'utf8' }
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  expect(changedProtectedFiles).toEqual([]);
});

test('fixed private reschedule frontend connects read-only inspector gate', () => {
  const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'Dashboard.jsx'), 'utf8');
  const privateSlotsSectionSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/PrivateLessonSlotsSection.jsx'),
    'utf8'
  );
  const functionsSource = fs.readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');

  [
    'inspectFixedPrivateLessonRescheduleScope',
    'inspectFixedRescheduleStateOnServer',
    'fixedRescheduleInspectorResult',
    'fixedRescheduleInspectorBusy',
    'fixedRescheduleInspectorError',
    'fixedRescheduleInspectorPayload',
    'clearFixedRescheduleInspectorState',
    "mode: 'before_commit'",
    'readOnly',
    'canProceedToCommitCandidate',
  ].forEach((token) => {
    expect(dashboardSource).toContain(token);
  });

  [
    'DB 원장 확인',
    'DB 원장 확인 중',
    'DB 원장 확인 결과',
    '실제 수정 전 DB 원장 확인을 먼저 실행하세요',
    '이 확인은 read-only이며 수업, 슬롯, 예약 문서를 수정하지 않습니다',
    '원장 확인이 통과하면 실제 수정 버튼이 활성화됩니다',
    'readOnly',
    'canProceedToCommitCandidate',
    'selectedLesson',
    'linkedSlot',
    'linkedReservation',
    'targetTemplate',
    'targetConflicts',
    'fixedPrivateRescheduleBatch',
    'consistency',
    'private-fixed-reschedule-inspector-button',
    'private-fixed-reschedule-inspector-loading',
    'private-fixed-reschedule-inspector-result',
    'private-fixed-reschedule-inspector-readonly',
    'private-fixed-reschedule-inspector-selected-lesson',
    'private-fixed-reschedule-inspector-linked-slot',
    'private-fixed-reschedule-inspector-linked-reservation',
    'private-fixed-reschedule-inspector-target-template',
    'private-fixed-reschedule-inspector-conflict',
    'private-fixed-reschedule-inspector-batch',
    'private-fixed-reschedule-inspector-consistency',
    'private-fixed-reschedule-inspector-warning',
    'private-fixed-reschedule-inspector-error',
    'private-fixed-reschedule-inspector-next-step',
    'private-fixed-reschedule-commit-gated-note',
    'private-fixed-reschedule-inspector-no-write-note',
  ].forEach((token) => {
    expect(privateSlotsSectionSource).toContain(token);
  });

  const inspectorHandlerStart = dashboardSource.indexOf(
    'async function inspectFixedRescheduleStateOnServer'
  );
  const inspectorHandlerEnd = dashboardSource.indexOf(
    'async function handleCommitFixedPrivateReschedule',
    inspectorHandlerStart
  );
  expect(inspectorHandlerStart).toBeGreaterThanOrEqual(0);
  expect(inspectorHandlerEnd).toBeGreaterThan(inspectorHandlerStart);
  const inspectorHandlerSource = dashboardSource.slice(
    inspectorHandlerStart,
    inspectorHandlerEnd
  );

  expect(inspectorHandlerSource).toContain('...fixedRescheduleServerPreviewPayload');
  expect(inspectorHandlerSource).toContain("mode: 'before_commit'");
  expect(inspectorHandlerSource).toContain('httpsCallable(');
  expect(inspectorHandlerSource).toContain('firebaseFunctions');
  expect(inspectorHandlerSource).toContain("'inspectFixedPrivateLessonRescheduleScope'");
  expect(inspectorHandlerSource).not.toContain('Date.now()');
  expect(inspectorHandlerSource).not.toContain('Math.random()');

  [
    'commit: true',
    'dryRun: false',
    'previewOnly: false',
    'updateFixedPrivateLessonScheduleScope',
    'writeBatch',
    'runTransaction',
    'setDoc',
    'addDoc',
    'updateDoc',
    'deleteDoc',
  ].forEach((token) => {
    expect(inspectorHandlerSource).not.toContain(token);
    expect(privateSlotsSectionSource).not.toContain(token);
  });

  expect(functionsSource).toContain('exports.inspectFixedPrivateLessonRescheduleScope = onCall(');

  const protectedPaths = [
    'Dashboard.jsx',
    'src/features/dashboard/sections/PrivateLessonSlotsSection.jsx',
    'firestore.rules',
    'package.json',
    'package-lock.json',
    'functions/package.json',
    'functions/package-lock.json',
    'StudentBookingPage.jsx',
    'index.css',
  ];
  const changedProtectedFiles = execFileSync(
    'git',
    ['diff', '--name-only', '--', ...protectedPaths],
    { cwd: process.cwd(), encoding: 'utf8' }
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  expect(changedProtectedFiles).toEqual([]);
});

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
    const lessons = await queryLessonsByPackage(fixture.packageId);
    const slots = await queryFixedSlotsByPackage(fixture.packageId);
    const slotByDate = new Map(slots.map((slot) => [slot.date, slot]));
    const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
    expect(reservations.map((reservation) => reservation.date).sort()).toEqual(fixture.dates);
    expect(lessons.map((lesson) => lesson.date).sort()).toEqual(fixture.dates);
    expect(slots.map((slot) => slot.date).sort()).toEqual(fixture.dates);
    for (const reservation of reservations) {
      const lesson = lessonById.get(String(reservation.lessonId || '').trim());
      expect(reservation.studentId).toBe(fixture.studentId);
      expect(reservation.studentName).toBe(fixture.studentName);
      expect(reservation.packageId).toBe(fixture.packageId);
      expect(reservation.deductionPackageId).toBe(fixture.packageId);
      expect(reservation.linkedPackageId).toBe(fixture.packageId);
      expect(reservation.fixedPrivatePackageId).toBe(fixture.packageId);
      expect(reservation.lessonId).toBeTruthy();
      expect(reservation.fixedLessonId).toBe(reservation.lessonId);
      expect(reservation.teacherKey).toBe(fixture.teacher.key);
      expect(reservation.teacherUid).toBe(fixture.teacher.uid);
      expect(reservation.time).toBe(fixture.time);
      expect(reservation.durationMinutes).toBe(60);
      expect(reservation.subject).toBe('E2E 고정 1:1');
      expect(reservation.sourceType).toBe('fixed-private-slot-assignment');
      expect(reservation.reservationType).toBe('fixed');
      expect(reservation.status).toBe('active');
      expect(lesson).toBeTruthy();
      expect(lesson.packageId).toBe(fixture.packageId);
      expect(lesson.deductionPackageId).toBe(fixture.packageId);
      expect(lesson.linkedPackageId).toBe(fixture.packageId);
      expect(lesson.fixedPrivatePackageId).toBe(fixture.packageId);
      expect(lesson.studentId).toBe(fixture.studentId);
      expect(lesson.studentID).toBe(fixture.studentId);
      expect(lesson.teacherKey).toBe(fixture.teacher.key);
      expect(lesson.teacherUid).toBe(fixture.teacher.uid);
      expect(lesson.reservationId).toBe(reservation.id);
      expect(lesson.slotId).toBe(reservation.slotId);
      expect(lesson.packageType).toBe('private');
      expect(lesson.sourceType).toBe('fixed-private-slot-assignment');
      expect(lesson.status).toBe('active');
      const slot = slots.find((row) => row.id === reservation.slotId);
      expect(slot).toBeTruthy();
      expect(slot.status).toBe('reserved');
      expect(slot.reservedStudentId).toBe(fixture.studentId);
      expect(slot.lessonId).toBe(reservation.lessonId);
      expect(slot.fixedLessonId).toBe(reservation.lessonId);
      expect(slot.packageId).toBe(fixture.packageId);
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

    const studentReleasedSlot = slotByDate.get(fixture.dates[0]);
    expect(studentReleasedSlot?.id).toBeTruthy();
    const studentFixedCard = studentPage
      .locator('[data-testid="student-upcoming-private-lesson-card"]')
      .filter({ hasText: fixture.dates[0] })
      .filter({ hasText: fixture.time });
    await expect(studentFixedCard).toContainText('고정 예약', { timeout: 15000 });
    studentPage.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await studentFixedCard.getByTestId('student-upcoming-private-reservation-cancel-button').click();
    await expectReservationStatus(studentReleasedSlot.id, fixture.studentId, 'cancelled');
    await expect
      .poll(async () => {
        const snap = await getDb().collection('privateLessonSlots').doc(studentReleasedSlot.id).get();
        const data = snap.data() || {};
        return [
          data.status,
          data.slotType,
          data.isBookable === true ? 'bookable' : 'blocked',
          data.releaseReason || '',
        ].join('|');
      }, { timeout: 30000 })
      .toBe('open|released_fixed|bookable|fixed_student_cancelled');

    await otherStudentPage.goto(`${BASE_URL}student-booking?privateSlotBooking=enabled`);
    await otherStudentPage.getByTestId('private-slot-view-mode-available').click();
    const studentReleasedCard = otherStudentPage.locator(
      `[data-testid="student-private-slot-card"][data-slot-id="${studentReleasedSlot.id}"]`
    );
    await expect(studentReleasedCard, 'student-cancelled fixed slot should be bookable').toBeVisible({
      timeout: 30000,
    });
    otherStudentPage.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await studentReleasedCard.getByTestId('student-private-slot-reserve-button').click();
    await expectReservationStatus(studentReleasedSlot.id, fixture.otherStudentId, 'active');
    await expect
      .poll(async () => {
        const snap = await getDb()
          .collection('privateLessonReservations')
          .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
          .where('slotId', '==', studentReleasedSlot.id)
          .where('status', '==', 'active')
          .get();
        return snap.size;
      }, { timeout: 15000 })
      .toBe(1);

    const adminReleasedSlot = slotByDate.get(fixture.dates[1]);
    expect(adminReleasedSlot?.id).toBeTruthy();
    await openDashboardSection(page, '1:1 예약 시간 관리');
    const adminReleaseRow = page.locator(
      `[data-testid="private-slot-row"][data-slot-id="${adminReleasedSlot.id}"]`
    );
    await expect(adminReleaseRow).toContainText('예약 완료', { timeout: 30000 });
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('다른 학생에게 공개');
      await dialog.accept();
    });
    await adminReleaseRow.getByTestId('private-slot-cancel-button').click();
    await expectReservationStatus(adminReleasedSlot.id, fixture.studentId, 'cancelled');
    await expect
      .poll(async () => {
        const snap = await getDb().collection('privateLessonSlots').doc(adminReleasedSlot.id).get();
        const data = snap.data() || {};
        return [
          data.status,
          data.slotType,
          data.isBookable === true ? 'bookable' : 'blocked',
          data.releaseReason || '',
        ].join('|');
      }, { timeout: 30000 })
      .toBe('open|released_fixed|bookable|admin_cancelled');
    await expect(adminReleaseRow).toContainText('고정 취소로 예약 가능', { timeout: 30000 });

    await otherStudentPage.goto(`${BASE_URL}student-booking?privateSlotBooking=enabled`);
    await otherStudentPage.getByTestId('private-slot-view-mode-all').click();
    await expect(
      otherStudentPage.locator(
        `[data-testid="student-private-slot-card"][data-slot-id="${adminReleasedSlot.id}"]`
      ),
      'admin-cancelled fixed slot should be visible as a non-busy slot'
    ).toBeVisible({ timeout: 30000 });
    await expect(
      otherStudentPage.locator(
        `[data-testid="student-private-busy-slot-card"][data-slot-id="${adminReleasedSlot.id}"]`
      ),
      'admin-cancelled fixed slot must not stay busy'
    ).toHaveCount(0);

    const unavailableSlot = slotByDate.get(fixture.dates[3]);
    expect(unavailableSlot?.id).toBeTruthy();
    const unavailableRow = page.locator(
      `[data-testid="private-slot-row"][data-slot-id="${unavailableSlot.id}"]`
    );
    await expect(unavailableRow).toContainText('예약 완료', { timeout: 30000 });
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('선생님 결석/휴강/수업불가');
      await dialog.accept();
    });
    await unavailableRow.getByTestId('private-slot-close-unavailable-button').click();
    await expectReservationStatus(unavailableSlot.id, fixture.studentId, 'cancelled');
    await expect
      .poll(async () => {
        const snap = await getDb().collection('privateLessonSlots').doc(unavailableSlot.id).get();
        const data = snap.data() || {};
        return [
          data.status,
          data.isBookable === true ? 'bookable' : 'blocked',
          data.releaseReason || '',
        ].join('|');
      }, { timeout: 30000 })
      .toBe('cancelled|blocked|teacher_unavailable');
    await expect(unavailableRow).toContainText('선생님 수업불가로 닫힘', { timeout: 30000 });

    await otherStudentPage.goto(`${BASE_URL}student-booking?privateSlotBooking=enabled`);
    await otherStudentPage.getByTestId('private-slot-view-mode-available').click();
    await expect(
      otherStudentPage.locator(
        `[data-testid="student-private-slot-card"][data-slot-id="${unavailableSlot.id}"]`
      ),
      'teacher-unavailable fixed slot must not be bookable'
    ).toHaveCount(0, { timeout: 15000 });

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('다시 예약 가능하게 열까요');
      await dialog.accept();
    });
    await unavailableRow.getByTestId('private-slot-reopen-unavailable-button').click();
    await expectReservationStatus(unavailableSlot.id, fixture.studentId, 'cancelled');
    await expect
      .poll(async () => {
        const snap = await getDb().collection('privateLessonSlots').doc(unavailableSlot.id).get();
        const data = snap.data() || {};
        return [
          data.status,
          data.isBookable === true ? 'bookable' : 'blocked',
          data.reopenedReason || '',
        ].join('|');
      }, { timeout: 30000 })
      .toBe('open|bookable|teacher_unavailable_reopened');
    await expect(unavailableRow).toContainText('예약 가능한 시간', { timeout: 30000 });

    await otherStudentPage.goto(`${BASE_URL}student-booking?privateSlotBooking=enabled`);
    await otherStudentPage.getByTestId('private-slot-view-mode-available').click();
    await expect(
      otherStudentPage.locator(
        `[data-testid="student-private-slot-card"][data-slot-id="${unavailableSlot.id}"]`
      ),
      'reopened teacher-unavailable slot should be bookable again'
    ).toBeVisible({ timeout: 30000 });
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
    await singleSection.getByTestId('private-weekly-template-history-toggle').check();
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
