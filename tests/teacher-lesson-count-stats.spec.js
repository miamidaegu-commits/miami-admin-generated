import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildLessonOccurrenceStats,
  buildTeacherLessonOccurrenceStats,
  getLessonOccurrenceKey,
  getLessonStatsMonthRange,
} from '../src/features/dashboard/lessonOccurrenceStats.js';
import { buildPrivateLessonDashboardStats } from '../src/features/dashboard/privateLessonDashboardStats.js';

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

  assert.deepEqual(stats.today, { total: 5, privateCount: 4, groupCount: 1 });
  assert.deepEqual(stats.month, { total: 7, privateCount: 5, groupCount: 2 });
  assert.equal(getLessonOccurrenceKey(buildFixtureRows()[6]),
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

  assert.deepEqual(alice.stats.today, { total: 4, privateCount: 3, groupCount: 1 });
  assert.deepEqual(alice.stats.month, { total: 6, privateCount: 4, groupCount: 2 });
  assert.deepEqual(bob.stats.today, { total: 1, privateCount: 1, groupCount: 0 });
  assert.deepEqual(bob.stats.month, { total: 1, privateCount: 1, groupCount: 0 });
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

  assert.equal(currentStats.month.total, 7);
  assert.equal(pastStats.month.total, 1);
  assert.equal(futureRange.endYmd, '');
});

test('teacher stats skip malformed rows without blocking valid rows', () => {
  const malformedDate = {
    id: 'malformed-date',
    teacher: 'Alice',
    studentName: '깨진 날짜',
    startAt: {
      toDate() {
        throw new Error('broken timestamp');
      },
    },
  };
  const result = buildTeacherLessonOccurrenceStats({
    rows: [
      malformedDate,
      null,
      { id: 'valid-row', teacher: 'Alice', studentName: '학생', date: '2026-06-15' },
    ],
    teachers,
    monthDate: new Date('2026-06-01T00:00:00+09:00'),
    todayYmd: '2026-06-15',
  });
  const alice = result.teacherRows.find((row) => row.teacherName === 'Alice');

  assert.equal(result.overall.today.total, 1);
  assert.equal(result.overall.month.total, 1);
  assert.equal(alice.stats.today.total, 1);
  assert.equal(alice.stats.month.total, 1);
});

const SNAPSHOT_NOW = new Date('2026-03-15T03:00:00.000Z');

function privateOccurrence(id, overrides = {}) {
  return {
    id,
    teacherUid: 'teacher-1',
    studentId: 'student-1',
    packageId: 'package-1',
    date: '2026-03-15',
    startTime: '13:00',
    lessonType: 'private',
    status: 'scheduled',
    deductionEligible: true,
    ...overrides,
  };
}

function privatePackage(overrides = {}) {
  return {
    id: 'package-1',
    teacherUid: 'teacher-1',
    studentId: 'student-1',
    type: 'private',
    status: 'active',
    remainingCount: 1,
    ...overrides,
  };
}

function snapshotStats({
  occurrences = [privateOccurrence('lesson-1')],
  packages = [privatePackage()],
  teacherUid = 'teacher-1',
  now = SNAPSHOT_NOW,
} = {}) {
  return buildPrivateLessonDashboardStats({ occurrences, packages, teacherUid, now });
}

test('snapshot 01 uses the KST calendar day at the UTC boundary', () => {
  const stats = snapshotStats({
    now: new Date('2026-03-14T15:30:00.000Z'),
    occurrences: [
      privateOccurrence('kst-today', { date: '2026-03-15', startTime: '01:00' }),
      privateOccurrence('utc-yesterday', { date: '2026-03-14', startTime: '23:30' }),
    ],
  });
  assert.equal(stats.todayPrivateCount, 1);
});

test('snapshot 02 requires exact occurrence and package teacherUid instead of names', () => {
  const stats = snapshotStats({
    occurrences: [
      privateOccurrence('wrong-uid', { teacherUid: 'teacher-2', teacher: 'Alice' }),
      privateOccurrence('missing-uid', { teacherUid: undefined, teacher: 'Alice' }),
      privateOccurrence('right-uid'),
    ],
    packages: [
      privatePackage({ teacherUid: 'teacher-2', teacher: 'Alice' }),
      privatePackage(),
    ],
  });
  assert.equal(stats.todayPrivateCount, 1);
  assert.equal(stats.excludedLegacyCount, 1);
});

test('snapshot 03 excludes group occurrences', () => {
  const stats = snapshotStats({
    occurrences: [
      privateOccurrence('private'),
      privateOccurrence('group', { lessonType: 'group', teacherUid: undefined }),
    ],
  });
  assert.equal(stats.todayPrivateCount, 1);
  assert.equal(stats.excludedLegacyCount, 0);
});

