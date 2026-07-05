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

function createStatsAccumulator(range) {
  return {
    stats: createEmptyStats(range),
    seenToday: new Set(),
    seenMonth: new Set(),
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

function getSafeLessonDate(row) {
  try {
    return String(getLessonStorageDateString(row) || '').trim()
  } catch {
    return ''
  }
}

function getSafeLessonOccurrenceKey(row) {
  try {
    return String(getLessonOccurrenceKey(row) || '').trim()
  } catch {
    return ''
  }
}

function addRowToStatsAccumulator(accumulator, row, { date, key, range, todayYmd }) {
  if (!accumulator || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return
  const occurrenceKey = key || getSafeLessonOccurrenceKey(row)
  if (!occurrenceKey) return

  if (date === todayYmd && !accumulator.seenToday.has(occurrenceKey)) {
    accumulator.seenToday.add(occurrenceKey)
    addRowToBucket(accumulator.stats.today, row)
  }

  if (
    range.endYmd &&
    date >= range.startYmd &&
    date <= range.endYmd &&
    !accumulator.seenMonth.has(occurrenceKey)
  ) {
    accumulator.seenMonth.add(occurrenceKey)
    addRowToBucket(accumulator.stats.month, row)
  }
}

function getStatsTeacherIdentityKeys(row) {
  const stableUidKeys = []
  const stableTeacherKeys = []
  const displayKeys = []
  ;[
    row?.teacherUid,
    row?.teacherUID,
    row?.teacherMembershipUid,
    row?.uid,
    row?.teacherId,
    row?.teacherID,
    row?.id,
  ].forEach((value) => {
    const key = normalizeText(value || '')
    if (key) stableUidKeys.push(key)
  })
  ;[row?.teacherKey, row?.value].forEach((value) => {
    const key = normalizeText(value || '')
    if (key) stableTeacherKeys.push(key)
  })
  ;[row?.teacher, row?.teacherName, row?.displayName, row?.name, row?.label].forEach((value) => {
    const key = normalizeText(value || '')
    if (key) displayKeys.push(key)
  })

  const seen = new Set()
  const out = []
  ;[...stableUidKeys, ...stableTeacherKeys, ...displayKeys].forEach((key) => {
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(key)
  })
  return out
}

export function buildLessonOccurrenceStats({
  rows = [],
  monthDate = new Date(),
  todayYmd = getTodayStorageDateString(),
  teacherScope = null,
} = {}) {
  const range = getLessonStatsMonthRange({ monthDate, todayYmd })
  const accumulator = createStatsAccumulator(range)

  ;(Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!rowMatchesOptionalTeacherScope(row, teacherScope)) return
    if (!isCountableLessonOccurrence(row)) return
    const date = getSafeLessonDate(row)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    addRowToStatsAccumulator(accumulator, row, {
      date,
      key: getSafeLessonOccurrenceKey(row),
      range,
      todayYmd,
    })
  })

  return accumulator.stats
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
  const range = getLessonStatsMonthRange({ monthDate, todayYmd })
  const overallAccumulator = createStatsAccumulator(range)
  const safeTeachers = Array.isArray(teachers) ? teachers : []
  const teacherAccumulators = safeTeachers.map(() => createStatsAccumulator(range))
  const teacherIndexesByIdentityKey = new Map()

  const teacherRows = safeTeachers.map((teacher, index) => {
    const teacherScope = getTeacherScopeFromRecord(teacher)
    getStatsTeacherIdentityKeys(teacherScope).forEach((key) => {
      if (!teacherIndexesByIdentityKey.has(key)) teacherIndexesByIdentityKey.set(key, [])
      teacherIndexesByIdentityKey.get(key).push(index)
    })
    return {
      teacherId: String(teacher?.id || teacher?.value || teacher?.teacherKey || '').trim(),
      teacherKey: String(teacher?.teacherKey || teacher?.teacherName || teacher?.name || '').trim(),
      teacherName: getTeacherStatsDisplayName(teacher),
      stats: teacherAccumulators[index].stats,
    }
  })

  ;(Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!isCountableLessonOccurrence(row)) return
    const date = getSafeLessonDate(row)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    const key = getSafeLessonOccurrenceKey(row)
    if (!key) return

    const countableRow = { date, key, range, todayYmd }
    addRowToStatsAccumulator(overallAccumulator, row, countableRow)

    const matchedTeacherIndexes = new Set()
    getStatsTeacherIdentityKeys(row).forEach((identityKey) => {
      ;(teacherIndexesByIdentityKey.get(identityKey) || []).forEach((index) => {
        matchedTeacherIndexes.add(index)
      })
    })
    matchedTeacherIndexes.forEach((index) => {
      addRowToStatsAccumulator(teacherAccumulators[index], row, countableRow)
    })
  })

  return {
    overall: overallAccumulator.stats,
    teacherRows,
    range,
  }
}

export function formatLessonStatsMonthLabel(range) {
  const monthKey = String(range?.monthKey || '').trim()
  const [year, month] = monthKey.split('-')
  if (!year || !month) return '선택 월'
  return `${year}년 ${Number(month)}월`
}

