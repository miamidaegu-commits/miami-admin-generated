import { getLessonStorageDateString } from './dashboardViewUtils.js'
import {
  getCanonicalPrivateOccurrenceIdentity,
  getKstDateYmd,
  isGroupLessonOccurrence,
  isCountableLessonOccurrence,
} from './lessonOccurrenceStats.js'

const INACTIVE_PACKAGE_STATUSES = new Set([
  'inactive',
  'expired',
  'ended',
  'cancelled',
  'canceled',
])

const CANCELLED_DEDUCTION_STATES = new Set([
  'cancelled',
  'canceled',
  'reversed',
  'restored',
  'undone',
])

const APPLIED_DEDUCTION_STATES = new Set(['applied', 'deducted'])

function normalizeId(value) {
  return String(value || '').trim()
}

function normalizeToken(value) {
  return normalizeId(value).toLowerCase().replace(/[\s-]+/g, '_')
}

function getOccurrenceDate(row) {
  try {
    return normalizeId(getLessonStorageDateString(row))
  } catch {
    return ''
  }
}

function getOccurrenceTime(row) {
  const direct = normalizeId(row?.time || row?.startTime || row?.scheduleTime)
  if (/^\d{2}:\d{2}/.test(direct)) return direct.slice(0, 5)
  const timestamp = row?.startAt || row?.startsAt
  const date =
    timestamp instanceof Date
      ? timestamp
      : typeof timestamp?.toDate === 'function'
        ? timestamp.toDate()
        : timestamp
          ? new Date(timestamp)
          : null
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = parts.find((part) => part.type === 'hour')?.value
  const minute = parts.find((part) => part.type === 'minute')?.value
  return hour && minute ? `${hour}:${minute}` : ''
}

function getKstTime(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = parts.find((part) => part.type === 'hour')?.value
  const minute = parts.find((part) => part.type === 'minute')?.value
  return hour && minute ? `${hour}:${minute}` : ''
}

function getCurrentDeductionCancelled(row) {
  const state = normalizeToken(row?.currentDeductionState || row?.deductionStatus)
  if (CANCELLED_DEDUCTION_STATES.has(state)) return true
  if (APPLIED_DEDUCTION_STATES.has(state)) return false

  for (const field of ['deductionReversed', 'deductionCancelled', 'deductionCanceled']) {
    if (typeof row?.[field] === 'boolean') return row[field]
  }
  if (typeof row?.isDeductCancelled === 'boolean') return row.isDeductCancelled
  return false
}

function getDeductionStateRank(row) {
  if (normalizeId(row?.currentDeductionState || row?.deductionStatus)) return 3
  if (
    ['deductionReversed', 'deductionCancelled', 'deductionCanceled'].some(
      (field) => typeof row?.[field] === 'boolean'
    )
  ) {
    return 2
  }
  return typeof row?.isDeductCancelled === 'boolean' ? 1 : 0
}

function chooseCanonicalOccurrence(current, candidate) {
  if (!current) return candidate
  const currentRank = getDeductionStateRank(current)
  const candidateRank = getDeductionStateRank(candidate)
  if (candidateRank !== currentRank) return candidateRank > currentRank ? candidate : current
  if (
    candidate?._calendarRowKind === 'privateReservation' &&
    current?._calendarRowKind !== 'privateReservation'
  ) {
    return candidate
  }
  return current
}

function isPrivatePackage(pkg) {
  const type = normalizeToken(pkg?.packageType || pkg?.type || 'private')
  return !type || type === 'private'
}

function isActivePackage(pkg) {
  return !INACTIVE_PACKAGE_STATUSES.has(normalizeToken(pkg?.status || 'active'))
}

function isValidRemainingCount(value) {
  const count = Number(value)
  return Number.isFinite(count) && Number.isInteger(count) && count > 0
}

