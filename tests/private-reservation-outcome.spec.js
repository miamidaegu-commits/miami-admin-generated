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
  TEST_TEACHER_EMAIL,
  TEST_TEACHER_PASSWORD,
} from './fixtures/test-data.js';

const require = createRequire(import.meta.url);
const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const RUN_OUTCOME_E2E = process.env.RUN_PRIVATE_RESERVATION_OUTCOME_E2E === '1';
const TEACHER_NAME = 'teacher';

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

async function login(page, email, password) {
  await page.goto(BASE_URL);
  await page.getByLabel(/Email|이메일/i).or(page.locator('input[type="email"]')).first().fill(email);
  await page
    .getByLabel(/Password|비밀번호/i)
    .or(page.locator('input[type="password"]'))
    .first()
    .fill(password);
  await page.getByRole('button', { name: /Sign In|로그인/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
}

function reservationId({ slotId, studentId }) {
  return `${DEFAULT_E2E_ACADEMY_ID}__${slotId}__${studentId}`;
}

async function ensureAdminAndTeacher({ auth, db }) {
  const [adminUser, teacherUser] = await Promise.all([
    auth.getUserByEmail(ADMIN_EMAIL),
    auth.getUserByEmail(TEST_TEACHER_EMAIL),
  ]);
  const now = admin.firestore.FieldValue.serverTimestamp();
  await Promise.all([
    db.collection('academies').doc(DEFAULT_E2E_ACADEMY_ID).set(
      {
        id: DEFAULT_E2E_ACADEMY_ID,
        name: DEFAULT_E2E_ACADEMY_NAME,
        status: 'active',
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
        role: 'owner',
        teacherName: '',
        status: 'active',
        updatedAt: now,
      },
      { merge: true }
    ),
    db.collection('users').doc(teacherUser.uid).set(
      {
        uid: teacherUser.uid,
        email: TEST_TEACHER_EMAIL,
        role: 'teacher',
        teacherName: TEACHER_NAME,
        isActive: true,
        lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
        updatedAt: now,
      },
      { merge: true }
    ),
    db.collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${teacherUser.uid}`).set(
      {
        academyId: DEFAULT_E2E_ACADEMY_ID,
        uid: teacherUser.uid,
        email: TEST_TEACHER_EMAIL,
        role: 'teacher',
        teacherName: TEACHER_NAME,
        status: 'active',
        updatedAt: now,
      },
      { merge: true }
    ),
  ]);
}

async function seedReservationFixture({ db, unique, kind, status = 'active' }) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const date = todayInSeoul();
  const studentId = `outcome-${kind}-student-${unique}`;
  const slotId = `outcome-${kind}-slot-${unique}`;
  const packageId = `outcome-${kind}-package-${unique}`;
  const subject = `예약처리 ${kind} ${unique}`;
  const id = reservationId({ slotId, studentId });
  await Promise.all([
    db.collection('privateStudents').doc(studentId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: `예약처리학생 ${kind} ${unique}`,
      teacher: TEACHER_NAME,
      status: 'active',
      updatedAt: now,
    }),
    db.collection('studentPackages').doc(packageId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId,
      studentName: `예약처리학생 ${kind} ${unique}`,
      teacher: TEACHER_NAME,
      packageType: 'private',
      totalCount: 2,
      usedCount: 0,
      remainingCount: 2,
      status: 'active',
      updatedAt: now,
    }),
    db.collection('privateLessonSlots').doc(slotId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: TEACHER_NAME,
      date,
      time: kind === 'complete' ? '17:10' : kind === 'no-show' ? '17:20' : '17:30',
      subject,
      status: status === 'active' ? 'reserved' : 'open',
      reservedStudentId: status === 'active' ? studentId : '',
      reservationId: status === 'active' ? id : '',
      updatedAt: now,
    }),
    db.collection('privateLessonReservations').doc(id).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      slotId,
      studentId,
      studentName: `예약처리학생 ${kind} ${unique}`,
      teacher: TEACHER_NAME,
      date,
      time: kind === 'complete' ? '17:10' : kind === 'no-show' ? '17:20' : '17:30',
      subject,
      status,
      deductionApplied: false,
      packageId,
      updatedAt: now,
    }),
  ]);
  return { id, slotId, studentId, packageId, subject };
}

async function expectPackageCounts(db, packageId, usedCount, remainingCount) {
  await expect
    .poll(async () => {
      const snap = await db.collection('studentPackages').doc(packageId).get();
      const data = snap.data() || {};
      return {
        usedCount: Number(data.usedCount || 0),
        remainingCount: Number(data.remainingCount || 0),
      };
    }, { timeout: 20000 })
    .toEqual({ usedCount, remainingCount });
}

test.describe('private reservation admin outcome deduction', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json is required.');
  test.skip(
    !RUN_OUTCOME_E2E,
    'Set RUN_PRIVATE_RESERVATION_OUTCOME_E2E=1 after deploying markPrivateReservationOutcome'
  );

  const unique = `outcome-${Date.now()}`;
  const refs = [];
  let db;
  let completeFixture;
  let noShowFixture;
  let cancelledFixture;

  test.beforeAll(async () => {
    initializeAdmin();
    db = admin.firestore();
    await ensureAdminAndTeacher({ auth: admin.auth(), db });
    completeFixture = await seedReservationFixture({ db, unique, kind: 'complete' });
    noShowFixture = await seedReservationFixture({ db, unique, kind: 'no-show' });
    cancelledFixture = await seedReservationFixture({
      db,
      unique,
      kind: 'cancelled',
      status: 'cancelled',
    });
    [completeFixture, noShowFixture, cancelledFixture].forEach((fixture) => {
      refs.push(
        db.collection('privateStudents').doc(fixture.studentId),
        db.collection('studentPackages').doc(fixture.packageId),
        db.collection('privateLessonSlots').doc(fixture.slotId),
        db.collection('privateLessonReservations').doc(fixture.id),
        db.collection('creditTransactions').doc(`privateReservationDeduction__${fixture.id}`)
      );
    });
  });

  test.afterAll(async () => {
    if (!hasServiceAccount()) return;
    initializeAdmin();
    await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
  });

  test('admin can complete reservation and deduction is applied once', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const row = page
      .locator('[data-testid="calendar-lesson-row"][data-row-kind="privateReservation"]')
      .filter({ hasText: completeFixture.subject });
    page.once('dialog', (dialog) => dialog.accept());
    await row.getByRole('button', { name: '완료 처리' }).click();
    await expect(row).toHaveCount(0, { timeout: 20000 });
    await expectPackageCounts(db, completeFixture.packageId, 1, 1);
    const reservationSnap = await db
      .collection('privateLessonReservations')
      .doc(completeFixture.id)
      .get();
    expect(reservationSnap.data()).toMatchObject({
      status: 'completed',
      deductionApplied: true,
      deductionPackageId: completeFixture.packageId,
    });
    const creditSnap = await db
      .collection('creditTransactions')
      .doc(`privateReservationDeduction__${completeFixture.id}`)
      .get();
    expect(creditSnap.data()).toMatchObject({
      sourceType: 'privateReservation',
      sourceId: completeFixture.id,
      actionType: 'private_reservation_completed_deduct',
      deltaCount: -1,
    });
  });

  test('admin can mark no-show and deduction is applied once', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const row = page
      .locator('[data-testid="calendar-lesson-row"][data-row-kind="privateReservation"]')
      .filter({ hasText: noShowFixture.subject });
    page.once('dialog', (dialog) => dialog.accept());
    await row.getByRole('button', { name: '노쇼 처리' }).click();
    await expect(row).toHaveCount(0, { timeout: 20000 });
    await expectPackageCounts(db, noShowFixture.packageId, 1, 1);
    const reservationSnap = await db
      .collection('privateLessonReservations')
      .doc(noShowFixture.id)
      .get();
    expect(reservationSnap.data()).toMatchObject({
      status: 'no_show',
      deductionApplied: true,
      deductionPackageId: noShowFixture.packageId,
    });
    const creditSnap = await db
      .collection('creditTransactions')
      .doc(`privateReservationDeduction__${noShowFixture.id}`)
      .get();
    expect(creditSnap.data()).toMatchObject({
      sourceType: 'privateReservation',
      sourceId: noShowFixture.id,
      actionType: 'private_reservation_no_show_deduct',
      deltaCount: -1,
    });
  });

  test('teacher cannot see completion/no-show buttons', async ({ page }) => {
    await login(page, TEST_TEACHER_EMAIL, TEST_TEACHER_PASSWORD);
    await expect(page.getByRole('button', { name: '완료 처리' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '노쇼 처리' })).toHaveCount(0);
  });

  test('cancelled reservation cannot be completed from the calendar', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(
      page
        .locator('[data-testid="calendar-lesson-row"][data-row-kind="privateReservation"]')
        .filter({ hasText: cancelledFixture.subject })
    ).toHaveCount(0);
  });
});
