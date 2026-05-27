import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';
import { expect, test } from '@playwright/test';
import { loginAsAdmin, openDashboardSection } from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEFAULT_E2E_ACADEMY_ID,
} from './fixtures/test-data.js';

const require = createRequire(import.meta.url);
const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const TEACHER_NAME = 'teacher';

function hasServiceAccount() {
  return fs.existsSync(SERVICE_ACCOUNT_PATH);
}

function initializeAdmin() {
  if (admin.apps.find((app) => app?.name === '[DEFAULT]')) return;
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
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

function formatYmd(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function deductionKey({ academyId, lessonId, studentId, packageId }) {
  return ['deduct', academyId, lessonId, studentId, packageId].join('_');
}

async function readDoc(ref) {
  const snap = await ref.get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function callAutoDeduct(page, { dates, todayYmd }) {
  return page.evaluate(
    async ({ firebaseConfig, academyId, dates, todayYmd }) => {
      const [{ getApp, getApps, initializeApp }, authModule, functionsModule] = await Promise.all(
        [
          import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
          import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
          import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js'),
        ]
      );
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
      const runAutoDeduct = functionsModule.httpsCallable(
        functions,
        'runAutoDeductPendingLessonsForTest'
      );
      const result = await runAutoDeduct({
        academyId,
        dates,
        todayYmd,
        lookbackDays: 3,
      });
      return result.data;
    },
    {
      firebaseConfig: getFirebaseConfigFromEnv(),
      academyId: DEFAULT_E2E_ACADEMY_ID,
      dates,
      todayYmd,
    }
  );
}

async function cleanupRefs(refs) {
  await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
}

test.describe.configure({ mode: 'serial' });

test('automatic deduction handles private reservations idempotently', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 자동 차감 setup을 실행합니다.');

  initializeAdmin();
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();
  const unique = `auto-private-${Date.now()}-${testInfo.workerIndex}`;
  const todayYmd = formatYmd(new Date());
  const lessonDate = formatYmd(addDays(new Date(), -1));
  const studentId = `${unique}-student`;
  const packageId = `${unique}-package`;
  const slotId = `${unique}-slot`;
  const reservationId = `${DEFAULT_E2E_ACADEMY_ID}__${slotId}__${studentId}`;
  const txId = deductionKey({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    lessonId: reservationId,
    studentId,
    packageId,
  });
  const refs = [
    db.collection('privateStudents').doc(studentId),
    db.collection('studentPackages').doc(packageId),
    db.collection('privateLessonSlots').doc(slotId),
    db.collection('privateLessonReservations').doc(reservationId),
    db.collection('creditTransactions').doc(txId),
  ];

  try {
    await Promise.all([
      refs[0].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        name: `자동개인 ${unique}`,
        teacher: TEACHER_NAME,
        createdAt: now,
        updatedAt: now,
      }),
      refs[1].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        studentId,
        studentName: `자동개인 ${unique}`,
        teacher: TEACHER_NAME,
        packageType: 'private',
        totalCount: 3,
        usedCount: 0,
        remainingCount: 3,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }),
      refs[2].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        teacher: TEACHER_NAME,
        date: lessonDate,
        time: '09:00',
        durationMinutes: 50,
        subject: `자동 개인 ${unique}`,
        status: 'reserved',
        createdAt: now,
        updatedAt: now,
      }),
      refs[3].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        slotId,
        studentId,
        studentName: `자동개인 ${unique}`,
        packageId,
        teacher: TEACHER_NAME,
        date: lessonDate,
        time: '09:00',
        durationMinutes: 50,
        subject: `자동 개인 ${unique}`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const firstSummary = await callAutoDeduct(page, { dates: [lessonDate], todayYmd });
    expect(firstSummary.deducted).toBeGreaterThanOrEqual(1);

    await expect
      .poll(async () => (await readDoc(refs[1]))?.remainingCount, { timeout: 15000 })
      .toBe(2);
    await expect.poll(async () => (await readDoc(refs[1]))?.usedCount).toBe(1);
    await expect.poll(async () => Boolean(await readDoc(refs[4]))).toBe(true);
    await expect.poll(async () => (await readDoc(refs[3]))?.deductionSource).toBe('auto');

    await callAutoDeduct(page, { dates: [lessonDate], todayYmd });
    await expect.poll(async () => (await readDoc(refs[1]))?.remainingCount).toBe(2);
    await expect.poll(async () => (await readDoc(refs[1]))?.usedCount).toBe(1);
  } finally {
    await cleanupRefs(refs);
  }
});

