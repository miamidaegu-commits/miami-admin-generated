import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  buildCalendarVisibleEventCountByDate,
  buildCalendarTeacherFilterOptions,
  buildOpenDatedPrivateSlotCalendarRows,
  excludeOpenPrivateSlotsFromInstructionalStatistics,
  formatCalendarCompactPreviewLabel,
  formatOpenPrivateSlotCompactPreviewText,
  getCalendarDayCountLabelDescriptor,
} from '../src/features/dashboard/hooks/useCalendarSectionViewModel.js'
import {
  buildLessonOccurrenceStats,
  buildTeacherLessonOccurrenceStats,
} from '../src/features/dashboard/lessonOccurrenceStats.js'
import { canViewBillingFields } from '../src/features/dashboard/billingPermissions.js'
import { translate } from '../src/i18n/core.js'
import en from '../src/i18n/resources/en.js'
import ko from '../src/i18n/resources/ko.js'

const repositoryRoot = path.resolve(import.meta.dirname, '..')
const RANGE = {
  rangeStartDate: '2026-08-02',
  rangeEndDate: '2026-09-12',
}

function validSlot(overrides = {}) {
  return {
    id: 'slot-a',
    academyId: 'academy-a',
    teacher: 'Teacher A',
    teacherName: 'Teacher A',
    teacherKey: 'teacher-a',
    teacherUid: 'uid-teacher-a',
    date: '2026-08-10',
    time: '10:00',
    startAt: new Date('2026-08-10T01:00:00.000Z'),
    durationMinutes: 60,
    status: 'open',
    reservedCount: 0,
    reservedStudentId: '',
    reservationId: '',
    reservedAt: null,
    cancelledAt: null,
    ...overrides,
  }
}

function project({
  privateLessonSlots = [validSlot()],
  lessons = [],
  privateLessonReservations = [],
  academyId = 'academy-a',
  selectedTeacherUid = null,
  includeOpenPrivateSlots = true,
  rangeStartDate = RANGE.rangeStartDate,
  rangeEndDate = RANGE.rangeEndDate,
} = {}) {
  return buildOpenDatedPrivateSlotCalendarRows({
    includeOpenPrivateSlots,
    privateLessonSlots,
    lessons,
    privateLessonReservations,
    academyId,
    selectedTeacherUid,
    rangeStartDate,
    rangeEndDate,
  })
}

function calendarDayCountLabel(language, count, previews) {
  const descriptor = getCalendarDayCountLabelDescriptor({ count, previews })
  return translate(language, descriptor.key, { count })
}

test('A — valid open dated slot projects stable read-only calendar metadata', () => {
  const canonicalAdminProfiles = [
    { role: 'admin' },
    { role: 'owner' },
    { role: 'staff-admin' },
    { role: 'staff_admin' },
    { role: ' OWNER ' },
    { role: 'teacher', membershipRole: 'owner' },
    { role: 'student', membershipRole: 'staff-admin' },
    { role: 'teacher', membershipRole: ' STAFF_ADMIN ' },
  ]
  canonicalAdminProfiles.forEach((profile) => {
    const gate = canViewBillingFields(profile)
    assert.equal(gate, true)
    assert.equal(project({ includeOpenPrivateSlots: gate }).length, 1)
  })
  for (const profile of [
    { role: 'teacher' },
    { role: 'student' },
    { role: 'unknown' },
    {},
    null,
  ]) {
    const gate = canViewBillingFields(profile)
    assert.equal(gate, false)
    assert.deepEqual(project({ includeOpenPrivateSlots: gate }), [])
  }

  const source = validSlot()
  const [row] = project({ privateLessonSlots: [source] })

  assert.equal(row.id, 'open-private-slot:slot-a')
  assert.equal(row._calendarRowKind, 'openPrivateSlot')
  assert.equal(row.type, 'openPrivateSlot')
  assert.equal(row.lessonType, 'private')
  assert.equal(row.startAt, source.startAt)
  assert.equal(row.startMillis, Date.parse('2026-08-10T01:00:00.000Z'))
  assert.equal(row.endMillis, Date.parse('2026-08-10T02:00:00.000Z'))
  assert.equal(row.endAt.toISOString(), '2026-08-10T02:00:00.000Z')
  assert.equal(row.timeRangeLabel, '10:00–11:00')
  assert.equal(row.teacherName, 'Teacher A')
  assert.equal(row.teacherKey, 'teacher-a')
  assert.equal(row.slotId, 'slot-a')
  assert.equal(row.slotStatus, 'open')
  assert.equal(row.status, 'open')
  assert.equal(row.readOnly, true)
  assert.equal(row.isReadOnly, true)
  for (const forbiddenField of [
    'packageId',
    'reservation',
    'deductionApplied',
    'onReserve',
    'onClose',
    'onEdit',
  ]) {
    assert.equal(Object.hasOwn(row, forbiddenField), false)
  }

  assert.deepEqual(project({ includeOpenPrivateSlots: false }), [])
  assert.deepEqual(project({ includeOpenPrivateSlots: 'true' }), [])
  assert.deepEqual(
    buildOpenDatedPrivateSlotCalendarRows({
      privateLessonSlots: [validSlot()],
      academyId: 'academy-a',
      ...RANGE,
    }),
    []
  )
})

