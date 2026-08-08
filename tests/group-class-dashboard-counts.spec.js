import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { computeGroupClassDashboardStats } from '../src/features/dashboard/groupClassDashboardStats.js'
import en from '../src/i18n/resources/en.js'
import ko from '../src/i18n/resources/ko.js'

const ACADEMY_ID = 'academy-a'
const TEACHER_UID = 'teacher-a'
const NOW = new Date('2026-03-15T03:30:00.000Z') // 2026-03-15 12:30 KST

function groupClass(overrides = {}) {
  return {
    id: 'class-a',
    academyId: ACADEMY_ID,
    teacherUid: TEACHER_UID,
    status: 'active',
    ...overrides,
  }
}

function groupLesson(overrides = {}) {
  return {
    id: 'lesson-a',
    academyId: ACADEMY_ID,
    groupClassId: 'class-a',
    date: '2026-03-15',
    time: '10:00',
    status: 'scheduled',
    ...overrides,
  }
}

function stats({
  groupClasses = [groupClass()],
  groupLessons = [groupLesson()],
  academyId = ACADEMY_ID,
  teacherUid = TEACHER_UID,
  now = NOW,
  ...ignored
} = {}) {
  return computeGroupClassDashboardStats({
    groupClasses,
    groupLessons,
    academyId,
    teacherUid,
    now,
    ...ignored,
  })
}

test('01 KST today valid occurrence counts one session', () => {
  assert.equal(stats().todayGroupSessionCount, 1)
})

test('02 many students still count as one session', () => {
  const result = stats({
    groupLessons: [
      groupLesson({
        bookedCount: 14,
        countedStudentIDs: Array.from({ length: 14 }, (_, index) => `student-${index}`),
      }),
    ],
  })
  assert.equal(result.todayGroupSessionCount, 1)
})

test('03 class owned by another canonical UID is excluded', () => {
  assert.equal(
    stats({ groupClasses: [groupClass({ teacherUid: 'teacher-b' })] }).todayGroupSessionCount,
    0
  )
})

test('04 class from another academy is excluded', () => {
  assert.equal(
    stats({ groupClasses: [groupClass({ academyId: 'academy-b' })] }).todayGroupSessionCount,
    0
  )
})

test('05 missing class teacherUid is excluded as legacy', () => {
  const result = stats({ groupClasses: [groupClass({ teacherUid: '' })] })
  assert.equal(result.todayGroupSessionCount, 0)
  assert.equal(result.excludedLegacyClassCount, 1)
})

test('06 lesson linked to an owned canonical class is included', () => {
  assert.equal(stats().todayGroupSessionCount, 1)
})

test('07 lesson missing canonical groupClassId is excluded as legacy', () => {
  const result = stats({ groupLessons: [groupLesson({ groupClassId: '' })] })
  assert.equal(result.todayGroupSessionCount, 0)
  assert.equal(result.excludedLegacyLessonCount, 1)
})

test('08 lesson linked to another teacher class is excluded', () => {
  const result = stats({
    groupClasses: [
      groupClass(),
      groupClass({ id: 'class-b', teacherUid: 'teacher-b' }),
    ],
    groupLessons: [groupLesson({ groupClassId: 'class-b' })],
  })
  assert.equal(result.todayGroupSessionCount, 0)
})

test('09 duplicate lesson document ID counts at most once', () => {
  const duplicate = groupLesson()
  assert.equal(stats({ groupLessons: [duplicate, { ...duplicate }] }).todayGroupSessionCount, 1)
})

test('10 cancelled lesson is not countable', () => {
  assert.equal(stats({ groupLessons: [groupLesson({ status: 'cancelled' })] }).todayGroupSessionCount, 0)
})

test('11 deleted lesson is not countable', () => {
  assert.equal(stats({ groupLessons: [groupLesson({ status: 'deleted' })] }).todayGroupSessionCount, 0)
})

test('12 existing non-countable blocked status is excluded', () => {
  assert.equal(stats({ groupLessons: [groupLesson({ status: 'blocked' })] }).todayGroupSessionCount, 0)
})

