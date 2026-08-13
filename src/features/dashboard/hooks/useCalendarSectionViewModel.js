import { useMemo } from 'react'
import {
  getGroupLessonGroupId,
  getLessonDate,
  getLessonStorageDateString,
  getCalendarDays,
  getStorageDateStringFromDate,
  getTodayStorageDateString,
  formatLessonSessionNumber,
  getStudentName,
  getTeacherName,
  isActiveGroupClassRow,
  isClassClosureCancelledGroupLesson,
  isNoDeductionCancelledGroupLesson,
  normalizeText,
} from '../dashboardViewUtils.js'
import { rowMatchesTeacherScope } from '../teacherLessonRosterHelpers.js'
import {
  isCountableLessonOccurrence,
  isCountablePrivateReservationStatus,
} from '../lessonOccurrenceStats.js'

/**
 * 캘린더 탭 전용: 개인/그룹 수업 통합·필터·일자별 집계 등 읽기 전용 파생 상태.
 * Firestore 쓰기·모달·핸들러는 Dashboard에 둔다.
 */
function groupLessonHasAutoDeduction(groupLesson) {
  const autoDeductedIds = Array.isArray(groupLesson?.autoDeductedStudentIDs)
    ? groupLesson.autoDeductedStudentIDs
    : []
  if (autoDeductedIds.length > 0) return true
  if (String(groupLesson?.deductionSource || '').trim() === 'auto') return true
  const deductionSources =
    groupLesson?.deductionSources && typeof groupLesson.deductionSources === 'object'
      ? groupLesson.deductionSources
      : {}
  return Object.values(deductionSources).some(
    (source) => String(source || '').trim() === 'auto'
  )
}

function findGroupClassForLesson(groupLesson, groupClasses) {
  const groupId = getGroupLessonGroupId(groupLesson)
  if (groupId) {
    const byId = groupClasses.find((groupClass) => String(groupClass.id || '').trim() === groupId)
    if (byId) return byId
  }

  const lessonName = normalizeText(
    groupLesson?.groupClassName || groupLesson?.name || groupLesson?.title || ''
  )
  if (!lessonName) return null
  return (
    groupClasses.find((groupClass) => {
      const groupClassName = normalizeText(groupClass?.name || groupClass?.title || '')
      return groupClassName && groupClassName === lessonName
    }) || null
  )
}

function buildCalendarGroupLessonRows(groupLessons, groupClasses, todayYmd) {
  return groupLessons.map((gl) => {
    const gc = findGroupClassForLesson(gl, groupClasses)
    const name =
      gc?.name != null && String(gc.name).trim() ? String(gc.name).trim() : '-'
    const lessonDate = getLessonStorageDateString(gl)
    const countedIds = Array.isArray(gl.countedStudentIDs) ? gl.countedStudentIDs : []
    let calendarStatusLabel = '예정'
    if (isNoDeductionCancelledGroupLesson(gl)) {
      calendarStatusLabel = '휴강 · 차감 없음'
    } else if (groupLessonHasAutoDeduction(gl)) {
      calendarStatusLabel = '자동 차감 완료'
    } else if (countedIds.length > 0) {
      calendarStatusLabel = '정상 차감'
    } else if (lessonDate && lessonDate < todayYmd) {
      calendarStatusLabel = '미처리 · 자동 차감 예정'
    }
    return {
      ...gl,
      _calendarRowKind: 'group',
      groupClassDisplayName: name,
      teacher: String(gl.teacher || gc?.teacher || '').trim() || '-',
      teacherKey: String(gl.teacherKey || gc?.teacherKey || '').trim(),
      teacherUid: String(gl.teacherUid || gc?.teacherUid || '').trim(),
      teacherId: String(gl.teacherId || gc?.teacherId || '').trim(),
      teacherName: String(gl.teacherName || gc?.teacherName || '').trim(),
      teacherDisplayName: String(gl.teacherDisplayName || gc?.teacherDisplayName || '').trim(),
      displayName: String(gl.displayName || gc?.displayName || '').trim(),
      groupClassTeacher: String(gc?.teacher || '').trim(),
      groupClassTeacherKey: String(gc?.teacherKey || '').trim(),
      groupClassTeacherUid: String(gc?.teacherUid || '').trim(),
      groupClassTeacherId: String(gc?.teacherId || '').trim(),
      groupClassTeacherName: String(gc?.teacherName || '').trim(),
      groupClassTeacherDisplayName: String(gc?.teacherDisplayName || '').trim(),
      groupClassDisplayNameForTeacher: String(gc?.displayName || '').trim(),
      calendarStatusLabel,
    }
  })
}

function sortCalendarRows(rows) {
  const all = [...rows]
  all.sort((a, b) => {
    const aDate = getLessonDate(a)
    const bDate = getLessonDate(b)
    if (!aDate && !bDate) return 0
    if (!aDate) return 1
    if (!bDate) return -1
    return aDate.getTime() - bDate.getTime()
  })
  return all
}

