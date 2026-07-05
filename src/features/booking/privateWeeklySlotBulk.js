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

function getPrimaryTeacherScopeKeys(row) {
  if (!row) return []
  return unique(
    [
      row.teacherUid,
      row.teacherUID,
      row.teacherId,
      row.teacherID,
      row.teacherKey,
      row.teacher,
      row.uid,
      row.id,
      row.value,
      row.key,
    ].map(normalizeTeacherKey)
  )
}

function getDisplayTeacherScopeKeys(row) {
  if (!row) return []
  return unique(
    [
      row.teacherName,
      row.teacherDisplayName,
      row.displayName,
      row.name,
    ].map(normalizeTeacherKey)
  )
}

function sameTeacherScope(a, b) {
  const aPrimaryKeys = getPrimaryTeacherScopeKeys(a)
  const bPrimaryKeys = getPrimaryTeacherScopeKeys(b)
  if (aPrimaryKeys.length > 0 && bPrimaryKeys.length > 0) {
    return aPrimaryKeys.some((key) => bPrimaryKeys.includes(key))
  }
  if (aPrimaryKeys.length > 0 || bPrimaryKeys.length > 0) return false

  const aDisplayKeys = getDisplayTeacherScopeKeys(a)
  const bDisplayKeys = getDisplayTeacherScopeKeys(b)
  if (aDisplayKeys.length === 0 || bDisplayKeys.length === 0) return false
  return aDisplayKeys.some((key) => bDisplayKeys.includes(key))
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

function isFiniteRangeDate(value) {
  return normalizeDate(value) && value !== '0000-01-01' && value !== '9999-12-31'
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

export function isActivePrivateWeeklyTemplate(template) {
  return normalizeText(template?.status || 'active').toLowerCase() === 'active'
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

export function getPrivateWeeklyTemplateLabel(template) {
  const teacherDisplay = normalizeText(template?.teacherName || template?.displayName)
  const teacherKey = normalizeText(template?.teacherKey || template?.teacher || template?.teacherUid)
  const teacherLabel =
    teacherDisplay && teacherKey && teacherDisplay !== teacherKey
      ? `${teacherDisplay} · ${teacherKey}`
      : teacherDisplay || teacherKey || '선생님 미지정'
  const weekdayLabel =
    PRIVATE_WEEKLY_SLOT_WEEKDAYS.find((option) => option.value === String(template?.weekday))?.label ||
    '요일 미지정'
  const time = normalizeText(template?.time) || '시간 미지정'
  const duration = Number(template?.durationMinutes || 0)
  const durationLabel = `${Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 60}분`
  const startDate = normalizeDate(template?.effectiveStartDate)
  const endDate = normalizeDate(template?.effectiveEndDate)
  const rangeLabel = startDate && endDate ? `${startDate} ~ ${endDate}` : '기간 제한 없음'
  return `${teacherLabel} · ${weekdayLabel} ${time} · ${durationLabel} · ${rangeLabel}`
}

function addDaysYmd(ymd, days) {
  const date = new Date(`${ymd}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  date.setDate(date.getDate() + days)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getPrivateWeeklyTemplateOverlapDates(a, b, limit = 4) {
  const start = [getRangeStart(a), getRangeStart(b)].sort().at(-1)
  const end = [getRangeEnd(a), getRangeEnd(b)].sort()[0]
  if (!isFiniteRangeDate(start) || !isFiniteRangeDate(end) || start > end) {
    return { dates: [], hasMore: false }
  }
  const weekday = Number(a?.weekday)
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return { dates: [], hasMore: false }
  }
  const parsedStart = new Date(`${start}T00:00:00`)
  if (Number.isNaN(parsedStart.getTime())) return { dates: [], hasMore: false }
  const offset = (weekday - parsedStart.getDay() + 7) % 7
  let next = addDaysYmd(start, offset)
  const dates = []
  let hasMore = false
  while (next && next <= end) {
    if (dates.length >= limit) {
      hasMore = true
      break
    }
    dates.push(next)
    next = addDaysYmd(next, 7)
  }
  return { dates, hasMore }
}

function buildPrivateWeeklyTemplateRecommendation(candidate, existing) {
  const candidateEnd = normalizeDate(candidate?.effectiveEndDate)
  const existingStart = getRangeStart(existing)
  const candidateStart = getRangeStart(candidate)
  const existingEnd = normalizeDate(existing?.effectiveEndDate)
  if (
    candidateEnd &&
    existingEnd &&
    existingStart <= candidateStart &&
    existingEnd < candidateEnd
  ) {
    return `새 시간표를 만들지 말고 기존 시간표의 종료일을 ${candidateEnd}로 연장하세요.`
  }
  return '새 시간표를 만들지 말고 기존 시간표를 수정하거나, 기존 시간표를 비활성화한 뒤 새 시간표를 사용하세요.'
}

export function findPrivateWeeklyTemplateOverlap(candidate, existingTemplates = [], options = {}) {
  if (!candidate || !isActivePrivateWeeklyTemplate(candidate)) return null
  const excludeTemplateId = normalizeText(options.excludeTemplateId)
  const activeTemplates = (Array.isArray(existingTemplates) ? existingTemplates : []).filter(
    (template) => {
      if (!template || !isActivePrivateWeeklyTemplate(template)) return false
      if (excludeTemplateId && normalizeText(template.id) === excludeTemplateId) return false
      return true
    }
  )
  const duplicate = activeTemplates.find((existing) =>
    isExactPrivateWeeklySlotDuplicate(candidate, existing)
  )
  if (duplicate) {
    return {
      type: 'duplicate',
      candidate,
      existing: duplicate,
      overlap: getPrivateWeeklyTemplateOverlapDates(candidate, duplicate),
    }
  }
  const overlap = activeTemplates.find((existing) => privateWeeklySlotsOverlap(candidate, existing))
  if (!overlap) return null
  return {
    type: 'overlap',
    candidate,
    existing: overlap,
    overlap: getPrivateWeeklyTemplateOverlapDates(candidate, overlap),
  }
}

export function formatPrivateWeeklyTemplateOverlapMessage(conflict) {
  if (!conflict) return ''
  const overlapDates = conflict.overlap?.dates || []
  const overlapDateText =
    overlapDates.length > 0
      ? `${overlapDates.join(', ')}${conflict.overlap?.hasMore ? ', ...' : ''}`
      : '기간 제한 없음 또는 장기 반복으로 겹침'
  return [
    '이미 같은 선생님·요일·시간이 겹치는 주간 1:1 시간표가 있습니다.',
    '',
    '기존 시간표:',
    getPrivateWeeklyTemplateLabel(conflict.existing),
    '',
    '새로 만들려는 기간:',
    getPrivateWeeklyTemplateLabel(conflict.candidate),
    '',
    '겹치는 날짜:',
    overlapDateText,
    '',
    '추천:',
    buildPrivateWeeklyTemplateRecommendation(conflict.candidate, conflict.existing),
  ].join('\n')
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
  useForFixedAssignment = true,
  openForStudentBooking = false,
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
        useForFixedAssignment,
        openForStudentBooking,
      })
    })
  })

  requestedRows.forEach((row) => {
    const activeRows = [
      ...(Array.isArray(existingTemplates) ? existingTemplates : []),
      ...acceptedRows,
    ].filter(isActivePrivateWeeklyTemplate)
    const conflict = findPrivateWeeklyTemplateOverlap(row, activeRows)
    if (conflict?.type === 'duplicate') {
      skippedDuplicateRows.push({ ...row, overlapConflict: conflict })
      return
    }
    if (conflict) {
      skippedOverlapRows.push({ ...row, overlapConflict: conflict })
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