test('13 current month is KST day one through today cumulatively', () => {
  const result = stats({
    groupLessons: [
      groupLesson({ id: 'month-start', date: '2026-03-01', time: '09:00' }),
      groupLesson({ id: 'today', time: '10:00' }),
      groupLesson({ id: 'prior-month', date: '2026-02-28', time: '11:00' }),
    ],
  })
  assert.equal(result.currentMonthGroupSessionCount, 2)
})

test('14 future session is excluded from current month snapshot', () => {
  assert.equal(
    stats({ groupLessons: [groupLesson({ date: '2026-03-16' })] })
      .currentMonthGroupSessionCount,
    0
  )
})

test('15 calendarMonth input cannot alter actual current month', () => {
  const result = stats({ calendarMonth: new Date('2024-01-01T00:00:00.000Z') })
  assert.equal(result.currentMonthGroupSessionCount, 1)
})

test('16 UTC previous day crossing into KST today uses the KST boundary', () => {
  const result = stats({ now: new Date('2026-03-14T15:30:00.000Z') })
  assert.equal(result.todayGroupSessionCount, 1)
})

test('17 attendance not started excludes a session before canonical start', () => {
  assert.equal(
    stats({ groupLessons: [groupLesson({ time: '13:00', attendanceAppliedAt: null })] })
      .attendanceNotStartedTodayCount,
    0
  )
})

test('18 started session without attendanceAppliedAt counts one', () => {
  assert.equal(
    stats({ groupLessons: [groupLesson({ time: '12:30', attendanceAppliedAt: null })] })
      .attendanceNotStartedTodayCount,
    1
  )
})

test('19 attendanceAppliedAt excludes an otherwise started session', () => {
  assert.equal(
    stats({
      groupLessons: [
        groupLesson({ time: '12:00', attendanceAppliedAt: { seconds: 1773543600 } }),
      ],
    }).attendanceNotStartedTodayCount,
    0
  )
})

test('20 partial student attendance state does not change session-level not-started count', () => {
  const result = stats({
    groupLessons: [
      groupLesson({
        time: '12:00',
        attendanceAppliedAt: null,
        countedStudentIDs: ['student-1'],
        completed: true,
      }),
    ],
  })
  assert.equal(result.attendanceNotStartedTodayCount, 1)
})

test('21 owned class closed this KST month through today counts one', () => {
  assert.equal(
    stats({
      groupClasses: [groupClass({ status: 'closed', closedFromDate: '2026-03-10' })],
      groupLessons: [],
    }).classesClosedThisMonthCount,
    1
  )
})

test('22 class closed in a prior month is excluded', () => {
  assert.equal(
    stats({
      groupClasses: [groupClass({ status: 'closed', closedFromDate: '2026-02-28' })],
      groupLessons: [],
    }).classesClosedThisMonthCount,
    0
  )
})

test('23 future closed date is excluded', () => {
  assert.equal(
    stats({
      groupClasses: [groupClass({ status: 'closed', closedFromDate: '2026-03-16' })],
      groupLessons: [],
    }).classesClosedThisMonthCount,
    0
  )
})

test('24 missing closedFromDate is excluded with one diagnostic', () => {
  const result = stats({
    groupClasses: [groupClass({ status: 'closed', closedFromDate: '' })],
    groupLessons: [],
  })
  assert.equal(result.classesClosedThisMonthCount, 0)
  assert.equal(result.invalidClosedFromDateCount, 1)
})

test('25 duplicate closed class ID counts at most once', () => {
  const closed = groupClass({ status: 'closed', closedFromDate: '2026-03-10' })
  assert.equal(
    stats({ groupClasses: [closed, { ...closed }], groupLessons: [] })
      .classesClosedThisMonthCount,
    1
  )
})