test('automatic deduction skips already manually deducted private reservations', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 자동 차감 setup을 실행합니다.');

  initializeAdmin();
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();
  const unique = `auto-manual-private-${Date.now()}-${testInfo.workerIndex}`;
  const todayYmd = formatYmd(new Date());
  const lessonDate = formatYmd(addDays(new Date(), -1));
  const studentId = `${unique}-student`;
  const packageId = `${unique}-package`;
  const slotId = `${unique}-slot`;
  const reservationId = `${DEFAULT_E2E_ACADEMY_ID}__${slotId}__${studentId}`;
  const txId = deductionKey({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    lessonId: reservationId,
    studentId,
    packageId,
  });
  const refs = [
    db.collection('studentPackages').doc(packageId),
    db.collection('privateLessonSlots').doc(slotId),
    db.collection('privateLessonReservations').doc(reservationId),
    db.collection('creditTransactions').doc(txId),
  ];

  try {
    await Promise.all([
      refs[0].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        studentId,
        studentName: `수동개인 ${unique}`,
        teacher: TEACHER_NAME,
        packageType: 'private',
        totalCount: 3,
        usedCount: 1,
        remainingCount: 2,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }),
      refs[1].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        teacher: TEACHER_NAME,
        date: lessonDate,
        time: '10:00',
        durationMinutes: 50,
        status: 'reserved',
        createdAt: now,
        updatedAt: now,
      }),
      refs[2].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        slotId,
        studentId,
        studentName: `수동개인 ${unique}`,
        packageId,
        teacher: TEACHER_NAME,
        date: lessonDate,
        time: '10:00',
        status: 'completed',
        deductionApplied: true,
        deductionSource: 'manual',
        deductionTransactionId: txId,
        deductionCreditTransactionId: txId,
        createdAt: now,
        updatedAt: now,
      }),
      refs[3].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        studentId,
        packageId,
        packageType: 'private',
        sourceType: 'privateReservation',
        sourceId: reservationId,
        actionType: 'private_reservation_completed_deduct',
        deltaCount: -1,
        deductionSource: 'manual',
        createdAt: now,
      }),
    ]);

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await callAutoDeduct(page, { dates: [lessonDate], todayYmd });

    await expect.poll(async () => (await readDoc(refs[0]))?.remainingCount).toBe(2);
    await expect.poll(async () => (await readDoc(refs[0]))?.usedCount).toBe(1);
    await expect.poll(async () => (await readDoc(refs[2]))?.deductionSource).toBe('manual');
  } finally {
    await cleanupRefs(refs);
  }
});

