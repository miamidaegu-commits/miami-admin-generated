import { isStudentPackageRowActive } from '../dashboard/dashboardViewUtils.js'
import { getGroupCourseTypeLabel } from '../group-booking/groupCourseTypes.js'
import { computePrivateTeacherPackageUsage } from '../dashboard/privatePackageHelpers.js'
import {
  computeGroupTicketBalance,
  isGroupTicketFreeBookingAllowed,
} from '../dashboard/ticketBalanceHelpers.js'
import { formatPrivatePackageCancelUsageSummary } from './studentPrivateCancelAllowance.js'

function toFiniteNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function cleanText(value, fallback = '-') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function isValidYmd(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function formatMillisAsKstYmd(millis) {
  if (!Number.isFinite(millis)) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(millis))
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  const ymd = `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`
  return isValidYmd(ymd) ? ymd : ''
}

export function formatPrivatePackageDateValueYmd(value) {
  if (value == null || value === '') return ''

  if (typeof value === 'string') {
    const text = value.trim()
    const ymd = text.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || ''
    if (ymd && isValidYmd(ymd)) return ymd
    const parsed = Date.parse(text)
    return Number.isFinite(parsed) ? formatMillisAsKstYmd(parsed) : ''
  }

  if (value instanceof Date) {
    return formatMillisAsKstYmd(value.getTime())
  }

  if (typeof value === 'number') {
    return formatMillisAsKstYmd(value)
  }

  if (typeof value?.toMillis === 'function') {
    return formatMillisAsKstYmd(value.toMillis())
  }

  if (typeof value?.toDate === 'function') {
    return formatPrivatePackageDateValueYmd(value.toDate())
  }

  if (value?.seconds !== undefined) {
    const seconds = Number(value.seconds)
    const nanos = Number(value.nanoseconds || value.nanoSeconds || 0)
    if (Number.isFinite(seconds)) {
      const millis = seconds * 1000 + (Number.isFinite(nanos) ? nanos / 1e6 : 0)
      return formatMillisAsKstYmd(millis)
    }
  }

  return ''
}

function getPrivatePackageCoverageBounds(pkg) {
  const startDate =
    formatPrivatePackageDateValueYmd(pkg?.registrationStartDate) ||
    formatPrivatePackageDateValueYmd(pkg?.startDate) ||
    formatPrivatePackageDateValueYmd(pkg?.packageStartDate) ||
    formatPrivatePackageDateValueYmd(pkg?.validFrom)
  const endDate =
    formatPrivatePackageDateValueYmd(pkg?.expiresAt) ||
    formatPrivatePackageDateValueYmd(pkg?.endDate) ||
    formatPrivatePackageDateValueYmd(pkg?.coverageEndDate) ||
    formatPrivatePackageDateValueYmd(pkg?.packageEndDate) ||
    formatPrivatePackageDateValueYmd(pkg?.validUntil)
  return { startDate, endDate }
}

export function formatPrivatePackageCoveragePeriodSummary(pkg) {
  const { startDate, endDate } = getPrivatePackageCoverageBounds(pkg)
  if (startDate && endDate) return `수강기간 ${startDate} ~ ${endDate}`
  if (startDate) return `수강기간 ${startDate} ~ 만료일 없음`
  if (endDate) return `수강기간 시작일 미설정 ~ ${endDate}`
  return '수강기간 미설정'
}

export function getPrivatePackageTeacherLabel(pkg) {
  return cleanText(pkg?.teacher || pkg?.teacherName, '선생님 미지정')
}

export function formatPrivatePackageUsageSummary(pkg) {
  const remaining = toFiniteNumber(pkg?.remainingCount)
  const total = toFiniteNumber(pkg?.totalCount)
  const usedFallback = Math.max(total - remaining, 0)
  const used =
    pkg?.usedCount != null && String(pkg.usedCount).trim() !== ''
      ? toFiniteNumber(pkg.usedCount)
      : usedFallback
  return `총 ${total}회 · 사용 ${used}회 · 남은 ${remaining}회`
}

function formatRegistrationDelta(row) {
  const count = Number(row?.deltaCount ?? row?.count ?? row?.lessonCount ?? 0)
  if (!Number.isFinite(count) || count <= 0) return ''
  return `+${count}회`
}

function getRegistrationLabel(row, index) {
  const explicit = String(row?.registrationLabel || row?.label || row?.title || '').trim()
  if (explicit) return explicit
  const round = Number(row?.registrationRound ?? row?.roundNumber ?? index + 1)
  if (Number.isFinite(round) && round > 0) return `${round}회차`
  return '추가 등록'
}

