import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import { BASE_URL } from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEFAULT_E2E_ACADEMY_ID,
  TEST_TEACHER_EMAIL,
  TEST_TEACHER_PASSWORD,
} from './fixtures/test-data.js';
import { buildTeacherPrivateLessonRequestPlans } from '../src/features/dashboard/teacherPrivateLessonRequestPlanning.js';

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');

function hasServiceAccount() {
  return fs.existsSync(SERVICE_ACCOUNT_PATH);
}

function getAdminApp() {
  const existing = admin.apps.find((app) => app?.name === 'teacher-permission-e2e');
  if (existing) return existing;

  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  if (serviceAccount.project_id !== 'miami-e2e') {
    throw new Error(`Expected miami-e2e service account, received ${serviceAccount.project_id}`);
  }

  return admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
    },
    'teacher-permission-e2e'
  );
}

function getDb() {
  return getAdminApp().firestore();
}

async function findLessonRequestsBySubject(subject) {
  const snap = await getDb()
    .collection('lessonRequests')
    .where('subject', '==', subject)
    .get();
  return snap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .filter((request) => request.academyId === DEFAULT_E2E_ACADEMY_ID);
}

async function countPrivateLessonSlotsByDateTime(date, time) {
  const snap = await getDb()
    .collection('privateLessonSlots')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .get();
  return snap.docs.filter((docSnap) => {
    const slot = docSnap.data() || {};
    return slot.date === date && slot.time === time;
  }).length;
}

async function findGroupClassesByName(name) {
  const snap = await getDb()
    .collection('groupClasses')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('name', '==', name)
    .get();
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
}

async function deleteGroupClassArtifacts(groupClassId) {
  if (!groupClassId) return;
  const db = getDb();
  const lessonSnap = await db
    .collection('groupLessons')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('groupClassId', '==', groupClassId)
    .get();
  const refs = [
    db.collection('groupClasses').doc(groupClassId),
    ...lessonSnap.docs.map((docSnap) => docSnap.ref),
  ];
  await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
}

async function createTeacherLessonRequestHistory({
  requestId,
  teacherName,
  studentName,
  date,
  time,
  subject,
  approvalStatus = 'pending',
  rejectionReason = '',
}) {
  await getDb()
    .collection('lessonRequests')
    .doc(requestId)
    .set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      teacherUID: `e2e-teacher-history-${requestId}`,
      teacherName,
      teacher: teacherName,
      studentID: `e2e-student-history-${requestId}`,
      studentId: `e2e-student-history-${requestId}`,
      studentName,
      student: studentName,
      date,
      time,
      subject,
      repeatWeekly: true,
      repeatWeeks: 4,
      approvalStatus,
      rejectionReason,
      createdAt: admin.firestore.Timestamp.now(),
    });
}