test('snapshot 04 includes valid scheduled and completed occurrences', () => {
  const stats = snapshotStats({
    occurrences: [
      privateOccurrence('scheduled'),
      privateOccurrence('completed', { status: 'completed' }),
    ],
  });
  assert.equal(stats.todayPrivateCount, 2);
});

test('snapshot 05 excludes cancelled deleted and holiday occurrences', () => {
  const stats = snapshotStats({
    occurrences: [
      privateOccurrence('cancelled', { status: 'cancelled' }),
      privateOccurrence('deleted', { status: 'deleted' }),
      privateOccurrence('holiday', { isHoliday: true }),
      privateOccurrence('valid'),
    ],
  });
  assert.equal(stats.todayPrivateCount, 1);
});

test('snapshot 06 excludes no-deduction occurrences from snapshot counts', () => {
  const stats = snapshotStats({
    occurrences: [
      privateOccurrence('no-deduct', { deductionEligible: false }),
      privateOccurrence('valid'),
    ],
  });
  assert.equal(stats.todayPrivateCount, 1);
  assert.equal(stats.monthlyPrivateCount, 1);
});

test('snapshot 07 dedupes migrated reservation and lesson rows by canonical identity', () => {
  const stats = snapshotStats({
    occurrences: [
      privateOccurrence('reservation-row', {
        reservationId: 'reservation-1',
        lessonId: 'lesson-1',
      }),
      privateOccurrence('lesson-row', {
        reservationId: 'reservation-1',
        lessonId: 'lesson-1',
        source: 'reservation',
      }),
    ],
  });
  assert.equal(stats.todayPrivateCount, 1);
});

test('snapshot 08 monthly count uses current KST month start through today', () => {
  const stats = snapshotStats({
    occurrences: [
      privateOccurrence('month-start', { date: '2026-03-01' }),
      privateOccurrence('today'),
      privateOccurrence('previous-month', { date: '2026-02-28' }),
      privateOccurrence('future-day', { date: '2026-03-16' }),
    ],
  });
  assert.equal(stats.monthlyPrivateCount, 2);
});

test('snapshot 09 monthly count is independent from a selected calendar month', () => {
  const stats = buildPrivateLessonDashboardStats({
    occurrences: [privateOccurrence('today')],
    packages: [privatePackage()],
    teacherUid: 'teacher-1',
    now: SNAPSHOT_NOW,
    calendarMonth: new Date('2025-01-01T00:00:00.000Z'),
  });
  assert.equal(stats.monthlyPrivateCount, 1);
});

test('snapshot 10 prefers canonical current deduction state', () => {
  const stats = snapshotStats({
    occurrences: [
      privateOccurrence('canonical-undo', {
        currentDeductionState: 'cancelled',
        isDeductCancelled: false,
      }),
      privateOccurrence('canonical-applied', {
        currentDeductionState: 'applied',
        isDeductCancelled: true,
      }),
    ],
  });
  assert.equal(stats.deductionCancelledCount, 1);
});

test('snapshot 11 falls back to the current isDeductCancelled flag', () => {
  const stats = snapshotStats({
    occurrences: [
      privateOccurrence('fallback-undo', { isDeductCancelled: true }),
      privateOccurrence('fallback-applied', { isDeductCancelled: false }),
    ],
  });
  assert.equal(stats.deductionCancelledCount, 1);
});

test('snapshot 12 counts a deduction cancellation at most once per occurrence', () => {
  const stats = snapshotStats({
    occurrences: [
      privateOccurrence('undo-a', {
        reservationId: 'reservation-undo',
        currentDeductionState: 'cancelled',
      }),
      privateOccurrence('undo-b', {
        reservationId: 'reservation-undo',
        currentDeductionState: 'cancelled',
      }),
    ],
  });
  assert.equal(stats.deductionCancelledCount, 1);
});

test('snapshot 13 counts final lesson when one valid occurrence meets remaining one', () => {
  assert.equal(snapshotStats().finalLessonCount, 1);
});

test('snapshot 14 counts final lesson when two valid occurrences meet remaining two', () => {
  const stats = snapshotStats({
    occurrences: [
      privateOccurrence('first', { startTime: '13:00' }),
      privateOccurrence('second', { startTime: '14:00' }),
    ],
    packages: [privatePackage({ remainingCount: 2 })],
  });
  assert.equal(stats.finalLessonCount, 1);
});

