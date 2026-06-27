import { test, expect } from '@playwright/test';
import { formatGroupTicketScheduleSummary } from '../src/features/booking/studentTicketSummary.js';

test('group ticket schedule summary uses registration wording', () => {
  expect(
    formatGroupTicketScheduleSummary({
      futureFixedAllocatedCount: 3,
      availableFreeBookingCount: 2,
      makeupAvailableCount: 2,
    }, { packageType: 'group', allowGroupFreeBooking: true })
  ).toBe('반 등록 수업 3회 · 자유 예약 가능 2회');
});
