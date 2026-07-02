import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  buildStudentPrivateTicketSummaries,
  buildStudentPrivateTicketSummariesFromCallablePackages,
  buildStudentTicketSummaryViewModel,
  formatPrivatePackageCoveragePeriodSummary,
  formatGroupTicketScheduleSummary,
  formatPrivateTicketScheduleSummary,
  formatStudentBookingIdentityLine,
  resolveLinkedStudentDisplayName,
} from '../src/features/booking/studentTicketSummary.js';

const ACADEMY_ID = 'academy_e2e_default';
const STUDENT_ID = 'e2e-student-ticket-summary';
const DAY_MS = 86400000;
const NOW = Date.now();

function ymdFromNow(daysFromNow) {
  return new Date(NOW + daysFromNow * DAY_MS).toISOString().slice(0, 10);
}

function privateLesson(id, overrides = {}) {
  return {
    id,
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
    teacher: 'don1',
    teacherName: 'don1',
    packageType: 'private',
    date: ymdFromNow(8),
    time: '15:00',
    startAt: new Date(NOW + Number(id.replace(/\D/g, '') || 1) * DAY_MS),
    ...overrides,
  };
}

function privateReservation(id, overrides = {}) {
  return {
    id,
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
    teacher: 'don1',
    teacherName: 'Don',
    status: 'active',
    date: ymdFromNow(20),
    time: '11:00',
    startAt: new Date(NOW + 20 * DAY_MS),
    ...overrides,
  };
}

test('student ticket summary helpers match admin-style private labels', () => {
  const ticket = {
    id: 'private-ticket',
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
    packageType: 'private',
    teacher: 'don1',
    totalCount: 4,
    usedCount: 0,
    remainingCount: 4,
    status: 'active',
    registrationStartDate: '2026-07-02',
    expiresAt: '2026-08-31',
    topUpCount: 1,
    registrationHistory: [
      { registrationRound: 1, deltaCount: 4 },
      { registrationLabel: '5개월 할인 등록', deltaCount: 5 },
    ],
  };
  const lessons = [
    privateLesson('past', {
      date: ymdFromNow(-1),
      time: '15:00',
      isDeductCancelled: true,
      packageId: ticket.id,
      startAt: new Date(NOW - DAY_MS),
    }),
    privateLesson('f1', {
      packageId: ticket.id,
      date: ymdFromNow(8),
      time: '15:00',
      startAt: new Date(NOW + 8 * DAY_MS),
    }),
    privateLesson('f2', {
      packageId: ticket.id,
      date: ymdFromNow(15),
      time: '15:00',
      startAt: new Date(NOW + 15 * DAY_MS),
    }),
    privateLesson('f3', {
      packageId: ticket.id,
      date: ymdFromNow(22),
      time: '15:00',
      startAt: new Date(NOW + 22 * DAY_MS),
    }),
  ];

  const beforeBooking = buildStudentPrivateTicketSummaries({
    packages: [ticket],
    privateLessons: lessons,
    privateReservations: [],
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
  });
  expect(beforeBooking[0]).toMatchObject({
    teacherLabel: 'don1',
    usageText: '총 4회 · 사용 0회 · 남은 4회',
    coverageText: '수강기간 2026-07-02 ~ 2026-08-31',
    scheduleText: '주간 배정 3회 · 직접 예약 가능 1회',
    cancelUsageText: '취소 사용 0/1회',
    registrationSummaryText: '등록 내역: 1회차 +4회, 5개월 할인 등록 +5회',
  });

  const afterBooking = buildStudentPrivateTicketSummaries({
    packages: [ticket],
    privateLessons: lessons,
    privateReservations: [privateReservation('r1', { packageId: ticket.id })],
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
  });
  expect(afterBooking[0].scheduleText).toBe('주간 배정 3회 · 직접 예약 1회');

  const afterCancel = buildStudentPrivateTicketSummaries({
    packages: [ticket],
    privateLessons: lessons,
    privateReservations: [privateReservation('r1', { packageId: ticket.id, status: 'cancelled' })],
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
  });
  expect(afterCancel[0].scheduleText).toBe('주간 배정 3회 · 직접 예약 가능 1회');
});

