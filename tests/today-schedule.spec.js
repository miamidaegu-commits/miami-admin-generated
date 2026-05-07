import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';
import { test, expect } from '@playwright/test';
import { BASE_URL } from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEFAULT_E2E_ACADEMY_ID,
  DEFAULT_E2E_ACADEMY_NAME,
} from './fixtures/test-data.js';

const require = createRequire(import.meta.url);
const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json is required for today schedule e2e.');
});

function hasServiceAccount() {
  return fs.existsSync(SERVICE_ACCOUNT_PATH);
}

function initializeAdmin() {
  if (admin.apps.length > 0) return;
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  if (serviceAccount.project_id !== 'miami-e2e') {
    throw new Error(`Expected miami-e2e service account, received ${serviceAccount.project_id}`);
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

function todayInSeoul() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

async function getAuthUserByEmail(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return null;
    throw error;
  }
}

async function createAuthUser(auth, { email, password, displayName }) {
  const existing = await getAuthUserByEmail(auth, email);
  if (existing) await auth.deleteUser(existing.uid);
  return auth.createUser({
    email,
    password,
    displayName,
    disabled: false,
  });
}

async function login(page, email, password, pathPattern) {
  await page.goto(BASE_URL);
  await page.getByLabel(/Email|이메일/i).or(page.locator('input[type="email"]')).first().fill(email);
  await page
    .getByLabel(/Password|비밀번호/i)
    .or(page.locator('input[type="password"]'))
    .first()
    .fill(password);
  await page.getByRole('button', { name: /Sign In|로그인/i }).click();
  await expect(page).toHaveURL(pathPattern, { timeout: 15000 });
}

function reservationId({ academyId, lessonId, studentId }) {
  return `${academyId}__${lessonId}__${studentId}`;
}

function privateReservationId({ academyId, slotId, studentId }) {
  return `${academyId}__${slotId}__${studentId}`;
}

async function ensureAdminFixture({ auth, db }) {
  const adminUser = await auth.getUserByEmail(ADMIN_EMAIL);
  const now = admin.firestore.FieldValue.serverTimestamp();
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
    db.collection('users').doc(adminUser.uid).set(
      {
        uid: adminUser.uid,
        email: ADMIN_EMAIL,
        role: 'admin',
        isActive: true,
        lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
        updatedAt: now,
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
        updatedAt: now,
      },
      { merge: true }
    ),
  ]);
}

async function createRoleDocs({ db, uid, email, role, teacherName = '', studentId = '' }) {
  const now = admin.firestore.FieldValue.serverTimestamp();
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
    db.collection('users').doc(uid).set({
      uid,
      email,
      role,
      teacherName,
      isActive: true,
      lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
      updatedAt: now,
    }),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${uid}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      uid,
      email,
      displayName: teacherName || email,
      role,
      teacherName,
      studentId,
      status: 'active',
      permissions,
      updatedAt: now,
    }),
  ]);
}

async function expectPanelContains(page, text) {
  await expect(page.getByTestId('today-schedule-panel')).toContainText(text, { timeout: 20000 });
}

async function expectSummaryCount(page, label, count) {
  const item = page
    .getByTestId('today-schedule-summary-item')
    .filter({ hasText: label });
  await expect(item).toContainText(String(count), { timeout: 20000 });
}

async function expectSummaryCountAtLeast(page, label, count) {
  const item = page
    .getByTestId('today-schedule-summary-item')
    .filter({ hasText: label });
  await expect
    .poll(async () => {
      const text = (await item.textContent()) || '';
      const match = text.match(/\d+/);
      return match ? Number(match[0]) : 0;
    }, { timeout: 20000 })
    .toBeGreaterThanOrEqual(count);
}

const fixture = {
  createdAuthEmails: [],
  docRefs: [],
};