test('automatic deduction skips no-deduction and closure group lessons', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 자동 차감 setup을 실행합니다.');

  initializeAdmin();
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();
  const unique = `auto-skip-group-${Date.now()}-${testInfo.workerIndex}`;
  const todayYmd = formatYmd(new Date());
  const lessonDate = formatYmd(addDays(new Date(), -1));
  const classId = `${unique}-class`;
  const holidayLessonId = `${unique}-holiday-lesson`;
  const closureLessonId = `${unique}-closure-lesson`;
  const studentId = `${unique}-student`;
  const packageId = `${unique}-package`;
  const groupStudentId = `${unique}-group-student`;
  const refs = [
    db.collection('groupClasses').doc(classId),
    db.collection('groupLessons').doc(holidayLessonId),
    db.collection('groupLessons').doc(closureLessonId),
    db.collection('studentPackages').doc(packageId),
    db.collection('groupStudents').doc(groupStudentId),
    db.collection('creditTransactions').doc(deductionKey({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      lessonId: holidayLessonId,
      studentId,
      packageId,
    })),
    db.collection('creditTransactions').doc(deductionKey({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      lessonId: closureLessonId,
      studentId,
      packageId,
    })),
  ];

  try {
    await Promise.all([
      refs[0].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        name: `자동스킵 ${unique}`,
        teacher: TEACHER_NAME,
        maxStudents: 4,
        createdAt: now,
        updatedAt: now,
      }),
      refs[1].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        groupClassId: classId,
        groupClassName: `자동스킵 ${unique}`,
        teacher: TEACHER_NAME,
        date: lessonDate,
        time: '11:00',
        subject: `휴강 ${unique}`,
        capacity: 4,
        status: 'cancelled',
        cancellationType: 'no_deduction',
        cancelledReason: 'holiday',
        noDeduction: true,
        createdAt: now,
        updatedAt: now,
      }),
      refs[2].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        groupClassId: classId,
        groupClassName: `자동스킵 ${unique}`,
        teacher: TEACHER_NAME,
        date: lessonDate,
        time: '12:00',
        subject: `운영종료 ${unique}`,
        capacity: 4,
        status: 'cancelled',
        cancellationType: 'class_closure',
        cancelledReason: 'group_class_closed',
        groupClassDeleted: true,
        noDeduction: true,
        createdAt: now,
        updatedAt: now,
      }),
      refs[3].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        studentId,
        studentName: `자동스킵 ${unique}`,
        teacher: TEACHER_NAME,
        packageType: 'group',
        groupClassId: classId,
        totalCount: 3,
        usedCount: 0,
        remainingCount: 3,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }),
      refs[4].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        groupClassId: classId,
        studentId,
        studentName: `자동스킵 ${unique}`,
        packageId,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await callAutoDeduct(page, { dates: [lessonDate], todayYmd });

    await expect.poll(async () => (await readDoc(refs[3]))?.remainingCount).toBe(3);
    await expect.poll(async () => Boolean(await readDoc(refs[5]))).toBe(false);
    await expect.poll(async () => Boolean(await readDoc(refs[6]))).toBe(false);
  } finally {
    await cleanupRefs(refs);
  }
});

