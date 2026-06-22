import {
  getLessonStorageDateString,
  getStorageDateStringFromDate,
  getStudentName,
  getTeacherName,
  getTodayStorageDateString,
  isCancelledOrDeletedGroupLesson,
  isClassClosureCancelledGroupLesson,
  isNoDeductionCancelledGroupLesson,
  normalizeText,
} from './dashboardViewUtils.js'
import {
  getTeacherScopeFromRecord,
  rowMatchesTeacherScope,
} from './teacherLessonRosterHelpers.js'

export const COUNTABLE_PRIVATE_RESERVATION_STATUSES = new Set([
  'active',
  'reserved',
  'confirmed',
  'booked',
  'completed',
  'no_show',
])

const EXCLUDED_STATUS_TOKENS = new Set([
  'cancelled',
  'canceled',
  'deleted',
  'blocked',
  'teacher_unavailable',
  'teacher_unavailable_closed',
  'academy_closed',
  'holiday',
  'no_deduction',
  'nodeduction',
  'class_closure',
  'seat_released',
  'lesson_cancelled',
])

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function normalizeCompactToken(value) {
  return normalizeToken(value).replace(/_/g, '')
}

function isExcludedToken(value) {
  const token = normalizeToken(value)
  if (!token) return false
  return (
    EXCLUDED_STATUS_TOKENS.has(token) ||
    EXCLUDED_STATUS_TOKENS.has(normalizeCompactToken(token))
  )
}

function hasExcludedToken(...values) {
  return values.some(isExcludedToken)
}

export function isCountablePrivateReservationStatus(status) {
  const normalizedStatus = normalizeToken(status)
  return COUNTABLE_PRIVATE_RESERVATION_STATUSES.has(normalizedStatus)
}

function isGroupLessonOccurrence(row) {
  return row?._calendarRowKind === 'group'
}

function isPrivateReservationOccurrence(row) {
  return row?._calendarRowKind === 'privateReservation'
}

function hasExplicitExclusion(row) {
  if (!row) return true
  if (
    row.noDeduction === true ||
    row.isDeductCancelled === true ||
    row.isSeatReleased === true ||
    row.deleted === true ||
    row.groupClassDeleted === true ||
    row.releasedForPrivateBooking === true
  ) {
    return true
  }
  return hasExcludedToken(
    row.status,
    row.cancellationType,
    row.cancelledReason,
    row.canceledReason,
    row.cancellationReason,
    row.reason,
    row.releaseReason,
    row.blockReason,
    row.unavailableReason,
    row.closedReason,
    row.slotStatus,
    row.slotType
  )
}

export function isCountableLessonOccurrence(row) {
  if (!row) return false
  if (isGroupLessonOccurrence(row)) {
    if (
      isCancelledOrDeletedGroupLesson(row) ||
      isClassClosureCancelledGroupLesson(row) ||
      isNoDeductionCancelledGroupLesson(row)
    ) {
      return false
    }
    return !hasExplicitExclusion(row)
  }

  if (isPrivateReservationOccurrence(row)) {
    if (!isCountablePrivateReservationStatus(row.status)) return false
    return !hasExplicitExclusion(row)
  }

  return !hasExplicitExclusion(row)
}

function getOccurrenceKind(row) {
  return isGroupLessonOccurrence(row) ? 'group' : 'private'
}

function getOccurrenceStudentKey(row) {
  return normalizeText(row?.studentId || row?.studentID || getStudentName(row))
}

export function getLessonOccurrenceKey(row) {
  const kind = getOccurrenceKind(row)
  const date = String(getLessonStorageDateString(row) || '').trim()
  const time = String(row?.time || '').trim()
  const teacher = normalizeText(getTeacherName(row))

  if (kind === 'group') {
    const groupLessonId = String(row?.id || row?.lessonId || '').trim()
    if (groupLessonId) return `group:${groupLessonId}`
    const groupClassId = String(row?.groupClassId || row?.groupId || '').trim()
    return ['group', date, time, groupClassId, teacher].join('__')
  }

  const reservationId = String(row?.reservationId || '').trim()
  const directReservationId =
    isPrivateReservationOccurrence(row) ? String(row?.id || '').trim() : ''
  const slotId = String(row?.slotId || '').trim()
  const student = getOccurrenceStudentKey(row)
  if (reservationId || directReservationId) {
    return `private:${date}:reservationId:${reservationId || directReservationId}`
  }
  if (slotId && student) return `private:${date}:slotId:${slotId}:${student}`
  return ['private', date, time, student, teacher].join('__')
}

function getKstMonthKeyFromDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return getTodayStorageDateString().slice(0, 7)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return `${year}-${month}`
}

function getLastDayOfMonthYmd(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  if (!year || !month) return ''
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${monthKey}-${String(lastDay).padStart(2, '0')}`
}

export function getLessonStatsMonthRange({
  monthDate = new Date(),
  todayYmd = getTodayStorageDateString(),
} = {}) {
  const monthKey = getKstMonthKeyFromDate(monthDate)
  const todayMonthKey = String(todayYmd || '').slice(0, 7)
  const startYmd = `${monthKey}-01`
  if (monthKey > todayMonthKey) {
    return {
      monthKey,
      startYmd,
      endYmd: '',
      isCurrentMonth: false,
      isFutureMonth: true,
    }
  }
  return {
    monthKey,
    startYmd,
    endYmd: monthKey === todayMonthKey ? todayYmd : getLastDayOfMonthYmd(monthKey),
    isCurrentMonth: monthKey === todayMonthKey,
    isFutureMonth: false,
  }
}

function createEmptyBucket() {
  return {
    total: 0,
    privateCount: 0,
    groupCount: 0,
  }
}

function createEmptyStats(range) {
  return {
    today: createEmptyBucket(),
    month: createEmptyBucket(),
    range,
  }
}

function addRowToBucket(bucket, row) {
  bucket.total += 1
  if (getOccurrenceKind(row) === 'group') {
    bucket.groupCount += 1
  } else {
    bucket.privateCount += 1
  }
}

function rowMatchesOptionalTeacherScope(row, teacherScope) {
  if (!teacherScope) return true
  return rowMatchesTeacherScope(row, teacherScope)
}

export function buildLessonOccurrenceStats({
  rows = [],
  monthDate = new Date(),
  todayYmd = getTodayStorageDateString(),
  teacherScope = null,
} = {}) {
  const range = getLessonStatsMonthRange({ monthDate, todayYmd })
  const stats = createEmptyStats(range)
  const seenToday = new Set()
  const seenMonth = new Set()

  ;(Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!rowMatchesOptionalTeacherScope(row, teacherScope)) return
    if (!isCountableLessonOccurrence(row)) return
    const date = String(getLessonStorageDateString(row) || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    const key = getLessonOccurrenceKey(row)

    if (date === todayYmd && !seenToday.has(key)) {
      seenToday.add(key)
      addRowToBucket(stats.today, row)
    }

    if (range.endYmd && date >= range.startYmd && date <= range.endYmd && !seenMonth.has(key)) {
      seenMonth.add(key)
      addRowToBucket(stats.month, row)
    }
  })

  return stats
}

function getTeacherStatsDisplayName(teacher) {
  return (
    String(teacher?.displayName || '').trim() ||
    String(teacher?.label || '').trim() ||
    String(teacher?.name || '').trim() ||
    String(teacher?.teacherName || '').trim() ||
    String(teacher?.teacherKey || '').trim() ||
    '-'
  )
}

export function buildTeacherLessonOccurrenceStats({
  rows = [],
  teachers = [],
  monthDate = new Date(),
  todayYmd = getTodayStorageDateString(),
} = {}) {
  const overall = buildLessonOccurrenceStats({ rows, monthDate, todayYmd })
  const teacherRows = (Array.isArray(teachers) ? teachers : []).map((teacher) => {
    const teacherScope = getTeacherScopeFromRecord(teacher)
    const stats = buildLessonOccurrenceStats({
      rows,
      monthDate,
      todayYmd,
      teacherScope,
    })
    return {
      teacherId: String(teacher?.id || teacher?.value || teacher?.teacherKey || '').trim(),
      teacherKey: String(teacher?.teacherKey || teacher?.teacherName || teacher?.name || '').trim(),
      teacherName: getTeacherStatsDisplayName(teacher),
      stats,
    }
  })

  return {
    overall,
    teacherRows,
    range: overall.range,
  }
}

export function formatLessonStatsMonthLabel(range) {
  const monthKey = String(range?.monthKey || '').trim()
  const [year, month] = monthKey.split('-')
  if (!year || !month) return '선택 월'
  return `${year}년 ${Number(month)}월`
}