test('26 explicit private lesson input is excluded from every group count', () => {
  const result = stats({
    groupLessons: [
      groupLesson({
        lessonType: 'private',
        studentId: 'student-a',
        packageId: 'private-package-a',
      }),
    ],
  })
  assert.deepEqual(
    {
      today: result.todayGroupSessionCount,
      month: result.currentMonthGroupSessionCount,
      attendance: result.attendanceNotStartedTodayCount,
      excludedLegacy: result.excludedLegacyLessonCount,
    },
    { today: 0, month: 0, attendance: 0, excludedLegacy: 0 }
  )
})

test('27 computation is deterministic and does not mutate either input array', () => {
  const groupClasses = [groupClass()]
  const groupLessons = [groupLesson()]
  const beforeClasses = structuredClone(groupClasses)
  const beforeLessons = structuredClone(groupLessons)
  const first = stats({ groupClasses, groupLessons })
  const second = stats({ groupClasses, groupLessons })
  assert.deepEqual(first, second)
  assert.deepEqual(groupClasses, beforeClasses)
  assert.deepEqual(groupLessons, beforeLessons)
})

test('28 deterministic occurrence identity dedupes different document IDs', () => {
  const first = groupLesson({ id: 'legacy-doc-a' })
  const second = groupLesson({ id: 'legacy-doc-b' })
  assert.equal(stats({ groupLessons: [first, second] }).todayGroupSessionCount, 1)
})

test('29 malformed closedFromDate increments the explicit diagnostic', () => {
  const result = stats({
    groupClasses: [groupClass({ status: ' CLOSED ', closedFromDate: '2026-02-31' })],
    groupLessons: [],
  })
  assert.equal(result.classesClosedThisMonthCount, 0)
  assert.equal(result.invalidClosedFromDateCount, 1)
})

test('30 group status panel is separate from private dashboard stats', () => {
  const panel = readFileSync(
    'src/features/dashboard/components/GroupClassStatusPanel.jsx',
    'utf8'
  )
  assert.match(panel, /data-testid="group-class-status-panel"/)
  assert.match(panel, /todayGroupSessionCount/)
  assert.match(panel, /currentMonthGroupSessionCount/)
  assert.match(panel, /attendanceNotStartedTodayCount/)
  assert.match(panel, /classesClosedThisMonthCount/)
  assert.doesNotMatch(panel, /privateLessonDashboardStats|todayPrivateCount|finalLessonCount/)
})

test('31 ko and en group overview labels have exact key parity and required text', () => {
  const expected = {
    'teacher.groupClassOverview.title': ['단체반 현황', 'Group Class Overview'],
    'teacher.groupClassOverview.todaySessions': ['오늘 단체수업', 'Group Sessions Today'],
    'teacher.groupClassOverview.monthSessions': ['이번 달 단체수업', 'Group Sessions This Month'],
    'teacher.groupClassOverview.attendanceNotStarted': [
      '오늘 출결 미시작',
      'Attendance Not Started Today',
    ],
    'teacher.groupClassOverview.classesClosed': [
      '이번 달 종료 반',
      'Classes Closed This Month',
    ],
  }
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort())
  for (const [key, [koText, enText]] of Object.entries(expected)) {
    assert.equal(ko[key], koText)
    assert.equal(en[key], enText)
  }
})

test('32 dashboard wires four group stats without private stats and reuses mobile 2x2 grid', () => {
  const dashboard = readFileSync('Dashboard.jsx', 'utf8')
  const panel = readFileSync(
    'src/features/dashboard/components/GroupClassStatusPanel.jsx',
    'utf8'
  )
  const css = readFileSync('index.css', 'utf8')
  assert.match(dashboard, /computeGroupClassDashboardStats\(\{/)
  assert.match(dashboard, /groupClasses,\s*groupLessons: studentSummaryGroupLessons/)
  assert.match(dashboard, /<GroupClassStatusPanel\s+stats=\{groupClassDashboardStats\}/)
  assert.doesNotMatch(panel, /privateLessonDashboardStats/)
  assert.match(panel, /className="today-schedule-summary-grid"/)
  assert.match(panel, /className="today-schedule-summary-card"/)
  assert.match(
    css,
    /\.dashboard--mobile\.dashboard--teacher \.today-schedule-summary-grid[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/
  )
})
