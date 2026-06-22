import { test, expect } from '@playwright/test';
import {
  buildLessonOccurrenceStats,
  buildTeacherLessonOccurrenceStats,
  getLessonOccurrenceKey,
  getLessonStatsMonthRange,
} from '../src/features/dashboard/lessonOccurrenceStats.js';

const teachers = [
  {
    value: 'alice',
    label: 'Alice',
    displayName: 'Alice',
    teacher: 'Alice',
    teacherName: 'Alice',
  },
  {
    value: 'bob',
    label: 'Bob',
    displayName: 'Bob',
    teacher: 'Bob',
    teacherName: 'Bob',
  },
];

function buildFixtureRows() {
  return [
    { id: 'p-today', teacher: 'Alice', studentName: '학생1', date: '2026-06-15', time: '10:00' },
    { id: 'p-month', teacher: 'Alice', studentName: '학생2', date: '2026-06-05', time: '11:00' },
    { id: 'p-bob', teacher: 'Bob', studentName: '학생3', date: '2026-06-15', time: '12:00' },
    {
      id: 'p-cancelled',
      teacher: 'Alice',
      studentName: '학생4',
      date: '2026-06-15',
      status: 'cancelled',
    },
    {
      id: 'p-no-deduction',
      teacher: 'Alice',
      studentName: '학생5',
      date: '2026-06-15',
      isDeductCancelled: true,
    },
    {
      id: 'p-released',
      teacher: 'Alice',
      studentName: '학생6',
      date: '2026-06-15',
      cancellationType: 'seat_released',
      isSeatReleased: true,
    },
    {
      id: 'p-dupe',
      teacher: 'Alice',
      studentName: '학생7',
      studentId: 'student-7',
      date: '2026-06-15',
      time: '13:00',
      reservationId: 'reservation-dupe',
      slotId: 'slot-dupe',
    },
    { id: 'p-future', teacher: 'Alice', studentName: '학생8', date: '2026-06-21' },
    { id: 'p-past-month', teacher: 'Alice', studentName: '학생9', date: '2026-05-20' },
    {
      id: 'g-today',
      _calendarRowKind: 'group',
      groupClassId: 'group-a',
      teacher: 'Alice',
      date: '2026-06-15',
    },
    {
      id: 'g-month',
      _calendarRowKind: 'group',
      groupClassId: 'group-a',
      teacher: 'Alice',
      date: '2026-06-03',
    },
    {
      id: 'g-no-deduction',
      _calendarRowKind: 'group',
      groupClassId: 'group-a',
      teacher: 'Alice',
      date: '2026-06-15',
      status: 'cancelled',
      noDeduction: true,
      cancellationType: 'no_deduction',
    },
    {
      id: 'g-blocked',
      _calendarRowKind: 'group',
      groupClassId: 'group-a',
      teacher: 'Alice',
      date: '2026-06-15',
      status: 'blocked',
    },
    {
      id: 'g-future',
      _calendarRowKind: 'group',
      groupClassId: 'group-a',
      teacher: 'Alice',
      date: '2026-06-20',
    },
    {
      id: 'reservation-live',
      _calendarRowKind: 'privateReservation',
      slotId: 'slot-live',
      studentName: '학생10',
      teacher: 'Alice',
      date: '2026-06-15',
      time: '14:00',
      status: 'active',
    },
    {
      id: 'reservation-dupe',
      _calendarRowKind: 'privateReservation',
      slotId: 'slot-dupe',
      studentName: '학생7',
      studentId: 'student-7',
      teacher: 'Alice',
      date: '2026-06-15',
      time: '13:00',
      status: 'active',
    },
    {
      id: 'reservation-cancelled',
      _calendarRowKind: 'privateReservation',
      slotId: 'slot-live',
      studentName: '학생11',
      teacher: 'Alice',
      date: '2026-06-15',
      status: 'cancelled',
    },
    {
      id: 'reservation-blocked-slot',
      _calendarRowKind: 'privateReservation',
      slotId: 'slot-blocked',
      studentName: '학생12',
      teacher: 'Alice',
      date: '2026-06-15',
      status: 'active',
      slotStatus: 'blocked',
    },
  ];
}

test('lesson occurrence stats excludes cancelled blocked noDeduction rows and de-dupes private reservations', () => {
  const stats = buildLessonOccurrenceStats({
    rows: buildFixtureRows(),
    monthDate: new Date('2026-06-01T00:00:00+09:00'),
    todayYmd: '2026-06-15',
  });

  expect(stats.today).toEqual({ total: 5, privateCount: 4, groupCount: 1 });
  expect(stats.month).toEqual({ total: 7, privateCount: 5, groupCount: 2 });
  expect(getLessonOccurrenceKey(buildFixtureRows()[6])).toBe(
    getLessonOccurrenceKey(buildFixtureRows()[15])
  );
});

test('teacher lesson occurrence stats keep per-teacher private and group breakdowns', () => {
  const result = buildTeacherLessonOccurrenceStats({
    rows: buildFixtureRows(),
    teachers,
    monthDate: new Date('2026-06-01T00:00:00+09:00'),
    todayYmd: '2026-06-15',
  });
  const alice = result.teacherRows.find((row) => row.teacherName === 'Alice');
  const bob = result.teacherRows.find((row) => row.teacherName === 'Bob');

  expect(alice.stats.today).toEqual({ total: 4, privateCount: 3, groupCount: 1 });
  expect(alice.stats.month).toEqual({ total: 6, privateCount: 4, groupCount: 2 });
  expect(bob.stats.today).toEqual({ total: 1, privateCount: 1, groupCount: 0 });
  expect(bob.stats.month).toEqual({ total: 1, privateCount: 1, groupCount: 0 });
});

test('past month counts the full month while future dates stay out of the current month range', () => {
  const rows = buildFixtureRows();
  const currentStats = buildLessonOccurrenceStats({
    rows,
    monthDate: new Date('2026-06-01T00:00:00+09:00'),
    todayYmd: '2026-06-15',
  });
  const pastStats = buildLessonOccurrenceStats({
    rows,
    monthDate: new Date('2026-05-01T00:00:00+09:00'),
    todayYmd: '2026-06-15',
  });
  const futureRange = getLessonStatsMonthRange({
    monthDate: new Date('2026-07-01T00:00:00+09:00'),
    todayYmd: '2026-06-15',
  });

  expect(currentStats.month.total).toBe(7);
  expect(pastStats.month.total).toBe(1);
  expect(futureRange.endYmd).toBe('');
});
