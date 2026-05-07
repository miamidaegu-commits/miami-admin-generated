import fs from 'node:fs';
import path from 'node:path';
import admin from 'firebase-admin';
import { test, expect } from '@playwright/test';
import { BASE_URL } from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEFAULT_E2E_ACADEMY_ID,
  TEST_TEACHER_EMAIL,
  TEST_TEACHER_PASSWORD,
} from './fixtures/test-data.js';

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const ADMIN_APP_NAME = 'reservation-notification-events-e2e';
const TEACHER_NAME = 'teacher';
const RUN_NOTIFICATION_EVENTS_E2E = process.env.RUN_NOTIFICATION_EVENTS_E2E === '1';

function hasServiceAccount() {
  return fs.existsSync(SERVICE_ACCOUNT_PATH);
}

function initializeAdmin() {
  const existing = admin.apps.find((app) => app?.name === ADMIN_APP_NAME);
  if (existing) return existing;
  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  if (serviceAccount.project_id !== 'miami-e2e') {
    throw new Error(`Expected miami-e2e service account, received ${serviceAccount.project_id}`);
  }
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

async function loginAsDashboardUser(page, email, password) {
  await page.goto(BASE_URL);
  if (await page.getByTestId('reservation-notifications-panel').isVisible({ timeout: 1000 }).catch(() => false)) {
    return;
  }
  const emailInput = page.locator('input[type="email"]').first();
  if (!(await emailInput.isVisible({ timeout: 5000 }).catch(() => false))) {
    const bodyText = ((await page.locator('body').textContent().catch(() => '')) || '').slice(0, 500);
    throw new Error(`Login email input not visible. URL: ${page.url()}. Body: ${bodyText}`);
  }
  await emailInput.fill(email, { timeout: 15000 });
  await page.locator('input[type="password"]').first().fill(password, { timeout: 15000 });
  await page.getByRole('button', { name: /Sign In|로그인/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  await expect(page.getByTestId('reservation-notifications-panel')).toBeVisible({
    timeout: 20000,
  });
}

async function ensureTeacherMembership() {
  const auth = getAuth();
  const db = getDb();
  const teacherUser = await auth.getUserByEmail(TEST_TEACHER_EMAIL);
  const now = admin.firestore.Timestamp.now();
  await Promise.all([
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
        permissions: {
          canManageAttendance: true,
          canAddStudent: true,
          canEditStudent: true,
          canDeleteStudent: false,
        },
        updatedAt: now,
      },
      { merge: true }
    ),
  ]);
}

function notificationMessage({ studentName, date, time, cancelled = false }) {
  return cancelled
    ? `${studentName} 학생이 ${date} ${time} 1:1 수업 예약을 취소했습니다.`
    : `${studentName} 학생이 ${date} ${time} 1:1 수업을 예약했습니다.`;
}

test.describe('reservation notification events dashboard panel', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90_000);
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json is required for Firebase E2E setup');
  test.skip(
    !RUN_NOTIFICATION_EVENTS_E2E,
    'Set RUN_NOTIFICATION_EVENTS_E2E=1 after deploying notificationEvents rules/indexes to the e2e project'
  );

  const unique = `notify-${Date.now()}`;
  const events = {
    ownTeacher: {
      id: `${unique}-own-teacher`,
      studentName: `알림학생 A ${unique}`,
      date: '2026-06-10',
      time: '14:20',
    },
    ownTeacherName: {
      id: `${unique}-own-teacher-name`,
      studentName: `알림학생 B ${unique}`,
      date: '2026-06-11',
      time: '15:30',
    },
    unrelated: {
      id: `${unique}-unrelated`,
      studentName: `다른알림학생 ${unique}`,
      date: '2026-06-12',
      time: '16:40',
    },
  };

  test.beforeAll(async () => {
    await ensureTeacherMembership();
    const db = getDb();
    const baseMillis = Date.now() + 60_000;
    await Promise.all([
      db.collection('notificationEvents').doc(events.ownTeacher.id).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        type: 'private_slot_reserved',
        studentId: `${unique}-student-a`,
        studentName: events.ownTeacher.studentName,
        teacher: TEACHER_NAME,
        slotId: `${unique}-slot-a`,
        reservationId: `${unique}-reservation-a`,
        date: events.ownTeacher.date,
        time: events.ownTeacher.time,
        source: 'student',
        createdAt: admin.firestore.Timestamp.fromMillis(baseMillis + 3000),
      }),
      db.collection('notificationEvents').doc(events.ownTeacherName.id).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        type: 'private_slot_cancelled',
        studentId: `${unique}-student-b`,
        studentName: events.ownTeacherName.studentName,
        teacher: '',
        teacherName: TEACHER_NAME,
        slotId: `${unique}-slot-b`,
        reservationId: `${unique}-reservation-b`,
        date: events.ownTeacherName.date,
        time: events.ownTeacherName.time,
        source: 'student',
        createdAt: admin.firestore.Timestamp.fromMillis(baseMillis + 2000),
      }),
      db.collection('notificationEvents').doc(events.unrelated.id).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        type: 'private_slot_reserved',
        studentId: `${unique}-student-c`,
        studentName: events.unrelated.studentName,
        teacher: `other-${TEACHER_NAME}-${unique}`,
        slotId: `${unique}-slot-c`,
        reservationId: `${unique}-reservation-c`,
        date: events.unrelated.date,
        time: events.unrelated.time,
        source: 'student',
        createdAt: admin.firestore.Timestamp.fromMillis(baseMillis + 1000),
      }),
    ]);
  });

  test.afterAll(async () => {
    if (!hasServiceAccount()) return;
    const db = getDb();
    await Promise.all(
      Object.values(events).map((event) =>
        db.collection('notificationEvents').doc(event.id).delete().catch(() => {})
      )
    );
  });

  test('admin sees reservation notification events', async ({ page }) => {
    await loginAsDashboardUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const panel = page.getByTestId('reservation-notifications-panel');
    await expect(panel).toContainText(
      notificationMessage({
        studentName: events.ownTeacher.studentName,
        date: events.ownTeacher.date,
        time: events.ownTeacher.time,
      })
    );
    await expect(panel).toContainText(
      notificationMessage({
        studentName: events.unrelated.studentName,
        date: events.unrelated.date,
        time: events.unrelated.time,
      })
    );
  });

  test('teacher sees only own teacher notifications', async ({ page }) => {
    await loginAsDashboardUser(page, TEST_TEACHER_EMAIL, TEST_TEACHER_PASSWORD);

    const panel = page.getByTestId('reservation-notifications-panel');
    await expect(panel).toContainText(
      notificationMessage({
        studentName: events.ownTeacher.studentName,
        date: events.ownTeacher.date,
        time: events.ownTeacher.time,
      })
    );
    await expect(panel).toContainText(
      notificationMessage({
        studentName: events.ownTeacherName.studentName,
        date: events.ownTeacherName.date,
        time: events.ownTeacherName.time,
        cancelled: true,
      })
    );
    await expect(panel).not.toContainText(events.unrelated.studentName);
  });
});
