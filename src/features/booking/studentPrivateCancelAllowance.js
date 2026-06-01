export const STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT = 2
export const STUDENT_PRIVATE_CANCEL_LIMIT_MAX = 24

function readNonNegativeInteger(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

export function computeStudentPrivateCancelAllowance({
  studentCancelCount = 0,
  studentCancelLimit,
} = {}) {
  const used = readNonNegativeInteger(studentCancelCount)
  const rawLimit = Number(studentCancelLimit)
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(STUDENT_PRIVATE_CANCEL_LIMIT_MAX, Math.floor(rawLimit))
      : STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT
  const remaining = Math.max(0, limit - used)
  return { used, limit, remaining }
}

export function formatTeacherRosterStudentCancelLabel(allowance) {
  if (!allowance) return ''
  return `취소 가능 ${allowance.remaining}/${allowance.limit}회`
}

export function formatAdminStudentCancelAllowanceSummary(allowance) {
  if (!allowance) return ''
  return `취소 사용 ${allowance.used}/${allowance.limit}회 · 남은 ${allowance.remaining}회`
}

export function formatStudentPrivateCancelPolicyGuide({ limit, remaining }) {
  const safeLimit =
    Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Math.floor(Number(limit))
      : STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT
  const lines = [`예약 취소는 최대 ${safeLimit}회까지 가능합니다.`]
  if (Number.isFinite(Number(remaining))) {
    const safeRemaining = Math.max(0, Math.floor(Number(remaining)))
    lines.push(`남은 취소 가능 횟수: ${safeRemaining}/${safeLimit}회`)
  }
  return lines
}

export function buildPrivateSlotReserveConfirmMessage(limit = STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT) {
  const safeLimit =
    Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Math.floor(Number(limit))
      : STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT
  return (
    `1:1 수업을 예약하시겠습니까?\n\n` +
    `취소는 수업 시작 6시간 전까지만 가능하며, ` +
    `예약 취소는 최대 ${safeLimit}회까지 가능합니다.`
  )
}

export function buildPrivateReservationCancelConfirmMessage(
  limit = STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT
) {
  const safeLimit =
    Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Math.floor(Number(limit))
      : STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT
  return (
    `예약을 취소하시겠습니까?\n\n` +
    `예약 취소는 최대 ${safeLimit}회까지 가능하며, 이 취소도 횟수에 포함됩니다.`
  )
}

export function validateStudentCancelLimitInput({
  limit,
  used = 0,
  max = STUDENT_PRIVATE_CANCEL_LIMIT_MAX,
} = {}) {
  const parsed = Number(limit)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return { ok: false, message: '취소 가능 한도는 정수로 입력해 주세요.' }
  }
  if (parsed < 0 || parsed > max) {
    return { ok: false, message: `취소 가능 한도는 0~${max} 사이여야 합니다.` }
  }
  const safeUsed = readNonNegativeInteger(used)
  if (parsed < safeUsed) {
    return {
      ok: false,
      message: `이미 ${safeUsed}회 사용했으므로 한도는 ${safeUsed}회 이상이어야 합니다.`,
    }
  }
  return { ok: true, limit: parsed }
}