test('B — non-open, reserved, malformed, and linked slot states fail closed', () => {
  const variants = [
    { id: 'status-case', status: 'Open' },
    { id: 'status-reserved', status: 'reserved' },
    { id: 'status-cancelled', status: 'cancelled' },
    { id: 'status-closed', status: 'closed' },
    { id: 'count-one', reservedCount: 1 },
    { id: 'count-string', reservedCount: '0' },
    { id: 'student-link', reservedStudentId: 'student-a' },
    { id: 'student-null', reservedStudentId: null },
    { id: 'reserved-at', reservedAt: new Date() },
    { id: 'reserved-at-missing', reservedAt: undefined },
    { id: 'reservation-link', reservationId: 'reservation-a' },
    { id: 'reservation-malformed', reservationId: null },
    { id: 'lesson-link', lessonId: 'lesson-a' },
    { id: 'fixed-lesson-link', fixedLessonId: 'lesson-fixed' },
    { id: 'reservation-object', reservation: { id: 'reservation-a' } },
  ].map((patch) => validSlot(patch))

  const rows = project({ privateLessonSlots: variants })
  assert.deepEqual(rows, [])
})

test('C — origin markers exclude, while reopened open slots tolerate historical close timestamps', () => {
  const variants = [
    { id: 'fixed-type', slotType: 'fixed' },
    { id: 'fixed-student', fixedStudentId: 'student-a' },
    { id: 'fixed-batch', fixedPrivateAssignmentBatchId: 'batch-a' },
    { id: 'template-type', slotType: 'template' },
    { id: 'template-id', availabilityTemplateId: 'template-a' },
    { id: 'materialized-template', isGeneratedFromTemplate: true },
    { id: 'template-booking-marker', openForStudentBooking: true },
    { id: 'released-type', slotType: 'released_fixed' },
    { id: 'released-boolean', releasedFromFixed: true },
    { id: 'released-at', releasedAt: new Date() },
    { id: 'released-reason', releaseReason: 'fixed_student_cancelled' },
    { id: 'blocked-at', blockedAt: new Date() },
  ].map((patch) => validSlot(patch))

  assert.deepEqual(project({ privateLessonSlots: variants }), [])
  assert.deepEqual(
    project({
      privateLessonSlots: [
        validSlot({
          id: 'reopened',
          status: 'open',
          cancelledAt: new Date('2026-08-09T01:00:00.000Z'),
          canceledAt: new Date('2026-08-09T01:00:00.000Z'),
          closedAt: new Date('2026-08-09T01:00:00.000Z'),
        }),
      ],
    }).map((row) => row.slotId),
    ['reopened']
  )
})

