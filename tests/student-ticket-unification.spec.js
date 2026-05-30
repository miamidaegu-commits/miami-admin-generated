import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  computeGroupTicketBalance,
  computePrivateTicketBalance,
} from '../src/features/dashboard/ticketBalanceHelpers.js';

const ACADEMY_ID = 'academy_e2e_default';
const STUDENT_ID = 'e2e-unified-ticket-student';
const NOW = Date.UTC(2026, 4, 28, 0, 0, 0);

function futureDate(index) {
  return new Date(NOW + index * 24 * 60 * 60 * 1000);
}

function privateLesson(id, overrides = {}) {
  return {
    id,
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
    teacher: 'Don1',
    teacherKey: 'don1',
    date: '2026-06-01',
    time: '10:00',
    startAt: futureDate(Number(id.replace(/\D/g, '') || 1)),
    ...overrides,
  };
}

function privateReservation(id, overrides = {}) {
  return {
    id,
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
    teacher: 'Don1',
    teacherKey: 'don1',
    status: 'active',
    date: '2026-06-10',
    time: '11:00',
    startAt: futureDate(20),
    ...overrides,
  };
}

function groupLesson(id, overrides = {}) {
  return {
    id,
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
    groupClassId: 'group-fixed',
    groupCourseType: 'free_talking',
    date: '2026-06-01',
    time: '15:00',
    startAt: futureDate(Number(id.replace(/\D/g, '') || 1)),
    ...overrides,
  };
}

function groupReservation(id, overrides = {}) {
  return {
    id,
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
    groupClassId: 'group-flex',
    groupCourseType: 'free_talking',
    status: 'active',
    date: '2026-06-11',
    time: '16:00',
    startAt: futureDate(21),
    ...overrides,
  };
}

