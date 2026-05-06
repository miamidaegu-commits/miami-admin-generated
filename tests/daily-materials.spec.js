import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';
import { test, expect } from '@playwright/test';
import { BASE_URL, loginAsAdmin, loginAsStudent, openDashboardSection } from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEFAULT_E2E_ACADEMY_ID,
  DEFAULT_E2E_ACADEMY_NAME,
} from './fixtures/test-data.js';

const require = createRequire(import.meta.url);
const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const TEST_PASSWORD = '123456';

test.describe.configure({ mode: 'serial' });

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
  if (existing) return existing;
  return auth.createUser({
    email,
    password,
    displayName,
    disabled: false,
  });
}

async function ensureAcademyAdmin({ auth, db }) {
  const adminUser = await auth.getUserByEmail(ADMIN_EMAIL);
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
        permissions,
        updatedAt: now,
      },
      { merge: true }
    ),
  ]);
}

async function createStudentMember({
  auth,
  db,
  email,
  studentId,
  displayName,
  academyId = DEFAULT_E2E_ACADEMY_ID,
  academyName = DEFAULT_E2E_ACADEMY_NAME,
}) {
  const user = await createAuthUser(auth, {
    email,
    password: TEST_PASSWORD,
    displayName,
  });
  const now = admin.firestore.FieldValue.serverTimestamp();

  await Promise.all([
    db.collection('academies').doc(academyId).set(
      {
        id: academyId,
        name: academyName,
        slug: academyId,
        status: 'active',
        timezone: 'Asia/Seoul',
        updatedAt: now,
      },
      { merge: true }
    ),
    db.collection('users').doc(user.uid).set(
      {
        uid: user.uid,
        email,
        displayName,
        role: 'student',
        isActive: true,
        lastSelectedAcademyId: academyId,
        updatedAt: now,
      },
      { merge: true }
    ),
    db.collection('academyMemberships').doc(`${academyId}_${user.uid}`).set(
      {
        academyId,
        uid: user.uid,
        email,
        displayName,
        role: 'student',
        teacherName: '',
        studentId,
        status: 'active',
        updatedAt: now,
      },
      { merge: true }
    ),
  ]);

  return user;
}

test('admin creates daily video and student only sees published same-academy material', async ({
  page,
  browser,
}) => {
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json is required for daily materials e2e.');
  initializeAdmin();

  const db = admin.firestore();
  const auth = admin.auth();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const today = todayInSeoul();
  const studentEmail = `daily-materials-student-${unique}@example.com`;
  const studentId = `daily-materials-student-${unique}`;
  const publishedTitle = `오늘의 영상 ${unique}`;
  const draftTitle = `임시 영상 ${unique}`;
  const otherAcademyTitle = `다른 학원 영상 ${unique}`;
  const videoUrl = `https://example.com/daily-video-${unique}`;

  await ensureAcademyAdmin({ auth, db });
  await createStudentMember({
    auth,
    db,
    email: studentEmail,
    studentId,
    displayName: `오늘영상학생 ${unique}`,
  });

  await Promise.all([
    db.collection('dailyMaterials').doc(`daily-materials-draft-${unique}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      date: today,
      title: draftTitle,
      description: '학생에게 보이면 안 되는 임시 영상입니다.',
      videoUrl: `https://example.com/draft-${unique}`,
      status: 'draft',
      visibility: 'allStudents',
      createdByUid: 'e2e-admin-sdk',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }),
    db.collection('dailyMaterials').doc(`daily-materials-other-academy-${unique}`).set({
      academyId: `other-academy-${unique}`,
      date: today,
      title: otherAcademyTitle,
      description: '다른 학원 영상입니다.',
      videoUrl: `https://example.com/other-academy-${unique}`,
      status: 'published',
      visibility: 'allStudents',
      createdByUid: 'e2e-admin-sdk',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }),
  ]);

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '오늘의 영상 관리');
  await page.getByLabel('오늘의 영상 날짜').fill(today);
  await page.getByLabel('오늘의 영상 제목').fill(publishedTitle);
  await page.getByLabel('오늘의 영상 설명').fill('오늘 배운 표현을 짧게 복습하는 영상입니다.');
  await page.getByLabel('오늘의 영상 링크').fill(videoUrl);
  await page.getByLabel('오늘의 영상 공개 상태').selectOption('published');
  await page.getByTestId('daily-material-save-button').click();
  await expect(page.getByText('영상이 공개되었습니다.')).toBeVisible({ timeout: 15000 });

  const materialSnap = await db.collection('dailyMaterials').doc(`${DEFAULT_E2E_ACADEMY_ID}__${today}`).get();
  expect(materialSnap.exists).toBe(true);
  expect(materialSnap.data()).toMatchObject({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    date: today,
    title: publishedTitle,
    description: '오늘 배운 표현을 짧게 복습하는 영상입니다.',
    videoUrl,
    status: 'published',
    visibility: 'allStudents',
  });

  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  try {
    await loginAsStudent(studentPage, studentEmail, TEST_PASSWORD);
    const panel = studentPage.getByTestId('student-daily-material-panel');
    await expect(panel).toBeVisible({ timeout: 15000 });
    await expect(panel).toContainText('오늘의 영상');
    await expect(panel).toContainText(publishedTitle);
    await expect(panel).toContainText('오늘 배운 표현을 짧게 복습하는 영상입니다.');
    await expect(panel.getByTestId('student-daily-material-link')).toHaveAttribute('href', videoUrl);
    await expect(panel).not.toContainText(draftTitle);
    await expect(panel).not.toContainText(otherAcademyTitle);
    await expect(studentPage.locator('body')).not.toContainText('paymentStatus');
  } finally {
    await studentContext.close();
  }
});

test('student empty state appears when no published material exists for today', async ({ page }) => {
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json is required for daily materials e2e.');
  initializeAdmin();

  const db = admin.firestore();
  const auth = admin.auth();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const academyId = `daily-materials-empty-academy-${unique}`;
  const studentEmail = `daily-materials-empty-${unique}@example.com`;
  const studentId = `daily-materials-empty-${unique}`;

  await ensureAcademyAdmin({ auth, db });
  await createStudentMember({
    auth,
    db,
    email: studentEmail,
    studentId,
    displayName: `영상없는학생 ${unique}`,
    academyId,
    academyName: `오늘의 영상 빈 학원 ${unique}`,
  });

  await loginAsStudent(page, studentEmail, TEST_PASSWORD);
  await expect(page.getByTestId('student-daily-material-panel')).toContainText(
    '오늘 등록된 영상이 없습니다.',
    { timeout: 15000 }
  );
});
