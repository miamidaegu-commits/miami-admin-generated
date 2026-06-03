import fs from 'node:fs';
import path from 'node:path';
import admin from 'firebase-admin';
import { test, expect } from '@playwright/test';
import {
  getStudentRow,
  getStudentSearchInput,
  loginAsAdmin,
  openDashboardSection,
  selectTeacherOption,
} from './e2e-helpers.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, DEFAULT_E2E_ACADEMY_ID } from './fixtures/test-data.js';
import {
  createAdminSeededPrivateLesson,
  createAdminSeededPrivateReservation,
  createAdminSeededPrivateStudent,
  createAdminSeededStudentPackage,
} from './e2e-admin-helpers.js';

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const ADMIN_APP_NAME = 'private-package-top-up-e2e';

function getAdminApp() {
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
  return getAdminApp().firestore();
}

function futureYmd(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDays(ymd, days) {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getWeekday(ymd) {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay();
}

async function createTeacherAndTemplate({ unique, teacherKey, teacherName }) {
  const db = getDb();
  const now = admin.firestore.Timestamp.now();
  const templateStart = futureYmd(35);
  const teacherId = `e2e-top-up-teacher-${unique}`;
  const templateId = `e2e-top-up-template-${unique}`;
  await Promise.all([
    db.collection('teachers').doc(teacherId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: teacherName,
      teacherName,
      teacherKey,
      teacherUid: `uid-${teacherKey}`,
      teacherEmail: `${teacherKey}@example.com`,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }),
    db.collection('privateLessonAvailabilityTemplates').doc(templateId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacher: teacherKey,
      teacherName,
      teacherKey,
      teacherUid: `uid-${teacherKey}`,
      weekday: getWeekday(templateStart),
      time: '21:30',
      durationMinutes: 60,
      status: 'active',
      effectiveStartDate: templateStart,
      effectiveEndDate: addDays(templateStart, 21),
      createdAt: now,
      updatedAt: now,
    }),
  ]);
  return { teacherId, templateId, templateStart };
}

async function createCreditTransaction({
  packageId,
  studentId,
  studentName,
  teacher,
  packageTitle,
  actionType = 'package_created',
  deltaCount = 4,
}) {
  await getDb().collection('creditTransactions').add({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    studentId,
    studentName,
    teacher,
    packageId,
    packageType: 'private',
    packageTitle,
    groupClassName: '',
    sourceType: 'studentPackage',
    sourceId: packageId,
    actionType,
    deltaCount,
    memo: `${packageTitle} · 신규 수강권 발급`,
    actorUid: 'e2e-admin',
    actorRole: 'admin',
    createdAt: admin.firestore.Timestamp.now(),
  });
}

async function cleanupFixture(fixture) {
  if (!fixture) return;
  const db = getDb();
  const refs = [];

  for (const collectionName of ['lessons', 'privateLessonReservations', 'studentPackages']) {
    const snap = await db
      .collection(collectionName)
      .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
      .where('studentId', '==', fixture.studentId)
      .get()
      .catch(() => ({ docs: [] }));
    refs.push(...snap.docs.map((docSnap) => docSnap.ref));
  }

  for (const packageId of fixture.packageIds || []) {
    const txSnap = await db
      .collection('creditTransactions')
      .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
      .where('packageId', '==', packageId)
      .get()
      .catch(() => ({ docs: [] }));
    refs.push(...txSnap.docs.map((docSnap) => docSnap.ref));
  }
  if (fixture.studentId) {
    const txSnap = await db
      .collection('creditTransactions')
      .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
      .where('studentId', '==', fixture.studentId)
      .get()
      .catch(() => ({ docs: [] }));
    refs.push(...txSnap.docs.map((docSnap) => docSnap.ref));
  }

  if (fixture.studentId) refs.push(db.collection('privateStudents').doc(fixture.studentId));
  if (fixture.teacherId) refs.push(db.collection('teachers').doc(fixture.teacherId));
  if (fixture.templateId) {
    refs.push(db.collection('privateLessonAvailabilityTemplates').doc(fixture.templateId));
  }

  await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
}

