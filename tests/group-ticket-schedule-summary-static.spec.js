import { test, expect } from '@playwright/test';
import { formatGroupTicketScheduleSummary } from '../src/features/booking/studentTicketSummary.js';

test('group ticket schedule summary uses registration wording', () => {
  expect(
    formatGroupTicketScheduleSummary({
      futureFixedAllocatedCount: 3,
      activeFutureReservationCount: 1,
      makeupAvailableCount: 2,
    })
  ).toBe('등록 예정 3회 · 선택예약 1회 · 선택예약 가능 2회');
});