test('snapshot 15 does not forecast final when valid occurrences exceed remaining', () => {
  const stats = snapshotStats({
    occurrences: [
      privateOccurrence('first', { startTime: '13:00' }),
      privateOccurrence('second', { startTime: '14:00' }),
      privateOccurrence('third', { startTime: '15:00' }),
    ],
    packages: [privatePackage({ remainingCount: 2 })],
  });
  assert.equal(stats.finalLessonCount, 0);
});

test('snapshot 16 uses only now-or-future occurrences for final forecast', () => {
  const stats = snapshotStats({
    occurrences: [
      privateOccurrence('past', { startTime: '10:00' }),
      privateOccurrence('future', { startTime: '13:00' }),
    ],
    packages: [privatePackage({ remainingCount: 1 })],
  });
  assert.equal(stats.finalLessonCount, 1);
});

test('snapshot 17 groups final forecast by canonical student and package', () => {
  const stats = snapshotStats({
    occurrences: [
      privateOccurrence('student-1', { studentId: 'student-1', packageId: 'package-1' }),
      privateOccurrence('student-2', { studentId: 'student-2', packageId: 'package-2' }),
    ],
    packages: [
      privatePackage({ id: 'package-1', studentId: 'student-1' }),
      privatePackage({ id: 'package-2', studentId: 'student-2' }),
    ],
  });
  assert.equal(stats.finalLessonCount, 2);
});

test('snapshot 18 counts the same student package pair at most once', () => {
  const stats = snapshotStats({
    occurrences: [
      privateOccurrence('first', { startTime: '13:00' }),
      privateOccurrence('second', { startTime: '14:00' }),
    ],
    packages: [privatePackage({ remainingCount: 2 })],
  });
  assert.equal(stats.finalLessonCount, 1);
});

test('snapshot 19 excludes inactive non-private and wrong-teacher packages', () => {
  const packages = [
    privatePackage({ id: 'package-1', status: 'cancelled' }),
    privatePackage({ id: 'package-2', studentId: 'student-2', type: 'group' }),
    privatePackage({ id: 'package-3', studentId: 'student-3', teacherUid: 'teacher-2' }),
  ];
  const occurrences = [
    privateOccurrence('inactive', { packageId: 'package-1' }),
    privateOccurrence('group-package', { packageId: 'package-2', studentId: 'student-2' }),
    privateOccurrence('wrong-teacher', { packageId: 'package-3', studentId: 'student-3' }),
  ];
  assert.equal(snapshotStats({ occurrences, packages }).finalLessonCount, 0);
});

test('snapshot 20 requires the occurrence to link the proper package and student', () => {
  const stats = snapshotStats({
    occurrences: [
      privateOccurrence('wrong-package', { packageId: 'package-2' }),
      privateOccurrence('wrong-student', { studentId: 'student-2' }),
    ],
  });
  assert.equal(stats.finalLessonCount, 0);
});

test('snapshot 21 treats current remaining count as the top-up and renewal snapshot', () => {
  const occurrences = [
    privateOccurrence('first', { startTime: '13:00' }),
    privateOccurrence('second', { startTime: '14:00' }),
  ];
  assert.equal(
    snapshotStats({
      occurrences,
      packages: [privatePackage({ remainingCount: 2, topUpCount: 10 })],
    }).finalLessonCount,
    1
  );
  assert.equal(
    snapshotStats({
      occurrences,
      packages: [privatePackage({ remainingCount: 3, renewalBatchId: 'renewed' })],
    }).finalLessonCount,
    0
  );
});

test('snapshot 22 excludes unsafe occurrence and package identities as legacy', () => {
  const stats = snapshotStats({
    occurrences: [
      privateOccurrence('missing-student', { studentId: undefined }),
      privateOccurrence('missing-package', { packageId: undefined }),
      privateOccurrence('', { id: undefined }),
      privateOccurrence('valid'),
    ],
    packages: [
      privatePackage({ id: undefined }),
      privatePackage({ id: 'package-legacy', studentId: undefined }),
      privatePackage(),
    ],
  });
  assert.equal(stats.todayPrivateCount, 1);
  assert.equal(stats.excludedLegacyCount, 5);
});

test('snapshot 23 is deterministic and does not mutate occurrences or packages', () => {
  const occurrences = [
    privateOccurrence('second', { startTime: '14:00' }),
    privateOccurrence('first', { startTime: '13:00' }),
  ];
  const packages = [privatePackage({ remainingCount: 2 })];
  const beforeOccurrences = structuredClone(occurrences);
  const beforePackages = structuredClone(packages);
  const first = snapshotStats({ occurrences, packages });
  const second = snapshotStats({ occurrences, packages });

  assert.deepEqual(first, second);
  assert.deepEqual(occurrences, beforeOccurrences);
  assert.deepEqual(packages, beforePackages);
});
