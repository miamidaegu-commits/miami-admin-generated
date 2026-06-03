import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  buildStudentPrivateTicketSummaries,
  buildStudentTicketSummaryViewModel,
  formatPrivateTicketScheduleSummary,
  formatStudentBookingIdentityLine,
  resolveLinkedStudentDisplayName,
} from '../src/features/booking/studentTicketSummary.js';

const ACADEMY_ID = 'academy_e2e_default';
const STUDENT_ID = 'e2e-student-ticket-summary';
const NOW = Date.UTC(2026, 4, 28, 0, 0, 0);

function privateLesson(id, overrides = {}) {
  return {
    id,
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
    teacher: 'don1',
    teacherName: 'don1',
    packageType: 'private',
    date: '2026-06-05',
    time: '15:00',
    startAt: new Date(NOW + Number(id.replace(/\D/g, '') || 1) * 86400000),
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
    date: '2026-06-10',
    time: '11:00',
    startAt: new Date(NOW + 20 * 86400000),
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
    topUpCount: 1,
    registrationHistory: [
      { registrationRound: 1, deltaCount: 4 },
      { registrationLabel: '5개월 할인 등록', deltaCount: 5 },
    ],
  };
  const lessons = [
    privateLesson('past', {
      date: '2026-05-29',
      time: '15:00',
      isDeductCancelled: true,
      packageId: ticket.id,
      startAt: new Date(NOW - 86400000),
    }),
    privateLesson('f1', {
      packageId: ticket.id,
      date: '2026-06-05',
      time: '15:00',
      startAt: new Date(NOW + 8 * 86400000),
    }),
    privateLesson('f2', {
      packageId: ticket.id,
      date: '2026-06-12',
      time: '15:00',
      startAt: new Date(NOW + 15 * 86400000),
    }),
    privateLesson('f3', {
      packageId: ticket.id,
      date: '2026-06-19',
      time: '15:00',
      startAt: new Date(NOW + 22 * 86400000),
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
    scheduleText: '고정 예정 3회 · 보충 가능 1회',
    registrationSummaryText: '등록 내역: 1회차 +4회, 5개월 할인 등록 +5회',
  });

  const afterBooking = buildStudentPrivateTicketSummaries({
    packages: [ticket],
    privateLessons: lessons,
    privateReservations: [privateReservation('r1', { packageId: ticket.id })],
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
  });
  expect(afterBooking[0].scheduleText).toBe('고정 예정 3회 · 보충 예약 1회 · 예약 가능 0회');

  const afterCancel = buildStudentPrivateTicketSummaries({
    packages: [ticket],
    privateLessons: lessons,
    privateReservations: [privateReservation('r1', { packageId: ticket.id, status: 'cancelled' })],
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
  });
  expect(afterCancel[0].scheduleText).toBe('고정 예정 3회 · 보충 가능 1회');
});

test('general unused private package shows 예약 가능 not 보충 가능', () => {
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
  expect(viewModel.privateSummaries[0].scheduleText).toBe('고정 예정 0회 · 예약 가능 8회');
  expect(formatPrivateTicketScheduleSummary({
    futureFixedAllocatedCount: 0,
    activeFutureReservationCount: 0,
    noDeductionReleasedCount: 0,
    makeupAvailableCount: 8,
  })).toBe('고정 예정 0회 · 예약 가능 8회');
});

test('private ticket summary copy separates fixed assignments from remaining balance', () => {
  expect(formatPrivateTicketScheduleSummary({
    futureFixedAllocatedCount: 2,
    activeFutureReservationCount: 0,
    noDeductionReleasedCount: 0,
    makeupAvailableCount: 3,
  })).toBe('고정 예정 2회 · 예약 가능 3회');

  expect(formatPrivateTicketScheduleSummary({
    futureFixedAllocatedCount: 2,
    activeFutureReservationCount: 1,
    noDeductionReleasedCount: 2,
    makeupAvailableCount: 2,
  })).toBe('고정 예정 2회 · 보충 예약 1회 · 보충 가능 2회');
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
  expect(source).toContain('data-testid="student-booking-identity-line"');
  expect(source).toContain('data-testid="student-ticket-summary-section"');
  expect(source).toContain('data-testid="student-private-ticket-summary-schedule"');
  expect(source).toContain('buildStudentTicketSummaryViewModel');
  expect(source).not.toMatch(/amountPaid|결제 금액|payment|billingAmount/i);
});