export function formatPrivatePackageRegistrationSummary(pkg) {
  const rows = Array.isArray(pkg?.registrationHistory)
    ? pkg.registrationHistory
    : Array.isArray(pkg?.registrationEntries)
      ? pkg.registrationEntries
      : Array.isArray(pkg?.registrationRounds)
        ? pkg.registrationRounds
        : []
  const entries = rows
    .map((row, index) => [getRegistrationLabel(row, index), formatRegistrationDelta(row)]
      .filter(Boolean)
      .join(' '))
    .filter(Boolean)
  if (entries.length > 0) return `등록 내역: ${entries.join(', ')}`
  if (Number(pkg?.topUpCount || 0) > 0 || pkg?.lastTopUpAt) return '등록 내역: 추가 등록 포함'
  return ''
}

export function formatPrivateTicketScheduleSummary(balance) {
  if (!balance) return ''
  const fixedAllocated = Math.max(0, Number(balance.futureFixedAllocatedCount) || 0)
  const activeReservations = Math.max(0, Number(balance.activeFutureReservationCount) || 0)
  const makeupAvailable = Math.max(0, Number(balance.makeupAvailableCount) || 0)
  const parts = []
  if (fixedAllocated > 0) parts.push(`주간 배정 ${fixedAllocated}회`)
  if (activeReservations > 0) parts.push(`직접 예약 ${activeReservations}회`)
  if (makeupAvailable > 0) parts.push(`직접 예약 가능 ${makeupAvailable}회`)
  return parts.join(' · ')
}

export function getGroupPackageLabel(pkg) {
  return cleanText(
    pkg?.groupClassName || pkg?.title || getGroupCourseTypeLabel(pkg?.groupCourseType),
    '단체반'
  )
}

export function formatGroupPackageUsageSummary(pkg) {
  const remaining = toFiniteNumber(pkg?.remainingCount)
  const total = toFiniteNumber(pkg?.totalCount)
  const usedFallback = Math.max(total - remaining, 0)
  const used =
    pkg?.usedCount != null && String(pkg.usedCount).trim() !== ''
      ? toFiniteNumber(pkg.usedCount)
      : usedFallback
  return `잔여 ${remaining}회 / 총 ${total}회 · 사용 ${used}회`
}

export function formatGroupTicketScheduleSummary(balance, pkg = {}) {
  if (!balance) return ''
  const packageType = String(pkg?.packageType || 'group').trim()
  const fixedAllocated = Math.max(0, Number(balance.futureFixedAllocatedCount) || 0)
  const available = Math.max(
    0,
    Number(balance.availableFreeBookingCount ?? balance.makeupAvailableCount) || 0
  )

  if (packageType === 'openGroup') {
    return available > 0 ? `자유 예약 가능 ${available}회` : ''
  }

  const parts = []
  if (fixedAllocated > 0) parts.push(`반 등록 수업 ${fixedAllocated}회`)
  if (isGroupTicketFreeBookingAllowed(pkg) && available > 0) {
    parts.push(`자유 예약 가능 ${available}회`)
  }
  return parts.join(' · ')
}

function selectDisplayPackages(packages, packageType) {
  const scoped = (Array.isArray(packages) ? packages : []).filter(
    (pkg) => String(pkg?.packageType || '').trim() === packageType
  )
  if (scoped.length === 0) return []
  const displayScoped =
    packageType === 'private'
      ? scoped.filter((pkg) => String(pkg?.status || '').trim().toLowerCase() !== 'revoked')
      : scoped
  if (displayScoped.length === 0) return []

  const activeRemaining = displayScoped.filter(
    (pkg) => isStudentPackageRowActive(pkg) && toFiniteNumber(pkg.remainingCount) > 0
  )
  if (activeRemaining.length > 0) return activeRemaining
  const active = displayScoped.filter((pkg) => isStudentPackageRowActive(pkg))
  if (active.length > 0) return active
  return displayScoped
}

export function buildStudentPrivateTicketSummaries({
  packages = [],
  privateLessons = [],
  privateReservations = [],
  academyId,
  studentId,
}) {
  const displayPackages = selectDisplayPackages(packages, 'private')
  return displayPackages.map((pkg) => {
    const packageId = String(pkg.id || '').trim()
    const balance = computePrivateTeacherPackageUsage({
      privatePackage: pkg,
      privateLessons,
      privateReservations,
      academyId,
      studentId,
      teacher: pkg.teacher || pkg.teacherName,
      teacherKey: pkg.teacherKey,
      teacherUid: pkg.teacherUid,
      teacherUID: pkg.teacherUID,
      teacherId: pkg.teacherId,
    })
    const remaining = toFiniteNumber(pkg.remainingCount)
    const isActive = isStudentPackageRowActive(pkg)
    return {
      id: packageId || `${getPrivatePackageTeacherLabel(pkg)}-${remaining}`,
      teacherLabel: getPrivatePackageTeacherLabel(pkg),
      usageText: formatPrivatePackageUsageSummary(pkg),
      coverageText: formatPrivatePackageCoveragePeriodSummary(pkg),
      scheduleText: formatPrivateTicketScheduleSummary(balance),
      cancelUsageText: formatPrivatePackageCancelUsageSummary(pkg),
      registrationSummaryText: formatPrivatePackageRegistrationSummary(pkg),
      muted: !isActive || remaining <= 0,
      statusText: !isActive || remaining <= 0 ? '소진' : '',
    }
  })
}

