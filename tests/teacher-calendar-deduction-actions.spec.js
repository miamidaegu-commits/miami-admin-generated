import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import admin from 'firebase-admin';
import { BASE_URL, loginAsAdmin, openDashboardSection } from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEFAULT_E2E_ACADEMY_ID,
  TEST_TEACHER_EMAIL,
  TEST_TEACHER_PASSWORD,
} from './fixtures/test-data.js';

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const TEACHER_NAME = 'teacher';

function hasServiceAccount() {
  return fs.existsSync(SERVICE_ACCOUNT_PATH);
}

function getAdminApp() {
  const existing = admin.apps.find((app) => app?.name === 'teacher-calendar-deduction-actions');
  if (existing) return existing;

  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  if (serviceAccount.project_id !== 'miami-e2e') {
    throw new Error(`Expected miami-e2e service account, received ${serviceAccount.project_id}`);
  }

  return admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
    },
    'teacher-calendar-deduction-actions'
  );
}

function getDb() {
  return getAdminApp().firestore();
}

function getTodayYmdInSeoul() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function getTeacherMembershipRef() {
  const userRecord = await getAdminApp().auth().getUserByEmail(TEST_TEACHER_EMAIL);
  return getDb().collection('academyMemberships').doc(`${DEFAULT_E2E_ACADEMY_ID}_${userRecord.uid}`);
}

async function snapshotDoc(ref) {
  const snap = await ref.get();
  return snap.exists ? snap.data() : null;
}

async function restoreDoc(ref, data) {
  if (data) {
    await ref.set(data);
  } else {
    await ref.delete().catch(() => {});
  }
}

async function setTeacherPermissions({
  canManageOwnLessonDeductions = false,
  canEditStudentPackageCounts = false,
}) {
  const membershipRef = await getTeacherMembershipRef();
  await membershipRef.set(
    {
      academyId: DEFAULT_E2E_ACADEMY_ID,
      email: TEST_TEACHER_EMAIL,
      role: 'teacher',
      teacherName: TEACHER_NAME,
      status: 'active',
      permissions: {
        canManageOwnLessonDeductions,
        canEditStudentPackageCounts,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return membershipRef;
}

async function loginAsTeacher(page) {
  await page.goto(`${BASE_URL}login/`);
  await page.getByLabel(/Email|이메일/i).or(page.locator('input[type="email"]')).first().fill(TEST_TEACHER_EMAIL);
  await page
    .getByLabel(/Password|비밀번호/i)
    .or(page.locator('input[type="password"]'))
    .first()
    .fill(TEST_TEACHER_PASSWORD);
  await page.getByRole('button', { name: /Sign In|로그인/i }).click();
  await expect(page.getByRole('heading', { name: '캘린더', level: 1 })).toBeVisible({
    timeout: 15000,
  });
}

async function createPrivateLessonFixture({
  unique,
  date,
  studentName,
  teacher = TEACHER_NAME,
  withPackage = true,
  packageOverrides = {},
  lessonOverrides = {},
}) {
  const db = getDb();
  const now = admin.firestore.Timestamp.now();
  const studentId = `e2e-tcda-student-${unique}`;
  const packageId = `e2e-tcda-package-${unique}`;
  const lessonId = `e2e-tcda-lesson-${unique}`;
  const refs = [
    db.collection('privateStudents').doc(studentId),
    db.collection('lessons').doc(lessonId),
  ];
  if (withPackage) refs.push(db.collection('studentPackages').doc(packageId));

  await refs[0].set({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    name: studentName,
    studentName,
    teacher,
    teacherName: teacher,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });

  if (withPackage) {
    await refs[2].set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId,
      studentName,
      title: `E2E calendar package ${unique}`,
      packageType: 'private',
      teacher,
      teacherName: teacher,
      totalCount: 4,
      usedCount: 1,
      remainingCount: 3,
      status: 'active',
      amountPaid: 123456,
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      memo: `hidden billing memo ${unique}`,
      createdAt: now,
      updatedAt: now,
      ...packageOverrides,
    });
  }

  await refs[1].set({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    teacher,
    teacherName: teacher,
    studentId,
    studentID: studentId,
    studentName,
    student: studentName,
    date,
    time: '10:30',
    subject: `E2E 차감 ${unique}`,
    packageId: withPackage ? packageId : '',
    isDeductCancelled: false,
    deductMemo: '',
    createdAt: now,
    updatedAt: now,
    ...lessonOverrides,
  });

  return { refs, studentId, studentName, packageId: withPackage ? packageId : '', lessonId };
}

async function cleanupRefs(refs = []) {
  await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
}

async function selectCalendarDate(page, date) {
  await openDashboardSection(page, '캘린더');
  const dateButton = page.locator(`[data-testid="calendar-day-button"][data-date="${date}"]`);
  await expect(dateButton).toBeVisible({ timeout: 15000 });
  await dateButton.click();
  await expect(page.getByTestId('calendar-lessons-section').getByText('불러오는 중...', { exact: true })).toHaveCount(0, {
    timeout: 30000,
  });
}

async function getCalendarPrivateRow(page, lessonId) {
  const row = page.locator(
    `[data-testid="calendar-lesson-row"][data-row-kind="private"][data-lesson-id="${lessonId}"]`
  );
  await expect(row).toBeVisible({ timeout: 15000 });
  return row;
}

test.setTimeout(120000);

test('admin no-package calendar row shows no active 차감취소 action', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 Firestore fixture를 생성합니다.');

  const unique = `admin-nopkg-${Date.now()}-${testInfo.workerIndex}`;
  const date = getTodayYmdInSeoul();
  const fixture = await createPrivateLessonFixture({
    unique,
    date,
    studentName: `E2E 수강권없음 ${unique}`,
    withPackage: false,
  });

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await selectCalendarDate(page, date);
    const row = await getCalendarPrivateRow(page, fixture.lessonId);
    await expect(row).toContainText('수강권 없음');
    await expect(row.getByRole('button', { name: '차감취소', exact: true })).toHaveCount(0);
    await expect(row.getByTestId('calendar-deduction-action-disabled-label')).toContainText(
      '수강권 연결 필요'
    );
  } finally {
    await cleanupRefs(fixture.refs);
  }
});

