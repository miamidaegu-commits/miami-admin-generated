import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import admin from 'firebase-admin';
import { ADMIN_STORAGE_STATE } from './global-setup.js';
import { BASE_URL, getGroupRow, loginAsAdmin, openDashboardSection } from './e2e-helpers.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures/test-data.js';
import {
  callGroupBookingFunction,
  cleanupTempGroupBookingSetup,
  createTempGroupBookingSetup,
} from './e2e-firebase-helpers.js';

test.use({ storageState: ADMIN_STORAGE_STATE });

const require = createRequire(import.meta.url);
const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');

function hasServiceAccount() {
  return fs.existsSync(SERVICE_ACCOUNT_PATH);
}

function getAdminDb() {
  if (!hasServiceAccount()) {
    throw new Error('serviceAccountKey.json is required for cross-academy admin fixture tests.');
  }

  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  }
  return admin.firestore();
}

function token() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function reserve(page, setup, studentIndex) {
  const student = setup.bookingStudents[studentIndex];
  return callGroupBookingFunction(page, 'reserveGroupLesson', {
    lessonId: setup.groupLessonId,
    studentId: student.studentId,
    studentName: student.studentName,
  });
}

async function cancel(page, setup, studentIndex, options = {}) {
  const student = setup.bookingStudents[studentIndex];
  return callGroupBookingFunction(page, 'cancelGroupLessonReservation', {
    lessonId: setup.groupLessonId,
    reservationId: `${setup.groupLessonId}_${student.studentId}`,
    studentId: student.studentId,
    studentName: student.studentName,
    ...options,
  });
}

function expectOk(result) {
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
}

async function createOtherAcademyBookingFixture(rawToken) {
  const db = getAdminDb();
  const normalizedToken = String(rawToken || token()).trim();
  const academyId = `academy_other_${normalizedToken}`;
  const teacher = `booking-teacher-${normalizedToken}`.toLowerCase();
  const nowTs = admin.firestore.Timestamp.now();
  const lessonDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000));
  const groupClassRef = db.collection('groupClasses').doc();
  const groupLessonRef = db.collection('groupLessons').doc();
  const studentRef = db.collection('privateStudents').doc();
  const groupName = `E2E 타학원 예약반 ${normalizedToken}`;
  const studentName = `E2E 타학원 학생 ${normalizedToken}`;

  await groupClassRef.set({
    academyId,
    name: groupName,
    teacher,
    maxStudents: 4,
    time: '19:00',
    subject: 'Booking',
    weekdays: [],
    createdAt: nowTs,
    updatedAt: nowTs,
  });
  await groupLessonRef.set({
    academyId,
    groupClassId: groupClassRef.id,
    groupClassID: groupClassRef.id,
    groupClassName: groupName,
    teacher,
    date: lessonDate,
    time: '19:00',
    subject: 'Booking',
    completed: false,
    countedStudentIDs: [],
    bookingMode: 'hybrid',
    capacity: 4,
    bookedCount: 0,
    isBookable: true,
    createdAt: nowTs,
    updatedAt: nowTs,
  });
  await studentRef.set({
    academyId,
    name: studentName,
    teacher,
    createdAt: nowTs,
    updatedAt: nowTs,
  });

  return {
    academyId,
    groupClassId: groupClassRef.id,
    groupLessonId: groupLessonRef.id,
    groupName,
    studentId: studentRef.id,
    studentName,
  };
}

async function cleanupOtherAcademyBookingFixture(fixture) {
  if (!fixture) return;
  const db = getAdminDb();
  await Promise.all([
    fixture.studentId ? db.collection('privateStudents').doc(fixture.studentId).delete() : Promise.resolve(),
    fixture.groupLessonId ? db.collection('groupLessons').doc(fixture.groupLessonId).delete() : Promise.resolve(),
    fixture.groupClassId ? db.collection('groupClasses').doc(fixture.groupClassId).delete() : Promise.resolve(),
  ]);
}

test('정원 5명, 고정 학생 3명일 때 예약 2명만 성공하고 3번째는 실패한다', async ({ page }) => {
  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const setup = await createTempGroupBookingSetup(page, {
    token: token(),
    capacity: 5,
    fixedCount: 3,
  });

  try {
    expectOk(await reserve(page, setup, 0));
    expectOk(await reserve(page, setup, 1));
    const third = await reserve(page, setup, 2);
    expect(third.ok).toBe(false);
    expect(third.message).toContain('정원이 마감');
  } finally {
    await cleanupTempGroupBookingSetup(page, setup);
  }
});