export function buildStudentGroupTicketSummaries({
  packages = [],
  groupReservations = [],
  academyId,
  studentId,
}) {
  const displayPackages = [
    ...selectDisplayPackages(packages, 'group'),
    ...selectDisplayPackages(packages, 'openGroup'),
  ]
  return displayPackages.map((pkg) => {
    const packageId = String(pkg.id || '').trim()
    const balance = computeGroupTicketBalance({
      ticket: pkg,
      fixedGroupLessons: [],
      groupReservations,
      studentId,
      academyId,
      groupScope: {
        groupClassId: pkg.groupClassId,
        groupCourseType: pkg.groupCourseType,
      },
    })
    const remaining = toFiniteNumber(pkg.remainingCount)
    const isActive = isStudentPackageRowActive(pkg)
    return {
      id: packageId || `${getGroupPackageLabel(pkg)}-${remaining}`,
      classLabel: getGroupPackageLabel(pkg),
      usageText: formatGroupPackageUsageSummary(pkg),
      scheduleText: formatGroupTicketScheduleSummary(balance, pkg),
      muted: !isActive || remaining <= 0,
      statusText: !isActive || remaining <= 0 ? '소진' : '',
    }
  })
}

export function buildStudentPrivateTicketSummariesFromCallablePackages(slots = []) {
  const byPackageId = new Map()
  ;(Array.isArray(slots) ? slots : []).forEach((slot) => {
    const summary = slot?.packageSummary
    if (String(summary?.status || '').trim().toLowerCase() === 'revoked') return
    const packageId = String(summary?.packageId || slot?.packageId || '').trim()
    if (!packageId || !summary) return
    byPackageId.set(packageId, {
      summary,
      teacherLabel: cleanText(
        slot?.teacher || slot?.teacherName || summary?.teacherKey,
        '선생님 미지정'
      ),
    })
  })
  return Array.from(byPackageId.entries()).map(([packageId, row]) => {
    const summary = row.summary
    const totalCount = toFiniteNumber(summary.totalCount)
    const used = toFiniteNumber(summary.usedDeductedCount)
    const remaining = Math.max(0, totalCount - used)
    const balanceLike = {
      futureFixedAllocatedCount: summary.futureFixedAllocatedCount,
      activeFutureReservationCount: summary.activeFutureReservationCount,
      noDeductionReleasedCount: summary.noDeductionReleasedCount,
      makeupAvailableCount: summary.makeupAvailableCount ?? summary.remainingCount,
    }
    return {
      id: packageId,
      teacherLabel: row.teacherLabel,
      usageText: `총 ${totalCount}회 · 사용 ${used}회 · 남은 ${remaining}회`,
      coverageText: formatPrivatePackageCoveragePeriodSummary(summary),
      scheduleText: formatPrivateTicketScheduleSummary(balanceLike),
      cancelUsageText: formatPrivatePackageCancelUsageSummary({
        used: summary.privateCancelUsedCount,
        limit: summary.privateCancelLimit,
        remaining: summary.privateCancelRemaining,
      }),
      registrationSummaryText: formatPrivatePackageRegistrationSummary(summary),
      muted: remaining <= 0,
      statusText: remaining <= 0 ? '소진' : '',
    }
  })
}

export function buildStudentTicketSummaryViewModel({
  packages = [],
  privateLessons = [],
  privateReservations = [],
  groupReservations = [],
  academyId,
  studentId,
}) {
  const privateSummaries = buildStudentPrivateTicketSummaries({
    packages,
    privateLessons,
    privateReservations,
    academyId,
    studentId,
  })
  const groupSummaries = buildStudentGroupTicketSummaries({
    packages,
    groupReservations,
    academyId,
    studentId,
  })

  return {
    privateSummaries,
    groupSummaries,
    hasPrivateTicket: privateSummaries.length > 0,
    hasGroupTicket: groupSummaries.length > 0,
  }
}

export function resolveLinkedStudentDisplayName({
  membershipDisplayName = '',
  privateStudentRecord = null,
  packageStudentName = '',
}) {
  return (
    cleanText(membershipDisplayName, '') ||
    cleanText(privateStudentRecord?.name || privateStudentRecord?.studentName, '') ||
    cleanText(packageStudentName, '')
  )
}

export function formatStudentBookingIdentityLine({
  academyName = '',
  studentName = '',
  email = '',
}) {
  const identity =
    studentName && email
      ? `${studentName} · ${email}`
      : studentName || email || '-'
  const academy = cleanText(academyName, '-')
  return `${academy} · ${identity}`
}
