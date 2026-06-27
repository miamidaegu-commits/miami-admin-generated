import { test, expect } from '@playwright/test';
import {
  computeGroupTicketBalance,
  isGroupTicketFreeBookingAllowed,
} from '../src/features/dashboard/ticketBalanceHelpers.js';

test('group free booking permission defaults off for registered group packages', () => {
  expect(isGroupTicketFreeBookingAllowed({ packageType: 'group' })).toBe(false);
  expect(
    isGroupTicketFreeBookingAllowed({
      packageType: 'group',
      allowGroupFreeBooking: true,
    })
  ).toBe(true);
  expect(isGroupTicketFreeBookingAllowed({ packageType: 'openGroup' })).toBe(true);
});

test('group free booking count subtracts registered lessons and free reservations', () => {
  const ticket = {
    id: 'group-ticket-1',
    academyId: 'academy-1',
    studentId: 'student-1',
    packageType: 'group',
    allowGroupFreeBooking: true,
    groupClassId: 'group-a',
    groupCourseType: '일반 영어회화',
    totalCount: 12,
    usedCount: 0,
    remainingCount: 12,
  };

  const balance = computeGroupTicketBalance({
    ticket,
    academyId: 'academy-1',
    studentId: 'student-1',
    fixedGroupLessons: Array.from({ length: 7 }, (_, index) => ({
      id: `fixed-${index}`,
      academyId: 'academy-1',
      studentId: 'student-1',
      packageId: 'group-ticket-1',
      date: '2999-01-01',
    })),
    groupReservations: [
      {
        id: 'reservation-1',
        academyId: 'academy-1',
        studentId: 'student-1',
        packageId: 'group-ticket-1',
        status: 'active',
        date: '2999-01-02',
      },
    ],
  });

  expect(balance.futureFixedAllocatedCount).toBe(7);
  expect(balance.activeFutureReservationCount).toBe(1);
  expect(balance.availableFreeBookingCount).toBe(4);
});

test('registered group packages without permission cannot free book', () => {
  const balance = computeGroupTicketBalance({
    ticket: {
      id: 'group-ticket-2',
      academyId: 'academy-1',
      studentId: 'student-1',
      packageType: 'group',
      totalCount: 12,
      usedCount: 0,
      remainingCount: 12,
    },
    academyId: 'academy-1',
    studentId: 'student-1',
  });

  expect(balance.availableFreeBookingCount).toBe(0);
  expect(balance.makeupAvailableCount).toBe(0);
});
