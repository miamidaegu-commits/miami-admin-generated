import { test, expect } from '@playwright/test';
import {
  PRIVATE_PACKAGE_CANCEL_UNIT_COUNT,
  STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT,
  buildPrivateReservationCancelConfirmMessage,
  canUsePrivatePackageCancel,
  computePrivatePackageCancelAllowance,
  computeStudentPrivateCancelAllowance,
  formatAdminStudentCancelAllowanceSummary,
  formatPrivatePackageCancelUsageSummary,
  formatStudentPrivateCancelPolicyGuide,
  getPrivatePackageCancelLimit,
  getPrivatePackageCancelRemaining,
  getPrivatePackageCancelUsed,
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
  expect(formatStudentPrivateCancelPolicyGuide()).toEqual([
    '개인 1:1 취소는 수강권 4회당 1회까지 가능합니다.',
    '취소는 수업 시작 10시간 전까지만 가능합니다.',
  ]);
  expect(STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT).toBe(2);
});

test('private package cancel allowance is computed from total count', () => {
  expect(PRIVATE_PACKAGE_CANCEL_UNIT_COUNT).toBe(4);
  expect(getPrivatePackageCancelLimit({ totalCount: 1 })).toBe(0);
  expect(getPrivatePackageCancelLimit({ totalCount: 3 })).toBe(0);
  expect(getPrivatePackageCancelLimit({ totalCount: 4 })).toBe(1);
  expect(getPrivatePackageCancelLimit({ totalCount: 8 })).toBe(2);
  expect(getPrivatePackageCancelLimit({ totalCount: 24 })).toBe(6);
  expect(getPrivatePackageCancelUsed({ privateCancelUsedCount: 1.8 })).toBe(1);
  expect(getPrivatePackageCancelRemaining({
    totalCount: 8,
    privateCancelUsedCount: 1,
  })).toBe(1);
  expect(computePrivatePackageCancelAllowance({
    totalCount: 8,
    privateCancelUsedCount: 1,
  })).toEqual({
    used: 1,
    limit: 2,
    remaining: 1,
  });
  expect(canUsePrivatePackageCancel({
    totalCount: 4,
    privateCancelUsedCount: 1,
  })).toBe(false);
  expect(formatPrivatePackageCancelUsageSummary({
    totalCount: 4,
    privateCancelUsedCount: 0,
  })).toBe('취소 사용 0/1회');
  expect(formatPrivatePackageCancelUsageSummary({
    totalCount: 8,
    privateCancelUsedCount: 1,
  })).toBe('취소 사용 1/2회');
});

test('private package top-up increases computed limit while preserving used count', () => {
  const before = { totalCount: 4, privateCancelUsedCount: 1 };
  const afterTopUp = { ...before, totalCount: 8 };
  expect(computePrivatePackageCancelAllowance(before)).toEqual({
    used: 1,
    limit: 1,
    remaining: 0,
  });
  expect(computePrivatePackageCancelAllowance(afterTopUp)).toEqual({
    used: 1,
    limit: 2,
    remaining: 1,
  });
});

