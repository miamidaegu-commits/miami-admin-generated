import {
  getLessonStorageDateString,
  lessonTimeInputValue,
  normalizeText,
} from './dashboardViewUtils.js'
import {
  STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT,
  computeStudentPrivateCancelAllowance,
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

function getStudentCancelLabel(studentId, cancelAllowanceByStudentId, sourceKind) {
  if (sourceKind !== 'reservation') return ''
  const safeStudentId = normalizeId(studentId)
  if (!safeStudentId || !cancelAllowanceByStudentId.has(safeStudentId)) return ''
  return formatTeacherRosterStudentCancelLabel(
    cancelAllowanceByStudentId.get(safeStudentId)
  )
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
  if (bucket === 'cancelled') return '차감취소'
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
  if (sourceKind === 'lesson' && lesson?.isDeductCancelled === true) return 'cancelled'
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
    entries.push({
      id: `lesson:${lesson.id}`,
      sourceKind: 'lesson',
      studentId: resolveStudentId(lesson),
      date,
      time,
      studentName: resolveStudentName(lesson, studentById),
      lessonTypeLabel: getLessonTypeLabel({ sourceKind: 'lesson', lesson }),
      subject: normalizeId(lesson.subject) || '1:1 수업',
      statusLabel: getLessonStatusLabel(lesson, bucket),
      ticketContextLabel: getTicketContextLabel({
        sourceKind: 'lesson',
        lesson,
        packageById,
      }),
      directCancelLabel: '',
      bucket,
      sortKey: getSortKey(date, time),
    })
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
      entries.push({
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
        ticketContextLabel: getTicketContextLabel({
          sourceKind: 'reservation',
          reservation,
          packageById,
        }),
        directCancelLabel: getStudentCancelLabel(
          resolveStudentId(reservation),
          cancelAllowanceByStudentId,
          'reservation',
        ),
        bucket,
        sortKey: getSortKey(date, time),
      })
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
