import { test, expect } from '@playwright/test';
import {
  STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT,
  buildPrivateReservationCancelConfirmMessage,
  computeStudentPrivateCancelAllowance,
  formatAdminStudentCancelAllowanceSummary,
  formatStudentPrivateCancelPolicyGuide,
  formatTeacherRosterStudentCancelLabel,
  validateStudentCancelLimitInput,
} from '../src/features/booking/studentPrivateCancelAllowance.js';

test('computeStudentPrivateCancelAllowance uses default limit and remaining counts', () => {
  expect(computeStudentPrivateCancelAllowance({})).toEqual({
    used: 0,
    limit: 2,
    remaining: 2,
  });
  expect(
    computeStudentPrivateCancelAllowance({
      studentCancelCount: 2,
    })
  ).toEqual({
    used: 2,
    limit: 2,
    remaining: 0,
  });
  expect(
    computeStudentPrivateCancelAllowance({
      studentCancelCount: 2,
      studentCancelLimit: 6,
    })
  ).toEqual({
    used: 2,
    limit: 6,
    remaining: 4,
  });
});

test('validateStudentCancelLimitInput rejects limit below used count', () => {
  expect(
    validateStudentCancelLimitInput({
      limit: 1,
      used: 2,
    })
  ).toEqual({
    ok: false,
    message: '이미 2회 사용했으므로 한도는 2회 이상이어야 합니다.',
  });
  expect(
    validateStudentCancelLimitInput({
      limit: 6,
      used: 2,
    })
  ).toEqual({
    ok: true,
    limit: 6,
  });
});

test('format labels use friendly cancellation wording', () => {
  const allowance = computeStudentPrivateCancelAllowance({
    studentCancelCount: 2,
    studentCancelLimit: 6,
  });
  expect(formatTeacherRosterStudentCancelLabel(allowance)).toBe('취소 가능 4/6회');
  expect(formatAdminStudentCancelAllowanceSummary(allowance)).toBe(
    '취소 사용 2/6회 · 남은 4회'
  );
  expect(formatStudentPrivateCancelPolicyGuide({ limit: 6, used: 2, remaining: 4 })).toEqual([
    '예약 취소는 최대 6회까지 가능합니다.',
    '취소 사용 2/6회 · 남은 취소 가능 4회',
  ]);
  expect(STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT).toBe(2);
});

test('cancel confirmation shows used, remaining, and after-cancel counts', () => {
  const allowance = computeStudentPrivateCancelAllowance({
    studentCancelCount: 2,
    studentCancelLimit: 6,
  });
  const message = buildPrivateReservationCancelConfirmMessage(allowance, { loaded: true });
  expect(message).toContain('예약을 취소하시겠습니까?');
  expect(message).toContain('취소 사용 2/6회');
  expect(message).toContain('남은 취소 가능 4회');
  expect(message).toContain('이번 취소 후 남은 취소 가능 3회');
  expect(message).toContain('이 취소도 횟수에 포함됩니다.');
  expect(buildPrivateReservationCancelConfirmMessage(
    computeStudentPrivateCancelAllowance({ studentCancelCount: 2, studentCancelLimit: 2 }),
    { loaded: true }
  )).toBe('예약 취소 가능 횟수를 모두 사용했습니다. 학원에 문의해 주세요.');
  expect(buildPrivateReservationCancelConfirmMessage(null, { loaded: false })).toContain(
    '예약 취소는 최대 2회까지 가능하며'
  );
});

