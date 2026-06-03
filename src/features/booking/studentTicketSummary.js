import { isStudentPackageRowActive } from '../dashboard/dashboardViewUtils.js'
import { getGroupCourseTypeLabel } from '../group-booking/groupCourseTypes.js'
import { computePrivateTeacherPackageUsage } from '../dashboard/privatePackageHelpers.js'
import {
  computeGroupTicketBalance,
} from '../dashboard/ticketBalanceHelpers.js'

function toFiniteNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function cleanText(value, fallback = '-') {
  const text = String(value ?? '').trim()
  return text || fallback
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
  const releasedCount = Math.max(0, Number(balance.noDeductionReleasedCount) || 0)
  const makeupAvailable = Math.max(0, Number(balance.makeupAvailableCount) || 0)
  const parts = [`고정 예정 ${fixedAllocated}회`]
  if (activeReservations > 0) parts.push(`보충 예약 ${activeReservations}회`)
  const availableLabel = releasedCount > activeReservations ? '보충 가능' : '예약 가능'
  parts.push(`${availableLabel} ${makeupAvailable}회`)
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

export function formatGroupTicketScheduleSummary(balance) {
  if (!balance) return ''
  const fixedAllocated = Math.max(0, Number(balance.futureFixedAllocatedCount) || 0)
  const activeReservations = Math.max(0, Number(balance.activeFutureReservationCount) || 0)
  const available = Math.max(0, Number(balance.makeupAvailableCount) || 0)
  const parts = [`고정 예정 ${fixedAllocated}회`]
  if (activeReservations > 0) parts.push(`선택예약 ${activeReservations}회`)
  parts.push(`선택예약 가능 ${available}회`)
  return parts.join(' · ')
}

function selectDisplayPackages(packages, packageType) {
  const scoped = (Array.isArray(packages) ? packages : []).filter(
    (pkg) => String(pkg?.packageType || '').trim() === packageType
  )
  if (scoped.length === 0) return []

  const activeRemaining = scoped.filter(
    (pkg) => isStudentPackageRowActive(pkg) && toFiniteNumber(pkg.remainingCount) > 0
  )
  if (activeRemaining.length > 0) return activeRemaining
  const active = scoped.filter((pkg) => isStudentPackageRowActive(pkg))
  if (active.length > 0) return active
  return scoped
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
      scheduleText: formatPrivateTicketScheduleSummary(balance),
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
  const displayPackages = selectDisplayPackages(packages, 'group')
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
      scheduleText: formatGroupTicketScheduleSummary(balance),
      muted: !isActive || remaining <= 0,
      statusText: !isActive || remaining <= 0 ? '소진' : '',
    }
  })
}

export function buildStudentPrivateTicketSummariesFromCallablePackages(slots = []) {
  const byPackageId = new Map()
  ;(Array.isArray(slots) ? slots : []).forEach((slot) => {
    const summary = slot?.packageSummary
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
      scheduleText: formatPrivateTicketScheduleSummary(balanceLike),
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