test('D — active linked claims dedupe first and legacy fallback requires one canonical UID', () => {
  assert.deepEqual(
    project({ lessons: [{ id: 'lesson-a', slotId: 'slot-a', status: 'active' }] }),
    []
  )
  assert.deepEqual(
    project({
      privateLessonReservations: [
        { id: 'reservation-a', privateLessonSlotId: 'slot-a', status: 'active' },
      ],
    }),
    []
  )
  for (const status of ['cancelled', 'canceled', 'void', 'released', 'reversed', 'inactive']) {
    assert.equal(
      project({
        privateLessonReservations: [{ slotId: 'slot-a', status }],
      }).length,
      1,
      `${status} reservation must not claim an open slot`
    )
  }
  assert.equal(
    project({
      lessons: [{ slotId: 'slot-a', status: 'inactive' }],
    }).length,
    1
  )
  assert.deepEqual(
    project({
      lessons: [
        {
          id: 'legacy-a',
          date: '2026-08-10',
          time: '10:00',
          teacherName: 'Teacher A',
          teacherUid: 'uid-teacher-a',
          status: 'active',
        },
      ],
    }),
    []
  )

  const linkedDifferentSlot = project({
    lessons: [
      {
        id: 'linked-other',
        slotId: 'slot-other',
        date: '2026-08-10',
        time: '10:00',
        teacherName: 'Teacher A',
        teacherUid: 'uid-teacher-a',
        status: 'active',
      },
    ],
  })
  assert.equal(linkedDifferentSlot.length, 1)

  const differentTeacher = project({
    lessons: [
      {
        id: 'legacy-b',
        date: '2026-08-10',
        time: '10:00',
        teacherName: 'Teacher A',
        teacherUid: 'uid-teacher-b',
        status: 'active',
      },
    ],
  })
  assert.equal(differentTeacher.length, 1)

  for (const legacyRow of [
    { teacherName: 'Teacher A' },
    { teacherName: 'Teacher A', teacherUid: ' uid-teacher-a ' },
    {
      teacherName: 'Teacher A',
      teacherUid: 'uid-teacher-a',
      teacherUID: 'uid-conflict',
    },
  ]) {
    assert.equal(
      project({
        lessons: [
          {
            id: 'legacy-unclaimable',
            date: '2026-08-10',
            time: '10:00',
            status: 'active',
            ...legacyRow,
          },
        ],
      }).length,
      1
    )
  }

  const groupAtSameTime = project({
    lessons: [
      {
        id: 'group-a',
        _calendarRowKind: 'group',
        date: '2026-08-10',
        time: '10:00',
        teacherName: 'Teacher A',
        teacherUid: 'uid-teacher-a',
      },
    ],
  })
  assert.equal(groupAtSameTime.length, 1)
})

test('E — academy, selected teacher, all-teacher, and inclusive range filters are exact', () => {
  const sameNameOptions = buildCalendarTeacherFilterOptions({
    lessons: [
      { teacherUid: 'uid-teacher-a', teacherName: 'Same Teacher' },
      { teacherUID: 'uid-teacher-b', teacherName: 'Same Teacher' },
      { teacherId: 'not-an-auth-uid', teacherName: 'Document ID Only' },
      {
        teacherUid: 'uid-conflict-a',
        teacherUID: 'uid-conflict-b',
        teacherName: 'Conflicting',
      },
      { teacherName: 'Missing UID' },
      { teacherUid: 123, teacherName: 'Numeric UID' },
      { teacherUid: ' uid-with-padding ', teacherName: 'Padded UID' },
    ],
  })
  assert.deepEqual(sameNameOptions, [
    {
      value: 'uid-teacher-a',
      label: 'Same Teacher',
      teacherUid: 'uid-teacher-a',
      teacherUID: 'uid-teacher-a',
    },
    {
      value: 'uid-teacher-b',
      label: 'Same Teacher',
      teacherUid: 'uid-teacher-b',
      teacherUID: 'uid-teacher-b',
    },
  ])
  assert.deepEqual(
    buildCalendarTeacherFilterOptions({
      teacherManagementTeachers: [
        {
          teacherMembershipUid: 'uid-membership',
          name: 'Zulu Label',
        },
        {
          teacherUid: 'uid-membership',
          name: 'Alpha Label',
        },
      ],
    }),
    [
      {
        value: 'uid-membership',
        label: 'Alpha Label',
        teacherUid: 'uid-membership',
        teacherUID: 'uid-membership',
      },
    ]
  )
  assert.deepEqual(
    buildCalendarTeacherFilterOptions({
      teacherManagementTeachers: [
        {
          teacherUid: 'uid-membership',
          name: 'Alpha Label',
        },
        {
          teacherMembershipUid: 'uid-membership',
          name: 'Zulu Label',
        },
      ],
    }),
    [
      {
        value: 'uid-membership',
        label: 'Alpha Label',
        teacherUid: 'uid-membership',
        teacherUID: 'uid-membership',
      },
    ]
  )
  assert.deepEqual(
    buildCalendarTeacherFilterOptions({
      lessons: [{ teacherUid: 'uid-blank-label' }],
    }),
    [
      {
        value: 'uid-blank-label',
        label: '-',
        teacherUid: 'uid-blank-label',
        teacherUID: 'uid-blank-label',
      },
    ]
  )

  const slots = [
    validSlot({
      id: 'range-start',
      date: RANGE.rangeStartDate,
      time: '00:00',
      startAt: new Date('2026-08-01T15:00:00.000Z'),
    }),
    validSlot({
      id: 'range-end',
      date: RANGE.rangeEndDate,
      time: '23:59',
      startAt: new Date('2026-09-12T14:59:00.000Z'),
      teacher: 'Teacher A',
      teacherName: 'Teacher A',
      teacherKey: 'teacher-b',
      teacherUid: 'uid-teacher-b',
    }),
    validSlot({ id: 'wrong-academy', academyId: 'academy-b' }),
    validSlot({
      id: 'before-range',
      date: '2026-08-01',
      startAt: new Date('2026-08-01T01:00:00.000Z'),
    }),
    validSlot({
      id: 'after-range',
      date: '2026-09-13',
      startAt: new Date('2026-09-13T01:00:00.000Z'),
    }),
  ]

  assert.deepEqual(
    project({ privateLessonSlots: slots }).map((row) => row.slotId),
    ['range-start', 'range-end']
  )
  assert.deepEqual(
    project({
      privateLessonSlots: slots,
      selectedTeacherUid: 'uid-teacher-a',
    }).map((row) => row.slotId),
    ['range-start']
  )
  assert.deepEqual(
    project({
      privateLessonSlots: slots,
      selectedTeacherUid: 'uid-teacher-b',
    }).map((row) => row.slotId),
    ['range-end']
  )
  assert.deepEqual(project({ privateLessonSlots: slots, selectedTeacherUid: '' }), [])
  assert.deepEqual(
    project({ privateLessonSlots: slots, selectedTeacherUid: ' uid-teacher-a ' }),
    []
  )
  assert.deepEqual(
    project({ privateLessonSlots: slots, academyId: 'academy-b' }).map((row) => row.slotId),
    ['wrong-academy']
  )

  assert.deepEqual(
    project({
      privateLessonSlots: [
        validSlot({ id: 'no-uid', teacherUid: undefined }),
        validSlot({
          id: 'conflicting-uids',
          teacherUid: 'uid-teacher-a',
          teacherUID: 'uid-teacher-b',
        }),
        validSlot({
          id: 'padded-uid',
          teacherUid: ' uid-teacher-a ',
        }),
      ],
    }),
    []
  )
})

