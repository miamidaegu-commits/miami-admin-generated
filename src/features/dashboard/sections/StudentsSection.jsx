import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions as firebaseFunctions } from '../../../../firebase'
import {
  formatCreditTransactionActionTypeLabel,
  formatCreditTransactionCreatedAtDisplay,
  formatCreditTransactionDeltaCountDisplay,
  formatDate,
  formatGroupStudentStartDate,
  formatStudentPackageDetailAmountPaid,
  formatStudentPackageDetailMemo,
  formatStudentPackageDetailStatusLabel,
  formatStudentPackageDetailTypeLabel,
  getLessonDate,
  getLessonStorageDateString,
  getTeacherName,
  formatTime,
  isStudentPackageRowActive,
  sanitizePhoneForTel,
  parseYmdToLocalDate,
} from '../dashboardViewUtils.js'
import { setStudentPrivateSlotBookingPilotEnabled } from '../../private-booking/studentPrivateAccessSummaryClient.js'
import { getGroupCourseTypeLabel } from '../../group-booking/groupCourseTypes.js'
import {
  computeStudentPrivateCancelAllowance,
  formatAdminStudentCancelAllowanceSummary,
  STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT,
  STUDENT_PRIVATE_CANCEL_LIMIT_MAX,
  validateStudentCancelLimitInput,
} from '../../booking/studentPrivateCancelAllowance.js'

function cleanText(value, fallback = '-') {
  const text = String(value ?? '').trim()
  return text || fallback
}

const STUDENT_INVITATION_APP_URL_BY_PROJECT_ID = {
  'daegu-miami-production': 'https://daegumiami.com',
  'miami-e2e': 'https://miami-e2e.web.app',
}

function getStudentInvitationAppUrl() {
  const configuredUrl = String(import.meta.env.VITE_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
  if (configuredUrl) return configuredUrl
  return (
    STUDENT_INVITATION_APP_URL_BY_PROJECT_ID[import.meta.env.VITE_FIREBASE_PROJECT_ID] ||
    'https://miami-e2e.web.app'
  )
}

const STUDENT_INVITATION_APP_URL = getStudentInvitationAppUrl()

function toFiniteNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function toPositiveInteger(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

function packageKindLabel(packageType) {
  if (packageType === 'private') return '1:1'
  if (packageType === 'group' || packageType === 'openGroup') return '단체반'
  return formatStudentPackageDetailTypeLabel(packageType)
}

function getPrivatePackageTeacherLabel(pkg) {
  return cleanText(pkg?.teacherName || pkg?.teacher, '선생님 미지정')
}

function formatPrivatePackageTeacherScope(pkg) {
  const display = String(pkg?.teacherName || '').trim()
  const key = String(pkg?.teacherKey || pkg?.teacher || '').trim()
  if (display && key && display !== key) return `${display} · ${key}`
  return display || key || '-'
}

function formatPrivatePackageUsageSummary(pkg) {
  const remaining = toFiniteNumber(pkg?.remainingCount)
  const total = toFiniteNumber(pkg?.totalCount)
  const usedFallback = Math.max(total - remaining, 0)
  const used = pkg?.usedCount != null && String(pkg.usedCount).trim() !== ''
    ? toFiniteNumber(pkg.usedCount)
    : usedFallback
  return `잔여 ${remaining}회 / 총 ${total}회 · 사용 ${used}회`
}

function formatPrivateTicketScheduleSummary(balance) {
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

function formatPrivatePackageTeacherSummary(packages, balanceByPackageId = new Map()) {
  const privatePackages = (Array.isArray(packages) ? packages : []).filter(
    (pkg) => String(pkg?.packageType || '').trim() === 'private'
  )
  if (privatePackages.length === 0) return []

  const activeRemainingPackages = privatePackages.filter(
    (pkg) => isStudentPackageRowActive(pkg) && toFiniteNumber(pkg.remainingCount) > 0
  )
  const displayPackages =
    activeRemainingPackages.length > 0
      ? activeRemainingPackages
      : privatePackages.filter((pkg) => isStudentPackageRowActive(pkg)).length > 0
        ? privatePackages.filter((pkg) => isStudentPackageRowActive(pkg))
        : privatePackages

  return displayPackages.map((pkg) => {
    const remaining = toFiniteNumber(pkg.remainingCount)
    const isActive = isStudentPackageRowActive(pkg)
    const balance = balanceByPackageId.get(String(pkg.id || '').trim())
    const scheduleText = formatPrivateTicketScheduleSummary(balance)
    return {
      id: String(pkg.id || `${getPrivatePackageTeacherLabel(pkg)}-${remaining}`),
      text: `${getPrivatePackageTeacherLabel(pkg)} 수강권 · ${formatPrivatePackageUsageSummary(pkg)}`,
      scheduleText,
      statusText: !isActive || remaining <= 0 ? '소진' : '',
      muted: !isActive || remaining <= 0,
    }
  })
}

function PrivateLessonProgressSummary({ progress, scheduleOnly = false }) {
  if (!progress) return null
  return (
    <span
      data-testid="student-private-lesson-progress"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px 8px',
        marginTop: 4,
        fontSize: 12,
        lineHeight: 1.35,
        opacity: 0.82,
      }}
    >
      {scheduleOnly ? <span>일정 기준</span> : null}
      <span>총 {Number(progress.totalRegistered) || 0}회</span>
      <span>지난 {Number(progress.pastLessons) || 0}회</span>
      <span>예정 {Number(progress.remainingScheduled ?? progress.upcomingLessons) || 0}회</span>
    </span>
  )
}

function privateLessonProgressForDisplay(student, progress) {
  if (progress) return progress
  const paidLessons = toPositiveInteger(student?.paidLessons)
  if (paidLessons <= 0) return null
  return {
    totalRegistered: paidLessons,
    pastLessons: 0,
    upcomingLessons: 0,
    remainingScheduled: 0,
  }
}

function docDateToMillis(raw) {
  if (!raw) return 0
  if (typeof raw.toMillis === 'function') return raw.toMillis()
  if (typeof raw.toDate === 'function') return raw.toDate().getTime()
  if (raw.seconds != null) return Number(raw.seconds) * 1000
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    const d = parseYmdToLocalDate(raw.trim())
    return d ? d.getTime() : 0
  }
  return 0
}

function docDateToDate(raw) {
  if (!raw) return null
  if (raw instanceof Date) return raw
  if (typeof raw.toDate === 'function') return raw.toDate()
  if (raw.seconds != null) return new Date(Number(raw.seconds) * 1000)
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const parsed = parseYmdToLocalDate(trimmed)
      return parsed || null
    }
    const ms = Date.parse(trimmed)
    return Number.isFinite(ms) ? new Date(ms) : null
  }
  return null
}

function formatYmdDate(raw, fallback = '-') {
  if (!raw) return fallback
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    return raw.trim()
  }
  const date = docDateToDate(raw)
  if (!date || !Number.isFinite(date.getTime())) return fallback
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`
}

function formatYmdDateTime(raw, fallback = '기록 없음') {
  const date = docDateToDate(raw)
  if (!date || !Number.isFinite(date.getTime())) return fallback
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')} ${byType.get('hour')}:${byType.get('minute')}`
}

function formatPackagePaymentDate(pkg) {
  return formatYmdDate(pkg?.paymentDate || pkg?.paidDate || pkg?.paidAt, '기록 없음')
}

function formatPackageStartDate(pkg) {
  return formatYmdDate(pkg?.registrationStartDate || pkg?.startDate, '-')
}