test('private ticket summary formats package coverage period', () => {
  expect(formatPrivatePackageCoveragePeriodSummary({
    registrationStartDate: '2026-07-02',
    expiresAt: '2026-08-31',
  })).toBe('수강기간 2026-07-02 ~ 2026-08-31');

  expect(formatPrivatePackageCoveragePeriodSummary({
    startDate: '2026-06-20',
  })).toBe('수강기간 2026-06-20 ~ 만료일 없음');

  expect(formatPrivatePackageCoveragePeriodSummary({
    endDate: '2026-08-31',
  })).toBe('수강기간 시작일 미설정 ~ 2026-08-31');

  expect(formatPrivatePackageCoveragePeriodSummary({
    registrationStartDate: 'not-a-date',
    expiresAt: 'also-not-a-date',
  })).toBe('수강기간 미설정');

  const timestampLike = { seconds: Date.UTC(2026, 6, 2, 0, 0, 0) / 1000 };
  expect(formatPrivatePackageCoveragePeriodSummary({
    packageStartDate: timestampLike,
    validUntil: { toDate: () => new Date(Date.UTC(2026, 7, 31, 0, 0, 0)) },
  })).toBe('수강기간 2026-07-02 ~ 2026-08-31');

  const fallback = buildStudentPrivateTicketSummariesFromCallablePackages([
    {
      id: 'slot-for-package',
      teacher: 'don1',
      packageId: 'private-ticket-fallback',
      packageSummary: {
        packageId: 'private-ticket-fallback',
        totalCount: 4,
        usedDeductedCount: 1,
        remainingCount: 3,
        makeupAvailableCount: 3,
        registrationStartDate: '2026-06-20',
      },
    },
  ]);
  expect(fallback[0]).toMatchObject({
    coverageText: '수강기간 2026-06-20 ~ 만료일 없음',
    usageText: '총 4회 · 사용 1회 · 남은 3회',
  });
});

test('general unused private package shows direct booking availability', () => {
  const ticket = {
    id: 'open-private',
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
    packageType: 'private',
    teacher: 'Don1',
    totalCount: 8,
    usedCount: 0,
    remainingCount: 8,
    status: 'active',
  };
  const viewModel = buildStudentTicketSummaryViewModel({
    packages: [ticket],
    privateLessons: [],
    privateReservations: [],
    groupReservations: [],
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
  });
  expect(viewModel.privateSummaries[0].scheduleText).toBe('직접 예약 가능 8회');
  expect(formatPrivateTicketScheduleSummary({
    futureFixedAllocatedCount: 0,
    activeFutureReservationCount: 0,
    noDeductionReleasedCount: 0,
    makeupAvailableCount: 8,
  })).toBe('직접 예약 가능 8회');
});

test('revoked private package is not shown as reservable or exhausted in student summary', () => {
  const revokedTicket = {
    id: 'revoked-private',
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
    packageType: 'private',
    teacher: 'miketest',
    totalCount: 4,
    usedCount: 0,
    remainingCount: 4,
    status: 'revoked',
  };
  const viewModel = buildStudentTicketSummaryViewModel({
    packages: [revokedTicket],
    privateLessons: [],
    privateReservations: [],
    groupReservations: [],
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
  });

  expect(viewModel.hasPrivateTicket).toBe(false);
  expect(viewModel.privateSummaries).toEqual([]);
});

test('revoked callable private package summary is ignored in student fallback summary', () => {
  const summaries = buildStudentPrivateTicketSummariesFromCallablePackages([
    {
      id: 'slot-for-revoked-package',
      teacher: 'miketest',
      packageId: 'revoked-private',
      packageSummary: {
        packageId: 'revoked-private',
        status: 'revoked',
        totalCount: 4,
        usedDeductedCount: 0,
        remainingCount: 4,
        makeupAvailableCount: 4,
      },
    },
  ]);

  expect(summaries).toEqual([]);
});