test('F — invalid dates, times, stored starts, KST mismatches, and durations fail closed', () => {
  const canonicalSeconds = Date.parse('2026-08-10T01:00:00.000Z') / 1000
  const variants = [
    validSlot({
      id: 'bad-date',
      date: '2026-02-30',
      startAt: new Date('2026-03-01T15:00:00.000Z'),
    }),
    validSlot({ id: 'bad-time', time: '24:00' }),
    validSlot({ id: 'missing-start', startAt: null }),
    validSlot({ id: 'string-start', startAt: '2026-08-10T01:00:00.000Z' }),
    validSlot({ id: 'array-start', startAt: [canonicalSeconds, 0] }),
    validSlot({
      id: 'string-seconds',
      startAt: { seconds: String(canonicalSeconds), nanoseconds: 0 },
    }),
    validSlot({ id: 'boolean-seconds', startAt: { seconds: true, nanoseconds: 0 } }),
    validSlot({ id: 'null-seconds', startAt: { seconds: null, nanoseconds: 0 } }),
    validSlot({ id: 'nan-seconds', startAt: { seconds: NaN, nanoseconds: 0 } }),
    validSlot({ id: 'infinite-seconds', startAt: { seconds: Infinity, nanoseconds: 0 } }),
    validSlot({ id: 'fraction-seconds', startAt: { seconds: canonicalSeconds + 0.5, nanoseconds: 0 } }),
    validSlot({
      id: 'coercible-seconds',
      startAt: { seconds: { valueOf: () => canonicalSeconds }, nanoseconds: 0 },
    }),
    validSlot({ id: 'string-nanos', startAt: { seconds: canonicalSeconds, nanoseconds: '0' } }),
    validSlot({ id: 'boolean-nanos', startAt: { seconds: canonicalSeconds, nanoseconds: false } }),
    validSlot({ id: 'null-nanos', startAt: { seconds: canonicalSeconds, nanoseconds: null } }),
    validSlot({ id: 'array-nanos', startAt: { seconds: canonicalSeconds, nanoseconds: [] } }),
    validSlot({ id: 'nan-nanos', startAt: { seconds: canonicalSeconds, nanoseconds: NaN } }),
    validSlot({
      id: 'infinite-nanos',
      startAt: { seconds: canonicalSeconds, nanoseconds: Infinity },
    }),
    validSlot({ id: 'fraction-nanos', startAt: { seconds: canonicalSeconds, nanoseconds: 0.5 } }),
    validSlot({ id: 'negative-nanos', startAt: { seconds: canonicalSeconds, nanoseconds: -1 } }),
    validSlot({
      id: 'overflow-nanos',
      startAt: { seconds: canonicalSeconds, nanoseconds: 1000000000 },
    }),
    validSlot({ id: 'coercible-millis', startAt: { toMillis: () => String(canonicalSeconds * 1000) } }),
    validSlot({ id: 'fraction-millis', startAt: { toMillis: () => canonicalSeconds * 1000 + 0.5 } }),
    validSlot({ id: 'invalid-to-date', startAt: { toDate: () => '2026-08-10T01:00:00.000Z' } }),
    validSlot({ id: 'kst-mismatch', startAt: new Date('2026-08-10T10:00:00.000Z') }),
    validSlot({ id: 'short-duration', durationMinutes: 9 }),
    validSlot({ id: 'long-duration', durationMinutes: 241 }),
    validSlot({ id: 'fraction-duration', durationMinutes: 60.5 }),
  ]
  assert.deepEqual(project({ privateLessonSlots: variants }), [])

  const boundaryRows = project({
    privateLessonSlots: [
      validSlot({ id: 'duration-min', durationMinutes: 10 }),
      validSlot({ id: 'duration-max', durationMinutes: 240, time: '12:00', startAt: new Date('2026-08-10T03:00:00.000Z') }),
      validSlot({
        id: 'timestamp-components',
        time: '13:00',
        startAt: {
          seconds: Date.parse('2026-08-10T04:00:00.000Z') / 1000,
          nanoseconds: 0,
        },
      }),
      validSlot({
        id: 'timestamp-to-date',
        time: '14:00',
        startAt: { toDate: () => new Date('2026-08-10T05:00:00.000Z') },
      }),
      validSlot({
        id: 'timestamp-to-millis',
        time: '15:00',
        startAt: { toMillis: () => Date.parse('2026-08-10T06:00:00.000Z') },
      }),
    ],
  })
  assert.deepEqual(boundaryRows.map((row) => row.slotId), [
    'duration-min',
    'duration-max',
    'timestamp-components',
    'timestamp-to-date',
    'timestamp-to-millis',
  ])
})

