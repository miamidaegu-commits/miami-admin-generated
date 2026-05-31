import fs from 'node:fs';
import path from 'node:path';
import admin from 'firebase-admin';
import { test, expect } from '@playwright/test';
import { BASE_URL, loginAsAdmin, openDashboardSection } from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEFAULT_E2E_ACADEMY_ID,
} from './fixtures/test-data.js';
import { buildTeacherLessonRoster } from '../src/features/dashboard/teacherLessonRosterHelpers.js';

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const ADMIN_APP_NAME = 'teacher-lesson-roster-e2e';

function hasServiceAccount() {
  return fs.existsSync(SERVICE_ACCOUNT_PATH);
}

function initializeAdmin() {
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
  return initializeAdmin().firestore();
}

function upcomingMondayYmd(daysFromNow = 7) {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  while (date.getUTCDay() !== 1) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

test('teacher lesson roster helper groups upcoming, past, and cancelled rows', async () => {
  const teacher = {
    id: 'teacher-a',
    name: 'Roster Teacher A',
    teacherKey: 'roster-teacher-a',
    teacherName: 'roster-teacher-a',
  };
  const futureDate = '2026-09-07';
  const pastDate = '2025-01-15';
  const roster = buildTeacherLessonRoster({
    academyId: 'academy-1',
    teacher,
    lessons: [
      {
        id: 'fixed-future',
        academyId: 'academy-1',
        teacher: 'roster-teacher-a',
        studentId: 'student-1',
        studentName: 'Fixed Future Student',
        date: futureDate,
        time: '15:00',
        subject: 'Fixed Future Lesson',
      },
      {
        id: 'fixed-past',
        academyId: 'academy-1',
        teacher: 'roster-teacher-a',
        studentId: 'student-3',
        studentName: 'Past Student',
        date: pastDate,
        time: '16:00',
        subject: 'Past Fixed Lesson',
        completed: true,
      },
      {
        id: 'deduct-cancelled',
        academyId: 'academy-1',
        teacher: 'roster-teacher-a',
        studentId: 'student-5',
        studentName: 'Cancelled Lesson Student',
        date: pastDate,
        time: '17:00',
        subject: 'Cancelled Fixed Lesson',
        isDeductCancelled: true,
      },
      {
        id: 'other-teacher',
        academyId: 'academy-1',
        teacher: 'roster-teacher-b',
        studentId: 'student-x',
        studentName: 'Other Teacher Student',
        date: futureDate,
        time: '18:00',
        subject: 'Other Teacher Lesson',
      },
    ],
    privateLessonReservations: [
      {
        id: 'reservation-future',
        academyId: 'academy-1',
        teacher: 'roster-teacher-a',
        studentId: 'student-2',
        studentName: 'Reservation Future Student',
        date: futureDate,
        time: '19:00',
        status: 'active',
        subject: 'Future Reservation',
        sourceType: 'open_booking',
      },
      {
        id: 'reservation-cancelled',
        academyId: 'academy-1',
        teacher: 'roster-teacher-a',
        studentId: 'student-4',
        studentName: 'Cancelled Reservation Student',
        date: pastDate,
        time: '20:00',
        status: 'cancelled',
        subject: 'Cancelled Reservation',
      },
    ],
    nowMillis: Date.UTC(2026, 5, 1, 3, 0, 0),
  });

  expect(roster.upcoming.map((row) => row.studentName)).toEqual([
    'Fixed Future Student',
    'Reservation Future Student',
  ]);
  expect(roster.past.map((row) => row.studentName)).toEqual(['Past Student']);
  expect(roster.cancelled.map((row) => row.studentName).sort()).toEqual(
    ['Cancelled Lesson Student', 'Cancelled Reservation Student'].sort()
  );
  expect(roster.upcoming.every((row) => !/price|payment|billing/i.test(JSON.stringify(row)))).toBe(
    true
  );
});

test('admin opens teacher lesson roster modal with scoped private lessons', async ({
  page,
}, testInfo) => {
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 teacher roster E2E를 실행합니다.');
  test.setTimeout(180000);

  const db = getDb();
  const nowTs = admin.firestore.Timestamp.now();
  const unique = `${Date.now()}-${testInfo.workerIndex}`;
  const teacherAId = `e2e-roster-teacher-a-${unique}`;
  const teacherBId = `e2e-roster-teacher-b-${unique}`;
  const teacherCId = `e2e-roster-teacher-c-${unique}`;
  const teacherAKey = `roster-teacher-a-${unique}`;
  const teacherBKey = `roster-teacher-b-${unique}`;
  const teacherAName = `Roster Teacher A ${unique}`;
  const futureDate = upcomingMondayYmd(14);
  const pastDate = '2025-02-10';
  const futureFixedLessonId = `e2e-roster-fixed-future-${unique}`;
  const pastFixedLessonId = `e2e-roster-fixed-past-${unique}`;
  const otherTeacherLessonId = `e2e-roster-other-teacher-${unique}`;
  const futureSlotId = `e2e-roster-slot-${unique}`;
  const futureReservationId = `${DEFAULT_E2E_ACADEMY_ID}__${futureSlotId}__e2e-roster-student-2-${unique}`;
  const cancelledReservationId = `${DEFAULT_E2E_ACADEMY_ID}__e2e-roster-slot-cancelled-${unique}__e2e-roster-student-4-${unique}`;
  const student1Id = `e2e-roster-student-1-${unique}`;
  const student2Id = `e2e-roster-student-2-${unique}`;
  const student3Id = `e2e-roster-student-3-${unique}`;
  const student4Id = `e2e-roster-student-4-${unique}`;

  const refs = [
    db.collection('teachers').doc(teacherAId),
    db.collection('teachers').doc(teacherBId),
    db.collection('teachers').doc(teacherCId),
    db.collection('lessons').doc(futureFixedLessonId),
    db.collection('lessons').doc(pastFixedLessonId),
    db.collection('lessons').doc(otherTeacherLessonId),
    db.collection('privateLessonSlots').doc(futureSlotId),
    db.collection('privateLessonSlots').doc(`e2e-roster-slot-cancelled-${unique}`),
    db.collection('privateLessonReservations').doc(futureReservationId),
    db.collection('privateLessonReservations').doc(cancelledReservationId),
    db.collection('privateStudents').doc(student1Id),
    db.collection('privateStudents').doc(student2Id),
    db.collection('privateStudents').doc(student3Id),
    db.collection('privateStudents').doc(student4Id),
  ];

  try {
    await Promise.all([
      db.collection('teachers').doc(teacherAId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        name: teacherAName,
        teacherName: teacherAKey,
        teacherKey: teacherAKey,
        status: 'active',
        updatedAt: nowTs,
        createdAt: nowTs,
      }),
      db.collection('teachers').doc(teacherBId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        name: `Roster Teacher B ${unique}`,
        teacherName: teacherBKey,
        teacherKey: teacherBKey,
        status: 'active',
        updatedAt: nowTs,
        createdAt: nowTs,
      }),
      db.collection('teachers').doc(teacherCId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        name: `Roster Teacher C ${unique}`,
        teacherName: `roster-teacher-c-${unique}`,
        teacherKey: `roster-teacher-c-${unique}`,
        status: 'active',
        updatedAt: nowTs,
        createdAt: nowTs,
      }),
      db.collection('privateStudents').doc(student1Id).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        name: `Roster Fixed Future ${unique}`,
        teacher: teacherAKey,
        status: 'active',
        updatedAt: nowTs,
      }),
      db.collection('privateStudents').doc(student2Id).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        name: `Roster Reservation Future ${unique}`,
        teacher: teacherAKey,
        status: 'active',
        updatedAt: nowTs,
      }),
      db.collection('privateStudents').doc(student3Id).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        name: `Roster Past Student ${unique}`,
        teacher: teacherAKey,
        status: 'active',
        updatedAt: nowTs,
      }),
      db.collection('privateStudents').doc(student4Id).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        name: `Roster Cancelled Reservation ${unique}`,
        teacher: teacherAKey,
        status: 'active',
        updatedAt: nowTs,
      }),
      db.collection('lessons').doc(futureFixedLessonId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        teacher: teacherAKey,
        teacherName: teacherAKey,
        studentId: student1Id,
        studentName: `Roster Fixed Future ${unique}`,
        date: futureDate,
        time: '15:00',
        subject: `E2E Roster Fixed Future ${unique}`,
        completed: false,
        isDeductCancelled: false,
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
      db.collection('lessons').doc(pastFixedLessonId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        teacher: teacherAKey,
        teacherName: teacherAKey,
        studentId: student3Id,
        studentName: `Roster Past Student ${unique}`,
        date: pastDate,
        time: '16:00',
        subject: `E2E Roster Fixed Past ${unique}`,
        completed: true,
        isDeductCancelled: false,
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
      db.collection('lessons').doc(otherTeacherLessonId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        teacher: teacherBKey,
        teacherName: teacherBKey,
        studentId: 'other-student',
        studentName: `Other Teacher Student ${unique}`,
        date: futureDate,
        time: '18:00',
        subject: `E2E Roster Other Teacher ${unique}`,
        completed: false,
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
      db.collection('privateLessonSlots').doc(futureSlotId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        teacher: teacherAKey,
        teacherName: teacherAKey,
        date: futureDate,
        time: '19:00',
        subject: `E2E Roster Reservation Slot ${unique}`,
        durationMinutes: 50,
        status: 'reserved',
        reservedStudentId: student2Id,
        reservationId: futureReservationId,
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
      db.collection('privateLessonReservations').doc(futureReservationId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        slotId: futureSlotId,
        studentId: student2Id,
        studentName: `Roster Reservation Future ${unique}`,
        teacher: teacherAKey,
        teacherName: teacherAKey,
        date: futureDate,
        time: '19:00',
        status: 'active',
        source: 'student',
        sourceType: 'open_booking',
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
      db.collection('privateLessonReservations').doc(cancelledReservationId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        slotId: `e2e-roster-slot-cancelled-${unique}`,
        studentId: student4Id,
        studentName: `Roster Cancelled Reservation ${unique}`,
        teacher: teacherAKey,
        teacherName: teacherAKey,
        date: pastDate,
        time: '20:00',
        status: 'cancelled',
        source: 'student',
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
    ]);

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '선생님 관리');

    const teacherRow = page
      .getByTestId('teacher-management-row')
      .filter({ hasText: teacherAName })
      .first();
    await expect(teacherRow).toBeVisible({ timeout: 15000 });
    await teacherRow.getByTestId('teacher-lesson-roster-open-button').click();

    const modal = page.getByTestId('teacher-lesson-roster-modal');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await expect(modal.getByTestId('teacher-lesson-roster-title')).toContainText('수업 현황');
    await expect(modal).toContainText(teacherAKey);

    const upcomingSection = modal.getByTestId('teacher-lesson-roster-upcoming-section');
    await expect(upcomingSection).toContainText(`Roster Fixed Future ${unique}`);
    await expect(upcomingSection).toContainText(`Roster Reservation Future ${unique}`);
    await expect(upcomingSection).not.toContainText(`Other Teacher Student ${unique}`);

    const pastSection = modal.getByTestId('teacher-lesson-roster-past-section');
    await expect(pastSection).toContainText(`Roster Past Student ${unique}`);

    const cancelledSection = modal.getByTestId('teacher-lesson-roster-cancelled-section');
    await expect(cancelledSection).toContainText(`Roster Cancelled Reservation ${unique}`);

    await expect(modal).not.toContainText(/price|payment|billing|결제|금액/i);

    await modal.getByTestId('teacher-lesson-roster-close-button').click();
    await expect(modal).toHaveCount(0);

    const emptyTeacherRow = page
      .getByTestId('teacher-management-row')
      .filter({ hasText: `Roster Teacher C ${unique}` })
      .first();
    await emptyTeacherRow.getByTestId('teacher-lesson-roster-open-button').click();
    const emptyModal = page.getByTestId('teacher-lesson-roster-modal');
    await expect(emptyModal).toBeVisible();
    await expect(emptyModal.getByTestId('teacher-lesson-roster-upcoming-empty')).toContainText(
      '예정 수업 없음'
    );
    await expect(emptyModal.getByTestId('teacher-lesson-roster-past-empty')).toContainText(
      '지난 수업 없음'
    );
  } finally {
    await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
  }
});
