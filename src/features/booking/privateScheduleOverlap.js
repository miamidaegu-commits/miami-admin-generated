const DEFAULT_PRIVATE_DURATION_MINUTES = 50

function normalizeId(value) {
  return String(value ?? '').trim()
}

function normalizeTeacherKey(value) {
  const normalized = normalizeId(value).toLowerCase()
  return normalized || ''
}

function uniqueNormalizedTeacherKeyList(values) {
  const seen = new Set()
  const result = []
  ;(Array.isArray(values) ? values : [values]).forEach((value) => {
    const key = normalizeTeacherKey(value)
    if (!key || seen.has(key)) return
    seen.add(key)
    result.push(key)
  })
  return result
}

export function getPrivateTeacherScopeKeys(...rows) {
  const stableUidKeys = []
  const stableTeacherKeys = []
  const displayKeys = []
  rows.forEach((row) => {
    if (!row) return
    ;[row.teacherUid, row.teacherUID, row.teacherId, row.teacherID].forEach((value) => {
      const key = normalizeTeacherKey(value)
      if (key) stableUidKeys.push(key)
    })
    ;[row.teacherKey].forEach((value) => {
      const key = normalizeTeacherKey(value)
      if (key) stableTeacherKeys.push(key)
    })
    ;[row.teacher, row.teacherName, row.displayName, row.name].forEach((value) => {
      const key = normalizeTeacherKey(value)
      if (key) displayKeys.push(key)
    })
  })
  return uniqueNormalizedTeacherKeyList([
    ...stableUidKeys,
    ...stableTeacherKeys,
    ...displayKeys,
  ])
}

export function getPrivateScheduleDurationMinutes(row) {
  const duration = Number(
    row &&
      (row.durationMinutes ||
        row.duration ||
        row.lessonDurationMinutes ||
        row.classDurationMinutes)
  )
  if (Number.isFinite(duration) && duration > 0) return Math.floor(duration)
  return DEFAULT_PRIVATE_DURATION_MINUTES
}

export function getSeoulDateTimeMillis(date, time) {
  const safeDate = normalizeId(date)
  const safeTime = normalizeId(time)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDate)) return null
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(safeTime)) return null
  const [year, month, day] = safeDate.split('-').map(Number)
  const [hour, minute] = safeTime.split(':').map(Number)
  return Date.UTC(year, month - 1, day, hour - 9, minute)
}

function getPrivateRowStartMillis(row) {
  const date = normalizeId(row && (row.date || row.lessonDate || row.scheduleDate))
  const time = normalizeId(row && (row.time || row.startTime || row.scheduleTime))
  return getSeoulDateTimeMillis(date, time)
}

export function getPrivateScheduleTimeRange(row) {
  const startMillis = getPrivateRowStartMillis(row)
  if (startMillis === null) return null
  const durationMinutes = getPrivateScheduleDurationMinutes(row)
  return {
    startMillis,
    endMillis: startMillis + durationMinutes * 60 * 1000,
  }
}

export function privateTeacherScopeKeysOverlap(rowA, rowB) {
  const keysA = getPrivateTeacherScopeKeys(rowA)
  const keysB = getPrivateTeacherScopeKeys(rowB)
  if (keysA.length === 0 || keysB.length === 0) return false
  return keysA.some((key) => keysB.includes(key))
}

export function privateScheduleTimeRangesOverlap(rangeA, rangeB) {
  if (!rangeA || !rangeB) return false
  return rangeA.startMillis < rangeB.endMillis && rangeB.startMillis < rangeA.endMillis
}

export function privateSchedulesOverlap(candidate, existing) {
  if (!candidate || !existing) return false
  const candidateAcademyId = normalizeId(candidate.academyId)
  const existingAcademyId = normalizeId(existing.academyId)
  if (candidateAcademyId && existingAcademyId && candidateAcademyId !== existingAcademyId) {
    return false
  }
  const candidateRange = getPrivateScheduleTimeRange(candidate)
  const existingRange = getPrivateScheduleTimeRange(existing)
  if (!privateScheduleTimeRangesOverlap(candidateRange, existingRange)) return false
  return privateTeacherScopeKeysOverlap(candidate, existing)
}

export function isActivePrivateReservation(data) {
  return ['active', 'reserved', 'confirmed', 'booked'].includes(
    normalizeId(data && data.status).toLowerCase()
  )
}

export function isCancelledScheduleRow(row) {
  const status = normalizeId(row && row.status).toLowerCase()
  const approvalStatus = normalizeId(row && row.approvalStatus).toLowerCase()
  const cancellationType = normalizeId(row && row.cancellationType).toLowerCase()
  if (cancellationType === 'lesson_cancelled') return false
  if (status === 'cancelled' || status === 'canceled') return true
  if (row && row.completed === 'cancelled') return true
  if (row && row.isDeductCancelled === true) return true
  if (approvalStatus && approvalStatus !== 'approved') return true
  return false
}

export function isTeacherBlockingScheduleRow(row) {
  if (!row) return false
  if (isCancelledScheduleRow(row)) return false
  if (isActivePrivateReservation(row)) return true
  const status = normalizeId(row.status).toLowerCase()
  if (status === 'reserved' || status === 'blocked' || status === 'busy') return true
  if (status === 'open') return false
  const date = normalizeId(row.date || row.scheduleDate || row.lessonDate)
  const time = normalizeId(row.time || row.startTime || row.scheduleTime)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && /^([01]\d|2[0-3]):([0-5]\d)$/.test(time)
}
