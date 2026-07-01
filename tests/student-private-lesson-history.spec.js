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

test('student upcoming private lessons exposes fixed private lesson cancel action only', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'StudentBookingPage.jsx'), 'utf8');
  const upcomingHelper =
    source.match(/function canShowUpcomingPrivateReservation[\s\S]*?\n}\n/)?.[0] || '';
  const fixedCancelVisibilityHelper =
    source.match(/function canShowFixedPrivateLessonCancelAction[\s\S]*?\n}\n/)?.[0] || '';
  const fixedCancelRenderHelper =
    source.match(/function renderFixedPrivateLessonCancelAction[\s\S]*?return \(\n[\s\S]*?\n  }\n/)?.[0] || '';
  const upcomingItemsBlock =
    source.match(/const upcomingPrivateScheduleItems = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[[\s\S]*?todayYmd,\n  \]\)/)?.[0] || '';
  const upcomingSection =
    source.match(/id="student-upcoming-private-lessons-section"[\s\S]*?<h2 style=\{\{ margin: 0, fontSize: '1\.1rem' \}\}>내 반 등록 수업<\/h2>/)?.[0] || '';
  const historySection =
    source.match(/id="student-lesson-history-section"[\s\S]*?data-testid="student-booking-mobile-bottom-spacer"/)?.[0] || '';
  const directPrivateRenderHelper =
    source.match(/function renderPrivateReservationCancelAction[\s\S]*?return \(\n[\s\S]*?\n  }\n/)?.[0] || '';

  expect(source).toContain('function buildFixedPrivateCancelLessonFromReservation');
  expect(source).toContain('function isFixedPrivateScheduleDisplayLabel');
  expect(source).toContain('function getUpcomingFixedPrivateCancelLesson');
  expect(source).toContain('function getPrivatePackageLinkId');
  expect(source).toContain('function getFixedPrivateLessonLinkId');
  expect(source).toContain('function getFixedPrivateCancellableLessonId');
  expect(source).toContain('function getFixedPrivateFallbackLessonId');
  expect(source).toContain("sourceType === 'fixed_admin'");
  expect(source).toContain("'fixed-private-slot-assignment'");
  expect(source).toContain("sourceType === 'weekly_slot_fixed_assignment'");
  expect(source).toContain('source?.deductionPackageId');
  expect(source).toContain('source?.linkedPackageId');
  expect(source).toContain('item?.packageId');
  expect(source).toContain('reservation?.packageId');
  expect(source).toContain('slot?.packageId');
  expect(source).toContain('lesson?.packageId');
  expect(source).toContain('item?.lessonId');
  expect(source).toContain('reservation?.lessonId');
  expect(source).toContain('slot?.lessonId');
  expect(source).toContain('lesson?.lessonId');
  expect(source).toContain("item?.source === 'lesson'");
  expect(source).toContain('fixedLessonId || lessonId');
  expect(source).toContain('missingFixedLessonId: !lessonId');
  expect(source).toContain("trim() === '고정 예약 1:1'");
  expect(source).toContain('isFixedPrivateScheduleDisplayLabel(item?.typeLabel)');
  expect(source).toContain('isFixedPrivateLesson: true');
  expect(source).toContain('const privateReservationByLessonId = useMemo');
  expect(source).toContain('function getStudentPackageLookupIds');
  expect(source).toContain('pkg?.packageId');
  expect(source).toContain('pkg?.docId');
  expect(source).toContain('pkg?.originalId');
  expect(source).toContain('function studentPackageMatchesPrivateCancelScope');
  expect(source).toContain('function getFixedPrivatePackageLinkId');
  expect(source).toContain('getFixedPrivatePackageLinkId({');
  expect(source).toContain('function isUpcomingPrivateReservationStatus');
  expect(source).toContain("status === 'scheduled'");
  expect(source).toMatch(/where\('status', 'in', \[[\s\S]*'scheduled'/);
  expect(upcomingHelper).toContain('Boolean(reservation?.slotId)');
  expect(upcomingHelper).toContain('isUpcomingPrivateReservationStatus(reservation)');
  expect(upcomingHelper).toContain('!isPrivateReservationCancelled(reservation)');
  expect(upcomingHelper).toContain('!isPrivateReservationOutcomeFinal(reservation)');
  expect(upcomingHelper).toContain('!isPrivateReservationPast(reservation)');
  expect(upcomingHelper).toContain('isPrivateReservationInFuture(reservation)');
  expect(upcomingItemsBlock).toContain('canShowUpcomingPrivateReservation(reservation)');
  expect(upcomingItemsBlock).not.toContain('canShowPrivateReservationCancelAction(reservation)');
  expect(upcomingItemsBlock).toContain("isFixedPrivateReservation(reservation)");
  expect(upcomingItemsBlock).toContain("'고정 예약 1:1'");
  expect(upcomingItemsBlock).toContain("'학생 직접예약 1:1'");
  expect(upcomingItemsBlock).toContain('studentPrivateLessonById');
  expect(upcomingItemsBlock).toContain('lesson: linkedLesson');
  expect(upcomingItemsBlock).toContain('const linkedSlot = slotId ? privateSlotsById.get(slotId) || null : null');
  expect(upcomingItemsBlock).toContain('const fixedCancelLesson = buildFixedPrivateCancelLessonFromReservation');
  expect(upcomingItemsBlock).toContain('slot: linkedSlot');
  expect(upcomingItemsBlock).toContain('fixedCancelLesson,');
  expect(upcomingItemsBlock).toContain('fixedCancelLesson: isFixedPrivateLesson(lesson) ? lesson : null');
  expect(upcomingItemsBlock).toContain('studentName');
  expect(upcomingItemsBlock).toContain('seenKeys');
  expect(fixedCancelVisibilityHelper).toContain('isFixedPrivateLesson(lesson)');
  expect(fixedCancelVisibilityHelper).toContain('!isCancelledLesson(lesson)');
  expect(fixedCancelVisibilityHelper).toContain('!isPrivateReservationCancelled(lesson)');
  expect(fixedCancelVisibilityHelper).toContain('!isPrivateReservationOutcomeFinal(lesson)');
  expect(fixedCancelVisibilityHelper).toContain('PRIVATE_CANCEL_CUTOFF_MS');
  expect(fixedCancelVisibilityHelper).toContain("String(lesson?.id || '').trim()");
  expect(fixedCancelVisibilityHelper).toContain('lesson?.missingFixedLessonId !== true');
  expect(fixedCancelVisibilityHelper).toContain('getPrivatePackageLinkId(lesson)');
  expect(fixedCancelVisibilityHelper).toContain('cancelAllowance?.remaining');
  expect(source).toContain('function getFixedPrivateLessonCancelUnavailableReason');
  expect(source).toContain('수업 시작 10시간 전까지만 취소할 수 있습니다.');
  expect(source).toContain('이 수강권의 취소 가능 횟수를 모두 사용했습니다. 학원에 문의해 주세요.');
  expect(source).toContain('수강권 연결 정보가 없어 학원에 문의해 주세요.');
  expect(fixedCancelRenderHelper).toContain('student-fixed-private-lesson-cancel-button');
  expect(fixedCancelRenderHelper).toContain('cancelFixedPrivateLesson(lesson)');
  expect(fixedCancelRenderHelper).toContain("'수업 취소'");
  expect(fixedCancelRenderHelper).toContain("'수업 취소 불가'");
  expect(fixedCancelRenderHelper).toContain('{unavailableReason}');
  expect(fixedCancelRenderHelper).toContain('data-private-cancel-used-field="privateCancelUsedCount"');
  expect(fixedCancelRenderHelper).toContain('forceRender = false');
  expect(fixedCancelRenderHelper).toContain('isFixedPrivateLessonInFuture(lesson)');
  expect(fixedCancelRenderHelper).toContain('const fixedCancelLessonId = getFixedPrivateCancellableLessonId(lesson)');
  expect(fixedCancelRenderHelper).toContain('Boolean(fixedCancelLessonId)');
  expect(fixedCancelRenderHelper).toContain('busyFixedPrivateLessonId === fixedCancelLessonId');
  expect(fixedCancelRenderHelper).toContain('!fixedCancelLessonId');
  expect(fixedCancelRenderHelper).toContain('if (!fixedCancelLessonId || !canCancel) return');
  expect(fixedCancelRenderHelper).toContain("'취소 중...'");
  expect(fixedCancelRenderHelper).not.toContain('PRIVATE_SLOT_BOOKING_ENABLED');
  expect(fixedCancelRenderHelper).not.toContain('privateSlotBookingPilotEnabled');
  expect(directPrivateRenderHelper).toContain("'예약 취소'");
  expect(directPrivateRenderHelper).toContain('PRIVATE_SLOT_BOOKING_ENABLED');
  expect(directPrivateRenderHelper).toContain('privateSlotBookingPilotEnabled');
  expect(directPrivateRenderHelper).toContain('cancelPrivateReservation(reservation)');
  expect(source).toContain('>내 예정 수업</h2>');
  expect(source).toContain('>내 수업 내역</h2>');
  expect(upcomingSection).toContain('예정된 1:1 수업이 없습니다.');
  expect(upcomingSection).toContain('{item.typeLabel}');
  expect(upcomingSection).toContain('{item.studentName}');
  expect(upcomingSection).toContain('const fixedLessonForCancel = getUpcomingFixedPrivateCancelLesson(item)');
  expect(upcomingSection).toContain('const fixedCancelUnavailableReason = fixedLessonForCancel');
  expect(upcomingSection).toContain('const fixedCancelNode = fixedLessonForCancel');
  expect(upcomingSection).toContain('student-upcoming-fixed-private-cancel-action');
  expect(upcomingSection).toContain('data-fixed-cancel-callable="cancelFixedPrivateLessonOccurrence"');
  expect(upcomingSection).toContain('data-fixed-cancel-model="fixedCancelLesson"');
  expect(upcomingSection).toContain('data-fixed-cancel-cutoff-reason="수업 시작 10시간 전까지만 취소할 수 있습니다."');
  expect(upcomingSection).toContain('data-fixed-cancel-exhausted-reason="이 수강권의 취소 가능 횟수를 모두 사용했습니다."');
  expect(upcomingSection).toContain('data-fixed-cancel-missing-link-reason="수강권 연결 정보가 없어 학원에 문의해 주세요."');
  expect(upcomingSection).toContain('fixedCancelNode || (');
  expect(upcomingSection).toContain('student-upcoming-fixed-private-cancel-fallback');
  expect(upcomingSection).toContain("fixedCancelUnavailableReason ||");
  expect(upcomingSection).toContain('고정 예약 1:1 수업 취소 또는 수업 취소 불가');
  expect(upcomingSection).toContain('renderFixedPrivateLessonCancelAction(fixedLessonForCancel, {');
  expect(upcomingSection).toContain('forceRender: true');
  expect(upcomingSection).toContain('수강권 연결 정보가 없어 학원에 문의해 주세요.');
  expect(upcomingSection).not.toContain('renderPrivateReservationCancelAction');
  expect(upcomingSection).not.toContain('예약 취소');
  expect(historySection).toContain('data-testid="student-lesson-history-card"');
  expect(historySection).toContain('getLessonHistoryStatusLabel(item)');
  expect(historySection).not.toContain('student-fixed-private-lesson-cancel-button');
  expect(historySection).not.toContain('renderFixedPrivateLessonCancelAction');
  expect(historySection).not.toContain('cancelFixedPrivateLesson(');
  expect(source).toContain("'cancelFixedPrivateLessonOccurrence'");
  expect(source).toContain("'cancelPrivateLessonReservation'");
  expect(source).toContain("cancellationType: 'seat_released'");
  expect(source).toContain('취소 가능 횟수 1회가 사용되며, 수강권은 차감되지 않습니다.');
  expect(source).toContain("privateSlotCancelConfirm.kind === 'fixedLesson'\n                  ? '수업을 취소할까요?'");
  expect(source).toContain("privateSlotCancelConfirm.kind === 'fixedLesson' ? '수업 취소' : '예약 취소'");
});

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
