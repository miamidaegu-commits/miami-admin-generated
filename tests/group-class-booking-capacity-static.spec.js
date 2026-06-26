import { test, expect } from '@playwright/test';
import { getGroupLessonSeatAvailability } from '../src/features/booking/groupSeatAvailability.js';
import {
  getGroupClassBookingCapacitySummary,
} from '../src/features/dashboard/groupClassRoomUtils.js';

test('group class booking capacity reserves fixed seats before FCFS seats', () => {
  expect(
    getGroupClassBookingCapacitySummary({
      maxStudents: 4,
      activeFixedMemberCount: 3,
    })
  ).toEqual({
    capacity: 4,
    fixedMemberCount: 3,
    fcfsRemainingSeats: 1,
  });

  const availability = getGroupLessonSeatAvailability({
    lesson: { capacity: 4, bookedCount: 0 },
    fixedMembers: [{ studentId: 's1' }, { studentId: 's2' }, { studentId: 's3' }],
    reservations: [{ studentId: 'guest-1', status: 'active' }],
  });

  expect(availability.fixedAttendingCount).toBe(3);
  expect(availability.guestReservedCount).toBe(1);
  expect(availability.remainingSeats).toBe(0);
  expect(availability.isFull).toBe(true);
});
