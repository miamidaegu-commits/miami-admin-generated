import { normalizeText } from './dashboardViewUtils.js'

function normalizeId(value) {
  return String(value || '').trim()
}

function normalizeKey(value) {
  return normalizeText(value || '')
}

function normalizeCount(value) {
  const count = Number(value ?? 0)
  return Number.isFinite(count) ? Math.max(0, count) : 0
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  value.forEach((item) => {
    const id = normalizeId(item)
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push(id)
  })
  return out
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

function getKstTodayString(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now))
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`
}

function getKstDateTimeMillis(dateValue, timeValue) {
  const date = normalizeId(dateValue)
  const time = normalizeId(timeValue || '23:59')
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

function getRowDate(row) {
  return normalizeId(row?.date || row?.lessonDate || row?.scheduleDate)
}

function getRowStartMillis(row) {
  const value = row?.startAt || row?.startsAt
  if (value && typeof value.toMillis === 'function') return value.toMillis()
  if (value && typeof value.toDate === 'function') return value.toDate().getTime()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return getKstDateTimeMillis(getRowDate(row), row?.time || row?.startTime || row?.scheduleTime)
}

function isFutureAllocation(row, now) {
  const startMillis = getRowStartMillis(row)
  if (startMillis !== null && Number.isFinite(startMillis)) return startMillis >= now
  const date = getRowDate(row)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= getKstTodayString(now)
}

function isActivePrivateReservationStatus(status) {
  return ['active', 'reserved', 'confirmed', 'booked'].includes(
    normalizeId(status).toLowerCase()
  )
}

function isFixedPrivateReservation(row) {
  const sourceType = normalizeId(row?.sourceType).toLowerCase()
  const reservationType = normalizeId(row?.reservationType || row?.type).toLowerCase()
  return (
    sourceType === 'fixed-private-slot-assignment' ||
    sourceType === 'weekly-slot-fixed-assignment' ||
    reservationType === 'fixed' ||
    reservationType === 'fixed_private'
  )
}

function isPrivateLessonReleasedFromDeduction(lesson) {
  const status = normalizeId(lesson?.status).toLowerCase()
  const cancellationType = normalizeId(lesson?.cancellationType).toLowerCase()
  const cancelledReason = normalizeId(lesson?.cancelledReason).toLowerCase()
  if (lesson?.isDeductCancelled === true) return true
  if (lesson?.noDeduction === true) return true
  if (status === 'cancelled' || status === 'canceled') return true
  if (cancellationType === 'no_deduction') return true
  if (cancellationType === 'class_closure') return true
  return ['holiday', 'teacher_unavailable', 'academy_closed'].includes(cancelledReason)
}

function isNoDeductionLesson(row) {
  const status = normalizeId(row?.status).toLowerCase()
  const cancellationType = normalizeId(row?.cancellationType).toLowerCase()
  const cancelledReason = normalizeId(row?.cancelledReason).toLowerCase()
  if (row?.isDeductCancelled === true || row?.noDeduction === true) return true
  if (status === 'cancelled' || status === 'canceled') return true
  if (cancellationType === 'no_deduction' || cancellationType === 'class_closure') return true
  return ['holiday', 'teacher_unavailable', 'academy_closed'].includes(cancelledReason)
}

function getPackageTeacherKeys(ticket) {
  return getPrivateTeacherScopeKeys(ticket)
}

function getGroupClassScopeValues(row) {
  return normalizeIdList([
    row?.groupClassId,
    row?.classID,
    row?.classId,
    row?.groupId,
    ...normalizeIdList(row?.groupClassIds),
  ])
}

function getGroupCourseScopeValues(row) {
  return normalizeIdList([
    row?.groupCourseType,
    row?.courseType,
    ...normalizeIdList(row?.groupCourseTypes),
  ])
}

function getGroupTicketPackageType(ticket) {
  return normalizeId(ticket?.packageType).toLowerCase()
}

export function isGroupTicketFreeBookingAllowed(ticket) {
  const packageType = getGroupTicketPackageType(ticket)
  if (packageType === 'opengroup') return true
  if (packageType !== 'group') return false
  return ticket?.allowGroupFreeBooking === true || ticket?.allowStudentGroupBooking === true
}

function privateRowMatchesTicketScope({
  row,
  ticket,
  academyId,
  studentId,
  teacherScope,
  packageIdFields = ['packageId'],
}) {
  if (normalizeId(row?.academyId) !== normalizeId(academyId)) return false
  const rowStudentId = normalizeId(row?.studentId || row?.studentID)
  if (rowStudentId !== normalizeId(studentId)) return false
  const ticketId = normalizeId(ticket?.id)
  const rowPackageIds = packageIdFields.map((key) => normalizeId(row?.[key])).filter(Boolean)
  if (rowPackageIds.length > 0) {
    if (ticketId && rowPackageIds.includes(ticketId)) return true
  }

  const ticketKeys = getPackageTeacherKeys(ticket)
  const rowKeys = getPrivateTeacherScopeKeys(row)
  if (ticketKeys.length === 0) return false
  if (rowKeys.length > 0) return rowKeys.some((key) => ticketKeys.includes(key))
  if (rowPackageIds.length > 0) return false

  const requestedKeys = [
    teacherScope?.teacherUid,
    teacherScope?.teacherUID,
    teacherScope?.teacherId,
    teacherScope?.teacherID,
    teacherScope?.teacherKey,
    teacherScope?.teacher,
    teacherScope?.teacherName,
    teacherScope?.displayName,
    teacherScope?.name,
  ]
    .map(normalizeKey)
    .filter(Boolean)
  return requestedKeys.some((key) => ticketKeys.includes(key))
}

function groupRowMatchesTicketScope({
  row,
  ticket,
  academyId,
  studentId,
  groupScope,
  packageIdFields = ['packageId'],
}) {
  if (normalizeId(row?.academyId) !== normalizeId(academyId)) return false
  const rowStudentId = normalizeId(row?.studentId || row?.studentID)
  if (rowStudentId && rowStudentId !== normalizeId(studentId)) return false
  const ticketId = normalizeId(ticket?.id)
  const rowPackageIds = packageIdFields.map((key) => normalizeId(row?.[key])).filter(Boolean)
  if (ticketId && rowPackageIds.length > 0) return rowPackageIds.includes(ticketId)

  const ticketClassIds = getGroupClassScopeValues(ticket)
  const rowClassIds = [
    ...getGroupClassScopeValues(row),
    ...getGroupClassScopeValues(groupScope || {}),
  ]
  if (ticketClassIds.length > 0 && rowClassIds.some((id) => ticketClassIds.includes(id))) {
    return true
  }

  const ticketCourseTypes = getGroupCourseScopeValues(ticket)
  const rowCourseTypes = [
    ...getGroupCourseScopeValues(row),
    ...getGroupCourseScopeValues(groupScope || {}),
  ]
  if (
    ticketCourseTypes.length > 0 &&
    rowCourseTypes.some((courseType) => ticketCourseTypes.includes(courseType))
  ) {
    return true
  }

  return false
}

function getTicketLabels({
  ticket,
  remainingCount,
  availableToBook,
  ambiguousLegacyMatch = false,
  availableLabel = '예약 가능',
}) {
  if (!ticket) {
    return {
      statusLabel: ambiguousLegacyMatch ? '수강권 연결 필요' : '수강권 등록 필요',
      actionLabel: ambiguousLegacyMatch ? '수강권 연결 필요' : '수강권 등록 필요',
    }
  }
  if (ambiguousLegacyMatch) {
    return { statusLabel: '수강권 연결 필요', actionLabel: '수강권 연결 필요' }
  }
  if (remainingCount <= 0) return { statusLabel: '소진', actionLabel: '소진' }
  if (availableToBook <= 0) {
    return { statusLabel: `${availableLabel} 0회`, actionLabel: `${availableLabel} 0회` }
  }
  return {
    statusLabel: `${availableLabel} ${availableToBook}회`,
    actionLabel: `${availableLabel} ${availableToBook}회`,
  }
}

function buildBalanceResult({
  ticket,
  fixedLessons,
  reservations,
  academyId,
  studentId,
  now,
  rowMatchesTicketScope,
  isReleasedFromDeduction = isNoDeductionLesson,
  ambiguousLegacyMatch = false,
  availableLabel = '예약 가능',
}) {
  if (!ticket) {
    const labels = getTicketLabels({
      ticket,
      remainingCount: 0,
      availableToBook: 0,
      ambiguousLegacyMatch,
      availableLabel,
    })
    return {
      totalCount: 0,
      usedCount: 0,
      usedDeductedCount: 0,
      remainingCount: 0,
      futureFixedAllocatedCount: 0,
      activeFutureReservationCount: 0,
      activeFutureReservationAllocatedCount: 0,
      noDeductionReleasedCount: 0,
      availableToBook: 0,
      makeupAvailableCount: 0,
      ...labels,
    }
  }

  const totalCount = normalizeCount(ticket.totalCount)
  const usedCount = normalizeCount(ticket.usedCount)
  const remainingCount = normalizeCount(ticket.remainingCount)
  const rawAvailableCount =
    totalCount > 0 ? Math.min(remainingCount, Math.max(0, totalCount - usedCount)) : remainingCount

  let futureFixedAllocatedCount = 0
  let noDeductionReleasedCount = 0
  ;(Array.isArray(fixedLessons) ? fixedLessons : []).forEach((lesson) => {
    if (!rowMatchesTicketScope(lesson)) return
    if (isReleasedFromDeduction(lesson)) {
      noDeductionReleasedCount += 1
      return
    }
    if (isFutureAllocation(lesson, now)) futureFixedAllocatedCount += 1
  })

  let activeFutureReservationCount = 0
  ;(Array.isArray(reservations) ? reservations : []).forEach((reservation) => {
    if (!isActivePrivateReservationStatus(reservation?.status)) return
    if (!rowMatchesTicketScope(reservation, ['packageId', 'deductionPackageId'])) return
    if (isFixedPrivateReservation(reservation)) {
      if (isFutureAllocation(reservation, now)) futureFixedAllocatedCount += 1
      return
    }
    activeFutureReservationCount += 1
  })

  const availableToBook = Math.max(
    0,
    rawAvailableCount - futureFixedAllocatedCount - activeFutureReservationCount
  )
  const labels = getTicketLabels({
    ticket,
    remainingCount,
    availableToBook,
    ambiguousLegacyMatch,
    availableLabel,
  })

  return {
    totalCount,
    usedCount,
    usedDeductedCount: usedCount,
    remainingCount,
    futureFixedAllocatedCount,
    activeFutureReservationCount,
    activeFutureReservationAllocatedCount: activeFutureReservationCount,
    noDeductionReleasedCount,
    availableToBook,
    makeupAvailableCount: availableToBook,
    ...labels,
  }
}

export function computePrivateTicketBalance({
  ticket,
  fixedPrivateLessons = [],
  privateReservations = [],
  studentId,
  teacherScope = {},
  academyId = ticket?.academyId,
  now = Date.now(),
  ambiguousLegacyMatch = false,
}) {
  return buildBalanceResult({
    ticket,
    fixedLessons: fixedPrivateLessons,
    reservations: privateReservations,
    academyId,
    studentId,
    now,
    ambiguousLegacyMatch,
    isReleasedFromDeduction: isPrivateLessonReleasedFromDeduction,
    availableLabel: '직접 예약 가능',
    rowMatchesTicketScope: (row, packageIdFields = ['packageId']) =>
      privateRowMatchesTicketScope({
        row,
        ticket,
        academyId,
        studentId,
        teacherScope,
        packageIdFields,
      }),
  })
}

export function computeGroupTicketBalance({
  ticket,
  fixedGroupLessons = [],
  groupReservations = [],
  studentId,
  groupScope = {},
  academyId = ticket?.academyId,
  now = Date.now(),
  ambiguousLegacyMatch = false,
}) {
  const balance = buildBalanceResult({
    ticket,
    fixedLessons: fixedGroupLessons,
    reservations: groupReservations,
    academyId,
    studentId,
    now,
    ambiguousLegacyMatch,
    availableLabel: '자유 예약 가능',
    rowMatchesTicketScope: (row, packageIdFields = ['packageId']) =>
      groupRowMatchesTicketScope({
        row,
        ticket,
        academyId,
        studentId,
        groupScope,
        packageIdFields,
      }),
  })
  if (!ticket) return balance
  if (isGroupTicketFreeBookingAllowed(ticket)) {
    return {
      ...balance,
      availableFreeBookingCount: balance.availableToBook,
    }
  }
  const noPermissionLabel =
    balance.remainingCount <= 0 ? '소진' : '반 등록 수업만 가능'
  return {
    ...balance,
    availableToBook: 0,
    availableFreeBookingCount: 0,
    makeupAvailableCount: 0,
    statusLabel: noPermissionLabel,
    actionLabel: noPermissionLabel,
  }
}