async function openPrivatePackageAddDialog(page, studentName) {
  await openDashboardSection(page, '학생 관리');
  await getStudentSearchInput(page).fill(studentName);
  const studentRow = getStudentRow(page, studentName);
  await expect(studentRow).toBeVisible({ timeout: 15000 });
  await studentRow.getByRole('button', { name: '수강권 추가', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('수강권 유형').selectOption('private');
  return dialog;
}

test('admin tops up an existing same-teacher private package', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!fs.existsSync(SERVICE_ACCOUNT_PATH), 'serviceAccountKey.json이 있을 때만 실행합니다.');
  test.setTimeout(180000);

  const unique = Date.now();
  const teacherKey = `top-up-teacher-${unique}`;
  const teacherName = `Top Up Teacher ${unique}`;
  const packageTitle = `E2E top-up package ${unique}`;
  const paymentDate = '2026-06-03';
  const memo = `E2E top-up memo ${unique}`;
  let fixture = null;

  try {
    const teacherFixture = await createTeacherAndTemplate({ unique, teacherKey, teacherName });
    const student = await createAdminSeededPrivateStudent({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: `e2e-top-up-student-${unique}`,
      name: `E2E 추가등록 학생 ${unique}`,
      studentName: `E2E 추가등록 학생 ${unique}`,
      teacher: teacherKey,
      teacherName,
    });
    const studentPackage = await createAdminSeededStudentPackage({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      packageId: `e2e-top-up-package-${unique}`,
      studentId: student.studentId,
      studentName: student.studentName,
      title: packageTitle,
      packageType: 'private',
      teacher: teacherKey,
      teacherName,
      totalCount: 4,
      usedCount: 0,
      remainingCount: 4,
      status: 'active',
      registrationStartDate: '2026-05-01',
      paymentDate: '2026-05-01',
    });
    fixture = {
      ...teacherFixture,
      studentId: student.studentId,
      packageIds: [studentPackage.packageId],
    };
    await createCreditTransaction({
      packageId: studentPackage.packageId,
      studentId: student.studentId,
      studentName: student.studentName,
      teacher: teacherKey,
      packageTitle,
      deltaCount: 4,
    });
    await Promise.all([
      createAdminSeededPrivateLesson({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        studentId: student.studentId,
        studentName: student.studentName,
        packageId: studentPackage.packageId,
        teacher: teacherKey,
        teacherName,
        date: futureYmd(7),
        time: '10:00',
        subject: `E2E fixed 1 ${unique}`,
      }),
      createAdminSeededPrivateLesson({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        studentId: student.studentId,
        studentName: student.studentName,
        packageId: studentPackage.packageId,
        teacher: teacherKey,
        teacherName,
        date: futureYmd(14),
        time: '10:00',
        subject: `E2E fixed 2 ${unique}`,
      }),
      createAdminSeededPrivateLesson({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        studentId: student.studentId,
        studentName: student.studentName,
        packageId: studentPackage.packageId,
        teacher: teacherKey,
        teacherName,
        date: futureYmd(21),
        time: '10:00',
        subject: `E2E fixed 3 ${unique}`,
      }),
      createAdminSeededPrivateReservation({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        studentId: student.studentId,
        studentName: student.studentName,
        packageId: studentPackage.packageId,
        teacher: teacherKey,
        teacherName,
        date: futureYmd(10),
        time: '11:00',
        status: 'active',
      }),
    ]);

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const dialog = await openPrivatePackageAddDialog(page, student.studentName);
    await expect(dialog.getByTestId('student-package-top-up-section')).toBeVisible();
    await expect(dialog).toContainText('기존 수강권에 추가 등록할 수 있습니다.');
    await expect(dialog).toContainText('총 4회 · 사용 0회 · 남은 4회');
    await expect(dialog).toContainText('고정 예정 3회 · 예약 1회 · 새 배정 가능 0회');

    await dialog.getByTestId('private-package-top-up-count-input').fill('4');
    await dialog.getByTestId('student-package-payment-date-input').fill(paymentDate);
    await dialog.getByTestId('private-package-top-up-amount-input').fill('300000');
    await dialog.getByTestId('private-package-top-up-memo-input').fill(memo);
    await expect(dialog.getByTestId('student-package-top-up-section')).not.toContainText(
      '새 수강권으로 발급'
    );
    await expect(dialog.getByTestId('private-package-other-options')).toContainText('기타 옵션');
    await dialog.getByRole('button', { name: '기존 수강권에 추가 등록', exact: true }).click();

    const postDialog = page.getByRole('dialog', { name: '고정 1:1 수업 배정으로 이동할까요?' });
    await expect(postDialog).toBeVisible();
    await expect(postDialog).toContainText('기존 개인 수강권에 추가 등록했습니다.');
    await postDialog.getByRole('button', { name: '나중에 하기', exact: true }).click();

    await expect
      .poll(async () => {
        const snap = await getDb().collection('studentPackages').doc(studentPackage.packageId).get();
        const data = snap.data() || {};
        return {
          totalCount: data.totalCount,
          remainingCount: data.remainingCount,
          usedCount: data.usedCount,
          paymentDate: data.paymentDate,
        };
      })
      .toEqual({
        totalCount: 8,
        remainingCount: 8,
        usedCount: 0,
        paymentDate: '2026-05-01',
      });

    await openDashboardSection(page, '학생 관리');
    await getStudentSearchInput(page).fill(student.studentName);
    const studentRow = getStudentRow(page, student.studentName);
    const privatePackageCell = studentRow.getByTestId('student-private-package-cell');
    await expect(privatePackageCell).toContainText(`${teacherName} 수강권`);
    await expect(privatePackageCell).toContainText('잔여 8회 / 총 8회 · 사용 0회');
    await expect(privatePackageCell).toContainText('고정 예정 3회 · 보충 예약 1회 · 예약 가능 4회');
    await expect(privatePackageCell).not.toContainText('잔여 4회 / 총 4회');

    await studentRow.getByRole('button', { name: '수강권 보기', exact: true }).click();
    const packageCard = page
      .getByTestId('student-package-card')
      .filter({ hasText: packageTitle })
      .first();
    await expect(packageCard).toBeVisible();
    await packageCard.getByTestId('student-package-history-button').click();
    const historyDialog = page.getByRole('dialog', { name: '수강권 이력' });
    await expect(historyDialog).toBeVisible();
    await expect(historyDialog).toContainText('수강권 발급');
    await expect(historyDialog).toContainText('2회차 등록');
    await expect(historyDialog).toContainText('+4');
    await expect(historyDialog).toContainText(`결제일 ${paymentDate}`);
    await expect(historyDialog).toContainText('결제 금액 300000');
    await expect(historyDialog).toContainText(memo);
    await historyDialog.getByRole('button', { name: '닫기', exact: true }).click();

    await openDashboardSection(page, '1:1 예약 시간 관리');
    const section = page.getByTestId('private-fixed-slot-assignment-section');
    await expect(section).toBeVisible({ timeout: 15000 });
    await selectTeacherOption(
      section.getByTestId('private-fixed-assignment-teacher-select'),
      teacherName,
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
    await expect
      .poll(
        () =>
          section
            .getByTestId('private-fixed-assignment-student-select')
            .locator('option')
            .evaluateAll((options) => options.map((option) => option.value)),
        { timeout: 15000 }
      )
      .toContain(student.studentId);
    await section.getByTestId('private-fixed-assignment-student-select').selectOption(student.studentId);
    const packageSelect = section.getByTestId('private-fixed-assignment-package-select');
    await expect
      .poll(
        () =>
          packageSelect
            .locator('option')
            .evaluateAll((options) => options.map((option) => option.value)),
        { timeout: 15000 }
      )
      .toContain(studentPackage.packageId);
    await expect(packageSelect).toContainText('새 배정 가능 4회', { timeout: 15000 });
  } finally {
    await cleanupFixture(fixture).catch(() => {});
  }
});

test('admin can force a new same-teacher package with confirmation', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!fs.existsSync(SERVICE_ACCOUNT_PATH), 'serviceAccountKey.json이 있을 때만 실행합니다.');
  test.setTimeout(120000);

  const unique = Date.now();
  const teacherKey = `top-up-force-teacher-${unique}`;
  const teacherName = `Top Up Force Teacher ${unique}`;
  let fixture = null;

  try {
    const student = await createAdminSeededPrivateStudent({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: `e2e-top-up-force-student-${unique}`,
      name: `E2E 새발급 학생 ${unique}`,
      studentName: `E2E 새발급 학생 ${unique}`,
      teacher: teacherKey,
      teacherName,
    });
    const existingPackage = await createAdminSeededStudentPackage({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      packageId: `e2e-top-up-force-package-${unique}`,
      studentId: student.studentId,
      studentName: student.studentName,
      title: `E2E 기존 새발급 ${unique}`,
      packageType: 'private',
      teacher: teacherKey,
      teacherName,
      totalCount: 4,
      remainingCount: 4,
      usedCount: 0,
      status: 'active',
    });
    fixture = { studentId: student.studentId, packageIds: [existingPackage.packageId] };

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const dialog = await openPrivatePackageAddDialog(page, student.studentName);
    await expect(dialog.getByTestId('student-package-top-up-section')).toBeVisible();
    await expect(dialog.getByTestId('private-package-other-options')).toContainText('기타 옵션');
    await dialog.getByTestId('private-package-force-new-button').click();
    await dialog.getByRole('button', { name: '횟수 수강권', exact: true }).click();
    await dialog.getByLabel('제목').fill(`E2E 강제 새 수강권 ${unique}`);
    await dialog.getByLabel(/총 횟수/).fill('2');

    page.once('dialog', async (nativeDialog) => {
      expect(nativeDialog.message()).toContain('같은 선생님 수강권이 이미 있습니다.');
      expect(nativeDialog.message()).toContain(
        '일반적인 2회차/3회차 등록은 기존 수강권에 추가 등록을 사용하세요.'
      );
      expect(nativeDialog.message()).toContain('정말 별도 수강권으로 발급할까요?');
      await nativeDialog.accept();
    });
    await dialog.getByRole('button', { name: '새 수강권으로 발급', exact: true }).click();
    const postDialog = page.getByRole('dialog', { name: '고정 1:1 수업 배정으로 이동할까요?' });
    await expect(postDialog).toBeVisible();
    await postDialog.getByRole('button', { name: '나중에 하기', exact: true }).click();

    await expect
      .poll(async () => {
        const snap = await getDb()
          .collection('studentPackages')
          .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
          .where('studentId', '==', student.studentId)
          .where('teacher', '==', teacherKey)
          .get();
        return snap.docs.length;
      })
      .toBe(2);
  } finally {
    await cleanupFixture(fixture).catch(() => {});
  }
});

