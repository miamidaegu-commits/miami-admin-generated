export const FIXED_PRIVATE_ASSIGNMENT_BACKFILL_WARNING =
  '누락된 수업을 보정하는 경우에만 배정하세요.'

export function isPastFixedPrivateAssignmentDate(date, todayYmd) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(todayYmd || '')) &&
    date < todayYmd
  )
}

export function classifyFixedPrivateAssignmentDates(dates, todayYmd) {
  const normalizedDates = Array.isArray(dates) ? dates : []
  const pastDates = normalizedDates.filter((date) =>
    isPastFixedPrivateAssignmentDate(date, todayYmd)
  )
  return {
    pastDates,
    pastDateCount: pastDates.length,
  }
}

export function formatFixedPrivateAssignmentBackfillWarning(pastDateCount) {
  return `과거 일정 ${Number(pastDateCount) || 0}회가 포함되어 있습니다. ${FIXED_PRIVATE_ASSIGNMENT_BACKFILL_WARNING}`
}

export function canCommitFixedPrivateAssignmentBackfill(pastDateCount, confirmed) {
  return Number(pastDateCount) <= 0 || confirmed === true
}

export function buildFixedPrivateAssignmentCallablePayload(
  basePayload,
  { previewOnly = false, pastDateCount = 0 } = {}
) {
  return {
    ...basePayload,
    commit: previewOnly !== true,
    dryRun: previewOnly === true,
    previewOnly: previewOnly === true,
    ...(Number(pastDateCount) > 0 ? { allowPastDates: true } : {}),
  }
}