const OPEN_PRIVATE_SLOT_MIN_DURATION_MINUTES = 10
const OPEN_PRIVATE_SLOT_MAX_DURATION_MINUTES = 240
const OPEN_PRIVATE_SLOT_LINK_FIELDS = [
  'reservationId',
  'privateLessonReservationId',
  'privateReservationId',
  'reservation',
  'reservationRef',
  'lessonId',
  'fixedLessonId',
  'privateLessonId',
  'sourceLessonId',
  'lesson',
  'lessonRef',
]
const OPEN_PRIVATE_SLOT_FIXED_TEMPLATE_FIELDS = [
  'availabilityTemplateId',
  'privateLessonAvailabilityTemplateId',
  'templateId',
  'fixedStudentId',
  'fixedStudentName',
  'fixedPrivateAssignmentBatchId',
  'fixedPrivateDeductionLedger',
  'packageId',
  'deductionPackageId',
  'linkedPackageId',
  'fixedPrivatePackageId',
]
const OPEN_PRIVATE_SLOT_RELEASE_FIELDS = [
  'releasedByStudentId',
  'releasedFromFixedLessonId',
  'releasedAt',
  'releasedBy',
  'releasedByUid',
  'releasedByRole',
  'releasedByName',
  'releaseReason',
]
const OPEN_PRIVATE_SLOT_CLOSED_FIELDS = [
  'blockedAt',
  'blockReason',
  'closedReason',
  'unavailableReason',
  'cancellationReason',
  'cancelledReason',
]
const NON_RENDERABLE_PRIVATE_EVENT_STATUSES = new Set([
  'cancelled',
  'canceled',
  'void',
  'released',
  'seat_released',
  'reversed',
  'inactive',
])
const PRIVATE_EVENT_SLOT_ID_FIELDS = ['slotId', 'privateLessonSlotId', 'privateSlotId']
const PRIVATE_EVENT_TEACHER_UID_FIELDS = ['teacherUid', 'teacherUID']
const CALENDAR_TEACHER_OPTION_UID_FIELDS = [
  'teacherUid',
  'teacherUID',
  'teacherMembershipUid',
]
const CALENDAR_TEACHER_OPTION_LABEL_FIELDS = [
  'name',
  'displayName',
  'teacherName',
  'teacher',
  'teacherKey',
  'teacherEmail',
  'email',
]

function hasOwn(record, field) {
  return Object.prototype.hasOwnProperty.call(record, field)
}

function timestampToMillis(value) {
  if (!value) return null
  if (Array.isArray(value)) return null
  try {
    if (typeof value.toMillis === 'function') {
      const millis = value.toMillis()
      return typeof millis === 'number' && Number.isFinite(millis) && Number.isInteger(millis)
        ? millis
        : null
    }
    if (typeof value.toDate === 'function') {
      const date = value.toDate()
      const millis = date instanceof Date ? date.getTime() : NaN
      return Number.isFinite(millis) && Number.isInteger(millis) ? millis : null
    }
  } catch {
    return null
  }
  if (value instanceof Date) {
    const millis = value.getTime()
    return Number.isFinite(millis) && Number.isInteger(millis) ? millis : null
  }
  if (typeof value === 'object' && value.seconds != null) {
    const seconds = value.seconds
    const nanoseconds = hasOwn(value, 'nanoseconds') ? value.nanoseconds : 0
    if (
      typeof seconds !== 'number' ||
      !Number.isFinite(seconds) ||
      !Number.isInteger(seconds) ||
      typeof nanoseconds !== 'number' ||
      !Number.isFinite(nanoseconds) ||
      !Number.isInteger(nanoseconds) ||
      nanoseconds < 0 ||
      nanoseconds > 999999999
    ) {
      return null
    }
    const millis = seconds * 1000 + nanoseconds / 1000000
    return Number.isFinite(millis) && Number.isInteger(millis) ? millis : null
  }
  return null
}

function canonicalKstDateTimeMillis(dateValue, timeValue) {
  const date = String(dateValue || '')
  const time = String(timeValue || '')
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const timeMatch = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!dateMatch || !timeMatch) return null
  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  const millis = Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0)
  const kst = new Date(millis + 9 * 60 * 60 * 1000)
  if (
    kst.getUTCFullYear() !== year ||
    kst.getUTCMonth() + 1 !== month ||
    kst.getUTCDate() !== day ||
    kst.getUTCHours() !== hour ||
    kst.getUTCMinutes() !== minute
  ) {
    return null
  }
  return millis
}

function formatKstTimeFromMillis(millis) {
  const kst = new Date(millis + 9 * 60 * 60 * 1000)
  return `${String(kst.getUTCHours()).padStart(2, '0')}:${String(
    kst.getUTCMinutes()
  ).padStart(2, '0')}`
}

function getCanonicalPrivateEventTeacherUid(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return ''
  const uids = new Set()
  let aliasCount = 0
  for (const field of PRIVATE_EVENT_TEACHER_UID_FIELDS) {
    if (!hasOwn(row, field)) continue
    aliasCount += 1
    const uid = row[field]
    if (typeof uid !== 'string' || !uid || uid !== uid.trim()) return ''
    uids.add(uid)
  }
  return aliasCount > 0 && uids.size === 1 ? [...uids][0] : ''
}

function getCanonicalCalendarTeacherOptionUid(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return ''
  const uids = new Set()
  let aliasCount = 0
  for (const field of CALENDAR_TEACHER_OPTION_UID_FIELDS) {
    if (!hasOwn(row, field)) continue
    aliasCount += 1
    const uid = row[field]
    if (typeof uid !== 'string' || !uid || uid !== uid.trim()) return ''
    uids.add(uid)
  }
  return aliasCount > 0 && uids.size === 1 ? [...uids][0] : ''
}