test('private fixed and flexible usage share one private ticket balance', () => {
  const ticket = {
    id: 'private-ticket',
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
    packageType: 'private',
    teacher: 'Don1',
    teacherKey: 'don1',
    totalCount: 4,
    usedCount: 0,
    remainingCount: 4,
  };
  const fixedPrivateLessons = [1, 2, 3, 4].map((index) => privateLesson(`p${index}`));

  const fullyAllocated = computePrivateTicketBalance({
    ticket,
    fixedPrivateLessons,
    privateReservations: [],
    studentId: STUDENT_ID,
    teacherScope: { teacher: 'Don1', teacherKey: 'don1' },
    now: NOW,
  });
  expect(fullyAllocated).toMatchObject({
    remainingCount: 4,
    futureFixedAllocatedCount: 4,
    activeFutureReservationCount: 0,
    availableToBook: 0,
    statusLabel: '보충 가능 0회',
    actionLabel: '선택예약 가능 0회',
  });

  const released = fixedPrivateLessons.map((lesson, index) =>
    index === 0 ? { ...lesson, isDeductCancelled: true } : lesson
  );
  const oneReleased = computePrivateTicketBalance({
    ticket,
    fixedPrivateLessons: released,
    privateReservations: [],
    studentId: STUDENT_ID,
    teacherScope: { teacher: 'Don1', teacherKey: 'don1' },
    now: NOW,
  });
  expect(oneReleased.availableToBook).toBe(1);
  expect(oneReleased.statusLabel).toBe('보충 가능 1회');

  const oneBooked = computePrivateTicketBalance({
    ticket,
    fixedPrivateLessons: released,
    privateReservations: [privateReservation('r1', { packageId: ticket.id })],
    studentId: STUDENT_ID,
    teacherScope: { teacher: 'Don1', teacherKey: 'don1' },
    now: NOW,
  });
  expect(oneBooked).toMatchObject({
    activeFutureReservationCount: 1,
    availableToBook: 0,
    statusLabel: '보충 가능 0회',
  });

  const pastActiveBooking = computePrivateTicketBalance({
    ticket,
    fixedPrivateLessons: released,
    privateReservations: [
      privateReservation('r-past', {
        packageId: ticket.id,
        date: '2026-05-01',
        time: '23:30',
      }),
    ],
    studentId: STUDENT_ID,
    teacherScope: { teacher: 'Don1', teacherKey: 'don1' },
    now: NOW,
  });
  expect(pastActiveBooking).toMatchObject({
    activeFutureReservationCount: 1,
    availableToBook: 0,
  });

  const confirmedBooking = computePrivateTicketBalance({
    ticket,
    fixedPrivateLessons: released,
    privateReservations: [privateReservation('r-confirmed', { packageId: ticket.id, status: 'confirmed' })],
    studentId: STUDENT_ID,
    teacherScope: { teacher: 'Don1', teacherKey: 'don1' },
    now: NOW,
  });
  expect(confirmedBooking.availableToBook).toBe(0);

  const legacyUidOnlyFixedLessons = released.map((lesson, index) => ({
    ...lesson,
    teacher: 'Don',
    teacherName: 'Don',
    teacherKey: '',
    teacherUID: 'teacher-uid-don1',
    packageId: index === 1 ? ticket.id : 'legacy-private-ticket',
  }));
  const legacyUidTicket = {
    ...ticket,
    teacher: 'Don',
    teacherName: 'Don',
    teacherKey: 'don1',
    teacherUid: 'teacher-uid-don1',
  };
  const legacyUidBalance = computePrivateTicketBalance({
    ticket: legacyUidTicket,
    fixedPrivateLessons: legacyUidOnlyFixedLessons,
    privateReservations: [
      privateReservation('r-uid', {
        packageId: ticket.id,
        teacher: 'Don',
        teacherName: 'Don',
        teacherKey: '',
        teacherUID: 'teacher-uid-don1',
      }),
    ],
    studentId: STUDENT_ID,
    teacherScope: { teacherKey: 'don1', teacherUid: 'teacher-uid-don1' },
    now: NOW,
  });
  expect(legacyUidBalance).toMatchObject({
    futureFixedAllocatedCount: 3,
    activeFutureReservationCount: 1,
    availableToBook: 0,
  });

  const productionLikePastSlotBalance = computePrivateTicketBalance({
    ticket: legacyUidTicket,
    fixedPrivateLessons: legacyUidOnlyFixedLessons.map((lesson, index) =>
      index === 0
        ? lesson
        : {
            ...lesson,
            date: `2026-06-0${index + 1}`,
            time: '10:00',
            startAt: undefined,
          }
    ),
    privateReservations: [
      privateReservation('r-prod-past-slot', {
        packageId: legacyUidTicket.id,
        teacher: 'don1',
        teacherName: 'don1',
        teacherKey: 'don1',
        date: '2026-06-01',
        time: '23:30',
        startAt: undefined,
      }),
    ],
    studentId: STUDENT_ID,
    teacherScope: { teacherKey: 'don1', teacherUid: 'teacher-uid-don1' },
    now: Date.UTC(2026, 5, 1, 14, 31, 0),
  });
  expect(productionLikePastSlotBalance).toMatchObject({
    futureFixedAllocatedCount: 3,
    activeFutureReservationCount: 1,
    availableToBook: 0,
  });

  const cancelledBooking = computePrivateTicketBalance({
    ticket,
    fixedPrivateLessons: released,
    privateReservations: [privateReservation('r1', { packageId: ticket.id, status: 'cancelled' })],
    studentId: STUDENT_ID,
    teacherScope: { teacher: 'Don1', teacherKey: 'don1' },
    now: NOW,
  });
  expect(cancelledBooking.availableToBook).toBe(1);
});