function futureYmd(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function makePlanningSlots(count) {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-06-${String(index + 1).padStart(2, '0')}`,
    time: `1${index}:00`,
    subject: `slot ${index + 1}`,
  }));
}

test('fixed 1:1 planning: 8 lessons 주2는 4,4로 요청한다', () => {
  const plans = buildTeacherPrivateLessonRequestPlans({
    paidLessons: 8,
    weeklyFrequency: 2,
    normalizedSlots: makePlanningSlots(2),
  });

  expect(plans.map((plan) => plan.repeatWeeks)).toEqual([4, 4]);
  expect(plans.map((plan) => plan.repeatWeekly)).toEqual([true, true]);
});

test('fixed 1:1 planning: 5 lessons 주2는 3,2로 요청한다', () => {
  const plans = buildTeacherPrivateLessonRequestPlans({
    paidLessons: 5,
    weeklyFrequency: 2,
    normalizedSlots: makePlanningSlots(2),
  });

  expect(plans.map((plan) => plan.repeatWeeks)).toEqual([3, 2]);
  expect(plans.map((plan) => plan.repeatWeekly)).toEqual([true, true]);
});

test('fixed 1:1 planning: 10 lessons 주3은 4,4,2로 요청한다', () => {
  const plans = buildTeacherPrivateLessonRequestPlans({
    paidLessons: 10,
    weeklyFrequency: 3,
    normalizedSlots: makePlanningSlots(3),
  });

  expect(plans.map((plan) => plan.repeatWeeks)).toEqual([4, 4, 2]);
  expect(plans.map((plan) => plan.repeatWeekly)).toEqual([true, true, true]);
});

test('fixed 1:1 planning: paidLessons가 없으면 슬롯마다 비반복 1회 요청한다', () => {
  const plans = buildTeacherPrivateLessonRequestPlans({
    paidLessons: '',
    weeklyFrequency: 3,
    normalizedSlots: makePlanningSlots(3),
  });

  expect(plans.map((plan) => plan.repeatWeeks)).toEqual([1, 1, 1]);
  expect(plans.map((plan) => plan.repeatWeekly)).toEqual([false, false, false]);
});

async function loginAsDashboardUser(page, email, password) {
  await page.goto(`${BASE_URL.replace(/\/$/, '')}/login`);
  const emailInput = page.getByLabel(/Email|이메일/i).or(page.locator('input[type="email"]')).first();
  const passwordInput = page
    .getByLabel(/Password|비밀번호/i)
    .or(page.locator('input[type="password"]'))
    .first();

  if (!(await emailInput.isVisible({ timeout: 3000 }).catch(() => false))) {
    await page.goto(BASE_URL);
  }

  await emailInput.fill(email);
  await passwordInput.fill(password);
  await page.getByRole('button', { name: /Sign In|로그인/i }).click();

  const invalidCredentials = page.getByText('Invalid email or password.');
  const inactiveAccount = page.getByText('비활성 계정입니다');
  const welcomeMessage = page.getByTestId('dashboard-welcome-subtitle');
  const calendarButton = page.getByRole('button', { name: '캘린더', exact: true });

  await Promise.race([
    page.waitForURL(/\/dashboard/, { timeout: 5000 }).catch(() => null),
    invalidCredentials.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
    inactiveAccount.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
    calendarButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
  ]);

  await expect
    .poll(
      async () => ({
        url: page.url(),
        welcomeText: ((await welcomeMessage.textContent()) || '').trim(),
        hasCalendarNav: await calendarButton.isVisible().catch(() => false),
        hasInvalidCredentials: await invalidCredentials.isVisible().catch(() => false),
        hasInactiveAccount: await inactiveAccount.isVisible().catch(() => false),
      }),
      { timeout: 5000 }
    )
    .toMatchObject({
      hasInvalidCredentials: false,
      hasInactiveAccount: false,
    });

  const bodyText = (await page.locator('body').textContent()) || '';
  const isDashboard = /\/dashboard/.test(page.url());
  const welcomeText = ((await welcomeMessage.textContent()) || '').trim();
  const hasWelcome = /님,?\s환영합니다/.test(welcomeText);
  const hasTeacherNav = await calendarButton.isVisible().catch(() => false);
  const hasInvalidCredentials = bodyText.includes('Invalid email or password.');
  const hasInactiveAccount = bodyText.includes('비활성 계정입니다');

  const loginSucceeded = isDashboard && hasWelcome && hasTeacherNav;

  expect(
    loginSucceeded,
    [
      'Dashboard login failed.',
      `URL: ${page.url()}`,
      `Welcome: ${welcomeText || '(empty)'}`,
      hasInvalidCredentials ? 'Reason: Invalid email or password.' : null,
      hasInactiveAccount ? 'Reason: 비활성 계정입니다' : null,
      `Body: ${bodyText}`,
    ]
      .filter(Boolean)
      .join('\n'),
  ).toBe(true);
}

async function loginAsTeacher(page) {
  await loginAsDashboardUser(page, TEST_TEACHER_EMAIL, TEST_TEACHER_PASSWORD);
}

async function loginAsAdmin(page) {
  await loginAsDashboardUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);
}

async function getTeacherNameFromWelcome(page) {
  const welcomeText = (await page.getByTestId('dashboard-welcome-subtitle').textContent()) || '';
  const match = welcomeText.match(/(.*)\s님,?\s환영합니다/);
  return match?.[1]?.trim() || '';
}

test('teacher 계정은 웹 대시보드에서 캘린더, 내 1:1 관리, 내 단체반 관리만 볼 수 있다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  await loginAsTeacher(page);

  await expect(page.getByRole('button', { name: '캘린더', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '내 1:1 관리', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '내 단체반 관리', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '캘린더', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '단체반 관리', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '1:1 예약 시간 관리', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '1:1 수업 관리', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '수업 요청 관리', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '학생 추가', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '수정', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '삭제', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '로그인 초대', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '수강권 추가', exact: true })).toHaveCount(0);

  const teacherName = await getTeacherNameFromWelcome(page);
  await page.getByRole('button', { name: '내 단체반 관리', exact: true }).click();
  await expect(page.getByRole('heading', { name: '내 단체반 관리', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '내 단체반 관리', level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: '정규반 만들기', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '학생 등록', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '삭제', exact: true })).toHaveCount(0);

  const groupRows = page.getByTestId('group-row');
  await expect.poll(async () => groupRows.count(), { timeout: 15000 }).toBeGreaterThan(0);
  const rowCount = await groupRows.count();
  for (let i = 0; i < rowCount; i += 1) {
    await expect(groupRows.nth(i).locator(':scope > span').nth(1)).toContainText(teacherName);
  }
});

test('teacher는 내 1:1 관리에서 본인 고정 1:1 요청 내역을 볼 수 있다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 Firestore 내역 검증을 실행합니다.');

  const unique = Date.now();
  const studentName = `E2E 요청내역 학생 ${unique}`;
  const subject = `E2E 요청내역 과목 ${unique}`;
  const date = futureYmd(42);
  const time = `18:${String(unique % 50).padStart(2, '0')}`;

  await loginAsTeacher(page);

  const teacherName = await getTeacherNameFromWelcome(page);
  await createTeacherLessonRequestHistory({
    requestId: `teacher-history-${unique}`,
    teacherName,
    studentName,
    date,
    time,
    subject,
  });
  await createTeacherLessonRequestHistory({
    requestId: `teacher-history-other-${unique}`,
    teacherName: `다른 선생님 ${unique}`,
    studentName: `E2E 다른요청 학생 ${unique}`,
    date,
    time,
    subject: `E2E 다른요청 과목 ${unique}`,
  });

  await page.getByRole('button', { name: '내 1:1 관리', exact: true }).click();
  await expect(page.getByRole('heading', { name: '내 1:1 관리', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '내 1:1 요청 내역' })).toBeVisible();
  await expect(page.getByRole('button', { name: '수업 요청 관리', exact: true })).toHaveCount(0);

  const historyCard = page
    .getByTestId('teacher-private-request-history-card')
    .filter({ hasText: subject });
  await expect(historyCard).toBeVisible({ timeout: 15000 });
  await expect(historyCard).toContainText(studentName);
  await expect(historyCard).toContainText(date);
  await expect(historyCard).toContainText(time);
  await expect(historyCard).toContainText('매주 반복 · 4주');
  await expect(historyCard).toContainText('대기');
  await expect(page.getByText(`E2E 다른요청 과목 ${unique}`)).toHaveCount(0);
});

test('teacher 고정 1:1 요청은 lessonRequests만 생성한다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 Firestore 생성 검증을 실행합니다.');

  const unique = Date.now();
  const studentName = `E2E 고정요청 학생 ${unique}`;
  const subject = `E2E 고정1:1 요청 ${unique}`;
  const date = futureYmd(35);
  const time = `19:${String(unique % 50).padStart(2, '0')}`;
  const beforeSlotCount = await countPrivateLessonSlotsByDateTime(date, time);

  await loginAsTeacher(page);

  const teacherName = await getTeacherNameFromWelcome(page);
  await page.getByRole('button', { name: '내 1:1 관리', exact: true }).click();
  await expect(page.getByRole('heading', { name: '내 1:1 관리', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '내 1:1 관리', level: 2 })).toBeVisible();
  await expect(page.getByText('유동 1:1 예약 시간')).toBeVisible();
  await expect(page.getByText('현재 관리자 전용입니다')).toBeVisible();

  await page.getByLabel('새 학생 빠른 등록').check();
  await page.getByLabel('새 학생 이름').fill(studentName);
  await page.getByLabel('결제 수업 수').fill('4');
  await page.getByLabel('주당 횟수').selectOption('1');
  await page.getByLabel('날짜 1').fill(date);
  await page.getByLabel('시간 1').fill(time);
  await page.getByLabel('과목 1').fill(subject);
  await page.getByRole('button', { name: '고정 1:1 요청하기', exact: true }).click();

  await expect(page.getByText('수업 요청이 완료되었습니다.')).toBeVisible();

  let createdRequests = [];
  await expect
    .poll(
      async () => {
        createdRequests = await findLessonRequestsBySubject(subject);
        return createdRequests.length;
      },
      { timeout: 15000 }
    )
    .toBe(1);

  expect(createdRequests[0]).toMatchObject({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    teacherName,
    teacher: teacherName,
    studentName,
    student: studentName,
    date,
    time,
    subject,
    repeatWeekly: true,
    repeatWeeks: 4,
    approvalStatus: 'pending',
    rejectionReason: '',
  });
  expect(String(createdRequests[0].studentId || '')).toBeTruthy();
  expect(createdRequests[0].studentID).toBe(createdRequests[0].studentId);

  const afterSlotCount = await countPrivateLessonSlotsByDateTime(date, time);
  expect(afterSlotCount).toBe(beforeSlotCount);
});

test('admin 계정은 전체 단체반 관리를 볼 수 있다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  await loginAsAdmin(page);

  await expect(page.getByRole('button', { name: '캘린더', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '단체반 관리', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '1:1 예약 시간 관리', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '수업 요청 관리', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '선생님 관리', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '오늘의 영상 관리', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '단체반 관리', exact: true }).click();
  await expect(page.getByRole('heading', { name: '단체반 관리', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '단체반 관리', level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: '정규반 만들기', exact: true })).toBeVisible();
});

test('teacher는 내 단체반 관리에서 본인 반을 생성/수정하고 학생 관리는 볼 수 없다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 Firestore 생성 검증을 실행합니다.');

  const unique = Date.now();
  const groupName = `E2E teacher own group ${unique}`;
  const subject = `E2E teacher group subject ${unique}`;
  const editedSubject = `E2E teacher group edited ${unique}`;
  const startDate = futureYmd(21);
  const groupTime = `17:${String(unique % 50).padStart(2, '0')}`;
  let createdGroupId = '';
  const dialogMessages = [];

  try {
    page.on('dialog', async (dialog) => {
      dialogMessages.push(dialog.message());
      await dialog.accept();
    });

    await loginAsTeacher(page);

    const teacherName = await getTeacherNameFromWelcome(page);
    await page.getByRole('button', { name: '내 단체반 관리', exact: true }).click();
    await expect(page.getByRole('heading', { name: '내 단체반 관리', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: '정규반 만들기', exact: true }).click();
    const addDialog = page.getByRole('dialog', { name: '정규반 만들기' });
    await expect(addDialog).toBeVisible();
    await addDialog.getByLabel('반 이름').fill(groupName);
    await expect(addDialog.getByLabel('담당 선생님')).toBeDisabled();
    await expect(addDialog.getByLabel('담당 선생님')).toHaveValue(teacherName);
    await addDialog.getByLabel('정원 (명)').fill('5');
    await addDialog.getByLabel('수업 시작일 (자동 일정 기준)').fill(startDate);
    await addDialog.getByLabel('기본 시간 (HH:mm)').fill(groupTime);
    await addDialog.getByLabel('과목').fill(subject);
    await addDialog.getByRole('button', { name: '월', exact: true }).click();

    await addDialog.getByRole('button', { name: '저장', exact: true }).click();

    let groupDocs = [];
    await expect
      .poll(async () => {
        groupDocs = await findGroupClassesByName(groupName);
        return groupDocs.length;
      }, {
        message: `teacher group create dialog messages: ${dialogMessages.join(' | ') || '(none)'}`,
        timeout: 15000,
      })
      .toBe(1);
    await expect(addDialog).toBeHidden({ timeout: 15000 });
    createdGroupId = groupDocs[0].id;
    expect(groupDocs[0]).toMatchObject({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: groupName,
      teacher: teacherName,
      teacherName,
      maxStudents: 5,
      time: groupTime,
      subject,
    });

    const groupRow = page.getByTestId('group-row').filter({ hasText: groupName }).first();
    await expect(groupRow).toBeVisible({ timeout: 15000 });
    await expect(groupRow).toContainText(teacherName);
    await groupRow.getByRole('button', { name: '수정', exact: true }).click();

    const editDialog = page.getByRole('dialog', { name: '반 수정' });
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByLabel('담당 선생님')).toBeDisabled();
    await expect(editDialog.getByLabel('담당 선생님')).toHaveValue(teacherName);
    await editDialog.getByLabel('과목').fill(editedSubject);
    await editDialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(editDialog).toBeHidden({ timeout: 15000 });

    await expect
      .poll(async () => {
        const snap = await getDb().collection('groupClasses').doc(createdGroupId).get();
        return snap.exists ? snap.data()?.subject : '';
      }, { timeout: 15000 })
      .toBe(editedSubject);

    await groupRow.click();
    const groupStudentsSection = page.getByTestId('group-students-section');
    await expect(groupStudentsSection).toBeVisible();
    await expect(groupStudentsSection).toContainText('학생 등록과 수강권 관리는 관리자에게 요청해 주세요.');
    await expect(groupStudentsSection.getByRole('button', { name: '학생 등록', exact: true })).toHaveCount(0);
    await expect(groupStudentsSection.getByRole('button', { name: '관리', exact: true })).toHaveCount(0);
    await expect(groupStudentsSection.getByRole('button', { name: '제거', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toHaveCount(0);
  } finally {
    await deleteGroupClassArtifacts(createdGroupId);
  }
});