function getCalendarTeacherOptionLabelCandidate(row) {
  for (const [rank, field] of CALENDAR_TEACHER_OPTION_LABEL_FIELDS.entries()) {
    const value = row?.[field]
    if (typeof value !== 'string') continue
    const label = value.trim()
    if (label) return { label, rank }
  }
  return { label: '-', rank: CALENDAR_TEACHER_OPTION_LABEL_FIELDS.length }
}

export function buildCalendarTeacherFilterOptions({
  teacherManagementTeachers = [],
  lessons = [],
  groupClasses = [],
  groupLessons = [],
  privateLessonSlots = [],
  privateLessonReservations = [],
} = {}) {
  const candidates = [
    ...(Array.isArray(teacherManagementTeachers)
      ? teacherManagementTeachers.filter((row) => row?.status !== 'inactive')
      : []),
    ...(Array.isArray(lessons) ? lessons : []),
    ...(Array.isArray(groupClasses) ? groupClasses : []),
    ...(Array.isArray(groupLessons) ? groupLessons : []),
    ...(Array.isArray(privateLessonSlots) ? privateLessonSlots : []),
    ...(Array.isArray(privateLessonReservations) ? privateLessonReservations : []),
  ]
  const optionByUid = new Map()

  candidates.forEach((row) => {
    const uid = getCanonicalCalendarTeacherOptionUid(row)
    if (!uid) return
    const candidate = getCalendarTeacherOptionLabelCandidate(row)
    const current = optionByUid.get(uid)
    if (
      !current ||
      candidate.rank < current.rank ||
      (candidate.rank === current.rank &&
        candidate.label.localeCompare(current.label, 'ko') < 0)
    ) {
      optionByUid.set(uid, { ...candidate, uid })
    }
  })

  return [...optionByUid.values()]
    .sort((a, b) => {
      const labelOrder = a.label.localeCompare(b.label, 'ko')
      return labelOrder || a.uid.localeCompare(b.uid, 'en')
    })
    .map(({ uid, label }) => ({
      value: uid,
      label,
      teacherUid: uid,
      teacherUID: uid,
    }))
}

function hasMalformedOrPresentLink(slot, field) {
  if (!hasOwn(slot, field)) return false
  return typeof slot[field] !== 'string' || slot[field] !== ''
}

function hasFixedTemplateReleasedOrClosedMarker(slot) {
  const slotType = hasOwn(slot, 'slotType') ? slot.slotType : ''
  if (typeof slotType !== 'string' || !['', 'open'].includes(slotType)) return true

  for (const field of OPEN_PRIVATE_SLOT_FIXED_TEMPLATE_FIELDS) {
    if (!hasOwn(slot, field)) continue
    if (typeof slot[field] !== 'string' || slot[field] !== '') return true
  }
  for (const field of OPEN_PRIVATE_SLOT_RELEASE_FIELDS) {
    if (!hasOwn(slot, field)) continue
    if (typeof slot[field] === 'string' && slot[field] === '') continue
    return true
  }
  for (const field of OPEN_PRIVATE_SLOT_CLOSED_FIELDS) {
    if (!hasOwn(slot, field)) continue
    if (slot[field] === null || slot[field] === '') continue
    return true
  }
  for (const field of [
    'isGeneratedFromTemplate',
    'releasedFromFixed',
    'releasedForPrivateBooking',
    'isSeatReleased',
  ]) {
    if (hasOwn(slot, field) && slot[field] !== false) return true
  }
  if (hasOwn(slot, 'openForStudentBooking') || hasOwn(slot, 'useForFixedAssignment')) {
    return true
  }
  return false
}

function getLinkedSlotIds(row) {
  const ids = new Set()
  PRIVATE_EVENT_SLOT_ID_FIELDS.map((field) => row?.[field]).forEach((value) => {
    const id = typeof value === 'string' ? value.trim() : ''
    if (id) ids.add(id)
  })
  return ids
}

function isGroupCalendarSource(row) {
  return (
    row?._calendarRowKind === 'group' ||
    String(row?.lessonType || row?.type || row?.packageType || '')
      .trim()
      .toLowerCase() === 'group'
  )
}

function hasNonRenderablePrivateEventStatus(row) {
  if (row?.status == null || row.status === '') return false
  if (typeof row.status !== 'string') return true
  return NON_RENDERABLE_PRIVATE_EVENT_STATUSES.has(row.status.trim().toLowerCase())
}

export function isRenderableCalendarPrivateReservation(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false
  if (typeof row.status !== 'string' || hasNonRenderablePrivateEventStatus(row)) return false
  return (
    isCountablePrivateReservationStatus(row.status) &&
    isCountableLessonOccurrence({ ...row, _calendarRowKind: 'privateReservation' })
  )
}

function isActiveRenderableCalendarPrivateLesson(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false
  if (hasNonRenderablePrivateEventStatus(row)) return false
  return isCountableLessonOccurrence(row)
}

function buildOpenPrivateSlotDedupeState(lessons, privateLessonReservations) {
  const linkedSlotIds = new Set()
  const legacyRows = []
  const sources = [
    ...(Array.isArray(lessons) ? lessons : []).map((row) => ({
      row,
      renderable: isActiveRenderableCalendarPrivateLesson(row),
    })),
    ...(Array.isArray(privateLessonReservations) ? privateLessonReservations : []).map((row) => ({
      row,
      renderable: isRenderableCalendarPrivateReservation(row),
    })),
  ]
  sources.forEach(({ row, renderable }) => {
    if (!renderable || isGroupCalendarSource(row)) return
    const rowSlotIds = getLinkedSlotIds(row)
    if (rowSlotIds.size > 0) {
      rowSlotIds.forEach((id) => linkedSlotIds.add(id))
      return
    }
    const date = String(getLessonStorageDateString(row) || row.date || '').trim()
    const time = String(row.time || '').trim()
    const teacherUid = getCanonicalPrivateEventTeacherUid(row)
    if (date && time && teacherUid) {
      legacyRows.push({ date, time, teacherUid })
    }
  })
  return { linkedSlotIds, legacyRows }
}

