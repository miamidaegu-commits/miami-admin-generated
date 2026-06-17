import fs from 'node:fs';
import path from 'node:path';
import admin from 'firebase-admin';
import { test, expect } from '@playwright/test';
import {
  getStudentRow,
  getStudentRowById,
  getStudentSearchInput,
  loginAsAdmin,
  openDashboardSection,
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
  registrationRound,
  registrationLabel,
  memo,
}) {
  const payload = {
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
    memo: memo || `${packageTitle} · 신규 수강권 발급`,
    actorUid: 'e2e-admin',
    actorRole: 'admin',
    createdAt: admin.firestore.Timestamp.now(),
  };
  if (registrationRound != null) {
    payload.registrationRound = registrationRound;
    payload.roundNumber = registrationRound;
  }
  if (registrationLabel != null) {
    payload.registrationLabel = registrationLabel;
  }
  await getDb().collection('creditTransactions').add(payload);
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

async function openPrivatePackageAddDialog(page, studentName, studentId = '') {
  await openDashboardSection(page, '학생 관리');
  await getStudentSearchInput(page).fill(studentName);
  const studentRow = studentId ? getStudentRowById(page, studentId) : getStudentRow(page, studentName);
  await expect(studentRow).toBeVisible({ timeout: 15000 });
  await studentRow.getByRole('button', { name: '수강권 추가', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('수강권 유형').selectOption('private');
  return dialog;
}

async function maybeDismissPostPrivateLessonScheduleModal(page, options = {}) {
  const modalByTestId = page.getByTestId('post-private-lesson-schedule-modal');
  const modalByRole = page.getByRole('dialog', {
    name: '고정 1:1 수업 배정으로 이동할까요?',
  });
  const modal = modalByTestId.or(modalByRole).first();
  if (!(await modal.isVisible({ timeout: options.timeout ?? 2000 }).catch(() => false))) {
    return false;
  }

  await expect(modal).toContainText('고정 1:1 수업 배정으로 이동할까요?');
  if (options.expectedText) {
    await expect(modal).toContainText(options.expectedText);
  }
  await modal.getByRole('button', { name: /나중에 (하기|등록)/ }).click();
  await expect(modal).toBeHidden({ timeout: 10000 });
  return true;
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
  const registrationLabel = `5개월 할인 등록 ${unique}`;
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
      deltaCount: 2,
    });
    await createCreditTransaction({
      packageId: studentPackage.packageId,
      studentId: student.studentId,
      studentName: student.studentName,
      teacher: teacherKey,
      packageTitle,
      actionType: 'private_package_top_up',
      deltaCount: 2,
      registrationRound: 2,
      registrationLabel: '2회차 등록',
      memo: '2회차 등록 · +2회',
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
    const dialog = await openPrivatePackageAddDialog(page, student.studentName, student.studentId);
    await expect(dialog.getByTestId('student-package-top-up-section')).toBeVisible();
    await expect(dialog).toContainText('기존 수강권에 추가 등록할 수 있습니다.');
    await expect(dialog).toContainText('운영 순서');
    await expect(dialog).toContainText(
      '1) 수강권 등록/추가 등록: 학생에게 수업 가능 횟수를 부여합니다.'
    );
    await expect(dialog).toContainText('총 4회 · 사용 0회 · 남은 4회');
    await expect(dialog).toContainText('고정 예정 3회 · 예약 1회 · 새 배정 가능 0회');
    await expect(dialog.getByTestId('student-package-top-up-section')).toContainText(
      '같은 선생님 수강권에 횟수와 결제 이력을 더합니다.'
    );
    await expect(dialog.getByTestId('private-package-situation-guidance')).toContainText(
      '2회차/3회차 결제 등록 → 기존 수강권에 추가 등록'
    );
    await expect(dialog.getByTestId('private-package-situation-guidance')).toContainText(
      '결제일/금액/횟수 오입력 수정 → 기존 수강권 수정'
    );
    await expect(dialog.getByTestId('private-package-situation-guidance')).toContainText(
      '별도 계약으로 분리 → 새 수강권으로 발급'
    );
    await expect(dialog.getByTestId('private-package-situation-guidance')).toContainText(
      '주간 슬롯 고정 예약 → 고정 1:1 수업 배정으로 이동'
    );
    await expect(dialog).toContainText('이번에 추가할 수업 횟수');
    await expect(dialog).toContainText(
      '4주 등록이면 4를 입력하세요. 예: 주1회 4주 등록 = 추가 횟수 4회.'
    );
    await expect(dialog).toContainText('등록 회차:');
    await expect(dialog.getByTestId('private-package-top-up-registration-label-input')).toHaveAttribute(
      'placeholder',
      /[23]회차 등록/
    );

    await dialog.getByTestId('private-package-top-up-count-input').fill('4');
    const preview = dialog.getByTestId('private-package-top-up-preview');
    await expect(preview).toContainText('이번 추가: +4회');
    await expect(preview).toContainText('저장 후 총 횟수: 8회');
    await expect(preview).toContainText('저장 후 새 배정 가능: 4회');
    await dialog
      .getByTestId('private-package-top-up-registration-label-input')
      .fill(registrationLabel);
    await dialog.getByTestId('student-package-payment-date-input').fill(paymentDate);
    await dialog.getByTestId('private-package-top-up-amount-input').fill('300000');
    await dialog.getByTestId('private-package-top-up-memo-input').fill(memo);
    await expect(dialog.getByTestId('private-package-other-options')).toContainText('기타 옵션');
    await dialog.getByRole('button', { name: '기존 수강권에 추가 등록', exact: true }).click();

    await expect
      .poll(async () => {
        const snap = await getDb().collection('studentPackages').doc(studentPackage.packageId).get();
        const data = snap.data() || {};
        return {
          totalCount: data.totalCount,
          remainingCount: data.remainingCount,
          usedCount: data.usedCount,
          paymentDate: data.paymentDate,
          topUpCount: data.topUpCount,
        };
      }, { timeout: 30000 })
      .toEqual({
        totalCount: 8,
        remainingCount: 8,
        usedCount: 0,
        paymentDate: '2026-05-01',
        topUpCount: 1,
      });
    await maybeDismissPostPrivateLessonScheduleModal(page, {
      expectedText: '기존 개인 수강권에 추가 등록했습니다.',
    });

    await expect
      .poll(async () => {
        const snap = await getDb()
          .collection('creditTransactions')
          .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
          .where('packageId', '==', studentPackage.packageId)
          .where('actionType', '==', 'private_package_top_up')
          .get();
        return snap.docs
          .map((docSnap) => docSnap.data())
          .find((row) => row.registrationLabel === registrationLabel);
      }, { timeout: 30000 })
      .toMatchObject({
        deltaCount: 4,
        registrationRound: 3,
        roundNumber: 3,
        registrationLabel,
        registrationMemo: memo,
        paymentDate,
        amountPaid: 300000,
      });
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
    const teacherFixture = await createTeacherAndTemplate({
      unique: `force-${unique}`,
      teacherKey,
      teacherName,
    });
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
    fixture = {
      ...teacherFixture,
      studentId: student.studentId,
      packageIds: [existingPackage.packageId],
    };
    await expect
      .poll(async () => {
        const snap = await getDb().collection('studentPackages').doc(existingPackage.packageId).get();
        const row = snap.exists ? snap.data() || {} : {};
        return {
          id: snap.exists ? snap.id : '',
          studentId: String(row.studentId || ''),
          teacher: String(row.teacher || row.teacherKey || ''),
          status: String(row.status || ''),
        };
      }, { timeout: 30000 })
      .toEqual({
        id: existingPackage.packageId,
        studentId: student.studentId,
        teacher: teacherKey,
        status: 'active',
      });

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const dialog = await openPrivatePackageAddDialog(page, student.studentName, student.studentId);
    await expect(dialog.getByTestId('student-package-top-up-section')).toBeVisible({
      timeout: 30000,
    });
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

    await expect
      .poll(async () => {
        const snap = await getDb()
          .collection('studentPackages')
          .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
          .where('studentId', '==', student.studentId)
          .where('teacher', '==', teacherKey)
          .get();
        return snap.docs.length;
      }, { timeout: 30000 })
      .toBe(2);
    await maybeDismissPostPrivateLessonScheduleModal(page);
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
    const dialog = await openPrivatePackageAddDialog(page, student.studentName, student.studentId);
    await expect(dialog.getByTestId('student-package-top-up-section')).toHaveCount(0);
    await dialog.getByRole('button', { name: '횟수 수강권', exact: true }).click();
    await dialog.getByLabel('제목').fill(`E2E 현재 선생님 신규 ${unique}`);
    await dialog.getByLabel(/총 횟수/).fill('3');
    await dialog.getByRole('button', { name: '저장', exact: true }).click();

    await expect
      .poll(async () => {
        const snap = await getDb()
          .collection('studentPackages')
          .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
          .where('studentId', '==', student.studentId)
          .get();
        return snap.docs.map((docSnap) => String((docSnap.data() || {}).teacher || '')).sort();
      }, { timeout: 30000 })
      .toEqual([currentTeacher, otherTeacher].sort());
    await maybeDismissPostPrivateLessonScheduleModal(page);
  } finally {
    await cleanupFixture(fixture).catch(() => {});
  }
});