test('다른 academy의 수업은 보이거나 예약 수정되지 않는다', async ({ page }) => {
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 없어서 cross-academy admin fixture test를 건너뜁니다.');

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const setup = await createTempGroupBookingSetup(page, {
    token: token(),
    capacity: 4,
    fixedCount: 0,
  });
  const otherFixture = await createOtherAcademyBookingFixture(token());

  try {
    await openDashboardSection(page, '반 관리');
    await expect(getGroupRow(page, otherFixture.groupName)).toHaveCount(0);

    const listResult = await callGroupBookingFunction(page, 'listBookableGroupLessons', {
      studentId: setup.bookingStudents[0].studentId,
      studentName: setup.bookingStudents[0].studentName,
    });
    expectOk(listResult);
    expect(listResult.data.lessons.some((lesson) => lesson.id === setup.groupLessonId)).toBe(true);
    expect(listResult.data.lessons.some((lesson) => lesson.id === otherFixture.groupLessonId)).toBe(false);

    const reserveResult = await callGroupBookingFunction(page, 'reserveGroupLesson', {
      lessonId: otherFixture.groupLessonId,
      studentId: otherFixture.studentId,
      studentName: otherFixture.studentName,
    });
    expect(reserveResult.ok).toBe(false);
    expect(reserveResult.message).toMatch(/다른 (academy|학원)/);
  } finally {
    await cleanupTempGroupBookingSetup(page, setup);
    await cleanupOtherAcademyBookingFixture(otherFixture);
  }
});

test('같은 학생의 중복 예약을 막는다', async ({ page }) => {
  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const setup = await createTempGroupBookingSetup(page, {
    token: token(),
    capacity: 5,
    fixedCount: 0,
  });

  try {
    expectOk(await reserve(page, setup, 0));
    const duplicate = await reserve(page, setup, 0);
    expect(duplicate.ok).toBe(false);
    expect(duplicate.message).toContain('이미 예약');
  } finally {
    await cleanupTempGroupBookingSetup(page, setup);
  }
});

test('예약 취소 후 자리가 다시 열린다', async ({ page }) => {
  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const setup = await createTempGroupBookingSetup(page, {
    token: token(),
    capacity: 1,
    fixedCount: 0,
  });

  try {
    expectOk(await reserve(page, setup, 0));
    expect((await reserve(page, setup, 1)).ok).toBe(false);
    expectOk(await cancel(page, setup, 0));
    expectOk(await reserve(page, setup, 1));
  } finally {
    await cleanupTempGroupBookingSetup(page, setup);
  }
});

test('학생 직접 취소는 월 2회 이후 3번째 취소가 막힌다', async ({ page }) => {
  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const setup = await createTempGroupBookingSetup(page, {
    token: token(),
    capacity: 3,
    fixedCount: 0,
  });

  try {
    expectOk(await reserve(page, setup, 0));
    expectOk(await cancel(page, setup, 0, { asStudent: true }));
    expectOk(await reserve(page, setup, 0));
    expectOk(await cancel(page, setup, 0, { asStudent: true }));
    expectOk(await reserve(page, setup, 0));
    const thirdCancel = await cancel(page, setup, 0, { asStudent: true });
    expect(thirdCancel.ok).toBe(false);
    expect(thirdCancel.message).toContain('이번 달 예약 취소 가능 횟수 2회');
  } finally {
    await cleanupTempGroupBookingSetup(page, setup);
  }
});

test('고정 학생과 예약 학생이 출결/차감 모달에 함께 보인다', async ({ page }) => {
  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const setup = await createTempGroupBookingSetup(page, {
    token: token(),
    capacity: 5,
    fixedCount: 1,
  });

  try {
    expectOk(await reserve(page, setup, 0));
    await openDashboardSection(page, '반 관리');
    await expect(getGroupRow(page, setup.groupName)).toBeVisible();
    await getGroupRow(page, setup.groupName).click();
    const lessonRow = page.locator(`[data-testid="group-lesson-row"][data-lesson-date="${setup.lessonDate}"]`).first();
    await expect(lessonRow).toBeVisible();
    await lessonRow.getByRole('button', { name: '출결/차감', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /출결\s*\/\s*차감/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(setup.fixedStudents[0].studentName, { exact: true })).toBeVisible();
    await expect(dialog.getByText(setup.bookingStudents[0].studentName, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  } finally {
    await cleanupTempGroupBookingSetup(page, setup);
  }
});

test('예약 학생도 차감 후 차감복구할 수 있다', async ({ page }) => {
  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const ymd = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  const setup = await createTempGroupBookingSetup(page, {
    token: token(),
    capacity: 5,
    fixedCount: 0,
    lessonDate: ymd,
  });

  try {
    expectOk(await reserve(page, setup, 0));
    await openDashboardSection(page, '반 관리');
    await getGroupRow(page, setup.groupName).click();
    const lessonRow = page.locator(`[data-testid="group-lesson-row"][data-lesson-date="${setup.lessonDate}"]`).first();
    await lessonRow.getByRole('button', { name: '출결/차감', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /출결\s*\/\s*차감/ });
    const studentRow = dialog.locator('.table-row').filter({ hasText: setup.bookingStudents[0].studentName }).first();
    await expect(studentRow).toBeVisible();
    await studentRow.getByRole('button', { name: '차감', exact: true }).click();
    await expect.poll(() => studentRow.locator('span').nth(3).innerText()).toBe('차감됨');
    await studentRow.getByRole('button', { name: '차감복구', exact: true }).click();
    await expect.poll(() => studentRow.locator('span').nth(3).innerText()).toBe('차감취소됨');
    await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  } finally {
    await cleanupTempGroupBookingSetup(page, setup);
  }
});
