function normalizeId(value) {
  return String(value || '').trim()
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

function toSafeCount(value) {
  const count = Number(value || 0)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

function getStudentId(row) {
  return normalizeId(row?.studentId)
}

export function getGroupLessonSeatAvailability({
  lesson,
  fixedMembers = [],
  reservations = [],
} = {}) {
  const capacity = toSafeCount(lesson?.capacity)
  const fixedMemberIds = normalizeIdList(fixedMembers.map(getStudentId))
  const fixedMemberIdSet = new Set(fixedMemberIds)
  const countedIdSet = new Set(normalizeIdList(lesson?.countedStudentIDs))
  const explicitlyReleasedIdSet = new Set(normalizeIdList(lesson?.releasedFixedStudentIDs))
  const attendanceApplied = Boolean(lesson?.attendanceAppliedAt)
  const releasedFixedSeatIds = new Set()

  fixedMemberIds.forEach((studentId) => {
    if (explicitlyReleasedIdSet.has(studentId)) {
      releasedFixedSeatIds.add(studentId)
      return
    }
    if (attendanceApplied && !countedIdSet.has(studentId)) {
      releasedFixedSeatIds.add(studentId)
    }
  })

  const guestReservedStudentIds = new Set()
  reservations.forEach((reservation) => {
    if (reservation?.status !== 'active') return
    const studentId = getStudentId(reservation)
    if (!studentId || fixedMemberIdSet.has(studentId)) return
    guestReservedStudentIds.add(studentId)
  })

  const fixedMemberCount = fixedMemberIds.length
  const releasedFixedSeatCount = releasedFixedSeatIds.size
  const fixedAttendingCount = Math.max(0, fixedMemberCount - releasedFixedSeatCount)
  const guestReservedCount = guestReservedStudentIds.size
  const remainingSeats = Math.max(0, capacity - fixedAttendingCount - guestReservedCount)

  return {
    capacity,
    fixedMemberCount,
    fixedAttendingCount,
    releasedFixedSeatCount,
    guestReservedCount,
    remainingSeats,
    isFull: remainingSeats <= 0,
  }
}