test('private ticket summary copy separates fixed assignments from remaining balance', () => {
  expect(formatPrivateTicketScheduleSummary({
    futureFixedAllocatedCount: 2,
    activeFutureReservationCount: 0,
    noDeductionReleasedCount: 0,
    makeupAvailableCount: 3,
  })).toBe('주간 배정 2회 · 직접 예약 가능 3회');

  expect(formatPrivateTicketScheduleSummary({
    futureFixedAllocatedCount: 2,
    activeFutureReservationCount: 1,
    noDeductionReleasedCount: 2,
    makeupAvailableCount: 2,
  })).toBe('주간 배정 2회 · 직접 예약 1회 · 직접 예약 가능 2회');
});

test('group ticket summary wording separates registered and free booking permissions', () => {
  expect(formatGroupTicketScheduleSummary({
    futureFixedAllocatedCount: 2,
    availableFreeBookingCount: 6,
    makeupAvailableCount: 6,
  }, { packageType: 'group', allowGroupFreeBooking: true })).toBe(
    '반 등록 수업 2회 · 자유 예약 가능 6회'
  );

  expect(formatGroupTicketScheduleSummary({
    futureFixedAllocatedCount: 2,
    availableFreeBookingCount: 6,
    makeupAvailableCount: 6,
  }, { packageType: 'group' })).toBe('반 등록 수업 2회');

  expect(formatGroupTicketScheduleSummary({
    availableFreeBookingCount: 4,
    makeupAvailableCount: 4,
  }, { packageType: 'openGroup' })).toBe('자유 예약 가능 4회');
});

test('empty ticket summary shows registration needed labels', () => {
  const viewModel = buildStudentTicketSummaryViewModel({
    packages: [],
    privateLessons: [],
    privateReservations: [],
    groupReservations: [],
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
  });
  expect(viewModel.hasPrivateTicket).toBe(false);
  expect(viewModel.hasGroupTicket).toBe(false);
});

test('student booking identity line prefers linked student name', () => {
  expect(
    resolveLinkedStudentDisplayName({
      membershipDisplayName: '개인고정&보충테스트',
      privateStudentRecord: { name: 'privateStudents name' },
      packageStudentName: 'package name',
    })
  ).toBe('개인고정&보충테스트');

  expect(
    formatStudentBookingIdentityLine({
      academyName: 'Daegu Miami',
      studentName: '개인고정&보충테스트',
      email: 'xtune5@naver.com',
    })
  ).toBe('Daegu Miami · 개인고정&보충테스트 · xtune5@naver.com');
});

test('student booking page wiring exposes identity and ticket summary without billing fields', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'StudentBookingPage.jsx'), 'utf8');
  const privateSlotTestSource = fs.readFileSync(
    path.join(process.cwd(), 'tests/private-slot-reservation-intended.spec.js'),
    'utf8'
  );
  expect(source).toContain('data-testid="student-booking-identity-line"');
  expect(source).toContain('data-testid="student-ticket-summary-section"');
  expect(source).toContain('data-testid="student-private-ticket-summary-schedule"');
  expect(source).toContain('data-testid="student-private-ticket-summary-coverage"');
  expect(source).toContain('coverageText');
  expect(source).toContain('사용 가능한 개인 수강권이 없습니다.');
  expect(source).toContain('buildStudentTicketSummaryViewModel');
  expect(source).toContain('privateCalendarWeeks');
  expect(source).toContain('전체 시간 보기');
  expect(source).toContain('예약 오픈 대기');
  expect(privateSlotTestSource).toContain('package_date_out_of_range');
  expect(privateSlotTestSource).toContain('수강권 기간 밖');
  expect(source).not.toMatch(/amountPaid|결제 금액|payment|billingAmount/i);
});