export function excludeOpenPrivateSlotsFromInstructionalStatistics(rows) {
  return (Array.isArray(rows) ? rows : []).filter(
    (row) => row?._calendarRowKind !== 'openPrivateSlot' && row?.type !== 'openPrivateSlot'
  )
}

export function buildOpenDatedPrivateSlotCalendarRows({
  includeOpenPrivateSlots = false,
  privateLessonSlots = [],
  lessons = [],
  privateLessonReservations = [],
  academyId,
  rangeStartDate,
  rangeEndDate,
  selectedTeacherUid = null,
} = {}) {
  if (includeOpenPrivateSlots !== true) return []
  const scopedAcademyId = typeof academyId === 'string' ? academyId.trim() : ''
  const startDate = String(rangeStartDate || '')
  const endDate = String(rangeEndDate || '')
  if (
    !scopedAcademyId ||
    canonicalKstDateTimeMillis(startDate, '00:00') == null ||
    canonicalKstDateTimeMillis(endDate, '00:00') == null ||
    endDate < startDate
  ) {
    return []
  }

  const { linkedSlotIds, legacyRows } = buildOpenPrivateSlotDedupeState(
    lessons,
    privateLessonReservations
  )
  const rows = []

  ;(Array.isArray(privateLessonSlots) ? privateLessonSlots : []).forEach((slot) => {
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return
    const slotId = typeof slot.id === 'string' ? slot.id.trim() : ''
    if (
      !slotId ||
      typeof slot.academyId !== 'string' ||
      slot.academyId !== scopedAcademyId
    ) {
      return
    }
    if (slot.status !== 'open' || slot.reservedCount !== 0) return
    if (
      slot.reservedStudentId !== '' ||
      slot.reservedAt !== null ||
      slot.reservationId !== ''
    ) {
      return
    }
    if (OPEN_PRIVATE_SLOT_LINK_FIELDS.some((field) => hasMalformedOrPresentLink(slot, field))) {
      return
    }
    if (hasFixedTemplateReleasedOrClosedMarker(slot)) return
    const teacherUid = getCanonicalPrivateEventTeacherUid(slot)
    if (!teacherUid) return
    if (selectedTeacherUid !== null) {
      if (
        typeof selectedTeacherUid !== 'string' ||
        !selectedTeacherUid ||
        selectedTeacherUid !== selectedTeacherUid.trim() ||
        teacherUid !== selectedTeacherUid
      ) {
        return
      }
    }

    const date = typeof slot.date === 'string' ? slot.date : ''
    const time = typeof slot.time === 'string' ? slot.time : ''
    const canonicalStartMillis = canonicalKstDateTimeMillis(date, time)
    const storedStartMillis = timestampToMillis(slot.startAt)
    const durationMinutes = slot.durationMinutes
    if (
      canonicalStartMillis == null ||
      storedStartMillis !== canonicalStartMillis ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes < OPEN_PRIVATE_SLOT_MIN_DURATION_MINUTES ||
      durationMinutes > OPEN_PRIVATE_SLOT_MAX_DURATION_MINUTES ||
      date < startDate ||
      date > endDate
    ) {
      return
    }
    if (linkedSlotIds.has(slotId)) return
    if (
      legacyRows.some(
        ({ date: legacyDate, time: legacyTime, teacherUid: legacyTeacherUid }) =>
          legacyDate === date &&
          legacyTime === time &&
          legacyTeacherUid === teacherUid
      )
    ) {
      return
    }

    const endMillis = storedStartMillis + durationMinutes * 60 * 1000
    rows.push({
      id: `open-private-slot:${slotId}`,
      _calendarRowKind: 'openPrivateSlot',
      type: 'openPrivateSlot',
      lessonType: 'private',
      academyId: scopedAcademyId,
      date,
      time,
      startAt: slot.startAt,
      startMillis: storedStartMillis,
      endAt: new Date(endMillis),
      endMillis,
      durationMinutes,
      timeRangeLabel: `${formatKstTimeFromMillis(storedStartMillis)}–${formatKstTimeFromMillis(
        endMillis
      )}`,
      teacher: String(slot.teacher || slot.teacherName || '').trim(),
      teacherName: String(slot.teacherName || slot.teacher || '').trim(),
      teacherKey: String(slot.teacherKey || '').trim(),
      teacherUid,
      teacherId: String(slot.teacherId || slot.teacherID || '').trim(),
      teacherDisplayName: String(slot.teacherDisplayName || '').trim(),
      displayName: String(slot.displayName || '').trim(),
      subject: String(slot.subject || '').trim(),
      slotId,
      privateLessonSlotId: slotId,
      slotStatus: 'open',
      status: 'open',
      readOnly: true,
      isReadOnly: true,
    })
  })

  return rows.sort(
    (a, b) => a.startMillis - b.startMillis || a.id.localeCompare(b.id, 'en')
  )
}