test('student private reservation cancel button is gated by active future direct reservation state', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile('StudentBookingPage.jsx', 'utf8');
  const visibilityHelper =
    source.match(/function canShowPrivateReservationCancelAction[\s\S]*?\n}\n/)?.[0] || '';
  const groupVisibilityHelper =
    source.match(/function canShowGroupReservationCancelAction[\s\S]*?\n}\n/)?.[0] || '';
  const renderHelper =
    source.match(/function renderPrivateReservationCancelAction[\s\S]*?return \(\n[\s\S]*?\n  }\n/)?.[0] || '';
  const historyLabelHelper =
    source.match(/function getLessonHistoryStatusLabel[\s\S]*?\n}\n/)?.[0] || '';
  const historySection =
    source.match(/id="student-lesson-history-section"[\s\S]*?data-testid="student-booking-mobile-bottom-spacer"/)?.[0] || '';
  const groupReservationSection =
    source.match(/<h2 style=\{\{ margin: 0, fontSize: '1\.1rem' \}\}>내 단체반 예약<\/h2>[\s\S]*?<h2 style=\{\{ margin: 0, fontSize: '1\.1rem' \}\}>내 수업 내역<\/h2>/)?.[0] || '';
  const freeBookingSection =
    source.match(/<h2 style=\{\{ margin: 0, fontSize: '1\.1rem' \}\}>자유 예약 가능한 단체반<\/h2>[\s\S]*?<h2 style=\{\{ margin: 0, fontSize: '1\.1rem' \}\}>1:1 수업 예약<\/h2>/)?.[0] || '';

  expect(visibilityHelper).toContain('isStudentDirectPrivateReservation(reservation)');
  expect(visibilityHelper).toContain('isActivePrivateReservationStatus(reservation)');
  expect(visibilityHelper).toContain('!isPrivateReservationCancelled(reservation)');
  expect(visibilityHelper).toContain('!isPrivateReservationOutcomeFinal(reservation)');
  expect(visibilityHelper).toContain('!isPrivateReservationPast(reservation)');
  expect(visibilityHelper).toContain('isPrivateReservationInFuture(reservation)');
  expect(source).toMatch(/function isPrivateReservationOutcomeFinal[\s\S]*isPrivateReservationCompleted\(reservation\)[\s\S]*isPrivateReservationNoShow\(reservation\)/);
  expect(source).toContain('teacherCancelledAt');
  expect(source).toContain('adminCancelledAt');
  expect(source).toContain('studentCancelledAt');
  expect(source).toContain('cancelledByRole');
  expect(source).toContain('cancellationType.includes(\'cancel\')');
  expect(source).toContain("'teacher_unavailable'");
  expect(source).toContain("'admin_cancelled'");
  expect(source).toContain("'student_cancelled'");
  expect(source).toContain("'pending_deduction'");
  expect(source).toContain("'auto_deducted'");
  expect(renderHelper).toMatch(/if \(!canShowPrivateReservationCancelAction\(reservation\)\) \{\s*return null\s*\}/);
  expect(historyLabelHelper).toContain("item?.source === 'privateReservation'");
  expect(historyLabelHelper).toContain("return '완료'");
  expect(historyLabelHelper).toContain("return '노쇼'");
  expect(groupVisibilityHelper).toContain('isGroupReservationRecord(reservation, lesson)');
  expect(groupVisibilityHelper).toContain('GROUP_RESERVATION_ACTIVE_STATUSES');
  expect(groupVisibilityHelper).toContain('GROUP_RESERVATION_CANCELLED_STATUSES');
  expect(groupVisibilityHelper).toContain('nowMillis < startsAtMs');
  expect(source).toContain('function hasPrivateRecordIndicators');
  expect(source).toContain('slotId');
  expect(source).toContain('privateLessonSlotId');
  expect(historySection).not.toContain('student-booking-reservation-cancel-button');
  expect(historySection).not.toContain('student-booking-cancel-button');
  expect(historySection).not.toContain('student-private-reservation-cancel-button');
  expect(historySection).not.toContain('cancelReservation(');
  expect(historySection).not.toContain('cancelPrivateReservation(');
  expect(groupReservationSection).toContain('canShowGroupReservationCancelAction');
  expect(groupReservationSection).toContain('student-booking-reservation-cancel-button');
  expect(freeBookingSection).toContain('canShowGroupReservationCancelAction');
  expect(freeBookingSection).toContain('student-booking-cancel-button');
  expect(source).toContain("kind: 'reservation'");
  expect(source).toContain("kind: 'fixedLesson'");
});

test('updateStudentPrivateCancelAllowance callable enforces admin and limit rules', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile('functions/index.js', 'utf8');
  expect(source).toContain('exports.updateStudentPrivateCancelAllowance');
  expect(source).toMatch(
    /updateStudentPrivateCancelAllowance[\s\S]*requireAcademyAdmin\(db, academyId, uid\)/
  );
  expect(source).toMatch(
    /updateStudentPrivateCancelAllowance[\s\S]*studentCancelLimit cannot be less than current/
  );
  expect(source).toMatch(
    /cancelPrivateLessonReservation[\s\S]*resolveStudentPrivateCancelAllowance\(stats\)/
  );
  const adminCancelBlock =
    source.match(
      /exports\.adminCancelPrivateLessonReservation[\s\S]*?exports\.updateStudentPrivateCancelAllowance/
    )?.[0] || '';
  expect(adminCancelBlock).not.toContain('studentCancelCount');
});