export function buildPrivateLessonDashboardStats({
  occurrences = [],
  packages = [],
  teacherUid,
  now = new Date(),
} = {}) {
  const canonicalTeacherUid = normalizeId(teacherUid)
  const todayYmd = getKstDateYmd(now)
  const currentMonthStartYmd = todayYmd ? `${todayYmd.slice(0, 7)}-01` : ''
  const nowTime = getKstTime(now)
  let excludedLegacyCount = 0

  const occurrencesByIdentity = new Map()
  ;(Array.isArray(occurrences) ? occurrences : []).forEach((row) => {
    if (isGroupLessonOccurrence(row)) return
    const rowTeacherUid = normalizeId(row?.teacherUid)
    if (!rowTeacherUid) {
      excludedLegacyCount += 1
      return
    }
    if (!canonicalTeacherUid || rowTeacherUid !== canonicalTeacherUid) return

    const identity = getCanonicalPrivateOccurrenceIdentity(row)
    const studentId = normalizeId(row?.studentId)
    const packageId = normalizeId(row?.packageId || row?.deductionPackageId)
    if (!identity || !studentId || !packageId) {
      excludedLegacyCount += 1
      return
    }
    occurrencesByIdentity.set(
      identity,
      chooseCanonicalOccurrence(occurrencesByIdentity.get(identity), row)
    )
  })

  const packagesById = new Map()
  ;(Array.isArray(packages) ? packages : []).forEach((pkg) => {
    const packageId = normalizeId(pkg?.id)
    const studentId = normalizeId(pkg?.studentId)
    if (!packageId || !studentId) {
      excludedLegacyCount += 1
      return
    }
    if (!isPrivatePackage(pkg) || !isActivePackage(pkg)) return
    const packageTeacherUid = normalizeId(pkg?.teacherUid)
    if (packageTeacherUid && packageTeacherUid !== canonicalTeacherUid) return
    packagesById.set(packageId, pkg)
  })

  let todayPrivateCount = 0
  let monthlyPrivateCount = 0
  let deductionCancelledCount = 0
  const finalCandidatesByStudentPackage = new Map()

  occurrencesByIdentity.forEach((row) => {
    const date = getOccurrenceDate(row)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      excludedLegacyCount += 1
      return
    }

    const deductionCancelled = getCurrentDeductionCancelled(row)
    const countableWithCancellation = isCountableLessonOccurrence(row, {
      includeDeductionCancelled: true,
    })
    const countable = countableWithCancellation && !deductionCancelled

    if (date === todayYmd && countableWithCancellation && deductionCancelled) {
      deductionCancelledCount += 1
    }
    if (countable && date === todayYmd) todayPrivateCount += 1
    if (
      countable &&
      currentMonthStartYmd &&
      date >= currentMonthStartYmd &&
      date <= todayYmd
    ) {
      monthlyPrivateCount += 1
    }
    if (!countable || date !== todayYmd) return

    const time = getOccurrenceTime(row)
    if (!time || time < nowTime) return
    const studentId = normalizeId(row.studentId)
    const packageId = normalizeId(row.packageId || row.deductionPackageId)
    const pkg = packagesById.get(packageId)
    if (!pkg || normalizeId(pkg.studentId) !== studentId) return
    const pairKey = `${studentId}:${packageId}`
    const currentCandidate = finalCandidatesByStudentPackage.get(pairKey)
    finalCandidatesByStudentPackage.set(pairKey, {
      packageId,
      count: (currentCandidate?.count || 0) + 1,
    })
  })

  let finalLessonCount = 0
  finalCandidatesByStudentPackage.forEach((candidate) => {
    const pkg = packagesById.get(candidate.packageId)
    if (
      pkg &&
      isValidRemainingCount(pkg.remainingCount) &&
      candidate.count === Number(pkg.remainingCount)
    ) {
      finalLessonCount += 1
    }
  })

  return {
    todayPrivateCount,
    monthlyPrivateCount,
    deductionCancelledCount,
    finalLessonCount,
    excludedLegacyCount,
  }
}