function isStudentFixedPrivateSeatReleasedCancellation(lesson) {
  const status = String(lesson?.status || '').trim().toLowerCase()
  const cancellationType = String(lesson?.cancellationType || '').trim().toLowerCase()
  const cancelledByRole = String(
    lesson?.cancelledByRole || lesson?.canceledByRole || ''
  )
    .trim()
    .toLowerCase()
  const cancellationReason = String(
    lesson?.cancellationReason || lesson?.cancelledReason || ''
  )
    .trim()
    .toLowerCase()
  return (
    (status === 'cancelled' || status === 'canceled') &&
    cancellationType === 'seat_released' &&
    (cancelledByRole === 'student' || cancellationReason.includes('student_cancelled'))
  )
}

function addPrivateLessonReservationLinkKeys(keys, lesson) {
  if (!keys || !lesson) return
  const lessonIds = [lesson.id, lesson.lessonId, lesson.fixedLessonId]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  lessonIds.forEach((lessonId) => {
    keys.add(`lessonId:${lessonId}`)
    keys.add(`fixedLessonId:${lessonId}`)
  })

  const reservationId = String(lesson.reservationId || '').trim()
  if (reservationId) keys.add(`reservationId:${reservationId}`)

  const slotId = String(lesson.slotId || lesson.privateLessonSlotId || '').trim()
  if (slotId) keys.add(`slotId:${slotId}`)

  const date = String(getLessonStorageDateString(lesson) || lesson.date || '').trim()
  const time = String(lesson.time || '').trim()
  const studentKey = normalizeText(
    lesson.studentId || lesson.studentID || getStudentName(lesson)
  )
  const teacherKey = normalizeText(
    lesson.teacherName || lesson.teacher || lesson.teacherKey || lesson.teacherUid
  )
  if (date && time && studentKey && teacherKey) {
    keys.add(`datetime:${date}|${time}|${studentKey}|${teacherKey}`)
  }
}

function getPrivateReservationLinkKeys(reservation) {
  const keys = []
  const reservationIds = [reservation?.id, reservation?.reservationId]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  reservationIds.forEach((reservationId) => keys.push(`reservationId:${reservationId}`))

  const slotId = String(reservation?.slotId || '').trim()
  if (slotId) keys.push(`slotId:${slotId}`)

  ;[reservation?.lessonId, reservation?.fixedLessonId].forEach((lessonIdValue) => {
    const lessonId = String(lessonIdValue || '').trim()
    if (!lessonId) return
    keys.push(`lessonId:${lessonId}`)
    keys.push(`fixedLessonId:${lessonId}`)
  })

  const date = String(reservation?.date || '').trim()
  const time = String(reservation?.time || '').trim()
  const studentKey = normalizeText(
    reservation?.studentId || reservation?.studentName || reservation?.student
  )
  const teacherKey = normalizeText(
    reservation?.teacherName ||
      reservation?.teacher ||
      reservation?.teacherKey ||
      reservation?.teacherUid
  )
  if (date && time && studentKey && teacherKey) {
    keys.push(`datetime:${date}|${time}|${studentKey}|${teacherKey}`)
  }

  return keys
}

function buildCalendarPrivateReservationRows({
  privateLessonReservations,
  privateSlotById,
  approvedPrivateLessonKeys,
  cancelledFixedPrivateLessonKeys,
  selectedCalendarTeacherScope = null,
}) {
  const rows = Array.isArray(privateLessonReservations) ? privateLessonReservations : []
  return rows
    .filter(isRenderableCalendarPrivateReservation)
    .filter((reservation) => {
      if (!selectedCalendarTeacherScope) return true
      const slot = privateSlotById.get(String(reservation.slotId || '').trim()) || null
      return (
        rowMatchesTeacherScope(reservation, selectedCalendarTeacherScope) ||
        rowMatchesTeacherScope(slot, selectedCalendarTeacherScope)
      )
    })
    .map((reservation) => {
      const slot = privateSlotById.get(String(reservation.slotId || '').trim()) || null
      const date = String(reservation.date || slot?.date || '').trim()
      const time = String(reservation.time || slot?.time || '').trim()
      const teacherLabel =
        String(reservation.teacherName || '').trim() ||
        String(reservation.teacher || '').trim() ||
        String(slot?.teacherName || '').trim() ||
        String(slot?.teacher || '').trim()
      const studentLabel =
        String(reservation.studentName || '').trim() ||
        String(reservation.student || '').trim() ||
        String(reservation.studentId || '').trim()
      const subject =
        String(reservation.subject || '').trim() ||
        String(slot?.subject || '').trim() ||
        '1:1 수업'
      return {
        ...reservation,
        _calendarRowKind: 'privateReservation',
        date,
        time,
        studentName: studentLabel || '-',
        teacherName: teacherLabel || '-',
        teacher: teacherLabel || '-',
        subject,
        startAt: reservation.startAt || slot?.startAt || null,
        durationMinutes: reservation.durationMinutes || slot?.durationMinutes || 50,
        slotStatus: slot?.status || '',
        slotType: slot?.slotType || '',
        releaseReason: reservation.releaseReason || slot?.releaseReason || '',
        blockReason: reservation.blockReason || slot?.blockReason || '',
        unavailableReason: reservation.unavailableReason || slot?.unavailableReason || '',
      }
    })
    .filter((reservation) => {
      if (!reservation.date) return false
      const linkedToCancelledFixedLesson = getPrivateReservationLinkKeys(reservation).some((key) =>
        cancelledFixedPrivateLessonKeys.has(key)
      )
      if (linkedToCancelledFixedLesson) return false
      const reservationId = String(reservation.id || reservation.reservationId || '').trim()
      const slotId = String(reservation.slotId || '').trim()
      if (reservationId && approvedPrivateLessonKeys.has(`reservationId:${reservationId}`)) {
        return false
      }
      if (slotId && approvedPrivateLessonKeys.has(`slotId:${slotId}`)) return false
      const fallbackKey = [
        String(reservation.date || '').trim(),
        String(reservation.time || '').trim(),
        normalizeText(reservation.studentId || reservation.studentName || reservation.student),
        normalizeText(reservation.teacherName || reservation.teacher),
      ].join('__')
      return !approvedPrivateLessonKeys.has(fallbackKey)
    })
}

