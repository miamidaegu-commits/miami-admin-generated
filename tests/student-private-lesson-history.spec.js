import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import { loginAsStudent } from './e2e-helpers.js';
import {
  DEFAULT_E2E_ACADEMY_ID,
  TEST_STUDENT_EMAIL,
  TEST_STUDENT_PASSWORD,
} from './fixtures/test-data.js';

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const TEACHER_NAME = 'teacher';

function hasServiceAccount() {
  return fs.existsSync(SERVICE_ACCOUNT_PATH);
}

function getAdminApp() {
  const existing = admin.apps.find((app) => app?.name === 'student-private-history-e2e');
  if (existing) return existing;

  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  if (serviceAccount.project_id !== 'miami-e2e') {
    throw new Error(`Expected miami-e2e service account, received ${serviceAccount.project_id}`);
  }

  return admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
    },
    'student-private-history-e2e'
  );
}

function getDb() {
  return getAdminApp().firestore();
}

async function readDoc(ref) {
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

function formatYmd(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatYmd(date);
}

function privateUpcomingCard(page, subject) {
  return page
    .locator('[data-testid="student-upcoming-private-lesson-card"]')
    .filter({ hasText: subject })
    .first();
}

function lessonHistoryCard(page, subject) {
  return page
    .locator('[data-testid="student-lesson-history-card"]')
    .filter({ hasText: subject })
    .first();
}

async function createPrivateLesson({
  lessonId,
  studentId,
  studentName,
  date,
  time,
  subject,
  sessionNumber,
  completed = false,
}) {
  const now = admin.firestore.Timestamp.now();
  await getDb().collection('lessons').doc(lessonId).set({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    teacher: TEACHER_NAME,
    teacherName: TEACHER_NAME,
    studentId,
    studentID: studentId,
    studentName,
    student: studentName,
    date,
    time,
    subject,
    sessionNumber,
    completed,
    isDeductCancelled: false,
    deductMemo: '',
    createdAt: now,
    updatedAt: now,
  });
}

test('student sees own approved private lessons in upcoming and history', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 Firestore 내역 검증을 실행합니다.');
  test.setTimeout(120000);

  const unique = Date.now();
  const db = getDb();
  const auth = admin.auth(getAdminApp());
  const studentUser = await auth.getUserByEmail(TEST_STUDENT_EMAIL);
  const studentMembershipRef = db
    .collection('academyMemberships')
    .doc(`${DEFAULT_E2E_ACADEMY_ID}_${studentUser.uid}`);
  const studentUserRef = db.collection('users').doc(studentUser.uid);
  const originalMembership = await readDoc(studentMembershipRef);
  const originalUser = await readDoc(studentUserRef);

  const studentId = `e2e-student-private-history-${unique}`;
  const studentName = `E2E 학생개인이력 ${unique}`;
  const upcomingSubject = `E2E upcoming private ${unique}`;
  const pastSubject = `E2E past private ${unique}`;
  const upcomingLessonId = `e2e-upcoming-private-history-${unique}`;
  const pastLessonId = `e2e-past-private-history-${unique}`;

  try {
    const now = admin.firestore.Timestamp.now();
    await Promise.all([
      studentUserRef.set(
        {
          uid: studentUser.uid,
          email: TEST_STUDENT_EMAIL,
          role: 'student',
          isActive: true,
          lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
          updatedAt: now,
        },
        { merge: true }
      ),
      studentMembershipRef.set(
        {
          academyId: DEFAULT_E2E_ACADEMY_ID,
          uid: studentUser.uid,
          email: TEST_STUDENT_EMAIL,
          displayName: 'Student E2E',
          role: 'student',
          studentId,
          teacherName: '',
          status: 'active',
          permissions: {
            canManageAttendance: false,
            canAddStudent: false,
            canEditStudent: false,
            canDeleteStudent: false,
            canEditLesson: false,
            canDeleteLesson: false,
            canCreateLessonDirectly: false,
            requiresLessonApproval: false,
          },
          updatedAt: now,
        },
        { merge: true }
      ),
      db.collection('privateStudents').doc(studentId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        name: studentName,
        teacher: TEACHER_NAME,
        paidLessons: 8,
        attendanceCount: 0,
        createdAt: now,
        updatedAt: now,
      }),
      createPrivateLesson({
        lessonId: upcomingLessonId,
        studentId,
        studentName,
        date: addDays(14),
        time: '10:00',
        subject: upcomingSubject,
        sessionNumber: 4,
      }),
      createPrivateLesson({
        lessonId: pastLessonId,
        studentId,
        studentName,
        date: '2020-01-04',
        time: '09:00',
        subject: pastSubject,
        sessionNumber: 1,
        completed: true,
      }),
    ]);

    await loginAsStudent(page, TEST_STUDENT_EMAIL, TEST_STUDENT_PASSWORD);

    const upcomingCard = privateUpcomingCard(page, upcomingSubject);
    await expect(upcomingCard).toBeVisible({ timeout: 15000 });
    await expect(upcomingCard).toContainText('4회차');
    await expect(upcomingCard).toContainText('수업 예정');

    const historyCard = lessonHistoryCard(page, pastSubject);
    await expect(historyCard).toBeVisible({ timeout: 15000 });
    await expect(historyCard).toContainText('1:1 수업');
    await expect(historyCard).toContainText('2020-01-04');
    await expect(historyCard).toContainText('지난 수업');
  } finally {
    await Promise.all([
      db.collection('privateStudents').doc(studentId).delete().catch(() => {}),
      db.collection('lessons').doc(upcomingLessonId).delete().catch(() => {}),
      db.collection('lessons').doc(pastLessonId).delete().catch(() => {}),
      restoreDoc(studentMembershipRef, originalMembership),
      restoreDoc(studentUserRef, originalUser),
    ]);
  }
});