test.beforeAll(async () => {
  if (!hasServiceAccount()) return;
  initializeAdmin();

  const db = admin.firestore();
  const auth = admin.auth();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const today = todayInSeoul();
  const now = admin.firestore.FieldValue.serverTimestamp();

  fixture.unique = unique;
  fixture.today = today;
  fixture.teacherName = `today-teacher-${unique}`;
  fixture.otherTeacherName = `today-other-teacher-${unique}`;
  fixture.studentId = `today-student-${unique}`;
  fixture.emptyStudentId = `today-empty-student-${unique}`;
  fixture.otherStudentId = `today-other-student-${unique}`;
  fixture.studentName = `오늘학생 ${unique}`;
  fixture.emptyStudentName = `빈일정학생 ${unique}`;
  fixture.otherStudentName = `다른학생 ${unique}`;
  fixture.teacherEmail = `today-teacher-${unique}@example.com`;
  fixture.studentEmail = `today-student-${unique}@example.com`;
  fixture.emptyStudentEmail = `today-empty-student-${unique}@example.com`;
  fixture.password = '123456';
  fixture.ownGroupClassId = `today-group-${unique}`;
  fixture.otherGroupClassId = `today-other-group-${unique}`;
  fixture.ownGroupLessonId = `today-group-lesson-${unique}`;
  fixture.otherGroupLessonId = `today-other-group-lesson-${unique}`;
  fixture.ownPrivateLessonId = `today-private-lesson-${unique}`;
  fixture.otherPrivateLessonId = `today-other-private-lesson-${unique}`;
  fixture.ownPrivateSlotId = `today-private-slot-${unique}`;
  fixture.otherPrivateSlotId = `today-other-private-slot-${unique}`;
  fixture.ownGroupTitle = `오늘단체수업 ${unique}`;
  fixture.otherGroupTitle = `다른선생단체 ${unique}`;
  fixture.ownPrivateTitle = `오늘개인수업 ${unique}`;
  fixture.otherPrivateTitle = `다른선생개인 ${unique}`;
  fixture.ownPrivateReservationTitle = `오늘1대1예약 ${unique}`;
  fixture.otherPrivateReservationTitle = `다른학생1대1 ${unique}`;

  await ensureAdminFixture({ auth, db });

  const [teacherUser, studentUser, emptyStudentUser] = await Promise.all([
    createAuthUser(auth, {
      email: fixture.teacherEmail,
      password: fixture.password,
      displayName: fixture.teacherName,
    }),
    createAuthUser(auth, {
      email: fixture.studentEmail,
      password: fixture.password,
      displayName: fixture.studentName,
    }),
    createAuthUser(auth, {
      email: fixture.emptyStudentEmail,
      password: fixture.password,
      displayName: fixture.emptyStudentName,
    }),
  ]);
  fixture.teacherUid = teacherUser.uid;
  fixture.studentUid = studentUser.uid;
  fixture.emptyStudentUid = emptyStudentUser.uid;
  fixture.createdAuthEmails.push(fixture.teacherEmail, fixture.studentEmail, fixture.emptyStudentEmail);

  await Promise.all([
    createRoleDocs({
      db,
      uid: teacherUser.uid,
      email: fixture.teacherEmail,
      role: 'teacher',
      teacherName: fixture.teacherName,
    }),
    createRoleDocs({
      db,
      uid: studentUser.uid,
      email: fixture.studentEmail,
      role: 'student',
      studentId: fixture.studentId,
    }),
    createRoleDocs({
      db,
      uid: emptyStudentUser.uid,
      email: fixture.emptyStudentEmail,
      role: 'student',
      studentId: fixture.emptyStudentId,
    }),
  ]);

  const refs = [
    db.collection('privateStudents').doc(fixture.studentId),
    db.collection('privateStudents').doc(fixture.emptyStudentId),
    db.collection('privateStudents').doc(fixture.otherStudentId),
    db.collection('groupClasses').doc(fixture.ownGroupClassId),
    db.collection('groupClasses').doc(fixture.otherGroupClassId),
    db.collection('groupLessons').doc(fixture.ownGroupLessonId),
    db.collection('groupLessons').doc(fixture.otherGroupLessonId),
    db.collection('groupLessonReservations').doc(
      reservationId({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        lessonId: fixture.ownGroupLessonId,
        studentId: fixture.studentId,
      })
    ),
    db.collection('groupLessonReservations').doc(
      reservationId({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        lessonId: fixture.otherGroupLessonId,
        studentId: fixture.otherStudentId,
      })
    ),
    db.collection('lessons').doc(fixture.ownPrivateLessonId),
    db.collection('lessons').doc(fixture.otherPrivateLessonId),
    db.collection('privateLessonSlots').doc(fixture.ownPrivateSlotId),
    db.collection('privateLessonSlots').doc(fixture.otherPrivateSlotId),
    db.collection('privateLessonReservations').doc(
      privateReservationId({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        slotId: fixture.ownPrivateSlotId,
        studentId: fixture.studentId,
      })
    ),
    db.collection('privateLessonReservations').doc(
      privateReservationId({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        slotId: fixture.otherPrivateSlotId,
        studentId: fixture.otherStudentId,
      })
    ),
    db.collection('studentGroupAccessSummary').doc(`${DEFAULT_E2E_ACADEMY_ID}__${fixture.studentId}`),
    db.collection('studentPrivateAccessSummary').doc(`${DEFAULT_E2E_ACADEMY_ID}__${fixture.studentId}`),
    db.collection('studentGroupAccessSummary').doc(`${DEFAULT_E2E_ACADEMY_ID}__${fixture.emptyStudentId}`),
    db.collection('studentPrivateAccessSummary').doc(`${DEFAULT_E2E_ACADEMY_ID}__${fixture.emptyStudentId}`),
    db.collection('users').doc(teacherUser.uid),
    db.collection('users').doc(studentUser.uid),
    db.collection('users').doc(emptyStudentUser.uid),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${teacherUser.uid}`),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${studentUser.uid}`),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${emptyStudentUser.uid}`),
  ];
  fixture.docRefs = refs;

  await Promise.all([
    refs[0].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: fixture.studentName,
      teacher: fixture.teacherName,
      status: 'active',
      updatedAt: now,
    }),
    refs[1].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: fixture.emptyStudentName,
      teacher: fixture.teacherName,
      status: 'active',
      updatedAt: now,
    }),
    refs[2].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: fixture.otherStudentName,
      teacher: fixture.otherTeacherName,
      status: 'active',
      updatedAt: now,
    }),
    refs[3].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: `오늘반 ${unique}`,
      teacher: fixture.teacherName,
      status: 'active',
      updatedAt: now,
    }),
    refs[4].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: `다른반 ${unique}`,
      teacher: fixture.otherTeacherName,
      status: 'active',
      updatedAt: now,
    }),
    refs[5].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      groupClassId: fixture.ownGroupClassId,
      groupClassName: `오늘반 ${unique}`,
      teacher: fixture.teacherName,
      date: today,
      time: '09:10',
      subject: fixture.ownGroupTitle,
      capacity: 6,
      bookedCount: 1,
      isBookable: true,
      updatedAt: now,
    }),
    refs[6].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      groupClassId: fixture.otherGroupClassId,
      groupClassName: `다른반 ${unique}`,
      teacher: fixture.otherTeacherName,
      date: today,
      time: '10:20',
      subject: fixture.otherGroupTitle,
      capacity: 6,
      bookedCount: 1,
      isBookable: true,
      updatedAt: now,
    }),
    refs[7].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      lessonId: fixture.ownGroupLessonId,
      groupClassId: fixture.ownGroupClassId,
      studentId: fixture.studentId,
      studentName: fixture.studentName,
      teacher: fixture.teacherName,
      status: 'active',
      source: 'student',
      updatedAt: now,
    }),
    refs[8].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      lessonId: fixture.otherGroupLessonId,
      groupClassId: fixture.otherGroupClassId,
      studentId: fixture.otherStudentId,
      studentName: fixture.otherStudentName,
      teacher: fixture.otherTeacherName,
      status: 'active',
      source: 'dashboard',
      updatedAt: now,
    }),
    refs[9].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      student: fixture.studentName,
      studentName: fixture.studentName,
      teacher: fixture.teacherName,
      teacherName: fixture.teacherName,
      date: today,
      time: '11:30',
      sessionNumber: 3,
      subject: fixture.ownPrivateTitle,
      updatedAt: now,
    }),
    refs[10].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      student: fixture.otherStudentName,
      studentName: fixture.otherStudentName,
      teacher: fixture.otherTeacherName,
      teacherName: fixture.otherTeacherName,
      date: today,
      time: '12:40',
      subject: fixture.otherPrivateTitle,
      updatedAt: now,
    }),
    refs[11].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: fixture.teacherName,
      date: today,
      time: '13:50',
      subject: fixture.ownPrivateReservationTitle,
      status: 'reserved',
      reservedStudentId: fixture.studentId,
      updatedAt: now,
    }),
    refs[12].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: fixture.otherTeacherName,
      date: today,
      time: '15:10',
      subject: fixture.otherPrivateReservationTitle,
      status: 'reserved',
      reservedStudentId: fixture.otherStudentId,
      updatedAt: now,
    }),
    refs[13].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      slotId: fixture.ownPrivateSlotId,
      studentId: fixture.studentId,
      studentName: fixture.studentName,
      teacher: fixture.teacherName,
      date: today,
      time: '13:50',
      subject: fixture.ownPrivateReservationTitle,
      status: 'active',
      updatedAt: now,
    }),
    refs[14].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      slotId: fixture.otherPrivateSlotId,
      studentId: fixture.otherStudentId,
      studentName: fixture.otherStudentName,
      teacher: fixture.otherTeacherName,
      date: today,
      time: '15:10',
      subject: fixture.otherPrivateReservationTitle,
      status: 'active',
      updatedAt: now,
    }),
    refs[15].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: fixture.studentId,
      groupClassIds: [fixture.ownGroupClassId],
      updatedAt: now,
    }),
    refs[16].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: fixture.studentId,
      teacherKeys: [fixture.teacherName],
      activePackageIds: [`today-package-${unique}`],
      updatedAt: now,
    }),
    refs[17].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: fixture.emptyStudentId,
      groupClassIds: [],
      updatedAt: now,
    }),
    refs[18].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: fixture.emptyStudentId,
      teacherKeys: [],
      activePackageIds: [],
      updatedAt: now,
    }),
  ]);
});

test.afterAll(async () => {
  if (!hasServiceAccount()) return;
  initializeAdmin();
  const auth = admin.auth();
  await Promise.all(fixture.docRefs.map((ref) => ref.delete().catch(() => {})));
  await Promise.all(
    fixture.createdAuthEmails.map((email) =>
      getAuthUserByEmail(auth, email)
        .then((user) => (user ? auth.deleteUser(user.uid) : null))
        .catch(() => null)
    )
  );
});

test('admin sees academy-scoped 오늘의 일정 on dashboard', async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, /\/dashboard/);

  await expect(page.getByTestId('today-schedule-panel')).toBeVisible({ timeout: 20000 });
  await expectPanelContains(page, fixture.ownGroupTitle);
  await expectPanelContains(page, fixture.otherGroupTitle);
  await expectPanelContains(page, fixture.ownPrivateTitle);
  await expectPanelContains(page, fixture.ownPrivateReservationTitle);
  await expectPanelContains(page, fixture.today);
  await expectPanelContains(page, '3회차');
  await expectSummaryCountAtLeast(page, '개인 수업', 4);
  await expectSummaryCountAtLeast(page, '단체수업', 2);
  await expectPanelContains(page, fixture.studentName);
  await expectPanelContains(page, '예약 완료');
  await expectPanelContains(page, '예약됨');

  const ownReservationRow = page
    .locator('[data-testid="calendar-lesson-row"][data-row-kind="privateReservation"]')
    .filter({ hasText: fixture.ownPrivateReservationTitle });
  await expect(ownReservationRow).toBeVisible({ timeout: 20000 });
  await expect(ownReservationRow).toContainText(fixture.studentName);
  await expect(ownReservationRow).toContainText(fixture.teacherName);
  await expect(ownReservationRow).toContainText('예약됨');
  await expect(ownReservationRow).toContainText('예약 1:1');
  await expect(
    page
      .locator('[data-testid="calendar-lesson-row"][data-row-kind="privateReservation"]')
      .filter({ hasText: fixture.otherPrivateReservationTitle })
  ).toBeVisible();
  await expect(page.locator('main section button').filter({ hasText: '1:1 예약' }).first()).toBeVisible();

});

test('teacher sees only teacher-owned today schedule rows', async ({ page }) => {
  await login(page, fixture.teacherEmail, fixture.password, /\/dashboard/);

  const panel = page.getByTestId('today-schedule-panel');
  await expect(panel).toBeVisible({ timeout: 20000 });
  await expect(panel).toContainText(fixture.ownGroupTitle, { timeout: 20000 });
  await expect(panel).toContainText(fixture.ownPrivateTitle);
  await expect(panel).toContainText(fixture.ownPrivateReservationTitle);
  await expect(panel).toContainText(fixture.today);
  await expect(panel).toContainText('예약됨');
  await expect(panel).toContainText('3회차');
  await expectSummaryCount(page, '개인 수업', 2);
  await expect(panel).toContainText(fixture.teacherName);
  await expect(panel).not.toContainText(fixture.otherGroupTitle);
  await expect(panel).not.toContainText(fixture.otherPrivateTitle);
  await expect(panel).not.toContainText(fixture.otherStudentName);

  const ownReservationRow = page
    .locator('[data-testid="calendar-lesson-row"][data-row-kind="privateReservation"]')
    .filter({ hasText: fixture.ownPrivateReservationTitle });
  await expect(ownReservationRow).toBeVisible({ timeout: 20000 });
  await expect(ownReservationRow).toContainText(fixture.studentName);
  await expect(ownReservationRow).toContainText(fixture.teacherName);
  await expect(ownReservationRow).toContainText('예약됨');
  await expect(
    page
      .locator('[data-testid="calendar-lesson-row"][data-row-kind="privateReservation"]')
      .filter({ hasText: fixture.otherPrivateReservationTitle })
  ).toHaveCount(0);
  await expect(page.locator('main section button').filter({ hasText: '1:1 예약' }).first()).toBeVisible();
});

test('student sees only own active today reservations on student booking page', async ({ page }) => {
  await login(page, fixture.studentEmail, fixture.password, /\/student-booking/);

  const panel = page.getByTestId('today-schedule-panel');
  await expect(panel).toBeVisible({ timeout: 20000 });
  await expect(panel).toContainText(fixture.ownGroupTitle, { timeout: 20000 });
  await expect(panel).toContainText(fixture.ownPrivateReservationTitle);
  await expect(panel).toContainText('예약 완료');
  await expect(panel).not.toContainText(fixture.otherStudentName);
  await expect(panel).not.toContainText(fixture.otherGroupTitle);
  await expect(panel).not.toContainText(fixture.otherPrivateReservationTitle);
  await expect(panel).not.toContainText('학생');

});

test('student with no today schedule sees empty state', async ({ page }) => {
  await login(page, fixture.emptyStudentEmail, fixture.password, /\/student-booking/);

  const panel = page.getByTestId('today-schedule-panel');
  await expect(panel).toBeVisible({ timeout: 20000 });
  await expect(panel.getByTestId('today-schedule-empty')).toHaveText('오늘 예정된 수업이 없습니다.');

});