function ymdTimeToMillis(dateValue, timeValue) {
  const date = String(dateValue || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const time = String(timeValue || '').trim()
  const safeTime = /^\d{2}:\d{2}$/.test(time) ? time : '23:59'
  const d = new Date(`${date}T${safeTime}:00`)
  const ms = d.getTime()
  return Number.isFinite(ms) ? ms : null
}

function reservationStatusLabel(row, startsAtMs) {
  if (row?.status !== 'active') return '예약 취소'
  if (startsAtMs !== null && startsAtMs < Date.now()) return '지난 수업'
  return '예약 완료'
}

function privateReservationStatusLabel(row, startsAtMs) {
  const status = String(row?.status || '').trim()
  const isPast = startsAtMs !== null && startsAtMs < Date.now()
  const wasDeducted =
    row?.deductionApplied === true ||
    Boolean(row?.deductionCreditTransactionId) ||
    status === 'completed' ||
    status === 'no_show'
  const wasReversed =
    Boolean(row?.outcomeReversedAt) ||
    Boolean(row?.reversalCreditTransactionId) ||
    Boolean(row?.previousOutcomeStatus)

  if (status === 'cancelled' || status === 'canceled') return '예약 취소'
  if (wasReversed) return isPast ? '지난 수업 · 차감 취소' : '차감 취소'
  if (wasDeducted) return isPast ? '지난 수업 · 차감 완료' : '차감 완료'
  if (status === 'active' && isPast) return '지난 수업 · 미차감'
  if (status === 'active') return '예약 완료'
  return cleanText(status, '-')
}

function creditTransactionHistoryStatus(row) {
  const actionType = String(row?.actionType || '').trim()
  const delta = Number(row?.deltaCount ?? 0)
  if (actionType === 'group_deduct' || delta < 0) return '출석 처리됨'
  if (actionType.includes('restore') || actionType.includes('cancel') || delta > 0) {
    return '차감 취소'
  }
  return formatCreditTransactionActionTypeLabel(actionType)
}

function buildStudentInvitationMessage({ email, resetLink }) {
  return [
    '안녕하세요. 수업 예약 페이지 로그인 안내입니다.',
    '아래 링크를 눌러 비밀번호를 설정한 뒤 로그인해 주세요.',
    '',
    `로그인 이메일: ${String(email || '').trim()}`,
    `비밀번호 설정 링크: ${String(resetLink || '').trim()}`,
    `예약 페이지: ${STUDENT_INVITATION_APP_URL}`,
  ].join('\n')
}

async function copyTextToClipboard(text) {
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (error) {
      console.warn('Clipboard API copy failed, falling back to selection copy:', error)
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-1000px'
  textarea.style.left = '-1000px'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }
}

function getStudentAccountLinkErrorMessage(error) {
  const message = String(error?.message || '').trim()
  if (error?.code === 'functions/unauthenticated') {
    return '로그인이 필요합니다.'
  }
  if (error?.code === 'functions/permission-denied') {
    return '학원 관리자만 학생 로그인 초대를 만들 수 있습니다.'
  }
  if (error?.code === 'functions/invalid-argument') {
    return message || '입력값을 확인해 주세요.'
  }
  if (error?.code === 'functions/failed-precondition') {
    if (/customClaims role|existing .* user|existing academy membership role/i.test(message)) {
      return '이미 관리자, 선생님, 직원 권한이 있는 이메일은 학생 로그인 초대로 사용할 수 없습니다.'
    }
    return message || '이미 연결된 계정 정보를 확인해 주세요.'
  }
  return message || '학생 로그인 초대에 실패했습니다.'
}

export default function StudentsSection({
  loading,
  currentAcademyId,
  privateStudents,
  filteredSortedPrivateStudents,
  studentSearchQuery,
  setStudentSearchQuery,
  studentTeacherFilter,
  setStudentTeacherFilter,
  studentRegistrationFilter,
  setStudentRegistrationFilter,
  studentPrivatePackageFilter,
  setStudentPrivatePackageFilter,
  studentGroupPackageFilter,
  setStudentGroupPackageFilter,
  studentNextLessonFilter,
  setStudentNextLessonFilter,
  studentAttentionFilter,
  setStudentAttentionFilter,
  studentSortKey,
  setStudentSortKey,
  studentTodayLessonOnly,
  setStudentTodayLessonOnly,
  studentListKpis,
  studentListTeacherOptions,
  isAdmin,
  studentPackageTableSummaryByStudentId,
  privateLessonProgressByStudentId = new Map(),
  studentPackagesSortedByStudentId,
  privateTicketBalanceByPackageId = new Map(),
  expandedStudentPackageStudentId,
  setExpandedStudentPackageStudentId,
  showAllStudentPackagesInDetail,
  setShowAllStudentPackagesInDetail,
  studentAttentionFlagsByStudentId,
  activeGroupRegistrationsByStudentId,
  nextPrivateLessonByStudentId,
  nextGroupLessonByStudentId,
  groupClasses,
  studentSummaryGroupLessons,
  studentSummaryGroupStudents,
  studentPackages,
  busyStudentId,
  busyStudentPackageSubmit,
  busyStudentPackageActionId,
  canAddStudent,
  canEditStudent,
  canDeleteStudent,
  canViewPaymentFields = false,
  copiedStudentPhoneId,
  copyStudentPhone,
  openStudentAddModal,
  openStudentEditModal,
  handleDeleteStudent,
  openStudentPackageModal,
  openStudentPackageEditModal,
  canEditStudentPackageCountsForPackage = () => false,
  endStudentPackage,
  openStudentPackageHistoryModal,
  openStudentPackageReRegisterModal,
  formatStudentFirstRegisteredForTable,
  formatStudentPackageCellSummary,
  studentPrivateBookingStats = [],
}) {
  const [studentAccountLinkModalStudent, setStudentAccountLinkModalStudent] = useState(null)
  const [studentAccountEmail, setStudentAccountEmail] = useState('')
  const [studentAccountDisplayName, setStudentAccountDisplayName] = useState('')
  const [studentAccountLinkBusy, setStudentAccountLinkBusy] = useState(false)
  const [studentAccountLinkError, setStudentAccountLinkError] = useState('')
  const [studentAccountLinkResult, setStudentAccountLinkResult] = useState(null)
  const [studentAccountInvitationCopied, setStudentAccountInvitationCopied] = useState(false)
  const [studentHistoryModalStudent, setStudentHistoryModalStudent] = useState(null)
  const [studentHistoryLoading, setStudentHistoryLoading] = useState(false)
  const [studentHistoryError, setStudentHistoryError] = useState('')
  const [studentHistoryGroupReservations, setStudentHistoryGroupReservations] = useState([])
  const [studentHistoryPrivateReservations, setStudentHistoryPrivateReservations] = useState([])
  const [studentHistoryCreditTransactions, setStudentHistoryCreditTransactions] = useState([])
  const [studentPrivateAccessSummaryByStudentId, setStudentPrivateAccessSummaryByStudentId] =
    useState(new Map())
  const [busyPrivateSlotPilotStudentId, setBusyPrivateSlotPilotStudentId] = useState('')
  const [cancelAllowanceModalStudent, setCancelAllowanceModalStudent] = useState(null)
  const [cancelAllowanceDraftLimit, setCancelAllowanceDraftLimit] = useState('')
  const [cancelAllowanceBusy, setCancelAllowanceBusy] = useState(false)
  const [cancelAllowanceError, setCancelAllowanceError] = useState('')
  const [cancelAllowanceSuccess, setCancelAllowanceSuccess] = useState('')

  const studentCancelAllowanceByStudentId = useMemo(() => {
    const map = new Map()
    ;(Array.isArray(studentPrivateBookingStats) ? studentPrivateBookingStats : []).forEach((row) => {
      const scopedAcademyId = String(currentAcademyId || '').trim()
      if (String(row?.academyId || '').trim() !== scopedAcademyId) return
      const studentId = String(row?.studentId || '').trim()
      if (!studentId) return
      map.set(studentId, computeStudentPrivateCancelAllowance(row))
    })
    return map
  }, [studentPrivateBookingStats, currentAcademyId])

  useEffect(() => {
    if (!isAdmin || !currentAcademyId) {
      setStudentPrivateAccessSummaryByStudentId(new Map())
      return undefined
    }

    const unsubscribe = onSnapshot(
      query(
        collection(db, 'studentPrivateAccessSummary'),
        where('academyId', '==', currentAcademyId)
      ),
      (snapshot) => {
        const next = new Map()
        snapshot.docs.forEach((docItem) => {
          const data = docItem.data()
          const studentId = String(data.studentId || '').trim()
          if (!studentId) return
          next.set(studentId, { id: docItem.id, ...data })
        })
        setStudentPrivateAccessSummaryByStudentId(next)
      },
      (error) => {
        console.error('studentPrivateAccessSummary(admin) 불러오기 실패:', error)
        setStudentPrivateAccessSummaryByStudentId(new Map())
      }
    )

    return () => unsubscribe()
  }, [currentAcademyId, isAdmin])

  const groupLessonById = useMemo(() => {
    const map = new Map()
    ;(studentSummaryGroupLessons || []).forEach((lesson) => {
      if (lesson?.id) map.set(lesson.id, lesson)
    })
    return map
  }, [studentSummaryGroupLessons])

  const studentAccountPasswordResetLink = String(
    studentAccountLinkResult?.passwordResetLink || studentAccountLinkResult?.resetLink || ''
  ).trim()

  const studentAccountInvitationMessage = useMemo(() => {
    const email = String(studentAccountLinkResult?.email || studentAccountEmail || '').trim()
    if (!email || !studentAccountPasswordResetLink) return ''
    return buildStudentInvitationMessage({
      email,
      resetLink: studentAccountPasswordResetLink,
    })
  }, [studentAccountEmail, studentAccountLinkResult?.email, studentAccountPasswordResetLink])

  const studentHistoryPackages = useMemo(() => {
    const studentId = String(studentHistoryModalStudent?.id || '').trim()
    if (!studentId) return []
    return studentPackages
      .filter(
        (pkg) =>
          String(pkg.academyId || '').trim() === String(currentAcademyId || '').trim() &&
          String(pkg.studentId || '').trim() === studentId
      )
      .sort((a, b) => docDateToMillis(b.createdAt) - docDateToMillis(a.createdAt))
  }, [currentAcademyId, studentHistoryModalStudent?.id, studentPackages])

  const studentHistoryGroupRows = useMemo(() => {
    const studentId = String(studentHistoryModalStudent?.id || '').trim()
    if (!studentId) return []
    return (studentSummaryGroupStudents || []).filter(
      (row) =>
        String(row.academyId || '').trim() === String(currentAcademyId || '').trim() &&
        String(row.studentId || '').trim() === studentId
    )
  }, [currentAcademyId, studentHistoryModalStudent?.id, studentSummaryGroupStudents])

  const studentHistoryPackageById = useMemo(() => {
    return new Map(studentHistoryPackages.map((pkg) => [pkg.id, pkg]))
  }, [studentHistoryPackages])

  const studentHistorySummary = useMemo(() => {
    const activePackages = studentHistoryPackages.filter((pkg) => isStudentPackageRowActive(pkg))
    const endedPackages = studentHistoryPackages.filter((pkg) => !isStudentPackageRowActive(pkg))
    const activeRemainingTotal = activePackages.reduce(
      (sum, pkg) => sum + toFiniteNumber(pkg.remainingCount),
      0
    )
    const usedTotal = studentHistoryPackages.reduce(
      (sum, pkg) => sum + toFiniteNumber(pkg.usedCount ?? pkg.attendanceCount),
      0
    )
    const latestPackage = studentHistoryPackages[0] || null
    return {
      activeCount: activePackages.length,
      endedCount: endedPackages.length,
      activeRemainingTotal,
      usedTotal,
      latestStatus: latestPackage
        ? formatStudentPackageDetailStatusLabel(latestPackage.status)
        : '-',
    }
  }, [studentHistoryPackages])

  const studentHistoryRows = useMemo(() => {
    const groupRows = studentHistoryGroupReservations.map((reservation) => {
      const lesson = groupLessonById.get(reservation.lessonId) || null
      const date = cleanText(reservation.date || lesson?.date, '')
      const time = cleanText(reservation.time || lesson?.time, '')
      const startsAtMs = ymdTimeToMillis(date, time)
      const groupClassId = cleanText(reservation.groupClassId || lesson?.groupClassId, '')
      const groupRegistration =
        studentHistoryGroupRows.find(
          (row) => cleanText(row.groupClassId, '') === groupClassId && cleanText(row.packageId, '')
        ) || null
      const packageId = cleanText(reservation.packageId || groupRegistration?.packageId, '')
      const pkg = packageId ? studentHistoryPackageById.get(packageId) : null
      return {
        key: `group-reservation-${reservation.id}`,
        date,
        time,
        type: '단체반 수업',
        teacher: cleanText(reservation.teacher || lesson?.teacher || lesson?.teacherName),
        title: cleanText(reservation.subject || lesson?.subject || lesson?.groupClassName, '단체반 수업'),
        status: reservationStatusLabel(reservation, startsAtMs),
        packageTitle: cleanText(reservation.packageTitle || pkg?.title, '-'),
        sortMs: startsAtMs ?? docDateToMillis(reservation.updatedAt),
      }
    })

    const privateRows = studentHistoryPrivateReservations.map((reservation) => {
      const date = cleanText(reservation.date, '')
      const time = cleanText(reservation.time, '')
      const startsAtMs = ymdTimeToMillis(date, time)
      const pkg = reservation.packageId
        ? studentHistoryPackageById.get(String(reservation.packageId))
        : null
      return {
        key: `private-reservation-${reservation.id}`,
        date,
        time,
        type: '1:1 수업',
        teacher: cleanText(reservation.teacher),
        title: '1:1 수업',
        status: privateReservationStatusLabel(reservation, startsAtMs),
        packageTitle: cleanText(reservation.packageTitle || pkg?.title, '-'),
        sortMs: startsAtMs ?? docDateToMillis(reservation.updatedAt),
      }
    })

    const creditRows = studentHistoryCreditTransactions.map((row) => {
      const pkg = row.packageId ? studentHistoryPackageById.get(String(row.packageId)) : null
      return {
        key: `credit-${row.id}`,
        date: formatCreditTransactionCreatedAtDisplay(row.createdAt),
        time: '-',
        type: packageKindLabel(row.packageType) === '1:1' ? '1:1 수업' : '단체반 수업',
        teacher: cleanText(row.teacher),
        title: cleanText(row.memo, '차감 이력'),
        status: creditTransactionHistoryStatus(row),
        packageTitle: cleanText(row.packageTitle || pkg?.title, '-'),
        delta: formatCreditTransactionDeltaCountDisplay(row.deltaCount),
        sortMs: docDateToMillis(row.createdAt),
      }
    })

    return [...groupRows, ...privateRows, ...creditRows].sort((a, b) => b.sortMs - a.sortMs)
  }, [
    groupLessonById,
    studentHistoryCreditTransactions,
    studentHistoryGroupReservations,
    studentHistoryGroupRows,
    studentHistoryPackageById,
    studentHistoryPrivateReservations,
  ])

  function openStudentAccountLinkModal(student) {
    setStudentAccountLinkModalStudent(student)
    setStudentAccountEmail(String(student.studentEmail || student.email || '').trim())
    setStudentAccountDisplayName(String(student.name || '').trim())
    setStudentAccountLinkError('')
    setStudentAccountLinkResult(null)
    setStudentAccountInvitationCopied(false)
  }

  function closeStudentAccountLinkModal() {
    if (studentAccountLinkBusy) return
    setStudentAccountLinkModalStudent(null)
    setStudentAccountEmail('')
    setStudentAccountDisplayName('')
    setStudentAccountLinkError('')
    setStudentAccountLinkResult(null)
    setStudentAccountInvitationCopied(false)
  }

  function closeStudentHistoryModal() {
    if (studentHistoryLoading) return
    setStudentHistoryModalStudent(null)
    setStudentHistoryError('')
    setStudentHistoryGroupReservations([])
    setStudentHistoryPrivateReservations([])
    setStudentHistoryCreditTransactions([])
  }

  async function openStudentHistoryModal(student) {
    if (!isAdmin || !student?.id) return
    setStudentHistoryModalStudent(student)
    setStudentHistoryLoading(true)
    setStudentHistoryError('')
    setStudentHistoryGroupReservations([])
    setStudentHistoryPrivateReservations([])
    setStudentHistoryCreditTransactions([])

    try {
      const studentId = String(student.id || '').trim()
      const packagesForStudent = studentPackages.filter(
        (pkg) =>
          String(pkg.academyId || '').trim() === String(currentAcademyId || '').trim() &&
          String(pkg.studentId || '').trim() === studentId
      )

      const [groupReservationSnap, privateReservationSnap, creditTransactionSnaps] =
        await Promise.all([
          getDocs(
            query(
              collection(db, 'groupLessonReservations'),
              where('academyId', '==', currentAcademyId),
              where('studentId', '==', studentId),
              where('status', 'in', ['active', 'cancelled'])
            )
          ),
          getDocs(
            query(
              collection(db, 'privateLessonReservations'),
              where('academyId', '==', currentAcademyId),
              where('studentId', '==', studentId),
              where('status', 'in', ['active', 'cancelled'])
            )
          ),
          Promise.all(
            packagesForStudent.map((pkg) =>
              getDocs(
                query(
                  collection(db, 'creditTransactions'),
                  where('academyId', '==', currentAcademyId),
                  where('packageId', '==', pkg.id)
                )
              )
            )
          ),
        ])

      setStudentHistoryGroupReservations(
        groupReservationSnap.docs
          .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
          .filter(
            (row) =>
              String(row.academyId || '').trim() === String(currentAcademyId || '').trim() &&
              String(row.studentId || '').trim() === studentId
          )
      )
      setStudentHistoryPrivateReservations(
        privateReservationSnap.docs
          .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
          .filter(
            (row) =>
              String(row.academyId || '').trim() === String(currentAcademyId || '').trim() &&
              String(row.studentId || '').trim() === studentId
          )
      )
      setStudentHistoryCreditTransactions(
        creditTransactionSnaps
          .flatMap((snap) => snap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })))
          .filter((row) => {
            const actionType = String(row.actionType || '').trim()
            return (
              String(row.academyId || '').trim() === String(currentAcademyId || '').trim() &&
              String(row.studentId || '').trim() === studentId &&
              (String(row.sourceType || '').trim() === 'groupLesson' ||
                actionType.includes('deduct'))
            )
          })
      )
    } catch (error) {
      console.error('학생 수업 내역 조회 실패:', error)
      setStudentHistoryError('학생 수업 내역을 불러오지 못했습니다.')
    } finally {
      setStudentHistoryLoading(false)
    }
  }

  async function copyStudentAccountInvitationMessage() {
    if (!studentAccountInvitationMessage) return
    try {
      await copyTextToClipboard(studentAccountInvitationMessage)
      setStudentAccountInvitationCopied(true)
    } catch (error) {
      console.warn('학생 로그인 초대 안내문 복사 실패:', error)
    }
  }

  async function submitStudentAccountLink() {
    if (!studentAccountLinkModalStudent || studentAccountLinkBusy) return
    setStudentAccountLinkBusy(true)
    setStudentAccountLinkError('')
    setStudentAccountLinkResult(null)
    setStudentAccountInvitationCopied(false)
    try {
      const linkStudentAccount = httpsCallable(firebaseFunctions, 'linkStudentAccount')
      const result = await linkStudentAccount({
        academyId: currentAcademyId,
        studentId: studentAccountLinkModalStudent.id,
        email: studentAccountEmail.trim(),
        displayName: studentAccountDisplayName.trim(),
      })
      setStudentAccountLinkResult(result.data)
    } catch (error) {
      console.error('학생 로그인 초대 실패:', error)
      setStudentAccountLinkError(getStudentAccountLinkErrorMessage(error))
    } finally {
      setStudentAccountLinkBusy(false)
    }
  }

  async function togglePrivateSlotBookingPilot(student, enabled) {
    if (!isAdmin || !student?.id || !currentAcademyId) return
    setBusyPrivateSlotPilotStudentId(student.id)
    try {
      await setStudentPrivateSlotBookingPilotEnabled(db, {
        academyId: currentAcademyId,
        studentId: student.id,
        enabled,
      })
    } catch (error) {
      console.error('1:1 예약 테스트 권한 변경 실패:', error)
      alert(`1:1 예약 테스트 권한 변경 실패: ${error.message}`)
    } finally {
      setBusyPrivateSlotPilotStudentId('')
    }
  }

  function resolveStudentCancelAllowance(student) {
    const studentId = String(student?.id || '').trim()
    if (!studentId) {
      return computeStudentPrivateCancelAllowance({})
    }
    return (
      studentCancelAllowanceByStudentId.get(studentId) ||
      computeStudentPrivateCancelAllowance({})
    )
  }

  function openCancelAllowanceModal(student) {
    const allowance = resolveStudentCancelAllowance(student)
    setCancelAllowanceModalStudent(student)
    setCancelAllowanceDraftLimit(String(allowance.limit))
    setCancelAllowanceError('')
    setCancelAllowanceSuccess('')
  }

  function closeCancelAllowanceModal() {
    if (cancelAllowanceBusy) return
    setCancelAllowanceModalStudent(null)
    setCancelAllowanceDraftLimit('')
    setCancelAllowanceError('')
    setCancelAllowanceSuccess('')
  }

  async function submitCancelAllowanceUpdate() {
    if (!cancelAllowanceModalStudent?.id || !currentAcademyId || cancelAllowanceBusy) return
    const allowance = resolveStudentCancelAllowance(cancelAllowanceModalStudent)
    const validation = validateStudentCancelLimitInput({
      limit: cancelAllowanceDraftLimit,
      used: allowance.used,
      max: STUDENT_PRIVATE_CANCEL_LIMIT_MAX,
    })
    if (!validation.ok) {
      setCancelAllowanceError(validation.message)
      setCancelAllowanceSuccess('')
      return
    }

    setCancelAllowanceBusy(true)
    setCancelAllowanceError('')
    setCancelAllowanceSuccess('')
    try {
      const updateStudentPrivateCancelAllowance = httpsCallable(
        firebaseFunctions,
        'updateStudentPrivateCancelAllowance'
      )
      const result = await updateStudentPrivateCancelAllowance({
        academyId: currentAcademyId,
        studentId: cancelAllowanceModalStudent.id,
        studentCancelLimit: validation.limit,
      })
      const data = result?.data || {}
      const updatedAllowance = computeStudentPrivateCancelAllowance({
        studentCancelCount: data.studentCancelCount,
        studentCancelLimit: data.studentCancelLimit,
      })
      setCancelAllowanceDraftLimit(String(updatedAllowance.limit))
      setCancelAllowanceSuccess('취소 가능 한도를 저장했습니다.')
    } catch (error) {
      console.error('취소 가능 한도 저장 실패:', error)
      setCancelAllowanceError(error?.message || '취소 가능 한도 저장에 실패했습니다.')
    } finally {
      setCancelAllowanceBusy(false)
    }
  }

  return (
  <section className="activity-section">
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        flexWrap: 'wrap',
      }}
    >
      <h2 className="section-title" style={{ margin: 0 }}>
        학생 관리
      </h2>
      {canAddStudent ? (
        <button
          type="button"
          onClick={openStudentAddModal}
          disabled={busyStudentId === '__add__' || loading}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid #444',
            background: '#1f2a44',
            color: 'white',
            cursor:
              busyStudentId === '__add__' || loading ? 'not-allowed' : 'pointer',
          }}
        >
          {busyStudentId === '__add__' ? '추가 중...' : '학생 추가'}
        </button>
      ) : null}
    </div>

    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 14,
      }}
    >
      {(
        [
          {
            key: 'total',
            title: '전체 학생',
            value: studentListKpis.totalStudents,
            hint: '등록된 학생',
            selected:
              studentAttentionFilter === 'all' &&
              studentRegistrationFilter === 'all' &&
              studentNextLessonFilter === 'all' &&
              !studentTodayLessonOnly,
            onClick: () => {
              setStudentAttentionFilter('all')
              setStudentRegistrationFilter('all')
              setStudentNextLessonFilter('all')
              setStudentTodayLessonOnly(false)
            },
          },
          {
            key: 'renewal',
            title: '재등록 필요',
            value: studentListKpis.renewalNeededCount,
            hint: '주의 기준',
            selected: studentAttentionFilter === 'renewal' && !studentTodayLessonOnly,
            onClick: () => {
              setStudentAttentionFilter('renewal')
              setStudentTodayLessonOnly(false)
            },
          },
          {
            key: 'expiring',
            title: '만료 임박',
            value: studentListKpis.expiringSoonCount,
            hint: '14일 이내',
            selected: studentAttentionFilter === 'expiring' && !studentTodayLessonOnly,
            onClick: () => {
              setStudentAttentionFilter('expiring')
              setStudentTodayLessonOnly(false)
            },
          },
          {
            key: 'registered',
            title: '현재 등록',
            value: studentListKpis.activeGroupRegistrationStudentCount,
            hint: '활성 그룹 등록',
            selected: studentRegistrationFilter === 'has' && !studentTodayLessonOnly,
            onClick: () => {
              setStudentRegistrationFilter('has')
              setStudentAttentionFilter('all')
              setStudentTodayLessonOnly(false)
            },
          },
          {
            key: 'today',
            title: '오늘 수업',
            value: studentListKpis.todayLessonStudentCount,
            hint: '개인·그룹',
            selected: studentTodayLessonOnly,
            onClick: () => {
              setStudentTodayLessonOnly(true)
            },
          },
        ]
      ).map((card) => (
        <button
          key={card.key}
          type="button"
          onClick={card.onClick}
          disabled={loading}
          style={{
            flex: '1 1 120px',
            minWidth: 108,
            maxWidth: 200,
            padding: '12px 14px',
            borderRadius: 10,
            border: card.selected ? '1px solid #5a7fd0' : '1px solid var(--border)',
            background: card.selected ? 'rgba(40, 55, 90, 0.45)' : 'var(--surface2)',
            color: 'inherit',
            textAlign: 'left',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.65 : 1,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.78, marginBottom: 4 }}>{card.title}</div>
          <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{card.value}</div>
          <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>{card.hint}</div>
        </button>
      ))}
    </div>

    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        alignItems: 'center',
        marginBottom: 14,
      }}
    >
      <input
        type="search"
        data-testid="student-search-input"
        value={studentSearchQuery}
        onChange={(e) => setStudentSearchQuery(e.target.value)}
        placeholder="이름, 전화번호, 차번호, 수강 목적 검색"
        disabled={loading}
        style={{
          flex: '1 1 220px',
          minWidth: 180,
          maxWidth: 420,
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'inherit',
          fontSize: 13,
        }}
      />
      {isAdmin ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>선생님</span>
          <select
            value={studentTeacherFilter}
            onChange={(e) => setStudentTeacherFilter(e.target.value)}
            disabled={loading}
            style={{
              padding: '6px 8px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'inherit',
              fontSize: 13,
            }}
          >
            <option value="">전체</option>
            {studentListTeacherOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>등록</span>
        <select
          value={studentRegistrationFilter}
          onChange={(e) => setStudentRegistrationFilter(e.target.value)}
          disabled={loading}
          style={{
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'inherit',
            fontSize: 13,
          }}
        >
          <option value="all">전체</option>
          <option value="has">등록 있음</option>
          <option value="none">등록 없음</option>
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>개인권</span>
        <select
          value={studentPrivatePackageFilter}
          onChange={(e) => setStudentPrivatePackageFilter(e.target.value)}
          disabled={loading}
          style={{
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'inherit',
            fontSize: 13,
          }}
        >
          <option value="all">전체</option>
          <option value="has">있음</option>
          <option value="none">없음</option>
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>그룹권</span>
        <select
          value={studentGroupPackageFilter}
          onChange={(e) => setStudentGroupPackageFilter(e.target.value)}
          disabled={loading}
          style={{
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'inherit',
            fontSize: 13,
          }}
        >
          <option value="all">전체</option>
          <option value="has">있음</option>
          <option value="none">없음</option>
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>다음 수업</span>
        <select
          value={studentNextLessonFilter}
          onChange={(e) => setStudentNextLessonFilter(e.target.value)}
          disabled={loading}
          style={{
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'inherit',
            fontSize: 13,
          }}
        >
          <option value="all">전체</option>
          <option value="has">예정 있음</option>
          <option value="none">예정 없음</option>
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>주의</span>
        <select
          value={studentAttentionFilter}
          onChange={(e) => setStudentAttentionFilter(e.target.value)}
          disabled={loading}
          style={{
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'inherit',
            fontSize: 13,
          }}
        >
          <option value="all">전체</option>
          <option value="renewal">재등록 필요</option>
          <option value="expiring">만료 임박</option>
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>정렬</span>
        <select
          value={studentSortKey}
          onChange={(e) => setStudentSortKey(e.target.value)}
          disabled={loading}
          style={{
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'inherit',
            fontSize: 13,
          }}
        >
          <option value="name">이름순</option>
          <option value="firstRegisteredDesc">첫 등록일 최신순</option>
          <option value="nextLessonAsc">다음 수업 빠른순</option>
        </select>
      </label>
    </div>

    {loading ? (
      <p>불러오는 중...</p>
    ) : privateStudents.length === 0 ? (
      <p style={{ opacity: 0.8 }}>등록된 학생이 없습니다.</p>
    ) : filteredSortedPrivateStudents.length === 0 ? (
      <p style={{ opacity: 0.8 }}>조건에 맞는 학생이 없습니다.</p>
    ) : (
      <div className="activity-table">
        <div
          className="table-head"
          style={{
            gridTemplateColumns:
              'minmax(72px, 0.95fr) minmax(72px, 0.95fr) minmax(100px, 1.05fr) minmax(96px, 0.85fr) minmax(120px, 1.15fr) minmax(120px, 1.15fr) minmax(240px, auto)',
          }}
        >
          <span>이름</span>
          <span>선생님</span>
          <span>전화번호</span>
          <span>첫 등록일</span>
          <span>개인 수강권</span>
          <span>그룹 수강권</span>
          <span>작업</span>
        </div>

        {filteredSortedPrivateStudents.map((student) => {
          const rowBusy = busyStudentId === student.id
          const studentPhoneTrim =
            student.phone != null && String(student.phone).trim()
              ? String(student.phone).trim()
              : ''
          const phoneTel = sanitizePhoneForTel(student.phone)
          const pkgSum = studentPackageTableSummaryByStudentId.get(student.id) ?? {
            privateCount: 0,
            privateRemainingTotal: 0,
            groupCount: 0,
            groupRemainingTotal: 0,
          }
          const privateLessonProgress = privateLessonProgressForDisplay(
            student,
            privateLessonProgressByStudentId.get(student.id)
          )
          const pkgListAll = studentPackagesSortedByStudentId.get(student.id) ?? []
          const privatePackageTeacherSummary = formatPrivatePackageTeacherSummary(
            pkgListAll.filter(
              (pkg) =>
                String(pkg.academyId || '').trim() === String(currentAcademyId || '').trim() &&
                String(pkg.studentId || '').trim() === String(student.id || '').trim()
            ),
            privateTicketBalanceByPackageId
          )
          const isPkgDetailExpanded = expandedStudentPackageStudentId === student.id
          const att = studentAttentionFlagsByStudentId.get(student.id) ?? {
            hasRenewalNeeded: false,
            hasExpiringSoon: false,
            expiringSoonLabel: '',
          }
          const privateAccessSummary = studentPrivateAccessSummaryByStudentId.get(student.id) || null
          const privateSlotBookingPilotEnabled =
            privateAccessSummary?.privateSlotBookingPilotEnabled === true
          const isPrivateSlotPilotBusy = busyPrivateSlotPilotStudentId === student.id

          return (
            <Fragment key={student.id}>
            <div
              className="table-row"
              data-testid="student-row"
              data-student-name={student.name || ''}
              style={{
                gridTemplateColumns:
                  'minmax(72px, 0.95fr) minmax(72px, 0.95fr) minmax(100px, 1.05fr) minmax(96px, 0.85fr) minmax(120px, 1.15fr) minmax(120px, 1.15fr) minmax(240px, auto)',
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                <span>{student.name || '-'}</span>
                {att.hasRenewalNeeded || att.hasExpiringSoon ? (
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {att.hasRenewalNeeded ? (
                      <span
                        style={{
                          fontSize: 10,
                          lineHeight: 1.3,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'rgba(180, 100, 40, 0.35)',
                          border: '1px solid rgba(220, 140, 60, 0.45)',
                          color: 'inherit',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        재등록 필요
                      </span>
                    ) : null}
                    {att.hasExpiringSoon ? (
                      <span
                        style={{
                          fontSize: 10,
                          lineHeight: 1.3,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'rgba(80, 120, 180, 0.35)',
                          border: '1px solid rgba(100, 140, 200, 0.45)',
                          color: 'inherit',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {att.expiringSoonLabel || '만료 임박'}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
              <span>{student.teacher || '-'}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ opacity: 0.62, fontSize: 11 }}>전화</span>
                <span>{studentPhoneTrim ? studentPhoneTrim : '-'}</span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ opacity: 0.62, fontSize: 11 }}>첫 등록</span>
                <span>{formatStudentFirstRegisteredForTable(student.firstRegisteredAt)}</span>
              </span>
              <span
                data-testid="student-private-package-cell"
                title="1:1 예약 가능 시간은 개인 수강권 선생님 기준으로 표시됩니다."
                style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
              >
                {privatePackageTeacherSummary.length > 0 ? (
                  privatePackageTeacherSummary.map((summary) => (
                    <span
                      key={summary.id}
                      data-testid="student-private-package-teacher-summary"
                      style={{
                        opacity: summary.muted ? 0.62 : 1,
                        lineHeight: 1.35,
                      }}
                    >
                      {summary.text}
                      {summary.statusText ? ` · ${summary.statusText}` : ''}
                      {summary.scheduleText ? (
                        <span style={{ display: 'block', fontSize: 12, opacity: 0.82 }}>
                          {summary.scheduleText}
                        </span>
                      ) : null}
                    </span>
                  ))
                ) : (
                  <span>개인 수강권 등록 필요</span>
                )}
                {privatePackageTeacherSummary.length === 0 ? (
                  <PrivateLessonProgressSummary
                    progress={privateLessonProgress}
                    scheduleOnly
                  />
                ) : null}
              </span>
              <span data-testid="student-group-package-cell">
                {formatStudentPackageCellSummary(
                  pkgSum.groupCount,
                  pkgSum.groupRemainingTotal
                )}
              </span>
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {studentPhoneTrim ? (
                  <button
                    type="button"
                    onClick={() => copyStudentPhone(student)}
                    disabled={rowBusy || busyStudentId === '__add__' || busyStudentPackageSubmit}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #3a4a66',
                      background:
                        copiedStudentPhoneId === student.id ? 'rgba(90, 127, 208, 0.35)' : '#1a2338',
                      color: 'white',
                      cursor:
                        rowBusy || busyStudentId === '__add__' || busyStudentPackageSubmit
                          ? 'not-allowed'
                          : 'pointer',
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {copiedStudentPhoneId === student.id ? '복사됨' : '복사'}
                  </button>
                ) : null}
                {phoneTel ? (
                  <a
                    href={`tel:${phoneTel}`}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #335544',
                      background: '#243528',
                      color: 'white',
                      fontSize: 12,
                      textDecoration: 'none',
                      whiteSpace: 'nowrap',
                      display: 'inline-block',
                    }}
                  >
                    전화
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    setExpandedStudentPackageStudentId((cur) =>
                      cur === student.id ? null : student.id
                    )
                  }
                  disabled={rowBusy || busyStudentId === '__add__'}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: '1px solid #4a6fff44',
                    background: '#1a2238',
                    color: 'white',
                    cursor:
                      rowBusy || busyStudentId === '__add__'
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                >
                  {isPkgDetailExpanded ? '접기' : '수강권 보기'}
                </button>
                {canEditStudent ? (
                  <button
                    type="button"
                    onClick={() => openStudentEditModal(student)}
                    disabled={
                      rowBusy ||
                      busyStudentId === '__add__' ||
                      busyStudentPackageSubmit
                    }
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #555',
                      background: '#1f2a44',
                      color: 'white',
                      cursor:
                        rowBusy || busyStudentId === '__add__' || busyStudentPackageSubmit
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    {rowBusy ? '처리 중...' : '수정'}
                  </button>
                ) : null}
                {canDeleteStudent ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteStudent(student)}
                    disabled={
                      rowBusy ||
                      busyStudentId === '__add__' ||
                      busyStudentPackageSubmit
                    }
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #553333',
                      background: '#4a2a2a',
                      color: 'white',
                      cursor:
                        rowBusy || busyStudentId === '__add__' || busyStudentPackageSubmit
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    {rowBusy ? '처리 중...' : '삭제'}
                  </button>
                ) : null}
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() =>
                      togglePrivateSlotBookingPilot(student, !privateSlotBookingPilotEnabled)
                    }
                    disabled={
                      rowBusy ||
                      busyStudentId === '__add__' ||
                      busyPrivateSlotPilotStudentId !== ''
                    }
                    data-testid="student-private-slot-pilot-toggle-button"
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: privateSlotBookingPilotEnabled
                        ? '1px solid #665032'
                        : '1px solid #335544',
                      background: privateSlotBookingPilotEnabled ? '#3d3122' : '#243528',
                      color: 'white',
                      cursor:
                        rowBusy ||
                        busyStudentId === '__add__' ||
                        busyPrivateSlotPilotStudentId !== ''
                          ? 'not-allowed'
                          : 'pointer',
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isPrivateSlotPilotBusy
                      ? '변경 중...'
                      : privateSlotBookingPilotEnabled
                        ? '1:1 예약 테스트 해제'
                        : '1:1 예약 테스트 허용'}
                  </button>
                ) : null}
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => openCancelAllowanceModal(student)}
                    disabled={
                      rowBusy ||
                      busyStudentId === '__add__' ||
                      cancelAllowanceBusy
                    }
                    data-testid="student-cancel-allowance-open-button"
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #4a5568',
                      background: '#1f2937',
                      color: 'white',
                      cursor:
                        rowBusy || busyStudentId === '__add__' || cancelAllowanceBusy
                          ? 'not-allowed'
                          : 'pointer',
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    취소 가능 횟수
                  </button>
                ) : null}
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => openStudentHistoryModal(student)}
                    disabled={rowBusy || busyStudentId === '__add__'}
                    data-testid="student-history-open-button"
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #4a6fff44',
                      background: '#1a2238',
                      color: 'white',
                      cursor:
                        rowBusy || busyStudentId === '__add__'
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    수업 내역
                  </button>
                ) : null}
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => openStudentAccountLinkModal(student)}
                    disabled={rowBusy || busyStudentId === '__add__'}
                    data-testid="student-account-link-open-button"
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #4b5875',
                      background: '#20293d',
                      color: 'white',
                      cursor:
                        rowBusy || busyStudentId === '__add__'
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    로그인 초대
                  </button>
                ) : null}
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => openStudentPackageModal(student)}
                    disabled={
                      rowBusy ||
                      busyStudentId === '__add__' ||
                      busyStudentPackageSubmit
                    }
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #335533',
                      background: '#2a3d2a',
                      color: 'white',
                      cursor:
                        rowBusy || busyStudentId === '__add__' || busyStudentPackageSubmit
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    수강권 추가
                  </button>
                ) : null}
              </span>
            </div>
            {isPkgDetailExpanded ? (
              <div
                data-testid="student-detail-panel"
                data-student-name={student.name || ''}
                style={{
                  padding: '14px 1.25rem',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--surface2)',
                }}
              >
                {(() => {
                  const regRows =
                    activeGroupRegistrationsByStudentId.get(student.id) ?? []
                  const nextPrivateLesson = nextPrivateLessonByStudentId.get(student.id)
                  const nextGroupLesson = nextGroupLessonByStudentId.get(student.id)
                  const nextPrivateDateObj = nextPrivateLesson
                    ? getLessonDate(nextPrivateLesson)
                    : null
                  const nextPrivateDateLabel =
                    nextPrivateDateObj && Number.isFinite(nextPrivateDateObj.getTime())
                      ? formatDate(nextPrivateDateObj)
                      : nextPrivateLesson
                        ? getLessonStorageDateString(nextPrivateLesson) || '-'
                        : '-'
                  const nextPrivateTimeLabel =
                    nextPrivateDateObj && Number.isFinite(nextPrivateDateObj.getTime())
                      ? formatTime(nextPrivateDateObj)
                      : nextPrivateLesson
                        ? String(nextPrivateLesson.time || '').trim() || '-'
                        : '-'
                  const nextGroupClassName = nextGroupLesson
                    ? (() => {
                        const gid = String(nextGroupLesson.groupClassId || '').trim()
                        const gc = groupClasses.find((g) => g.id === gid)
                        return gc?.name != null && String(gc.name).trim()
                          ? String(gc.name).trim()
                          : '-'
                      })()
                    : '-'
                  const nextGroupDateStr = nextGroupLesson
                    ? String(nextGroupLesson.date || '').trim()
                    : ''
                  const nextGroupDateLabel =
                    nextGroupDateStr && /^\d{4}-\d{2}-\d{2}$/.test(nextGroupDateStr)
                      ? (() => {
                          const d = parseYmdToLocalDate(nextGroupDateStr)
                          return d ? formatDate(d) : nextGroupDateStr
                        })()
                      : '-'
                  const nextGroupTimeLabel = nextGroupLesson
                    ? String(nextGroupLesson.time || '').trim() || '-'
                    : '-'
                  const nextGroupSubjectLabel = nextGroupLesson
                    ? String(nextGroupLesson.subject || '').trim() || '-'
                    : '-'

                  return (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 14,
                        marginBottom: 16,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            marginBottom: 8,
                            opacity: 0.95,
                          }}
                        >
                          현재 등록
                        </div>
                        {regRows.length === 0 ? (
                          <p style={{ margin: 0, fontSize: 13, opacity: 0.82 }}>
                            현재 등록된 반이 없습니다.
                          </p>
                        ) : (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 8,
                            }}
                          >
                            {regRows.map((row) => (
                              <div
                                key={row.key}
                                style={{
                                  fontSize: 13,
                                  lineHeight: 1.55,
                                  padding: '8px 10px',
                                  borderRadius: 8,
                                  border: '1px solid var(--border)',
                                  background: 'var(--surface)',
                                }}
                              >
                                <div>
                                  <span style={{ opacity: 0.72 }}>반 이름</span>{' '}
                                  {row.className}
                                </div>
                                <div>
                                  <span style={{ opacity: 0.72 }}>시작일</span>{' '}
                                  {row.startDisplay}
                                </div>
                                <div>
                                  <span style={{ opacity: 0.72 }}>수강권</span>{' '}
                                  {row.packageTitle}
                                </div>
                                <div>
                                  <span style={{ opacity: 0.72 }}>남은 횟수</span>{' '}
                                  {row.remainingDisplay}
                                </div>
                                {row.operationalLabel ? (
                                  <div style={{ marginTop: 6 }}>
                                    <span
                                      style={{
                                        fontSize: 11,
                                        fontWeight: 600,
                                        padding: '3px 8px',
                                        borderRadius: 6,
                                        border: '1px solid #4a4a6a',
                                        background: 'rgba(80, 90, 140, 0.25)',
                                        color: 'rgba(230, 235, 255, 0.95)',
                                      }}
                                    >
                                      {row.operationalLabel}
                                    </span>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            marginBottom: 8,
                            opacity: 0.95,
                          }}
                        >
                          다음 개인 수업
                        </div>
                        {!nextPrivateLesson ? (
                          <p style={{ margin: 0, fontSize: 13, opacity: 0.82 }}>
                            예정된 개인 수업이 없습니다.
                          </p>
                        ) : (
                          <div
                            style={{
                              fontSize: 13,
                              lineHeight: 1.55,
                              padding: '8px 10px',
                              borderRadius: 8,
                              border: '1px solid var(--border)',
                              background: 'var(--surface)',
                            }}
                          >
                            <div>
                              <span style={{ opacity: 0.72 }}>날짜</span>{' '}
                              {nextPrivateDateLabel}
                            </div>
                            <div>
                              <span style={{ opacity: 0.72 }}>시간</span>{' '}
                              {nextPrivateTimeLabel}
                            </div>
                            <div>
                              <span style={{ opacity: 0.72 }}>과목</span>{' '}
                              {String(nextPrivateLesson.subject || '').trim() || '-'}
                            </div>
                            <div>
                              <span style={{ opacity: 0.72 }}>선생님</span>{' '}
                              {getTeacherName(nextPrivateLesson)}
                            </div>
                          </div>
                        )}
                      </div>

                      <div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            marginBottom: 8,
                            opacity: 0.95,
                          }}
                        >
                          다음 그룹 수업
                        </div>
                        {!nextGroupLesson ? (
                          <p style={{ margin: 0, fontSize: 13, opacity: 0.82 }}>
                            예정된 그룹 수업이 없습니다.
                          </p>
                        ) : (
                          <div
                            style={{
                              fontSize: 13,
                              lineHeight: 1.55,
                              padding: '8px 10px',
                              borderRadius: 8,
                              border: '1px solid var(--border)',
                              background: 'var(--surface)',
                            }}
                          >
                            <div>
                              <span style={{ opacity: 0.72 }}>반 이름</span>{' '}
                              {nextGroupClassName}
                            </div>
                            <div>
                              <span style={{ opacity: 0.72 }}>날짜</span>{' '}
                              {nextGroupDateLabel}
                            </div>
                            <div>
                              <span style={{ opacity: 0.72 }}>시간</span>{' '}
                              {nextGroupTimeLabel}
                            </div>
                            <div>
                              <span style={{ opacity: 0.72 }}>과목</span>{' '}
                              {nextGroupSubjectLabel}
                            </div>
                          </div>
                        )}
                      </div>

                      {privateLessonProgress ? (
                        <div>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              marginBottom: 8,
                              opacity: 0.95,
                            }}
                          >
                            개인 수업 진행
                          </div>
                          <div
                            style={{
                              fontSize: 13,
                              lineHeight: 1.55,
                              padding: '8px 10px',
                              borderRadius: 8,
                              border: '1px solid var(--border)',
                              background: 'var(--surface)',
                            }}
                          >
                            <div>
                              <span style={{ opacity: 0.72 }}>총 등록</span>{' '}
                              {Number(privateLessonProgress.totalRegistered) || 0}회
                            </div>
                            <div>
                              <span style={{ opacity: 0.72 }}>지난 수업</span>{' '}
                              {Number(privateLessonProgress.pastLessons) || 0}회
                            </div>
                            <div>
                              <span style={{ opacity: 0.72 }}>예정 수업</span>{' '}
                              {Number(privateLessonProgress.remainingScheduled) || 0}회
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })()}
                {pkgListAll.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 14, opacity: 0.88 }}>
                    등록된 수강권이 없습니다.
                  </p>
                ) : (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 10,
                      }}
                    >
                      <div
                        style={{
                          display: 'inline-flex',
                          borderRadius: 8,
                          border: '1px solid var(--border)',
                          overflow: 'hidden',
                          fontSize: 12,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setShowAllStudentPackagesInDetail(false)}
                          style={{
                            padding: '6px 12px',
                            border: 'none',
                            background: !showAllStudentPackagesInDetail
                              ? 'rgba(90, 127, 208, 0.35)'
                              : 'transparent',
                            color: 'inherit',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          사용 중만 보기
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAllStudentPackagesInDetail(true)}
                          data-testid="student-package-show-all-button"
                          style={{
                            padding: '6px 12px',
                            border: 'none',
                            borderLeft: '1px solid var(--border)',
                            background: showAllStudentPackagesInDetail
                              ? 'rgba(90, 127, 208, 0.35)'
                              : 'transparent',
                            color: 'inherit',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          전체 보기
                        </button>
                      </div>
                    </div>
                    {(() => {
                      const pkgListActive = pkgListAll.filter((p) =>
                        isStudentPackageRowActive(p)
                      )
                      const displayedPkgList = showAllStudentPackagesInDetail
                        ? pkgListAll
                        : pkgListActive
                      if (!showAllStudentPackagesInDetail && pkgListActive.length === 0) {
                        return (
                          <p style={{ margin: 0, fontSize: 14, opacity: 0.88 }}>
                            사용 중인 수강권이 없습니다. 전체 보기를 켜면 지난 수강권을 볼 수 있습니다.
                          </p>
                        )
                      }
                      return (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                    }}
                  >
                    {displayedPkgList.map((pkg) => (
                      <div
                        key={pkg.id}
                        data-testid="student-package-card"
                        style={{
                          padding: 12,
                          borderRadius: 10,
                          border: '1px solid var(--border)',
                          background: 'var(--surface)',
                        }}
                      >
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(92px, 0.38fr) 1fr',
                            gap: '6px 14px',
                            fontSize: 13,
                            alignItems: 'start',
                          }}
                        >
                          <span style={{ opacity: 0.72 }}>유형</span>
                          <span>{formatStudentPackageDetailTypeLabel(pkg.packageType)}</span>
                          <span style={{ opacity: 0.72 }}>제목</span>
                          <span>{pkg.title != null && String(pkg.title).trim() ? String(pkg.title) : '-'}</span>
                          <span style={{ opacity: 0.72 }}>상태</span>
                          <span>{formatStudentPackageDetailStatusLabel(pkg.status)}</span>
                          <span style={{ opacity: 0.72 }}>등록일</span>
                          <span>{formatYmdDateTime(pkg.createdAt)}</span>
                          <span style={{ opacity: 0.72 }}>연결 반</span>
                          <span>
                            {pkg.groupClassName != null && String(pkg.groupClassName).trim()
                              ? String(pkg.groupClassName)
                              : '-'}
                          </span>
                          <span style={{ opacity: 0.72 }}>코스 유형</span>
                          <span>{getGroupCourseTypeLabel(pkg.groupCourseType) || '-'}</span>
                          {String(pkg.packageType || '').trim() === 'private' ? (
                            <>
                              <span style={{ opacity: 0.72 }}>사용 가능 선생님</span>
                              <span>{formatPrivatePackageTeacherScope(pkg)}</span>
                            </>
                          ) : null}
                          <span style={{ opacity: 0.72 }}>총 횟수</span>
                          <span>
                            {pkg.totalCount != null && pkg.totalCount !== ''
                              ? String(pkg.totalCount)
                              : '-'}
                          </span>
                          <span style={{ opacity: 0.72 }}>사용 횟수</span>
                          <span>
                            {pkg.usedCount != null && pkg.usedCount !== ''
                              ? String(pkg.usedCount)
                              : '-'}
                          </span>
                          <span style={{ opacity: 0.72 }}>남은 횟수</span>
                          <span>
                            {pkg.remainingCount != null && pkg.remainingCount !== ''
                              ? String(pkg.remainingCount)
                              : '-'}
                          </span>
                          <span style={{ opacity: 0.72 }}>수강권 시작일</span>
                          <span>{formatPackageStartDate(pkg)}</span>
                          <span style={{ opacity: 0.72 }}>만료일</span>
                          <span>{formatGroupStudentStartDate(pkg.expiresAt)}</span>
                          {canViewPaymentFields ? (
                            <>
                              <span style={{ opacity: 0.72 }}>결제일</span>
                              <span>{formatPackagePaymentDate(pkg)}</span>
                              <span style={{ opacity: 0.72 }}>결제 금액</span>
                              <span>{formatStudentPackageDetailAmountPaid(pkg.amountPaid)}</span>
                              <span style={{ opacity: 0.72 }}>메모</span>
                              <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                {formatStudentPackageDetailMemo(pkg.memo)}
                              </span>
                            </>
                          ) : null}
                        </div>
                        {isAdmin || canEditStudentPackageCountsForPackage(pkg) ? (
                          <div
                            style={{
                              display: 'flex',
                              gap: 8,
                              marginTop: 12,
                              flexWrap: 'wrap',
                            }}
                          >
                            {canEditStudentPackageCountsForPackage(pkg) ? (
                              <button
                                type="button"
                                onClick={() => openStudentPackageEditModal(pkg)}
                                data-testid="student-package-edit-button"
                                disabled={
                                  busyStudentPackageActionId != null || busyStudentPackageSubmit
                                }
                                style={{
                                  padding: '6px 12px',
                                  borderRadius: 8,
                                  border: '1px solid #555',
                                  background: '#1f2a44',
                                  color: 'white',
                                  cursor:
                                    busyStudentPackageActionId != null || busyStudentPackageSubmit
                                      ? 'not-allowed'
                                      : 'pointer',
                                  fontSize: 13,
                                }}
                              >
                                수정
                              </button>
                            ) : null}
                            {isAdmin ? (
                              <button
                              type="button"
                              onClick={() => openStudentPackageHistoryModal(pkg)}
                              data-testid="student-package-history-button"
                              disabled={
                                busyStudentPackageActionId != null || busyStudentPackageSubmit
                              }
                              style={{
                                padding: '6px 12px',
                                borderRadius: 8,
                                border: '1px solid #3a4a66',
                                background: '#1a2338',
                                color: 'white',
                                cursor:
                                  busyStudentPackageActionId != null || busyStudentPackageSubmit
                                    ? 'not-allowed'
                                    : 'pointer',
                                fontSize: 13,
                              }}
                            >
                              이력 보기
                            </button>
                            ) : null}
                            {isAdmin ? (
                              <button
                              type="button"
                              onClick={() => endStudentPackage(pkg)}
                              disabled={
                                String(pkg.status || '').toLowerCase() === 'ended' ||
                                busyStudentPackageActionId != null ||
                                busyStudentPackageSubmit
                              }
                              style={{
                                padding: '6px 12px',
                                borderRadius: 8,
                                border: '1px solid #664422',
                                background: '#3d2e1f',
                                color: 'white',
                                cursor:
                                  String(pkg.status || '').toLowerCase() === 'ended' ||
                                  busyStudentPackageActionId != null ||
                                  busyStudentPackageSubmit
                                    ? 'not-allowed'
                                    : 'pointer',
                                fontSize: 13,
                              }}
                            >
                              종료
                            </button>
                            ) : null}
                            {isAdmin &&
                            (String(pkg.status || 'active').toLowerCase() === 'exhausted' ||
                            String(pkg.status || 'active').toLowerCase() === 'ended' ? (
                              <button
                                type="button"
                                onClick={() => openStudentPackageReRegisterModal(pkg)}
                                disabled={
                                  busyStudentPackageActionId != null || busyStudentPackageSubmit
                                }
                                style={{
                                  padding: '6px 12px',
                                  borderRadius: 8,
                                  border: '1px solid #335544',
                                  background: '#243528',
                                  color: 'white',
                                  cursor:
                                    busyStudentPackageActionId != null || busyStudentPackageSubmit
                                      ? 'not-allowed'
                                      : 'pointer',
                                  fontSize: 13,
                                }}
                              >
                                재등록
                              </button>
                            ) : null)}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                      )
                    })()}
                  </>
                )}
              </div>
            ) : null}
            </Fragment>
          )
        })}
      </div>
    )}
    {isAdmin && studentHistoryModalStudent ? (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-history-modal-title"
        data-testid="student-history-modal"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1120,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          background: 'rgba(0, 0, 0, 0.55)',
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && !studentHistoryLoading) {
            closeStudentHistoryModal()
          }
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 980,
            maxHeight: '90vh',
            overflow: 'auto',
            border: '1px solid #2e3240',
            borderRadius: 12,
            background: '#151922',
            color: 'white',
            padding: 20,
            boxSizing: 'border-box',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div>
              <h2
                id="student-history-modal-title"
                style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}
              >
                학생 수업 내역
              </h2>
              <p style={{ margin: '6px 0 0 0', opacity: 0.75, fontSize: 13 }}>
                선택한 학생의 수강권과 수업 예약 내역만 표시됩니다.
              </p>
            </div>
            <button
              type="button"
              onClick={closeStudentHistoryModal}
              disabled={studentHistoryLoading}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #555',
                background: 'transparent',
                color: 'white',
                cursor: studentHistoryLoading ? 'not-allowed' : 'pointer',
              }}
            >
              닫기
            </button>
          </div>

          {studentHistoryError ? (
            <p style={{ color: '#f4a7a7', marginTop: 0 }}>{studentHistoryError}</p>
          ) : null}

          <div style={{ display: 'grid', gap: 18 }}>
            <section>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem' }}>학생 정보</h3>
              <div
                data-testid="student-history-profile"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: 10,
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  fontSize: 13,
                }}
              >
                <div><span style={{ opacity: 0.72 }}>이름</span><br />{cleanText(studentHistoryModalStudent.name)}</div>
                <div><span style={{ opacity: 0.72 }}>담당 선생님</span><br />{cleanText(studentHistoryModalStudent.teacher)}</div>
                <div><span style={{ opacity: 0.72 }}>연락처</span><br />{cleanText(studentHistoryModalStudent.phone)}</div>
              </div>
            </section>

            <section>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem' }}>수강권 요약</h3>
              <div
                data-testid="student-history-package-summary"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: 10,
                }}
              >
                {[
                  ['사용 중 수강권', studentHistorySummary.activeCount],
                  ['종료 수강권', studentHistorySummary.endedCount],
                  ['남은 횟수 합계', studentHistorySummary.activeRemainingTotal],
                  ['사용 횟수 합계', studentHistorySummary.usedTotal],
                  ['최근 수강권 상태', studentHistorySummary.latestStatus],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                    }}
                  >
                    <div style={{ fontSize: 12, opacity: 0.72 }}>{label}</div>
                    <div style={{ marginTop: 4, fontSize: 18, fontWeight: 700 }}>{value}</div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem' }}>수강권 목록</h3>
              {studentHistoryPackages.length === 0 ? (
                <p style={{ opacity: 0.78, margin: 0 }}>등록된 수강권이 없습니다.</p>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {studentHistoryPackages.map((pkg) => (
                    <div
                      key={pkg.id}
                      data-testid="student-history-package-row"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
                        gap: 10,
                        alignItems: 'center',
                        padding: 10,
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        fontSize: 12,
                      }}
                    >
                      <span>{cleanText(pkg.title, '수강권')}</span>
                      <span>
                        {[
                          packageKindLabel(pkg.packageType),
                          getGroupCourseTypeLabel(pkg.groupCourseType),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <span>등록일 {formatYmdDateTime(pkg.createdAt)}</span>
                      <span>결제일 {formatPackagePaymentDate(pkg)}</span>
                      <span>수강권 시작일 {formatPackageStartDate(pkg)}</span>
                      <span>만료일 {formatGroupStudentStartDate(pkg.expiresAt)}</span>
                      <span>
                        사용 가능 선생님{' '}
                        {String(pkg.packageType || '').trim() === 'private'
                          ? formatPrivatePackageTeacherScope(pkg)
                          : cleanText(pkg.teacher)}
                      </span>
                      <span>총 {cleanText(pkg.totalCount ?? pkg.paidLessons)}</span>
                      <span>사용 {cleanText(pkg.usedCount ?? pkg.attendanceCount)}</span>
                      <span>남은 {cleanText(pkg.remainingCount)}</span>
                      <span>{formatStudentPackageDetailStatusLabel(pkg.status)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem' }}>수업/예약 내역</h3>
              {studentHistoryLoading ? (
                <p style={{ opacity: 0.78, margin: 0 }}>불러오는 중...</p>
              ) : studentHistoryRows.length === 0 ? (
                <p style={{ opacity: 0.78, margin: 0 }}>아직 표시할 수업 내역이 없습니다.</p>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {studentHistoryRows.map((row) => (
                    <div
                      key={row.key}
                      data-testid="student-history-lesson-row"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '0.9fr 0.45fr 0.75fr 0.75fr 0.8fr 0.9fr 1.25fr',
                        gap: 10,
                        alignItems: 'center',
                        padding: 10,
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        fontSize: 12,
                      }}
                    >
                      <span>{cleanText(row.date)}</span>
                      <span>{cleanText(row.time)}</span>
                      <span>{cleanText(row.type)}</span>
                      <span>{cleanText(row.teacher)}</span>
                      <span>{cleanText(row.status)}</span>
                      <span>{cleanText(row.packageTitle)}</span>
                      <span>{cleanText(row.title)}{row.delta ? ` · ${row.delta}` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    ) : null}
    {isAdmin && studentAccountLinkModalStudent ? (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-account-link-modal-title"
        data-testid="student-account-link-modal"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          background: 'rgba(0, 0, 0, 0.55)',
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && !studentAccountLinkBusy) {
            closeStudentAccountLinkModal()
          }
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 620,
            border: '1px solid #2e3240',
            borderRadius: 12,
            background: '#151922',
            color: 'white',
            padding: 20,
            boxSizing: 'border-box',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2
            id="student-account-link-modal-title"
            style={{ margin: '0 0 12px 0', fontSize: '1.1rem', fontWeight: 600 }}
          >
            학생 로그인 초대
          </h2>
          <p style={{ margin: '0 0 16px 0', opacity: 0.75, fontSize: 13 }}>
            {studentAccountLinkModalStudent.name || '-'} 학생에게 예약 페이지 로그인 안내를 보냅니다.
          </p>

          <div style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
              <span style={{ opacity: 0.8 }}>학생 이메일</span>
              <input
                type="email"
                value={studentAccountEmail}
                onChange={(e) => setStudentAccountEmail(e.target.value)}
                disabled={studentAccountLinkBusy}
                data-testid="student-account-link-email-input"
                style={{
                  padding: '9px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'inherit',
                }}
              />
            </label>

            <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
              <span style={{ opacity: 0.8 }}>표시 이름</span>
              <input
                type="text"
                value={studentAccountDisplayName}
                onChange={(e) => setStudentAccountDisplayName(e.target.value)}
                disabled={studentAccountLinkBusy}
                data-testid="student-account-link-display-name-input"
                style={{
                  padding: '9px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'inherit',
                }}
              />
            </label>

            {studentAccountLinkError ? (
              <p
                data-testid="student-account-link-error"
                style={{ margin: 0, color: '#f4a7a7', fontSize: 13 }}
              >
                {studentAccountLinkError}
              </p>
            ) : null}

            {studentAccountLinkResult ? (
              <div
                data-testid="student-account-link-success"
                style={{
                  border: '1px solid #355d3f',
                  borderRadius: 8,
                  background: '#15291a',
                  padding: 12,
                  fontSize: 13,
                  lineHeight: 1.7,
                }}
              >
                <strong>초대 링크 준비 완료</strong>
                <div style={{ opacity: 0.85 }}>
                  학생이 안내문 링크에서 비밀번호를 설정한 뒤 예약 페이지에 로그인할 수 있습니다.
                </div>
              </div>
            ) : null}

            {studentAccountInvitationMessage ? (
            <div data-testid="student-account-link-invitation-section">
              <div style={{ opacity: 0.85, fontSize: 13, marginBottom: 6, fontWeight: 600 }}>
                학생에게 보낼 안내문
              </div>
              <pre
                data-testid="student-account-link-invitation-message"
                style={{
                  margin: 0,
                  padding: 12,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  borderRadius: 8,
                  border: '1px solid #30394f',
                  background: '#101521',
                  color: '#dbe7ff',
                  fontSize: 12,
                  minHeight: 48,
                }}
              >
                {studentAccountInvitationMessage}
              </pre>
            </div>
            ) : null}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              marginTop: 18,
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={closeStudentAccountLinkModal}
              disabled={studentAccountLinkBusy}
              style={{
                padding: '9px 14px',
                borderRadius: 8,
                border: '1px solid #555',
                background: 'transparent',
                color: 'white',
                cursor: studentAccountLinkBusy ? 'not-allowed' : 'pointer',
              }}
            >
              닫기
            </button>
              <button
                type="button"
              onClick={copyStudentAccountInvitationMessage}
              disabled={!studentAccountInvitationMessage || studentAccountLinkBusy}
              data-testid="student-account-link-copy-button"
              style={{
                padding: '9px 14px',
                borderRadius: 8,
                border: '1px solid #4b5875',
                background: '#20293d',
                color: 'white',
                cursor:
                  studentAccountInvitationMessage && !studentAccountLinkBusy
                    ? 'pointer'
                    : 'not-allowed',
              }}
            >
              {studentAccountInvitationCopied ? '복사 완료' : '안내문 복사'}
            </button>
            <button
              type="button"
              onClick={submitStudentAccountLink}
              disabled={!studentAccountEmail.trim() || studentAccountLinkBusy}
              data-testid="student-account-link-submit-button"
              style={{
                padding: '9px 14px',
                borderRadius: 8,
                border: '1px solid #335544',
                background: '#243528',
                color: 'white',
                cursor:
                  studentAccountEmail.trim() && !studentAccountLinkBusy
                    ? 'pointer'
                    : 'not-allowed',
              }}
            >
              {studentAccountLinkBusy ? '초대 링크 만드는 중...' : '초대 링크 만들기'}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    {isAdmin && cancelAllowanceModalStudent ? (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-cancel-allowance-modal-title"
        data-testid="student-cancel-allowance-modal"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1125,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          background: 'rgba(0, 0, 0, 0.55)',
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeCancelAllowanceModal()
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 420,
            border: '1px solid #2e3240',
            borderRadius: 12,
            background: '#151922',
            color: 'white',
            padding: 20,
            boxSizing: 'border-box',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <h2
            id="student-cancel-allowance-modal-title"
            style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}
          >
            취소 가능 횟수
          </h2>
          <p style={{ margin: '10px 0 0 0', opacity: 0.82, fontSize: 13 }}>
            학생: {cleanText(cancelAllowanceModalStudent?.name)}
          </p>
          {(() => {
            const allowance = resolveStudentCancelAllowance(cancelAllowanceModalStudent)
            return (
              <div
                data-testid="student-cancel-allowance-summary"
                style={{ marginTop: 12, fontSize: 13, lineHeight: 1.7, opacity: 0.9 }}
              >
                <div>현재 취소 사용: {allowance.used}회</div>
                <div>현재 취소 가능 한도: {allowance.limit}회</div>
                <div>남은 취소 가능: {allowance.remaining}회</div>
                <div style={{ marginTop: 8, opacity: 0.85 }}>
                  {formatAdminStudentCancelAllowanceSummary(allowance)}
                </div>
              </div>
            )
          })()}
          <label style={{ display: 'grid', gap: 6, marginTop: 16, fontSize: 13 }}>
            <span>새 취소 가능 한도</span>
            <input
              type="number"
              min={resolveStudentCancelAllowance(cancelAllowanceModalStudent).used}
              max={STUDENT_PRIVATE_CANCEL_LIMIT_MAX}
              step={1}
              value={cancelAllowanceDraftLimit}
              onChange={(event) => {
                setCancelAllowanceDraftLimit(event.target.value)
                setCancelAllowanceError('')
                setCancelAllowanceSuccess('')
              }}
              data-testid="student-cancel-allowance-limit-input"
              disabled={cancelAllowanceBusy}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#101521',
                color: 'white',
              }}
            />
          </label>
          <p style={{ margin: '8px 0 0 0', opacity: 0.72, fontSize: 12 }}>
            기본 한도는 {STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT}회이며, 최대{' '}
            {STUDENT_PRIVATE_CANCEL_LIMIT_MAX}회까지 설정할 수 있습니다.
          </p>
          {cancelAllowanceError ? (
            <p
              data-testid="student-cancel-allowance-error"
              style={{ margin: '12px 0 0 0', color: '#f4a7a7', fontSize: 13 }}
            >
              {cancelAllowanceError}
            </p>
          ) : null}
          {cancelAllowanceSuccess ? (
            <p
              data-testid="student-cancel-allowance-success"
              style={{ margin: '12px 0 0 0', color: '#9ee6b2', fontSize: 13 }}
            >
              {cancelAllowanceSuccess}
            </p>
          ) : null}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              marginTop: 18,
            }}
          >
            <button
              type="button"
              onClick={closeCancelAllowanceModal}
              disabled={cancelAllowanceBusy}
              data-testid="student-cancel-allowance-close-button"
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #555',
                background: 'transparent',
                color: 'white',
                cursor: cancelAllowanceBusy ? 'not-allowed' : 'pointer',
              }}
            >
              닫기
            </button>
            <button
              type="button"
              onClick={submitCancelAllowanceUpdate}
              disabled={cancelAllowanceBusy}
              data-testid="student-cancel-allowance-save-button"
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #335544',
                background: '#243528',
                color: 'white',
                cursor: cancelAllowanceBusy ? 'not-allowed' : 'pointer',
              }}
            >
              {cancelAllowanceBusy ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    ) : null}
  </section>
  );
}