test('admin deducted calendar row can reverse deduction', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 Firestore fixture를 생성합니다.');

  const unique = `admin-deducted-${Date.now()}-${testInfo.workerIndex}`;
  const date = getTodayYmdInSeoul();
  const fixture = await createPrivateLessonFixture({
    unique,
    date,
    studentName: `E2E 관리자차감 ${unique}`,
  });
  const db = getDb();
  const packageRef = db.collection('studentPackages').doc(fixture.packageId);
  const lessonRef = db.collection('lessons').doc(fixture.lessonId);

  try {
    page.once('dialog', (dialog) => dialog.accept('admin e2e cancel'));
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await selectCalendarDate(page, date);
    const row = await getCalendarPrivateRow(page, fixture.lessonId);
    await expect(row).toContainText('정상 차감');
    await row.getByRole('button', { name: '차감취소', exact: true }).click();

    await expect.poll(async () => (await snapshotDoc(lessonRef))?.isDeductCancelled).toBe(true);
    await expect.poll(async () => (await snapshotDoc(packageRef))?.usedCount).toBe(0);
    await expect.poll(async () => (await snapshotDoc(packageRef))?.remainingCount).toBe(4);
  } finally {
    await cleanupRefs(fixture.refs);
  }
});

test('teacher without deduction permission sees own lesson reason but no action', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 Firestore fixture를 생성합니다.');

  const unique = `teacher-noperm-${Date.now()}-${testInfo.workerIndex}`;
  const date = getTodayYmdInSeoul();
  const membershipRef = await getTeacherMembershipRef();
  const originalMembership = await snapshotDoc(membershipRef);
  const fixture = await createPrivateLessonFixture({
    unique,
    date,
    studentName: `E2E 교사권한없음 ${unique}`,
  });

  try {
    await setTeacherPermissions({
      canManageOwnLessonDeductions: false,
      canEditStudentPackageCounts: false,
    });
    await loginAsTeacher(page);
    await selectCalendarDate(page, date);
    const row = await getCalendarPrivateRow(page, fixture.lessonId);
    await row.click();
    const dialog = page.getByTestId('calendar-private-lesson-detail-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('calendar-private-lesson-action-reason')).toContainText(
      '권한이 없습니다'
    );
    await expect(dialog.getByRole('button', { name: '차감취소', exact: true })).toHaveCount(0);
  } finally {
    await cleanupRefs(fixture.refs);
    await restoreDoc(membershipRef, originalMembership);
  }
});