test('different teacher scope still creates a separate private package', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!fs.existsSync(SERVICE_ACCOUNT_PATH), 'serviceAccountKey.json이 있을 때만 실행합니다.');
  test.setTimeout(120000);

  const unique = Date.now();
  const currentTeacher = `top-up-current-${unique}`;
  const otherTeacher = `top-up-other-${unique}`;
  let fixture = null;

  try {
    const student = await createAdminSeededPrivateStudent({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: `e2e-top-up-different-student-${unique}`,
      name: `E2E 다른선생님 학생 ${unique}`,
      studentName: `E2E 다른선생님 학생 ${unique}`,
      teacher: currentTeacher,
      teacherName: currentTeacher,
    });
    const existingPackage = await createAdminSeededStudentPackage({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      packageId: `e2e-top-up-different-package-${unique}`,
      studentId: student.studentId,
      studentName: student.studentName,
      title: `E2E 다른 선생님 기존 ${unique}`,
      packageType: 'private',
      teacher: otherTeacher,
      teacherName: otherTeacher,
      totalCount: 4,
      remainingCount: 4,
      usedCount: 0,
      status: 'active',
    });
    fixture = { studentId: student.studentId, packageIds: [existingPackage.packageId] };

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const dialog = await openPrivatePackageAddDialog(page, student.studentName);
    await expect(dialog.getByTestId('student-package-top-up-section')).toHaveCount(0);
    await dialog.getByRole('button', { name: '횟수 수강권', exact: true }).click();
    await dialog.getByLabel('제목').fill(`E2E 현재 선생님 신규 ${unique}`);
    await dialog.getByLabel(/총 횟수/).fill('3');
    await dialog.getByRole('button', { name: '저장', exact: true }).click();
    const postDialog = page.getByRole('dialog', { name: '고정 1:1 수업 배정으로 이동할까요?' });
    await expect(postDialog).toBeVisible();
    await postDialog.getByRole('button', { name: '나중에 하기', exact: true }).click();

    await expect
      .poll(async () => {
        const snap = await getDb()
          .collection('studentPackages')
          .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
          .where('studentId', '==', student.studentId)
          .get();
        return snap.docs.map((docSnap) => String((docSnap.data() || {}).teacher || '')).sort();
      })
      .toEqual([currentTeacher, otherTeacher].sort());
  } finally {
    await cleanupFixture(fixture).catch(() => {});
  }
});
