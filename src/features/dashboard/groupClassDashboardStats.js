import { getLessonStorageDateString } from './dashboardViewUtils.js'
import {
  getKstDateYmd,
  isCountableLessonOccurrence,
} from './lessonOccurrenceStats.js'
import {
  buildGroupLessonOccurrenceId,
  scopeTeacherGroupData,
} from './groupClassTeacherScope.js'

export const GROUP_DASHBOARD_STATS_MODEL = 'CURRENT_SNAPSHOT_V1'

function normalizeId(value) {
  return String(value || '').trim()
}

function normalizeToken(value) {
  return normalizeId(value).toLowerCase().replace(/[\s-]+/g, '_')
}

function isValidYmd(value) {
  const ymd = normalizeId(value)
  const match = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const date = new Date(`${ymd}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === ymd
}

function getLessonYmd(lesson) {
  try {
    const ymd = normalizeId(getLessonStorageDateString(lesson))
    return isValidYmd(ymd) ? ymd : ''
  } catch {
    return ''
  }
}

function getCanonicalLessonTime(lesson) {
  const time = normalizeId(lesson?.time || lesson?.startTime || lesson?.scheduleTime)
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : ''
}

function getKstHourMinute(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = parts.find((part) => part.type === 'hour')?.value
  const minute = parts.find((part) => part.type === 'minute')?.value
  return hour && minute ? `${hour}:${minute}` : ''
}

function isExplicitPrivateLesson(lesson) {
  if (lesson?._calendarRowKind === 'privateReservation') return true
  const type = normalizeToken(lesson?.lessonType || lesson?.type || lesson?.packageType)
  return type === 'private' || type === 'private_lesson' || type === '1:1'
}

function hasCanonicalClassIdentity(groupClass) {
  return Boolean(
    normalizeId(groupClass?.id) &&
      normalizeId(groupClass?.academyId) &&
      normalizeId(groupClass?.teacherUid)
  )
}

function hasCanonicalLessonScopeIdentity(lesson) {
  return Boolean(
    normalizeId(lesson?.id) &&
      normalizeId(lesson?.academyId) &&
      normalizeId(lesson?.groupClassId)
  )
}

function getCanonicalOccurrenceKey(lesson, date, time) {
  try {
    return buildGroupLessonOccurrenceId({
      academyId: lesson?.academyId,
      groupClassId: lesson?.groupClassId,
      date,
      time,
      slot: normalizeId(lesson?.slot || '0'),
    })
  } catch {
    return normalizeId(lesson?.occurrenceId || lesson?.id)
  }
}

function hasAttendanceAppliedAt(lesson) {
  const value = lesson?.attendanceAppliedAt
  return value != null && value !== ''
}

export function computeGroupClassDashboardStats({
  groupClasses = [],
  groupLessons = [],
  academyId,
  teacherUid,
  now = new Date(),
} = {}) {
  const safeClasses = Array.isArray(groupClasses) ? groupClasses : []
  const safeLessons = Array.isArray(groupLessons) ? groupLessons : []
  const groupLessonCandidates = safeLessons.filter((lesson) => !isExplicitPrivateLesson(lesson))
  const excludedLegacyClassCount = safeClasses.filter(
    (groupClass) => !hasCanonicalClassIdentity(groupClass)
  ).length
  let excludedLegacyLessonCount = groupLessonCandidates.filter(
    (lesson) => !hasCanonicalLessonScopeIdentity(lesson)
  ).length

  const scoped = scopeTeacherGroupData({
    groupClasses: safeClasses,
    groupLessons: groupLessonCandidates,
    academyId,
    teacherUid,
  })
  const todayYmd = getKstDateYmd(now)
  const nowTime = getKstHourMinute(now)
  const currentMonthStartYmd = todayYmd ? `${todayYmd.slice(0, 7)}-01` : ''

  const uniqueClasses = new Map()
  for (const groupClass of scoped.groupClasses) {
    const classId = normalizeId(groupClass?.id)
    if (classId && !uniqueClasses.has(classId)) uniqueClasses.set(classId, groupClass)
  }

  let classesClosedThisMonthCount = 0
  let invalidClosedFromDateCount = 0
  for (const groupClass of uniqueClasses.values()) {
    if (normalizeToken(groupClass?.status) !== 'closed') continue
    const closedFromDate = normalizeId(groupClass?.closedFromDate)
    if (!isValidYmd(closedFromDate)) {
      invalidClosedFromDateCount += 1
      continue
    }
    if (
      currentMonthStartYmd &&
      closedFromDate >= currentMonthStartYmd &&
      closedFromDate <= todayYmd
    ) {
      classesClosedThisMonthCount += 1
    }
  }

  const uniqueOccurrences = new Map()
  for (const lesson of scoped.groupLessons) {
    const date = getLessonYmd(lesson)
    const time = getCanonicalLessonTime(lesson)
    const occurrenceKey = date && time ? getCanonicalOccurrenceKey(lesson, date, time) : ''
    if (!date || !time || !occurrenceKey) {
      excludedLegacyLessonCount += 1
      continue
    }
    if (!isCountableLessonOccurrence(lesson) || uniqueOccurrences.has(occurrenceKey)) continue
    uniqueOccurrences.set(occurrenceKey, { lesson, date, time })
  }

  let todayGroupSessionCount = 0
  let currentMonthGroupSessionCount = 0
  let attendanceNotStartedTodayCount = 0
  for (const { lesson, date, time } of uniqueOccurrences.values()) {
    if (date === todayYmd) {
      todayGroupSessionCount += 1
      if (nowTime && time <= nowTime && !hasAttendanceAppliedAt(lesson)) {
        attendanceNotStartedTodayCount += 1
      }
    }
    if (currentMonthStartYmd && date >= currentMonthStartYmd && date <= todayYmd) {
      currentMonthGroupSessionCount += 1
    }
  }

  return {
    todayGroupSessionCount,
    currentMonthGroupSessionCount,
    attendanceNotStartedTodayCount,
    classesClosedThisMonthCount,
    excludedLegacyClassCount,
    excludedLegacyLessonCount,
    invalidClosedFromDateCount,
  }
}