test('teacher with deduction permission can reverse only own visible lesson', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 Firestore fixture를 생성합니다.');

  const unique = `teacher-deduct-${Date.now()}-${testInfo.workerIndex}`;
  const date = getTodayYmdInSeoul();
  const membershipRef = await getTeacherMembershipRef();
  const originalMembership = await snapshotDoc(membershipRef);
  const ownFixture = await createPrivateLessonFixture({
    unique,
    date,
    studentName: `E2E 교사차감 ${unique}`,
  });
  const otherFixture = await createPrivateLessonFixture({
    unique: `${unique}-other`,
    date,
    studentName: `E2E 타교사 ${unique}`,
    teacher: 'other-teacher',
  });
  const db = getDb();
  const packageRef = db.collection('studentPackages').doc(ownFixture.packageId);
  const lessonRef = db.collection('lessons').doc(ownFixture.lessonId);

  try {
    await setTeacherPermissions({
      canManageOwnLessonDeductions: true,
      canEditStudentPackageCounts: false,
    });
    page.once('dialog', (dialog) => dialog.accept('teacher e2e cancel'));
    await loginAsTeacher(page);
    await selectCalendarDate(page, date);
    const ownRow = await getCalendarPrivateRow(page, ownFixture.lessonId);
    await expect(
      page.locator(`[data-testid="calendar-lesson-row"][data-lesson-id="${otherFixture.lessonId}"]`)
    ).toHaveCount(0);
    await ownRow.getByRole('button', { name: '차감취소', exact: true }).click();

    await expect.poll(async () => (await snapshotDoc(lessonRef))?.isDeductCancelled).toBe(true);
    await expect.poll(async () => (await snapshotDoc(packageRef))?.usedCount, { timeout: 15000 }).toBe(0);
    await expect.poll(async () => (await snapshotDoc(packageRef))?.remainingCount, { timeout: 15000 }).toBe(4);
  } finally {
    await cleanupRefs([...ownFixture.refs, ...otherFixture.refs]);
    await restoreDoc(membershipRef, originalMembership);
  }
});

test('teacher with count edit permission edits own package count from calendar without billing fields', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 Firestore fixture를 생성합니다.');

  const unique = `teacher-count-${Date.now()}-${testInfo.workerIndex}`;
  const date = getTodayYmdInSeoul();
  const membershipRef = await getTeacherMembershipRef();
  const originalMembership = await snapshotDoc(membershipRef);
  const fixture = await createPrivateLessonFixture({
    unique,
    date,
    studentName: `E2E 교사횟수 ${unique}`,
  });
  const packageRef = getDb().collection('studentPackages').doc(fixture.packageId);

  try {
    await setTeacherPermissions({
      canManageOwnLessonDeductions: false,
      canEditStudentPackageCounts: true,
    });
    await loginAsTeacher(page);
    await selectCalendarDate(page, date);
    const row = await getCalendarPrivateRow(page, fixture.lessonId);
    await row.getByTestId('calendar-package-count-edit-button').click();

    const dialog = page.getByRole('dialog', { name: '수강권 수정' });
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(dialog.getByTestId('student-package-count-edit-limited-note')).toBeVisible();
    await expect(dialog).not.toContainText('결제 금액');
    await expect(dialog).not.toContainText('payment');
    await expect(dialog).not.toContainText('hidden billing memo');
    await expect(dialog).not.toContainText('studentId:');
    await expect(dialog).not.toContainText('packageType:');
    await expect(dialog).not.toContainText('teacher:');

    await dialog.getByLabel('총 횟수 (totalCount)').fill('6');
    await dialog.getByTestId('student-package-edit-save-button').click();
    await expect(dialog).toBeHidden();

    await expect.poll(async () => (await snapshotDoc(packageRef))?.totalCount).toBe(6);
    await expect.poll(async () => (await snapshotDoc(packageRef))?.remainingCount).toBe(5);
  } finally {
    await cleanupRefs(fixture.refs);
    await restoreDoc(membershipRef, originalMembership);
  }
});

test('teacher without count edit permission has no calendar count edit action', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 Firestore fixture를 생성합니다.');

  const unique = `teacher-count-hidden-${Date.now()}-${testInfo.workerIndex}`;
  const date = getTodayYmdInSeoul();
  const membershipRef = await getTeacherMembershipRef();
  const originalMembership = await snapshotDoc(membershipRef);
  const fixture = await createPrivateLessonFixture({
    unique,
    date,
    studentName: `E2E 횟수숨김 ${unique}`,
  });

  try {
    await setTeacherPermissions({
      canManageOwnLessonDeductions: false,
      canEditStudentPackageCounts: false,
    });
    await loginAsTeacher(page);
    await selectCalendarDate(page, date);
    const row = await getCalendarPrivateRow(page, fixture.lessonId);
    await expect(row.getByTestId('calendar-package-count-edit-button')).toHaveCount(0);
  } finally {
    await cleanupRefs(fixture.refs);
    await restoreDoc(membershipRef, originalMembership);
  }
});