test('automatic deduction deducts pending group fixed and guest students once', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 자동 차감 setup을 실행합니다.');

  initializeAdmin();
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();
  const unique = `auto-group-${Date.now()}-${testInfo.workerIndex}`;
  const todayYmd = formatYmd(new Date());
  const lessonDate = formatYmd(addDays(new Date(), -1));
  const classId = `${unique}-class`;
  const lessonId = `${unique}-lesson`;
  const fixedStudentId = `${unique}-fixed`;
  const releasedStudentId = `${unique}-released`;
  const guestStudentId = `${unique}-guest`;
  const fixedPackageId = `${unique}-fixed-package`;
  const releasedPackageId = `${unique}-released-package`;
  const guestPackageId = `${unique}-guest-package`;
  const fixedGroupStudentId = `${unique}-fixed-group-student`;
  const releasedGroupStudentId = `${unique}-released-group-student`;
  const guestReservationId = `${DEFAULT_E2E_ACADEMY_ID}__${lessonId}__${guestStudentId}`;
  const fixedTxId = deductionKey({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    lessonId,
    studentId: fixedStudentId,
    packageId: fixedPackageId,
  });
  const guestTxId = deductionKey({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    lessonId,
    studentId: guestStudentId,
    packageId: guestPackageId,
  });
  const releasedTxId = deductionKey({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    lessonId,
    studentId: releasedStudentId,
    packageId: releasedPackageId,
  });
  const refs = [
    db.collection('groupClasses').doc(classId),
    db.collection('groupLessons').doc(lessonId),
    db.collection('studentPackages').doc(fixedPackageId),
    db.collection('studentPackages').doc(releasedPackageId),
    db.collection('studentPackages').doc(guestPackageId),
    db.collection('groupStudents').doc(fixedGroupStudentId),
    db.collection('groupStudents').doc(releasedGroupStudentId),
    db.collection('groupLessonReservations').doc(guestReservationId),
    db.collection('creditTransactions').doc(fixedTxId),
    db.collection('creditTransactions').doc(guestTxId),
    db.collection('creditTransactions').doc(releasedTxId),
  ];

  try {
    await Promise.all([
      refs[0].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        name: `자동그룹 ${unique}`,
        teacher: TEACHER_NAME,
        maxStudents: 4,
        createdAt: now,
        updatedAt: now,
      }),
      refs[1].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        groupClassId: classId,
        groupClassName: `자동그룹 ${unique}`,
        teacher: TEACHER_NAME,
        date: lessonDate,
        time: '13:00',
        subject: `자동 그룹 ${unique}`,
        capacity: 4,
        isBookable: true,
        bookedCount: 1,
        countedStudentIDs: [],
        releasedFixedStudentIDs: [releasedStudentId],
        createdAt: now,
        updatedAt: now,
      }),
      refs[2].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        studentId: fixedStudentId,
        studentName: `고정 ${unique}`,
        teacher: TEACHER_NAME,
        packageType: 'group',
        groupClassId: classId,
        totalCount: 3,
        usedCount: 0,
        remainingCount: 3,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }),
      refs[3].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        studentId: releasedStudentId,
        studentName: `차감취소 ${unique}`,
        teacher: TEACHER_NAME,
        packageType: 'group',
        groupClassId: classId,
        totalCount: 3,
        usedCount: 0,
        remainingCount: 3,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }),
      refs[4].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        studentId: guestStudentId,
        studentName: `예약 ${unique}`,
        teacher: TEACHER_NAME,
        packageType: 'group',
        groupClassId: classId,
        totalCount: 3,
        usedCount: 0,
        remainingCount: 3,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }),
      refs[5].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        groupClassId: classId,
        studentId: fixedStudentId,
        studentName: `고정 ${unique}`,
        packageId: fixedPackageId,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }),
      refs[6].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        groupClassId: classId,
        studentId: releasedStudentId,
        studentName: `차감취소 ${unique}`,
        packageId: releasedPackageId,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }),
      refs[7].set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        lessonId,
        groupClassId: classId,
        studentId: guestStudentId,
        studentName: `예약 ${unique}`,
        status: 'active',
        source: 'student',
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await callAutoDeduct(page, { dates: [lessonDate], todayYmd });
    await callAutoDeduct(page, { dates: [lessonDate], todayYmd });

    await expect.poll(async () => (await readDoc(refs[2]))?.remainingCount).toBe(2);
    await expect.poll(async () => (await readDoc(refs[2]))?.usedCount).toBe(1);
    await expect.poll(async () => (await readDoc(refs[3]))?.remainingCount).toBe(3);
    await expect.poll(async () => (await readDoc(refs[4]))?.remainingCount).toBe(2);
    await expect.poll(async () => Boolean(await readDoc(refs[8]))).toBe(true);
    await expect.poll(async () => Boolean(await readDoc(refs[9]))).toBe(true);
    await expect.poll(async () => Boolean(await readDoc(refs[10]))).toBe(false);

    const lessonDoc = await readDoc(refs[1]);
    expect(lessonDoc.countedStudentIDs).toEqual(
      expect.arrayContaining([fixedStudentId, guestStudentId])
    );
    expect(lessonDoc.countedStudentIDs).not.toContain(releasedStudentId);

    await openDashboardSection(page, '캘린더');
    await page.locator(`[data-testid="calendar-day-button"][data-date="${lessonDate}"]`).click();
    const row = page
      .locator(`[data-testid="calendar-lesson-row"][data-row-kind="group"][data-lesson-id="${lessonId}"]`)
      .first();
    await expect(row).toContainText('자동 차감 완료', { timeout: 15000 });
  } finally {
    await cleanupRefs(refs);
  }
});
