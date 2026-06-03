import {
  getLessonStorageDateString,
  lessonTimeInputValue,
  normalizeText,
} from './dashboardViewUtils.js'
import {
  STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT,
  computeStudentPrivateCancelAllowance,
  formatTeacherRosterCancelAllowanceValue,
  formatTeacherRosterStudentCancelLabel,
} from '../booking/studentPrivateCancelAllowance.js'

// Keep in sync with STUDENT_PRIVATE_CANCEL_LIMIT in functions/index.js.
export const STUDENT_PRIVATE_DIRECT_CANCEL_LIMIT = STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT

const ACTIVE_RESERVATION_STATUSES = new Set([
  'active',
  'reserved',
  'confirmed',
  'booked',
])
const PAST_RESERVATION_STATUSES = new Set(['completed', 'no_show'])
const CANCELLED_RESERVATION_STATUSES = new Set(['cancelled', 'canceled'])

function normalizeId(value) {
  return String(value || '').trim()
}

function normalizeKey(value) {
  return normalizeText(value || '')
}

function getPrivateTeacherScopeKeys(...rows) {
  const stableUidKeys = []
  const stableTeacherKeys = []
  const displayKeys = []
  rows.forEach((row) => {
    if (!row) return
    ;[row.teacherUid, row.teacherUID, row.teacherId, row.teacherID].forEach((value) => {
      const key = normalizeKey(value)
      if (key) stableUidKeys.push(key)
    })
    ;[row.teacherKey].forEach((value) => {
      const key = normalizeKey(value)
      if (key) stableTeacherKeys.push(key)
    })
    ;[row.teacher, row.teacherName, row.displayName, row.name].forEach((value) => {
      const key = normalizeKey(value)
      if (key) displayKeys.push(key)
    })
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

export function getTeacherScopeFromRecord(teacher) {
  const teacherKey = normalizeKey(
    teacher?.teacherKey || teacher?.teacherName || teacher?.name || ''
  )
  const teacherName = normalizeKey(teacher?.name || teacher?.teacherName || teacherKey)
  return {
    teacherUid: teacher?.teacherUid || teacher?.teacherUID || teacher?.teacherMembershipUid || '',
    teacherUID: teacher?.teacherUID || teacher?.teacherUid || '',
    teacherId: teacher?.id || teacher?.teacherId || '',
    teacherKey,
    teacher: teacherKey,
    teacherName,
    displayName: teacherName,
    name: teacherName,
  }
}

export function rowMatchesTeacherScope(row, teacherScope) {
  const rowKeys = getPrivateTeacherScopeKeys(row)
  const scopeKeys = getPrivateTeacherScopeKeys(teacherScope)
  if (rowKeys.length === 0 || scopeKeys.length === 0) return false
  return rowKeys.some((key) => scopeKeys.includes(key))
}

function getKstTodayString(nowMillis = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nowMillis))
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`
}

function getKstDateTimeMillis(dateValue, timeValue) {
  const date = normalizeId(dateValue)
  const time = normalizeId(timeValue || '00:00')
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const timeMatch = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!dateMatch || !timeMatch) return null
  return Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]) - 9,
    Number(timeMatch[2]),
    0,
    0
  )
}

function getTimestampMillis(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') {
    const millis = value.toMillis()
    return Number.isFinite(millis) ? millis : null
  }
  if (typeof value.toDate === 'function') {
    const millis = value.toDate().getTime()
    return Number.isFinite(millis) ? millis : null
  }
  if (value instanceof Date) {
    const millis = value.getTime()
    return Number.isFinite(millis) ? millis : null
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const millis = Date.parse(value)
    return Number.isFinite(millis) ? millis : null
  }
  if (typeof value === 'object' && value.seconds != null) {
    const millis = Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1000000)
    return Number.isFinite(millis) ? millis : null
  }
  return null
}

function formatKstAuditDateTime(value) {
  const millis = getTimestampMillis(value)
  if (millis === null) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(millis))
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')} ${byType.get('hour')}:${byType.get('minute')}`
}

export function formatReservationCreatedAt(reservation) {
  return (
    formatKstAuditDateTime(
      reservation?.reservedAt || reservation?.createdAt || reservation?.bookedAt
    ) || '기록 없음'
  )
}

export function mapCancelledByLabel(value) {
  const row = value && typeof value === 'object' ? value : null
  const actor = normalizeId(row ? row.cancelledBy || row.canceledBy || row.cancelledByRole : value)
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
  const reason = normalizeId(row?.cancellationReason || row?.cancelledReason || '').toLowerCase()
  if (['student', 'studentcancelled', 'learner'].includes(actor) || reason.includes('student')) {
    return '학생 취소'
  }
  if (
    ['admin', 'administrator', 'manager', 'staff', 'dashboard'].includes(actor) ||
    reason.includes('admin')
  ) {
    return '관리자 취소'
  }
  if (['teacher', 'instructor'].includes(actor) || reason.includes('teacher')) {
    return '선생님 취소'
  }
  return '취소됨'
}

export function formatReservationCancelledAt(reservation) {
  const cancelledAt = formatKstAuditDateTime(reservation?.cancelledAt || reservation?.canceledAt)
  if (!cancelledAt) return '-'
  return `${cancelledAt} · ${mapCancelledByLabel(reservation)}`
}

export function formatLessonCancelledAt(lesson) {
  const cancelledAt = formatKstAuditDateTime(lesson?.cancelledAt || lesson?.canceledAt)
  if (!cancelledAt) return ''
  return `${cancelledAt} · ${mapCancelledByLabel(lesson)}`
}

function getSortKey(date, time) {
  return `${normalizeId(date)} ${normalizeId(time)}`.trim()
}

function resolveStudentId(row) {
  return normalizeId(row?.studentId || row?.studentID)
}

function buildStudentCancelAllowanceByStudentId(statsRows, academyId) {
  const map = new Map()
  ;(Array.isArray(statsRows) ? statsRows : []).forEach((row) => {
    if (normalizeId(row.academyId) !== normalizeId(academyId)) return
    const studentId = normalizeId(row.studentId)
    if (!studentId) return
    map.set(studentId, computeStudentPrivateCancelAllowance(row))
  })
  return map
}

export function formatStudentDirectCancelLabel(usedCount, limit = STUDENT_PRIVATE_DIRECT_CANCEL_LIMIT) {
  return formatTeacherRosterStudentCancelLabel(
    computeStudentPrivateCancelAllowance({
      studentCancelCount: usedCount,
      studentCancelLimit: limit,
    })
  )
}

function resolveStudentDisplayName(studentName, studentId) {
  const name = normalizeId(studentName)
  if (name && name !== '-') return name
  const id = normalizeId(studentId)
  if (id) return id
  return '이름 없음'
}

function resolveSubjectLabel(subject) {
  const value = normalizeId(subject)
  return value || '1:1 수업'
}

export function getCancellationHandlingLabel({ sourceKind, lesson, reservation, bucket }) {
  if (bucket !== 'cancelled') return ''
  if (sourceKind === 'lesson') {
    if (lesson?.isDeductCancelled === true) return '차감취소'
    const cancellationType = normalizeId(lesson?.cancellationType).toLowerCase()
    if (cancellationType === 'seat_released' || lesson?.isSeatReleased === true) return '자리 공개'
    if (cancellationType === 'lesson_cancelled') return '수업 취소'
    return '취소됨'
  }
  if (sourceKind === 'reservation') {
    const cancelledByLabel = mapCancelledByLabel(reservation)
    if (cancelledByLabel !== '취소됨') return cancelledByLabel
    const source = normalizeId(reservation?.source).toLowerCase()
    if (source === 'student') return '학생 취소'
    if (source === 'admin') return '관리자 취소'
    if (source === 'teacher') return '선생님 취소'
    return '취소됨'
  }
  return '취소됨'
}

function getStudentCancelAllowanceValue(studentId, cancelAllowanceByStudentId, sourceKind) {
  if (sourceKind !== 'reservation') return ''
  const safeStudentId = normalizeId(studentId)
  if (!safeStudentId || !cancelAllowanceByStudentId.has(safeStudentId)) return ''
  return formatTeacherRosterCancelAllowanceValue(
    cancelAllowanceByStudentId.get(safeStudentId)
  )
}

function getStudentCancelLabel(studentId, cancelAllowanceByStudentId, sourceKind) {
  if (sourceKind !== 'reservation') return ''
  const safeStudentId = normalizeId(studentId)
  if (!safeStudentId || !cancelAllowanceByStudentId.has(safeStudentId)) return ''
  return formatTeacherRosterStudentCancelLabel(
    cancelAllowanceByStudentId.get(safeStudentId)
  )
}

function buildRosterEntry({
  id,
  sourceKind,
  studentId,
  date,
  time,
  studentName,
  lessonTypeLabel,
  subject,
  statusLabel,
  bucket,
  lesson = null,
  reservation = null,
  cancelAllowanceByStudentId,
}) {
  return {
    id,
    sourceKind,
    studentId,
    date,
    time,
    studentName,
    studentDisplayName: resolveStudentDisplayName(studentName, studentId),
    lessonTypeLabel,
    subjectLabel: resolveSubjectLabel(subject),
    statusLabel,
    reservationCreatedAtLabel:
      sourceKind === 'reservation' ? formatReservationCreatedAt(reservation) : '',
    reservationCancelledAtLabel:
      sourceKind === 'reservation'
        ? formatReservationCancelledAt(reservation)
        : formatLessonCancelledAt(lesson),
    directCancelLabel: getStudentCancelLabel(studentId, cancelAllowanceByStudentId, sourceKind),
    cancelAllowanceValue: getStudentCancelAllowanceValue(
      studentId,
      cancelAllowanceByStudentId,
      sourceKind,
    ),
    cancellationHandlingLabel: getCancellationHandlingLabel({
      sourceKind,
      lesson,
      reservation,
      bucket,
    }),
    bucket,
    sortKey: getSortKey(date, time),
  }
}

function resolveStudentName(row, studentById) {
  const direct = normalizeId(row.studentName || row.student)
  if (direct) return direct
  const studentId = normalizeId(row.studentId || row.studentID)
  if (studentId && studentById.has(studentId)) {
    return normalizeId(studentById.get(studentId)?.name) || studentId
  }
  return studentId || '-'
}

function getLessonTypeLabel({ sourceKind, reservation, slot, lesson }) {
  if (sourceKind === 'reservation') {
    const sourceType = normalizeId(reservation?.sourceType).toLowerCase()
    if (sourceType === 'released_fixed_slot') return '보충 예약'
    return '1:1 예약'
  }
  if (normalizeId(lesson?.slotId || lesson?.reservationId)) return '1:1 예약'
  return '고정 1:1'
}

function getTicketContextLabel({ sourceKind, reservation, lesson, packageById }) {
  const packageId = normalizeId(
    (sourceKind === 'reservation' ? reservation?.packageId : lesson?.packageId) || ''
  )
  const pkg = packageId ? packageById.get(packageId) : null
  if (sourceKind === 'reservation') {
    const sourceType = normalizeId(reservation?.sourceType).toLowerCase()
    if (sourceType === 'released_fixed_slot') return '보충 예약'
    return '예약 완료'
  }
  if (pkg?.packageType === 'private') return '고정 예정'
  return ''
}

function getLessonStatusLabel(lesson, bucket) {
  if (bucket === 'cancelled') {
    const cancellationType = normalizeId(lesson?.cancellationType).toLowerCase()
    if (cancellationType === 'seat_released' || lesson?.isSeatReleased === true) return '자리 공개'
    if (cancellationType === 'lesson_cancelled') return '수업 취소'
    return '차감취소'
  }
  const startMillis = getKstDateTimeMillis(
    getLessonStorageDateString(lesson),
    lessonTimeInputValue(lesson) || lesson?.time
  )
  const isFuture = startMillis === null ?
    getLessonStorageDateString(lesson) >= getKstTodayString() :
    startMillis >= Date.now()
  if (isFuture) return '수업 예정'
  if (lesson?.completed === true) return '수업 완료'
  return '정상 차감'
}

function getReservationStatusLabel(reservation, bucket) {
  const status = normalizeId(reservation?.status).toLowerCase()
  if (bucket === 'cancelled') return '취소'
  if (PAST_RESERVATION_STATUSES.has(status)) {
    return status === 'no_show' ? '노쇼' : '수업 완료'
  }
  if (ACTIVE_RESERVATION_STATUSES.has(status)) return '예약 완료'
  return status || '-'
}

function buildApprovedReservationKeys(lessons, academyId, teacherScope) {
  const keys = new Set()
  lessons.forEach((lesson) => {
    if (normalizeId(lesson.academyId) !== normalizeId(academyId)) return
    if (!rowMatchesTeacherScope(lesson, teacherScope)) return
    const reservationId = normalizeId(lesson.reservationId)
    const slotId = normalizeId(lesson.slotId)
    if (reservationId) keys.add(`reservationId:${reservationId}`)
    if (slotId) keys.add(`slotId:${slotId}`)
  })
  return keys
}

function classifyBucket({ sourceKind, lesson, reservation, date, time, nowMillis }) {
  if (sourceKind === 'lesson') {
    const status = normalizeId(lesson?.status).toLowerCase()
    if (lesson?.isDeductCancelled === true || status === 'cancelled' || status === 'canceled') {
      return 'cancelled'
    }
  }
  const status = normalizeId(reservation?.status).toLowerCase()
  if (sourceKind === 'reservation' && CANCELLED_RESERVATION_STATUSES.has(status)) {
    return 'cancelled'
  }

  const startMillis = getKstDateTimeMillis(date, time)
  const isFuture = startMillis === null ?
    normalizeId(date) >= getKstTodayString(nowMillis) :
    startMillis >= nowMillis
  if (isFuture) return 'upcoming'
  if (sourceKind === 'reservation' && ACTIVE_RESERVATION_STATUSES.has(status)) {
    return 'upcoming'
  }
  return 'past'
}

function compareAscending(a, b) {
  return getSortKey(a.date, a.time).localeCompare(getSortKey(b.date, b.time), 'ko')
}

function compareDescending(a, b) {
  return getSortKey(b.date, b.time).localeCompare(getSortKey(a.date, a.time), 'ko')
}

export function buildTeacherLessonRoster({
  academyId,
  teacher,
  lessons = [],
  privateLessonReservations = [],
  privateLessonSlots = [],
  privateStudents = [],
  studentPackages = [],
  studentPrivateBookingStats = [],
  nowMillis = Date.now(),
  pastLimit = 30,
}) {
  const teacherScope = getTeacherScopeFromRecord(teacher)
  const scopedAcademyId = normalizeId(academyId)
  const cancelAllowanceByStudentId = buildStudentCancelAllowanceByStudentId(
    studentPrivateBookingStats,
    scopedAcademyId,
  )
  const studentById = new Map(
    (Array.isArray(privateStudents) ? privateStudents : []).map((student) => [
      normalizeId(student.id),
      student,
    ])
  )
  const slotById = new Map(
    (Array.isArray(privateLessonSlots) ? privateLessonSlots : []).map((slot) => [
      normalizeId(slot.id),
      slot,
    ])
  )
  const packageById = new Map(
    (Array.isArray(studentPackages) ? studentPackages : []).map((pkg) => [
      normalizeId(pkg.id),
      pkg,
    ])
  )
  const approvedReservationKeys = buildApprovedReservationKeys(
    lessons,
    scopedAcademyId,
    teacherScope
  )
  const entries = []

  ;(Array.isArray(lessons) ? lessons : []).forEach((lesson) => {
    if (normalizeId(lesson.academyId) !== scopedAcademyId) return
    if (!rowMatchesTeacherScope(lesson, teacherScope)) return
    const date = getLessonStorageDateString(lesson)
    const time = lessonTimeInputValue(lesson) || normalizeId(lesson.time)
    if (!date || !time) return
    const bucket = classifyBucket({
      sourceKind: 'lesson',
      lesson,
      date,
      time,
      nowMillis,
    })
    entries.push(
      buildRosterEntry({
        id: `lesson:${lesson.id}`,
        sourceKind: 'lesson',
        studentId: resolveStudentId(lesson),
        date,
        time,
        studentName: resolveStudentName(lesson, studentById),
        lessonTypeLabel: getLessonTypeLabel({ sourceKind: 'lesson', lesson }),
        subject: normalizeId(lesson.subject) || '1:1 수업',
        statusLabel: getLessonStatusLabel(lesson, bucket),
        bucket,
        lesson,
        cancelAllowanceByStudentId,
      })
    )
  })

  ;(Array.isArray(privateLessonReservations) ? privateLessonReservations : []).forEach(
    (reservation) => {
      if (normalizeId(reservation.academyId) !== scopedAcademyId) return
      if (!rowMatchesTeacherScope(reservation, teacherScope)) return
      const slot = slotById.get(normalizeId(reservation.slotId)) || null
      const date = normalizeId(reservation.date || slot?.date)
      const time = normalizeId(reservation.time || slot?.time)
      if (!date || !time) return
      const reservationId = normalizeId(reservation.id || reservation.reservationId)
      const slotId = normalizeId(reservation.slotId)
      if (reservationId && approvedReservationKeys.has(`reservationId:${reservationId}`)) {
        return
      }
      if (slotId && approvedReservationKeys.has(`slotId:${slotId}`)) return
      const bucket = classifyBucket({
        sourceKind: 'reservation',
        reservation,
        date,
        time,
        nowMillis,
      })
      entries.push(
        buildRosterEntry({
          id: `reservation:${reservation.id}`,
          sourceKind: 'reservation',
          studentId: resolveStudentId(reservation),
          date,
          time,
          studentName: resolveStudentName(reservation, studentById),
          lessonTypeLabel: getLessonTypeLabel({
            sourceKind: 'reservation',
            reservation,
            slot,
          }),
          subject: normalizeId(reservation.subject || slot?.subject) || '1:1 수업',
          statusLabel: getReservationStatusLabel(reservation, bucket),
          bucket,
          reservation,
          cancelAllowanceByStudentId,
        })
      )
    }
  )

  const upcoming = entries
    .filter((entry) => entry.bucket === 'upcoming')
    .sort(compareAscending)
  const past = entries
    .filter((entry) => entry.bucket === 'past')
    .sort(compareDescending)
    .slice(0, pastLimit)
  const cancelled = entries
    .filter((entry) => entry.bucket === 'cancelled')
    .sort(compareDescending)

  return {
    upcoming,
    past,
    cancelled,
    teacherScopeKeys: getPrivateTeacherScopeKeys(teacherScope),
  }
}

// TODO: extend roster with group lesson teacher assignments when group roster is needed.
