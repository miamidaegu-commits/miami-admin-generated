export const STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT = 2
export const STUDENT_PRIVATE_CANCEL_LIMIT_MAX = 24
export const PRIVATE_PACKAGE_CANCEL_UNIT_COUNT = 4

function readNonNegativeInteger(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

export function getPrivatePackageCancelLimit(pkg) {
  const totalCount = readNonNegativeInteger(pkg?.totalCount)
  return Math.floor(totalCount / PRIVATE_PACKAGE_CANCEL_UNIT_COUNT)
}

export function getPrivatePackageCancelUsed(pkg) {
  return readNonNegativeInteger(pkg?.privateCancelUsedCount)
}

export function getPrivatePackageCancelRemaining(pkg) {
  return Math.max(0, getPrivatePackageCancelLimit(pkg) - getPrivatePackageCancelUsed(pkg))
}

export function computePrivatePackageCancelAllowance(pkg = {}) {
  const used = getPrivatePackageCancelUsed(pkg)
  const limit = getPrivatePackageCancelLimit(pkg)
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
  }
}

export function canUsePrivatePackageCancel(pkg) {
  return getPrivatePackageCancelRemaining(pkg) > 0
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

export function formatTeacherRosterCancelAllowanceValue(allowance) {
  if (!allowance) return ''
  return `${allowance.remaining}/${allowance.limit}회`
}

export function formatStudentPrivateCancelUsageSummary(allowance) {
  if (!allowance) return ''
  return `취소 사용 ${allowance.used}/${allowance.limit}회 · 남은 취소 가능 ${allowance.remaining}회`
}

export function formatAdminStudentCancelAllowanceSummary(allowance) {
  if (!allowance) return ''
  return `취소 사용 ${allowance.used}/${allowance.limit}회 · 남은 ${allowance.remaining}회`
}

export function formatPrivatePackageCancelUsageSummary(pkgOrAllowance) {
  if (!pkgOrAllowance) return ''
  const allowance =
    typeof pkgOrAllowance.limit !== 'undefined' ||
    typeof pkgOrAllowance.used !== 'undefined' ||
    typeof pkgOrAllowance.remaining !== 'undefined'
      ? {
          used: readNonNegativeInteger(pkgOrAllowance.used),
          limit: readNonNegativeInteger(pkgOrAllowance.limit),
          remaining: readNonNegativeInteger(pkgOrAllowance.remaining),
        }
      : computePrivatePackageCancelAllowance(pkgOrAllowance)
  return `취소 사용 ${allowance.used}/${allowance.limit}회`
}

export function formatStudentPrivateCancelPolicyGuide() {
  return [
    '개인 1:1 취소는 수강권 4회당 1회까지 가능합니다.',
    '취소는 수업 시작 10시간 전까지만 가능합니다.',
  ]
}

export function formatLegacyStudentPrivateCancelPolicyGuide({ limit, used, remaining } = {}) {
  const allowance = computeStudentPrivateCancelAllowance({
    studentCancelCount: used,
    studentCancelLimit: limit,
  })
  const safeRemaining =
    Number.isFinite(Number(remaining)) ?
      Math.max(0, Math.floor(Number(remaining))) :
      allowance.remaining
  const safeUsed =
    Number.isFinite(Number(used)) ?
      Math.max(0, Math.floor(Number(used))) :
      allowance.used
  const safeLimit = allowance.limit
  return [
    `예약 취소는 최대 ${safeLimit}회까지 가능합니다.`,
    `취소 사용 ${safeUsed}/${safeLimit}회 · 남은 취소 가능 ${safeRemaining}회`,
  ]
}

export function buildPrivateSlotReserveConfirmMessage() {
  return (
    `1:1 수업을 예약하시겠습니까?\n\n` +
    `취소는 수업 시작 10시간 전까지만 가능하며, ` +
    `개인 1:1 취소는 수강권 4회당 1회까지 가능합니다.`
  )
}

function resolveCancelAllowanceInput(allowance) {
  if (!allowance) return computeStudentPrivateCancelAllowance({})
  if (
    typeof allowance.used !== 'undefined' ||
    typeof allowance.remaining !== 'undefined'
  ) {
    return computeStudentPrivateCancelAllowance({
      studentCancelCount: allowance.used,
      studentCancelLimit: allowance.limit,
    })
  }
  return computeStudentPrivateCancelAllowance(allowance)
}

export function buildPrivateReservationCancelConfirmMessage(allowance, { loaded = true } = {}) {
  const resolved = resolveCancelAllowanceInput(allowance)
  if (!loaded) {
    return (
      `예약을 취소하시겠습니까?\n\n` +
      `개인 1:1 취소는 수강권 4회당 1회까지 가능하며, ` +
      `이 취소도 횟수에 포함됩니다.`
    )
  }
  if (resolved.remaining <= 0) {
    return '이 수강권의 취소 가능 횟수를 모두 사용했습니다. 학원에 문의해 주세요.'
  }
  const afterRemaining = Math.max(0, resolved.remaining - 1)
  return (
    `예약을 취소하시겠습니까?\n\n` +
    `취소 사용 ${resolved.used}/${resolved.limit}회\n` +
    `남은 취소 가능 ${resolved.remaining}회\n` +
    `이번 취소 후 남은 취소 가능 ${afterRemaining}회\n` +
    `이 취소도 횟수에 포함됩니다.`
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