export default function useCalendarSectionViewModel({
  lessons,
  privateLessonReservations,
  privateLessonSlots,
  studentSummaryGroupLessons,
  groupClasses,
  selectedDateString,
  showOnlySelectedDate,
  userProfile,
  selectedCalendarTeacherUid = null,
  includeOpenPrivateSlots = false,
  currentAcademyId,
  calendarMonth,
}) {
  const todayYmd = getTodayStorageDateString()
  const selectedCalendarTeacherScope = useMemo(() => {
    if (
      includeOpenPrivateSlots !== true ||
      typeof selectedCalendarTeacherUid !== 'string' ||
      !selectedCalendarTeacherUid
    ) {
      return null
    }
    return {
      teacherUid: selectedCalendarTeacherUid,
      teacherUID: selectedCalendarTeacherUid,
    }
  }, [includeOpenPrivateSlots, selectedCalendarTeacherUid])
  const selectedOpenSlotTeacherUid = useMemo(() => {
    return includeOpenPrivateSlots === true ? selectedCalendarTeacherUid : null
  }, [includeOpenPrivateSlots, selectedCalendarTeacherUid])
  const calendarRange = useMemo(() => {
    const days = getCalendarDays(calendarMonth instanceof Date ? calendarMonth : new Date())
    return {
      startDate: getStorageDateStringFromDate(days[0]),
      endDate: getStorageDateStringFromDate(days[days.length - 1]),
    }
  }, [calendarMonth])

  const activeGroupClassById = useMemo(() => {
    return new Map(
      groupClasses
        .filter(isActiveGroupClassRow)
        .map((groupClass) => [String(groupClass.id || ''), groupClass])
    )
  }, [groupClasses])

  const sortedLessons = useMemo(() => {
    return [...lessons].sort((a, b) => {
      const aDate = getLessonDate(a)
      const bDate = getLessonDate(b)

      if (!aDate && !bDate) return 0
      if (!aDate) return 1
      if (!bDate) return -1

      return aDate.getTime() - bDate.getTime()
    })
  }, [lessons])

  const visibleLessons = useMemo(() => {
    if (userProfile?.role === 'teacher' && userProfile?.teacherName) {
      const myTeacherName = normalizeText(userProfile.teacherName)
      return sortedLessons.filter(
        (lesson) => normalizeText(getTeacherName(lesson)) === myTeacherName
      )
    }

    if (selectedCalendarTeacherScope) {
      return sortedLessons.filter((lesson) =>
        rowMatchesTeacherScope(lesson, selectedCalendarTeacherScope)
      )
    }

    return sortedLessons
  }, [selectedCalendarTeacherScope, sortedLessons, userProfile])

  const activeGroupLessons = useMemo(() => {
    const rows = Array.isArray(studentSummaryGroupLessons)
      ? studentSummaryGroupLessons
      : []
    return rows.filter((gl) => {
      if (isClassClosureCancelledGroupLesson(gl)) return false
      const gcid = getGroupLessonGroupId(gl)
      if (gcid && activeGroupClassById.has(String(gcid))) return true
      return Boolean(findGroupClassForLesson(gl, groupClasses))
    })
  }, [activeGroupClassById, groupClasses, studentSummaryGroupLessons])

  const visibleGroupLessons = useMemo(() => {
    if (userProfile?.role === 'teacher' && userProfile?.teacherName) {
      const myTeacherName = normalizeText(userProfile.teacherName)
      return activeGroupLessons.filter((gl) => {
        const gcid = getGroupLessonGroupId(gl)
        const gc = activeGroupClassById.get(String(gcid)) || findGroupClassForLesson(gl, groupClasses)
        return gc && normalizeText(gc.teacher || '') === myTeacherName
      })
    }
    if (selectedCalendarTeacherScope) {
      return activeGroupLessons.filter((gl) => {
        const gcid = getGroupLessonGroupId(gl)
        const gc = activeGroupClassById.get(String(gcid)) || findGroupClassForLesson(gl, groupClasses)
        return (
          rowMatchesTeacherScope(gl, selectedCalendarTeacherScope) ||
          rowMatchesTeacherScope(gc, selectedCalendarTeacherScope)
        )
      })
    }
    return activeGroupLessons
  }, [
    activeGroupClassById,
    activeGroupLessons,
    groupClasses,
    selectedCalendarTeacherScope,
    userProfile,
  ])

  const calendarGroupLessonRows = useMemo(() => {
    return buildCalendarGroupLessonRows(visibleGroupLessons, groupClasses, todayYmd)
  }, [visibleGroupLessons, groupClasses, todayYmd])

  const allCalendarGroupLessonRows = useMemo(() => {
    return buildCalendarGroupLessonRows(activeGroupLessons, groupClasses, todayYmd)
  }, [activeGroupLessons, groupClasses, todayYmd])

  const privateSlotById = useMemo(() => {
    return new Map(
      (Array.isArray(privateLessonSlots) ? privateLessonSlots : []).map((slot) => [
        String(slot.id || '').trim(),
        slot,
      ])
    )
  }, [privateLessonSlots])

  const approvedPrivateLessonKeys = useMemo(() => {
    const byKey = new Set()
    visibleLessons.forEach((lesson) => {
      const status = String(lesson?.status || '').trim().toLowerCase()
      const cancellationType = String(lesson?.cancellationType || '').trim().toLowerCase()
      const isReleasedOrCancelled =
        status === 'cancelled' ||
        status === 'canceled' ||
        cancellationType === 'seat_released' ||
        lesson?.isSeatReleased === true
      if (isReleasedOrCancelled) return
      const directReservationId = String(lesson.reservationId || '').trim()
      const directSlotId = String(lesson.slotId || '').trim()
      if (directReservationId) byKey.add(`reservationId:${directReservationId}`)
      if (directSlotId) byKey.add(`slotId:${directSlotId}`)
      const base = [
        String(getLessonStorageDateString(lesson) || '').trim(),
        String(lesson.time || '').trim(),
        normalizeText(getTeacherName(lesson)),
      ]
      const studentKeys = [
        normalizeText(lesson.studentId || lesson.studentID || ''),
        normalizeText(getStudentName(lesson)),
      ].filter(Boolean)
      studentKeys.forEach((studentKey) => {
        byKey.add([base[0], base[1], studentKey, base[2]].join('__'))
      })
    })
    return byKey
  }, [visibleLessons])

  const allApprovedPrivateLessonKeys = useMemo(() => {
    const byKey = new Set()
    sortedLessons.forEach((lesson) => {
      const status = String(lesson?.status || '').trim().toLowerCase()
      const cancellationType = String(lesson?.cancellationType || '').trim().toLowerCase()
      const isReleasedOrCancelled =
        status === 'cancelled' ||
        status === 'canceled' ||
        cancellationType === 'seat_released' ||
        lesson?.isSeatReleased === true
      if (isReleasedOrCancelled) return
      const directReservationId = String(lesson.reservationId || '').trim()
      const directSlotId = String(lesson.slotId || '').trim()
      if (directReservationId) byKey.add(`reservationId:${directReservationId}`)
      if (directSlotId) byKey.add(`slotId:${directSlotId}`)
      const base = [
        String(getLessonStorageDateString(lesson) || '').trim(),
        String(lesson.time || '').trim(),
        normalizeText(getTeacherName(lesson)),
      ]
      const studentKeys = [
        normalizeText(lesson.studentId || lesson.studentID || ''),
        normalizeText(getStudentName(lesson)),
      ].filter(Boolean)
      studentKeys.forEach((studentKey) => {
        byKey.add([base[0], base[1], studentKey, base[2]].join('__'))
      })
    })
    return byKey
  }, [sortedLessons])

  const cancelledFixedPrivateLessonKeys = useMemo(() => {
    const byKey = new Set()
    visibleLessons.forEach((lesson) => {
      if (!isStudentFixedPrivateSeatReleasedCancellation(lesson)) return
      addPrivateLessonReservationLinkKeys(byKey, lesson)
    })
    return byKey
  }, [visibleLessons])

  const allCancelledFixedPrivateLessonKeys = useMemo(() => {
    const byKey = new Set()
    sortedLessons.forEach((lesson) => {
      if (!isStudentFixedPrivateSeatReleasedCancellation(lesson)) return
      addPrivateLessonReservationLinkKeys(byKey, lesson)
    })
    return byKey
  }, [sortedLessons])

  const calendarPrivateReservationRows = useMemo(() => {
    return buildCalendarPrivateReservationRows({
      privateLessonReservations,
      privateSlotById,
      approvedPrivateLessonKeys,
      cancelledFixedPrivateLessonKeys,
      selectedCalendarTeacherScope,
    })
  }, [
    approvedPrivateLessonKeys,
    cancelledFixedPrivateLessonKeys,
    privateLessonReservations,
    privateSlotById,
    selectedCalendarTeacherScope,
  ])

  const allCalendarPrivateReservationRows = useMemo(() => {
    return buildCalendarPrivateReservationRows({
      privateLessonReservations,
      privateSlotById,
      approvedPrivateLessonKeys: allApprovedPrivateLessonKeys,
      cancelledFixedPrivateLessonKeys: allCancelledFixedPrivateLessonKeys,
      selectedCalendarTeacherScope: null,
    })
  }, [
    allApprovedPrivateLessonKeys,
    allCancelledFixedPrivateLessonKeys,
    privateLessonReservations,
    privateSlotById,
  ])

  const calendarOpenPrivateSlotRows = useMemo(() => {
    return buildOpenDatedPrivateSlotCalendarRows({
      includeOpenPrivateSlots,
      privateLessonSlots,
      lessons: visibleLessons,
      privateLessonReservations,
      academyId: currentAcademyId,
      rangeStartDate: calendarRange.startDate,
      rangeEndDate: calendarRange.endDate,
      selectedTeacherUid: selectedOpenSlotTeacherUid,
    })
  }, [
    calendarRange.endDate,
    calendarRange.startDate,
    currentAcademyId,
    includeOpenPrivateSlots,
    selectedOpenSlotTeacherUid,
    privateLessonReservations,
    privateLessonSlots,
    visibleLessons,
  ])

  const allCalendarOpenPrivateSlotRows = useMemo(() => {
    return buildOpenDatedPrivateSlotCalendarRows({
      includeOpenPrivateSlots,
      privateLessonSlots,
      lessons: sortedLessons,
      privateLessonReservations,
      academyId: currentAcademyId,
      rangeStartDate: calendarRange.startDate,
      rangeEndDate: calendarRange.endDate,
      selectedTeacherUid: null,
    })
  }, [
    calendarRange.endDate,
    calendarRange.startDate,
    currentAcademyId,
    includeOpenPrivateSlots,
    privateLessonReservations,
    privateLessonSlots,
    sortedLessons,
  ])

  const calendarCombinedLessons = useMemo(() => {
    const priv = visibleLessons.map((l) => ({ ...l, _calendarRowKind: 'private' }))
    return sortCalendarRows([
      ...priv,
      ...calendarGroupLessonRows,
      ...calendarPrivateReservationRows,
      ...calendarOpenPrivateSlotRows,
    ])
  }, [
    visibleLessons,
    calendarGroupLessonRows,
    calendarPrivateReservationRows,
    calendarOpenPrivateSlotRows,
  ])

  const allCalendarCombinedLessons = useMemo(() => {
    const priv = sortedLessons.map((l) => ({ ...l, _calendarRowKind: 'private' }))
    return sortCalendarRows([
      ...priv,
      ...allCalendarGroupLessonRows,
      ...allCalendarPrivateReservationRows,
      ...allCalendarOpenPrivateSlotRows,
    ])
  }, [
    sortedLessons,
    allCalendarGroupLessonRows,
    allCalendarPrivateReservationRows,
    allCalendarOpenPrivateSlotRows,
  ])

  const calendarInstructionalLessons = useMemo(
    () => excludeOpenPrivateSlotsFromInstructionalStatistics(calendarCombinedLessons),
    [calendarCombinedLessons]
  )

  const allCalendarInstructionalLessons = useMemo(
    () => excludeOpenPrivateSlotsFromInstructionalStatistics(allCalendarCombinedLessons),
    [allCalendarCombinedLessons]
  )

  const displayedLessons = useMemo(() => {
    if (showOnlySelectedDate) {
      return calendarCombinedLessons.filter(
        (lesson) => getLessonStorageDateString(lesson) === selectedDateString
      )
    }

    return calendarCombinedLessons
  }, [showOnlySelectedDate, calendarCombinedLessons, selectedDateString])

  const lessonsCountByDate = useMemo(() => {
    const map = new Map()

    calendarCombinedLessons.forEach((lesson) => {
      const dateKey = getLessonStorageDateString(lesson)
      if (!dateKey) return
      map.set(dateKey, (map.get(dateKey) || 0) + 1)
    })

    return map
  }, [calendarCombinedLessons])

  const lessonsPreviewByDate = useMemo(() => {
    const map = new Map()

    calendarCombinedLessons.forEach((lesson) => {
      const dateKey = getLessonStorageDateString(lesson)
      if (!dateKey) return
      const current = map.get(dateKey) || []
      const isGroupRow = lesson._calendarRowKind === 'group'
      const isPrivateReservationRow = lesson._calendarRowKind === 'privateReservation'
      const isOpenPrivateSlotRow = lesson._calendarRowKind === 'openPrivateSlot'
      const cancellationType = String(lesson?.cancellationType || '').trim().toLowerCase()
      const isReleasedFixedPrivateRow =
        !isGroupRow &&
        !isPrivateReservationRow &&
        (cancellationType === 'seat_released' || lesson?.isSeatReleased === true)
      const studentName = getStudentName(lesson)
      current.push({
        id: lesson.id,
        kind: lesson._calendarRowKind || 'private',
        teacherName: getTeacherName(lesson),
        time: lesson.time || '',
        label: [
          isGroupRow
            ? lesson.groupClassDisplayName || '단체수업'
            : isOpenPrivateSlotRow
              ? lesson.timeRangeLabel
            : isPrivateReservationRow
              ? '학생예약'
              : isReleasedFixedPrivateRow
                ? '자리공개'
                : studentName,
          isPrivateReservationRow || isReleasedFixedPrivateRow ? studentName : '',
          lesson.time || '',
          isPrivateReservationRow || isReleasedFixedPrivateRow
            ? ''
            : formatLessonSessionNumber(lesson),
        ]
          .filter(Boolean)
          .join(' · '),
      })
      map.set(dateKey, current)
    })

    map.forEach((previews) => {
      previews.sort((a, b) => {
        const priority = (preview) => (preview.kind === 'privateReservation' ? 0 : 1)
        const priorityDiff = priority(a) - priority(b)
        if (priorityDiff !== 0) return priorityDiff
        return String(a.time || '').localeCompare(String(b.time || ''), 'ko')
      })
    })

    return map
  }, [calendarCombinedLessons])

  return {
    visibleLessons,
    visibleGroupLessons,
    calendarGroupLessonRows,
    calendarPrivateReservationRows,
    calendarOpenPrivateSlotRows,
    calendarCombinedLessons,
    allCalendarCombinedLessons,
    calendarInstructionalLessons,
    allCalendarInstructionalLessons,
    displayedLessons,
    lessonsCountByDate,
    lessonsPreviewByDate,
  }
}