test('group fixed and flexible usage share one group ticket balance', () => {
  const ticket = {
    id: 'group-ticket',
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
    packageType: 'group',
    groupCourseType: 'free_talking',
    totalCount: 4,
    usedCount: 0,
    remainingCount: 4,
  };
  const fixedGroupLessons = [1, 2, 3, 4].map((index) =>
    groupLesson(`g${index}`, { packageId: ticket.id })
  );

  const fullyAllocated = computeGroupTicketBalance({
    ticket,
    fixedGroupLessons,
    groupReservations: [],
    studentId: STUDENT_ID,
    groupScope: { groupCourseType: 'free_talking' },
    now: NOW,
  });
  expect(fullyAllocated).toMatchObject({
    remainingCount: 4,
    futureFixedAllocatedCount: 4,
    activeFutureReservationCount: 0,
    availableToBook: 0,
    statusLabel: '보충 가능 0회',
    actionLabel: '선택예약 가능 0회',
  });

  const released = fixedGroupLessons.map((lesson, index) =>
    index === 0 ? { ...lesson, noDeduction: true } : lesson
  );
  const oneReleased = computeGroupTicketBalance({
    ticket,
    fixedGroupLessons: released,
    groupReservations: [],
    studentId: STUDENT_ID,
    groupScope: { groupCourseType: 'free_talking' },
    now: NOW,
  });
  expect(oneReleased.availableToBook).toBe(1);
  expect(oneReleased.statusLabel).toBe('보충 가능 1회');

  const oneBooked = computeGroupTicketBalance({
    ticket,
    fixedGroupLessons: released,
    groupReservations: [groupReservation('gr1', { packageId: ticket.id })],
    studentId: STUDENT_ID,
    groupScope: { groupCourseType: 'free_talking' },
    now: NOW,
  });
  expect(oneBooked).toMatchObject({
    activeFutureReservationCount: 1,
    availableToBook: 0,
    statusLabel: '보충 가능 0회',
  });

  const cancelledBooking = computeGroupTicketBalance({
    ticket,
    fixedGroupLessons: released,
    groupReservations: [groupReservation('gr1', { packageId: ticket.id, status: 'cancelled' })],
    studentId: STUDENT_ID,
    groupScope: { groupCourseType: 'free_talking' },
    now: NOW,
  });
  expect(cancelledBooking.availableToBook).toBe(1);
});

test('ticket labels distinguish missing, ambiguous, exhausted, allocated, and available states', () => {
  expect(
    computePrivateTicketBalance({
      ticket: null,
      fixedPrivateLessons: [],
      privateReservations: [],
      studentId: STUDENT_ID,
      teacherScope: { teacher: 'Don1' },
    }).statusLabel
  ).toBe('수강권 등록 필요');
  expect(
    computePrivateTicketBalance({
      ticket: null,
      fixedPrivateLessons: [],
      privateReservations: [],
      studentId: STUDENT_ID,
      teacherScope: { teacher: 'Don1' },
      ambiguousLegacyMatch: true,
    }).statusLabel
  ).toBe('수강권 연결 필요');
  expect(
    computeGroupTicketBalance({
      ticket: {
        id: 'exhausted',
        academyId: ACADEMY_ID,
        studentId: STUDENT_ID,
        packageType: 'group',
        groupClassId: 'group-fixed',
        totalCount: 4,
        usedCount: 4,
        remainingCount: 0,
      },
      fixedGroupLessons: [],
      groupReservations: [],
      studentId: STUDENT_ID,
      groupScope: { groupClassId: 'group-fixed' },
    }).statusLabel
  ).toBe('소진');
});

test('server and UI are wired to unified ticket vocabulary and group enforcement', () => {
  const functionsSource = fs.readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');
  const bookingSource = fs.readFileSync(path.join(process.cwd(), 'StudentBookingPage.jsx'), 'utf8');
  const auditSource = fs.readFileSync(
    path.join(process.cwd(), 'scripts/dry-run-student-ticket-unification-audit.cjs'),
    'utf8'
  );

  expect(functionsSource).toContain('function computeGroupTicketBalance');
  expect(functionsSource).toContain('getGroupTicketBalanceForLesson');
  expect(functionsSource).toContain('packageId: ticketResult.ticket.id');
  expect(functionsSource).toContain('"수강권 등록 필요"');
  expect(functionsSource).toContain('선택예약 가능');
  expect(bookingSource).toContain('groupTicketAvailableToBook');
  expect(bookingSource).toContain('groupTicketStatusLabel');
  expect(bookingSource).not.toContain('수강권 미등록');
  expect(auditSource).toContain('legacy group ticket missing courseType/groupClassIds scope fields');
  expect(auditSource).toContain('--apply is intentionally not implemented');
});