test('cancel confirmation shows used, remaining, and after-cancel counts', () => {
  const allowance = computePrivatePackageCancelAllowance({
    totalCount: 24,
    privateCancelUsedCount: 2,
  });
  const message = buildPrivateReservationCancelConfirmMessage(allowance, { loaded: true });
  expect(message).toContain('예약을 취소하시겠습니까?');
  expect(message).toContain('취소 사용 2/6회');
  expect(message).toContain('남은 취소 가능 4회');
  expect(message).toContain('이번 취소 후 남은 취소 가능 3회');
  expect(message).toContain('이 취소도 횟수에 포함됩니다.');
  expect(buildPrivateReservationCancelConfirmMessage(
    computePrivatePackageCancelAllowance({ totalCount: 8, privateCancelUsedCount: 2 }),
    { loaded: true }
  )).toBe('이 수강권의 취소 가능 횟수를 모두 사용했습니다. 학원에 문의해 주세요.');
  expect(buildPrivateReservationCancelConfirmMessage(null, { loaded: false })).toContain(
    '개인 1:1 취소는 수강권 4회당 1회까지 가능하며'
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

test('student fixed private lesson cancel action uses package allowance and separate wording', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile('StudentBookingPage.jsx', 'utf8');
  const functionsSource = await fs.readFile('functions/index.js', 'utf8');
  const fixedVisibilityHelper =
    source.match(/function canShowFixedPrivateLessonCancelAction[\s\S]*?\n}\n/)?.[0] || '';
  const fixedUnavailableHelper =
    source.match(/function getFixedPrivateLessonCancelUnavailableReason[\s\S]*?\n  }\n/)?.[0] || '';
  const fixedRenderHelper =
    source.match(/function renderFixedPrivateLessonCancelAction[\s\S]*?return \(\n[\s\S]*?\n  }\n/)?.[0] || '';
  const upcomingSection =
    source.match(/id="student-upcoming-private-lessons-section"[\s\S]*?<h2 style=\{\{ margin: 0, fontSize: '1\.1rem' \}\}>내 반 등록 수업<\/h2>/)?.[0] || '';
  const historySection =
    source.match(/id="student-lesson-history-section"[\s\S]*?data-testid="student-booking-mobile-bottom-spacer"/)?.[0] || '';
  const upcomingItemsBlock =
    source.match(/const upcomingPrivateScheduleItems = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[[\s\S]*?todayYmd,\n  \]\)/)?.[0] || '';

  expect(source).toContain('function buildFixedPrivateCancelLessonFromReservation');
  expect(source).toContain('function isFixedPrivateScheduleDisplayLabel');
  expect(source).toContain('function getUpcomingFixedPrivateCancelLesson');
  expect(source).toContain('function getPrivatePackageLinkId');
  expect(source).toContain('function getFixedPrivateLessonLinkId');
  expect(source).toContain('function getFixedPrivateFallbackLessonId');
  expect(source).toContain("sourceType === 'fixed_admin'");
  expect(source).toContain("'fixed-private-slot-assignment'");
  expect(source).toContain("sourceType === 'weekly_slot_fixed_assignment'");
  expect(source).toContain('source?.deductionPackageId');
  expect(source).toContain('source?.linkedPackageId');
  expect(source).toContain('item?.lessonId');
  expect(source).toContain('item?.fixedLessonId');
  expect(source).toContain('reservation?.lessonId');
  expect(source).toContain('reservation?.fixedLessonId');
  expect(source).toContain('slot?.lessonId');
  expect(source).toContain('slot?.fixedLessonId');
  expect(source).toContain('lesson?.lessonId');
  expect(source).toContain('lesson?.id');
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
  expect(source).toContain('packageTeacherIds.length > 0');
  expect(source).toContain('function getFixedPrivatePackageLinkId');
  expect(source).toContain('getFixedPrivatePackageLinkId({');
  expect(fixedVisibilityHelper).toContain('isFixedPrivateLesson(lesson)');
  expect(fixedVisibilityHelper).toContain('!isCancelledLesson(lesson)');
  expect(fixedVisibilityHelper).toContain('!isPrivateReservationCancelled(lesson)');
  expect(fixedVisibilityHelper).toContain('!isPrivateReservationOutcomeFinal(lesson)');
  expect(fixedVisibilityHelper).toContain('startMillis - nowMillis >= PRIVATE_CANCEL_CUTOFF_MS');
  expect(fixedVisibilityHelper).toContain("String(lesson?.id || '').trim()");
  expect(fixedVisibilityHelper).toContain('lesson?.missingFixedLessonId !== true');
  expect(fixedVisibilityHelper).toContain('getPrivatePackageLinkId(lesson)');
  expect(fixedVisibilityHelper).toContain('Number(cancelAllowance?.remaining ?? 0) > 0');
  expect(fixedUnavailableHelper).toContain('수업 시작 10시간 전까지만 취소할 수 있습니다.');
  expect(fixedUnavailableHelper).toContain('수강권 연결 정보가 없어 학원에 문의해 주세요.');
  expect(fixedUnavailableHelper).toContain('이 수강권의 취소 가능 횟수를 모두 사용했습니다. 학원에 문의해 주세요.');
  expect(fixedUnavailableHelper).toContain('canRenderFixedPrivateLessonCancelAction(lesson)');
  expect(fixedRenderHelper).toContain('student-fixed-private-lesson-cancel-button');
  expect(fixedRenderHelper).toContain('수업 취소');
  expect(fixedRenderHelper).toContain('수업 취소 불가');
  expect(fixedRenderHelper).toContain('cancelFixedPrivateLesson(lesson)');
  expect(fixedRenderHelper).toContain('{unavailableReason}');
  expect(fixedRenderHelper).toContain('data-private-cancel-used-field="privateCancelUsedCount"');
  expect(fixedRenderHelper).toContain('forceRender = false');
  expect(fixedRenderHelper).toContain('isFixedPrivateLessonInFuture(lesson)');
  expect(fixedRenderHelper).not.toContain('PRIVATE_SLOT_BOOKING_ENABLED');
  expect(fixedRenderHelper).not.toContain('privateSlotBookingPilotEnabled');
  expect(upcomingItemsBlock).toContain('const linkedSlot = slotId ? privateSlotsById.get(slotId) || null : null');
  expect(upcomingItemsBlock).toContain('buildFixedPrivateCancelLessonFromReservation(');
  expect(upcomingItemsBlock).toContain('linkedSlot');
  expect(upcomingItemsBlock).toContain('const fixedCancelLesson = buildFixedPrivateCancelLessonFromReservation');
  expect(upcomingItemsBlock).toContain('slot: linkedSlot');
  expect(upcomingItemsBlock).toContain('fixedCancelLesson,');
  expect(upcomingItemsBlock).toContain('fixedCancelLesson: isFixedPrivateLesson(lesson) ? lesson : null');
  expect(source).toContain('>내 예정 수업</h2>');
  expect(source).toContain('>내 수업 내역</h2>');
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
  expect(historySection).not.toContain('student-fixed-private-lesson-cancel-button');
  expect(historySection).not.toContain('renderFixedPrivateLessonCancelAction');
  expect(source).toContain("'cancelPrivateLessonReservation'");
  expect(source).toContain("'cancelFixedPrivateLessonOccurrence'");
  expect(source).toContain('이번 고정 1:1 수업을 취소할까요?');
  expect(source).toContain('취소 가능 횟수 1회가 사용되며, 수강권은 차감되지 않습니다.');
  expect(functionsSource).toMatch(
    /cancelFixedPrivateLessonOccurrence[\s\S]*actorRole === "student"[\s\S]*STUDENT_PRIVATE_CANCEL_CUTOFF_MS/
  );
  expect(functionsSource).toMatch(
    /cancelFixedPrivateLessonOccurrence[\s\S]*studentPackages[\s\S]*doc\(lessonPackageId\)/
  );
  expect(functionsSource).toMatch(
    /cancelFixedPrivateLessonOccurrence[\s\S]*privateCancelUsedCount: nextPrivateCancelUsedCount/
  );
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
    /cancelPrivateLessonReservation[\s\S]*privateCancelUsedCount: allowance\.privateCancelUsedCount \+ 1/
  );
  expect(source).toMatch(
    /cancelPrivateLessonReservation[\s\S]*studentPackages[\s\S]*doc\(reservationPackageId\)/
  );
  expect(source).toMatch(
    /cancelFixedPrivateLessonOccurrence[\s\S]*privateCancelUsedCount: nextPrivateCancelUsedCount/
  );
  expect(source).toMatch(
    /STUDENT_PRIVATE_CANCEL_CUTOFF_MS = 10 \* 60 \* 60 \* 1000/
  );
  expect(source).toContain('computePrivatePackageCancelLimit');
  expect(source).toContain('Math.floor(totalCount / PRIVATE_PACKAGE_CANCEL_UNIT_COUNT)');
  expect(source).toContain('수강권 연결 정보가 없어 학원에 문의해 주세요.');
  expect(source).toContain('이 수강권의 취소 가능 횟수를 모두 사용했습니다. 학원에 문의해 주세요.');
  expect(source).toContain('Private reservation can only be cancelled at least 10 hours');
  expect(source).toContain('Fixed private lessons can only be cancelled at least');
  expect(source).toContain('10 hours');
  expect(source).not.toContain('Private reservation can only be cancelled at least 6 hours');
  expect(source).not.toContain('Fixed private lessons can only be cancelled at least 6 hours');
  expect(source).toMatch(
    /markPrivateReservationOutcome[\s\S]*usedCount: usedAfter[\s\S]*remainingCount: remainingAfter/
  );
  expect(source).toMatch(
    /markPrivateReservationOutcome[\s\S]*private_reservation_no_show_deduct/
  );
  expect(source).toMatch(
    /reversePrivateReservationOutcome[\s\S]*usedCount: usedAfter[\s\S]*remainingCount: remainingAfter/
  );
  const adminCancelBlock =
    source.match(
      /exports\.adminCancelPrivateLessonReservation[\s\S]*?exports\.updateStudentPrivateCancelAllowance/
    )?.[0] || '';
  expect(adminCancelBlock).not.toContain('studentCancelCount');
});