test('G — projection remains additive to the existing lesson/group/fixed calendar union', () => {
  const instructionalLesson = {
    id: 'lesson-existing',
    _calendarRowKind: 'private',
    date: '2026-08-10',
    time: '09:00',
    studentId: 'student-a',
    teacherName: 'Teacher A',
    teacherUid: 'uid-teacher-a',
    status: 'completed',
  }
  const availabilityRow = project()[0]
  const displayRows = [instructionalLesson, availabilityRow]
  const instructionalRows = excludeOpenPrivateSlotsFromInstructionalStatistics(displayRows)
  assert.equal(displayRows.length, 2)
  assert.deepEqual(instructionalRows, [instructionalLesson])
  assert.deepEqual(
    excludeOpenPrivateSlotsFromInstructionalStatistics([
      instructionalLesson,
      { id: 'kind-only', _calendarRowKind: 'openPrivateSlot' },
      { id: 'type-only', type: 'openPrivateSlot' },
    ]),
    [instructionalLesson]
  )

  const statsArgs = {
    monthDate: new Date('2026-08-01T00:00:00.000Z'),
    todayYmd: '2026-08-10',
  }
  const existingTeacherRows = [
    instructionalLesson,
    {
      id: 'group-existing',
      _calendarRowKind: 'group',
      lessonType: 'group',
      date: '2026-08-10',
      time: '11:00',
      teacherUid: 'uid-teacher-a',
      status: 'active',
    },
    {
      id: 'reservation-existing',
      _calendarRowKind: 'privateReservation',
      date: '2026-08-10',
      time: '12:00',
      studentId: 'student-b',
      teacherUid: 'uid-teacher-a',
      status: 'active',
    },
    {
      id: 'fixed-existing',
      _calendarRowKind: 'private',
      date: '2026-08-10',
      time: '13:00',
      studentId: 'student-c',
      teacherUid: 'uid-teacher-a',
      status: 'active',
      fixedLessonId: 'fixed-existing',
    },
  ]
  const teacherOpenRows = project({ includeOpenPrivateSlots: false })
  const teacherDisplayRows = [...existingTeacherRows, ...teacherOpenRows]
  assert.deepEqual(teacherOpenRows, [])
  assert.deepEqual(teacherDisplayRows, existingTeacherRows)
  assert.deepEqual(
    buildLessonOccurrenceStats({ rows: teacherDisplayRows, ...statsArgs }),
    buildLessonOccurrenceStats({ rows: existingTeacherRows, ...statsArgs })
  )
  assert.deepEqual(
    buildLessonOccurrenceStats({ rows: instructionalRows, ...statsArgs }),
    buildLessonOccurrenceStats({ rows: [instructionalLesson], ...statsArgs })
  )
  const teachers = [
    {
      value: 'uid-teacher-a',
      teacherUid: 'uid-teacher-a',
      teacherName: 'Teacher A',
    },
  ]
  assert.deepEqual(
    buildTeacherLessonOccurrenceStats({
      rows: instructionalRows,
      teachers,
      ...statsArgs,
    }),
    buildTeacherLessonOccurrenceStats({
      rows: [instructionalLesson],
      teachers,
      ...statsArgs,
    })
  )
  const sameNameTeacherOptions = buildCalendarTeacherFilterOptions({
    lessons: [
      { teacherUid: 'uid-a', teacherName: 'Same Teacher' },
      { teacherUid: 'uid-b', teacherName: 'Same Teacher' },
    ],
  })
  const sameNameTeacherStats = buildTeacherLessonOccurrenceStats({
    rows: [
      {
        ...instructionalLesson,
        id: 'lesson-a',
        studentId: 'student-a',
        teacherUid: 'uid-a',
        teacherName: 'Same Teacher',
      },
      {
        ...instructionalLesson,
        id: 'lesson-b',
        studentId: 'student-b',
        teacherUid: 'uid-b',
        teacherName: 'Same Teacher',
      },
    ],
    teachers: sameNameTeacherOptions,
    ...statsArgs,
  })
  assert.deepEqual(
    sameNameTeacherStats.teacherRows.map((row) => ({
      teacherId: row.teacherId,
      todayTotal: row.stats.today.total,
      monthTotal: row.stats.month.total,
    })),
    [
      { teacherId: 'uid-a', todayTotal: 1, monthTotal: 1 },
      { teacherId: 'uid-b', todayTotal: 1, monthTotal: 1 },
    ]
  )

  const hookSource = fs.readFileSync(
    path.join(repositoryRoot, 'src/features/dashboard/hooks/useCalendarSectionViewModel.js'),
    'utf8'
  )
  assert.match(
    hookSource,
    /\.\.\.priv,[\s\S]*\.\.\.calendarGroupLessonRows,[\s\S]*\.\.\.calendarPrivateReservationRows,[\s\S]*\.\.\.calendarOpenPrivateSlotRows/
  )
  assert.match(hookSource, /const priv = visibleLessons\.map\(\(l\) => \(\{ \.\.\.l, _calendarRowKind: 'private' \}\)\)/)
  assert.match(hookSource, /_calendarRowKind: 'group'/)
  assert.match(hookSource, /_calendarRowKind: 'privateReservation'/)
  assert.match(hookSource, /row\?\.lessonType \|\| row\?\.type \|\| row\?\.packageType/)
  const dashboardSource = fs.readFileSync(path.join(repositoryRoot, 'Dashboard.jsx'), 'utf8')
  assert.match(
    dashboardSource,
    /buildLessonOccurrenceStats\(\{[\s\S]*rows: calendarInstructionalLessons/
  )
  assert.match(
    dashboardSource,
    /buildTeacherLessonOccurrenceStats\(\{[\s\S]*rows: allCalendarInstructionalLessons/
  )
})

test('H — mixed, open-only, and lesson-only day summaries use visible counts without changing stats', () => {
  const instructionalLesson = {
    id: 'lesson-summary',
    _calendarRowKind: 'private',
    date: '2026-08-10',
    time: '21:00',
    studentId: 'student-a',
    studentName: 'Student A',
    teacherUid: 'uid-teacher-a',
    status: 'active',
  }
  const [openPrivateSlot] = project({
    privateLessonSlots: [
      validSlot({
        time: '22:00',
        startAt: new Date('2026-08-10T13:00:00.000Z'),
      }),
    ],
  })
  const statsArgs = {
    monthDate: new Date('2026-08-01T00:00:00.000Z'),
    todayYmd: '2026-08-10',
  }
  const mixedRows = [instructionalLesson, openPrivateSlot]
  const mixedCount = buildCalendarVisibleEventCountByDate(mixedRows).get('2026-08-10')
  const mixedPreviews = mixedRows.map((row) => ({ kind: row._calendarRowKind }))
  const mixedInstructionalRows =
    excludeOpenPrivateSlotsFromInstructionalStatistics(mixedRows)

  assert.equal(mixedCount, 2)
  assert.equal(calendarDayCountLabel('ko', mixedCount, mixedPreviews), '일정 2개')
  assert.equal(calendarDayCountLabel('en', mixedCount, mixedPreviews), '2 events')
  assert.equal(
    buildLessonOccurrenceStats({ rows: mixedInstructionalRows, ...statsArgs }).today.total,
    1
  )

  const openOnlyRows = [openPrivateSlot]
  const openOnlyCount = buildCalendarVisibleEventCountByDate(openOnlyRows).get('2026-08-10')
  const openOnlyPreviews = [{ kind: openPrivateSlot._calendarRowKind }]
  const openOnlyInstructionalRows =
    excludeOpenPrivateSlotsFromInstructionalStatistics(openOnlyRows)
  assert.equal(openOnlyCount, 1)
  assert.equal(calendarDayCountLabel('ko', openOnlyCount, openOnlyPreviews), '일정 1개')
  assert.equal(calendarDayCountLabel('en', openOnlyCount, openOnlyPreviews), '1 event')
  assert.equal(
    buildLessonOccurrenceStats({ rows: openOnlyInstructionalRows, ...statsArgs }).today.total,
    0
  )

  const lessonOnlyRows = [instructionalLesson]
  const lessonOnlyCount = buildCalendarVisibleEventCountByDate(lessonOnlyRows).get('2026-08-10')
  assert.equal(
    calendarDayCountLabel('ko', lessonOnlyCount, [{ kind: 'private' }]),
    '수업 1개'
  )
})

test('I — compact open-slot text is exact once while ordinary, group, and fixed labels stay unchanged', () => {
  const [openPrivateSlot] = project({
    privateLessonSlots: [
      validSlot({
        time: '22:00',
        startAt: new Date('2026-08-10T13:00:00.000Z'),
      }),
    ],
  })
  const openTimeRange = formatCalendarCompactPreviewLabel(openPrivateSlot)
  const koOpenText = formatOpenPrivateSlotCompactPreviewText(
    ko['teacher.calendar.openPrivateSlot.title'],
    openTimeRange
  )
  const enOpenText = formatOpenPrivateSlotCompactPreviewText(
    en['teacher.calendar.openPrivateSlot.title'],
    openTimeRange
  )
  assert.equal(openTimeRange, '22:00–23:00')
  assert.equal(koOpenText, '개인수업 예약 가능 · 22:00–23:00')
  assert.equal(enOpenText, 'Private lesson available · 22:00–23:00')
  assert.doesNotMatch(koOpenText, /22:00–23:00 · 22:00/)
  assert.doesNotMatch(enOpenText, /22:00–23:00 · 22:00/)

  assert.equal(
    formatCalendarCompactPreviewLabel({
      id: 'ordinary',
      _calendarRowKind: 'private',
      studentName: 'Student A',
      time: '09:00',
      sessionNumber: 2,
    }),
    'Student A · 09:00 · 2회차'
  )
  assert.equal(
    formatCalendarCompactPreviewLabel({
      id: 'group',
      _calendarRowKind: 'group',
      groupClassDisplayName: 'Group A',
      time: '10:00',
      sessionNumber: 3,
    }),
    'Group A · 10:00 · 3회차'
  )
  assert.equal(
    formatCalendarCompactPreviewLabel({
      id: 'fixed',
      _calendarRowKind: 'private',
      sourceType: 'fixed-private-slot-assignment',
      studentName: 'Student B',
      time: '11:00',
      sessionNumber: 4,
    }),
    'Student B · 11:00 · 4회차'
  )
})

test('J — Korean/English title, event counts, and reused available badge keys preserve parity', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort())
  assert.equal(en['teacher.calendar.openPrivateSlot.title'], 'Private lesson available')
  assert.equal(ko['teacher.calendar.openPrivateSlot.title'], '개인수업 예약 가능')
  assert.equal(en['teacher.calendar.eventCount.one'], '{{count}} event')
  assert.equal(en['teacher.calendar.eventCount.other'], '{{count}} events')
  assert.equal(ko['teacher.calendar.eventCount.one'], '일정 {{count}}개')
  assert.equal(ko['teacher.calendar.eventCount.other'], '일정 {{count}}개')
  assert.equal(en['student.status.available'], 'Available')
  assert.equal(ko['student.status.available'], '예약 가능')
})

test('K — click wiring only navigates through the existing Dashboard section setter', () => {
  const calendarSource = fs.readFileSync(
    path.join(repositoryRoot, 'src/features/dashboard/sections/CalendarSection.jsx'),
    'utf8'
  )
  const dashboardSource = fs.readFileSync(path.join(repositoryRoot, 'Dashboard.jsx'), 'utf8')
  const openNavigationStart = dashboardSource.indexOf('onOpenPrivateSlotManagement:')
  const openNavigationBlock = dashboardSource.slice(
    openNavigationStart,
    openNavigationStart + 220
  )
  const openRowBlock = calendarSource.slice(
    calendarSource.indexOf('if (isOpenPrivateSlotRow) {'),
    calendarSource.indexOf('const isFixedPrivateSourceRow =')
  )

  assert.match(openRowBlock, /onOpenPrivateSlotManagement\(lesson\)/)
  assert.match(openRowBlock, /role=\{canNavigateToPrivateSlots \? 'link'/)
  assert.match(openRowBlock, /event\.key !== 'Enter' && event\.key !== ' '/)
  assert.match(calendarSource, /<option value="">전체 선생님<\/option>/)
  assert.doesNotMatch(
    openRowBlock,
    /handleDeductionToggle|openStudentPackageEditModal|openPrivateLessonEditModal|handleDeletePrivateLesson|onMarkPrivateReservationOutcome|onCancelFixedPrivateLesson/
  )
  assert.match(openNavigationBlock, /includeOpenPrivateSlots/)
  assert.match(openNavigationBlock, /setActiveSection\('privateSlots'\)/)
  assert.match(openNavigationBlock, /: undefined/)
  assert.doesNotMatch(openNavigationBlock, /teacherPrivateSchedule/)
  assert.match(
    dashboardSource,
    /function isDashboardAdminProfile\(profile\) \{[\s\S]*return canViewBillingFields\(profile\)[\s\S]*\}/
  )
  assert.match(
    dashboardSource,
    /const isAdmin = isDashboardAdminProfile\(userProfile\)[\s\S]*const includeOpenPrivateSlots = isAdmin/
  )
  assert.match(
    dashboardSource,
    /selectedCalendarTeacherUid,[\s\S]*includeOpenPrivateSlots,[\s\S]*currentAcademyId/
  )
})

test('L — source contract stays read-only and contains no backend, write action, or CSS path', () => {
  const hookSource = fs.readFileSync(
    path.join(repositoryRoot, 'src/features/dashboard/hooks/useCalendarSectionViewModel.js'),
    'utf8'
  )
  const calendarSource = fs.readFileSync(
    path.join(repositoryRoot, 'src/features/dashboard/sections/CalendarSection.jsx'),
    'utf8'
  )
  const projectorSource = hookSource.slice(
    hookSource.indexOf('export function buildOpenDatedPrivateSlotCalendarRows'),
    hookSource.indexOf('function isStudentFixedPrivateSeatReleasedCancellation')
  )
  const openScopeSource = hookSource.slice(
    hookSource.indexOf('const selectedCalendarTeacherScope'),
    hookSource.indexOf('const calendarRange')
  )

  assert.match(projectorSource, /readOnly: true/)
  assert.match(projectorSource, /if \(includeOpenPrivateSlots !== true\) return \[\]/)
  assert.match(openScopeSource, /includeOpenPrivateSlots === true/)
  assert.doesNotMatch(openScopeSource, /role\s*[!=]==?\s*['"]admin['"]/)
  assert.doesNotMatch(projectorSource, /firebase|httpsCallable|writeBatch|setDoc|updateDoc|deleteDoc/)
  assert.doesNotMatch(projectorSource, /rowMatchesTeacherScope/)
  assert.doesNotMatch(hookSource, /Number\(value\.(?:seconds|nanoseconds)\)/)
  assert.doesNotMatch(calendarSource, /firebase\/(firestore|functions)/)
  assert.match(calendarSource, /data-read-only="true"/)
})
