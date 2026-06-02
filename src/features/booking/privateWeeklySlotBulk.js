const HH_MM_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeTeacherKey(value) {
  return normalizeText(value).toLowerCase()
}

function unique(values) {
  const seen = new Set()
  const out = []
  values.forEach((value) => {
    if (!value || seen.has(value)) return
    seen.add(value)
    out.push(value)
  })
  return out
}

function getTeacherScopeKeys(row) {
  if (!row) return []
  return unique(
    [
      row.teacherUid,
      row.teacherUID,
      row.teacherId,
      row.teacherID,
      row.teacherKey,
      row.teacher,
      row.teacherName,
      row.displayName,
      row.name,
    ].map(normalizeTeacherKey)
  )
}

function sameTeacherScope(a, b) {
  const aKeys = getTeacherScopeKeys(a)
  const bKeys = getTeacherScopeKeys(b)
  if (aKeys.length === 0 || bKeys.length === 0) return false
  return aKeys.some((key) => bKeys.includes(key))
}

function timeToMinutes(time) {
  const match = normalizeText(time).match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function rangesOverlap(aStart, aDuration, bStart, bDuration) {
  return aStart < bStart + bDuration && bStart < aStart + aDuration
}

function normalizeDate(value) {
  const text = normalizeText(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function getRangeStart(row) {
  return normalizeDate(row?.effectiveStartDate) || '0000-01-01'
}

function getRangeEnd(row) {
  return normalizeDate(row?.effectiveEndDate) || '9999-12-31'
}

export function privateWeeklySlotDateRangesOverlap(a, b) {
  if (!a || !b) return false
  return getRangeStart(a) <= getRangeEnd(b) && getRangeStart(b) <= getRangeEnd(a)
}

export function privateWeeklyTemplateAppliesToDate(template, date) {
  const safeDate = normalizeDate(date)
  if (!safeDate) return false
  const effectiveStartDate = normalizeDate(template?.effectiveStartDate)
  const effectiveEndDate = normalizeDate(template?.effectiveEndDate)
  if (effectiveStartDate && safeDate < effectiveStartDate) return false
  if (effectiveEndDate && safeDate > effectiveEndDate) return false
  return true
}

export const PRIVATE_WEEKLY_SLOT_WEEKDAYS = [
  { value: '1', label: '월요일', shortLabel: '월' },
  { value: '2', label: '화요일', shortLabel: '화' },
  { value: '3', label: '수요일', shortLabel: '수' },
  { value: '4', label: '목요일', shortLabel: '목' },
  { value: '5', label: '금요일', shortLabel: '금' },
  { value: '6', label: '토요일', shortLabel: '토' },
]

export function parsePrivateWeeklySlotTimeList(value) {
  const tokens = normalizeText(value)
    .split(/[,\n\r\t ]+/)
    .map((token) => token.trim())
    .filter(Boolean)
  const times = []
  const invalidTimes = []
  const seen = new Set()

  tokens.forEach((token) => {
    const match = token.match(HH_MM_PATTERN)
    if (!match) {
      invalidTimes.push(token)
      return
    }
    const time = `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`
    if (seen.has(time)) return
    seen.add(time)
    times.push(time)
  })

  return { times, invalidTimes }
}

export function normalizePrivateWeeklySlotWeekdays(values) {
  const allowed = new Set(PRIVATE_WEEKLY_SLOT_WEEKDAYS.map((weekday) => weekday.value))
  return unique(
    (Array.isArray(values) ? values : [values])
      .map((value) => normalizeText(value))
      .filter((value) => allowed.has(value))
  )
}

export function privateWeeklySlotsOverlap(a, b) {
  if (!a || !b) return false
  if (normalizeText(a.academyId) && normalizeText(b.academyId) && a.academyId !== b.academyId) {
    return false
  }
  if (String(a.weekday) !== String(b.weekday)) return false
  if (!sameTeacherScope(a, b)) return false
  if (!privateWeeklySlotDateRangesOverlap(a, b)) return false
  const aStart = timeToMinutes(a.time)
  const bStart = timeToMinutes(b.time)
  if (aStart === null || bStart === null) return false
  const aDuration = Number(a.durationMinutes || 0)
  const bDuration = Number(b.durationMinutes || 0)
  if (!Number.isFinite(aDuration) || aDuration <= 0) return false
  if (!Number.isFinite(bDuration) || bDuration <= 0) return false
  return rangesOverlap(aStart, Math.floor(aDuration), bStart, Math.floor(bDuration))
}

export function isExactPrivateWeeklySlotDuplicate(a, b) {
  if (!a || !b) return false
  return (
    String(a.weekday) === String(b.weekday) &&
    normalizeText(a.time) === normalizeText(b.time) &&
    Number(a.durationMinutes) === Number(b.durationMinutes) &&
    sameTeacherScope(a, b) &&
    privateWeeklySlotDateRangesOverlap(a, b)
  )
}

export function buildPrivateWeeklyBulkSlotPlan({
  academyId,
  teacherFields,
  weekdays,
  times,
  durationMinutes,
  status = 'active',
  effectiveStartDate = '',
  effectiveEndDate = '',
  existingTemplates = [],
}) {
  const requestedRows = []
  const createdRows = []
  const skippedDuplicateRows = []
  const skippedOverlapRows = []
  const acceptedRows = []

  normalizePrivateWeeklySlotWeekdays(weekdays).forEach((weekday) => {
    times.forEach((time) => {
      requestedRows.push({
        academyId,
        teacher: teacherFields.teacher,
        teacherName: teacherFields.teacherName,
        teacherKey: teacherFields.teacherKey,
        teacherUid: teacherFields.teacherUid,
        teacherEmail: teacherFields.teacherEmail,
        weekday: Number(weekday),
        time,
        durationMinutes,
        status,
        effectiveStartDate,
        effectiveEndDate,
      })
    })
  })

  requestedRows.forEach((row) => {
    const activeRows = [...existingTemplates, ...acceptedRows]
    if (activeRows.some((existing) => isExactPrivateWeeklySlotDuplicate(row, existing))) {
      skippedDuplicateRows.push(row)
      return
    }
    if (activeRows.some((existing) => privateWeeklySlotsOverlap(row, existing))) {
      skippedOverlapRows.push(row)
      return
    }
    acceptedRows.push(row)
    createdRows.push(row)
  })

  return {
    requestedRows,
    createdRows,
    skippedDuplicateRows,
    skippedOverlapRows,
    errorRows: [],
  }
}
