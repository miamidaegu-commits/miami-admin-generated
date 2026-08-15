import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '../../../i18n/LocalizationProvider.jsx'
import { installDialogFocusContainment } from '../../../preferences/layout.js'
import {
  formatLessonDateLabel,
  formatLessonSessionNumber,
  formatLessonTimeLabel,
  getLessonDate,
  getLessonStorageDateString,
  getStudentName,
  getTeacherName,
  getTodayStorageDateString,
  getStorageDateStringFromDate,
  isSameStorageDate,
  resolveTeacherDisplayName,
} from '../dashboardViewUtils.js'
import {
  computePrivateTeacherPackageUsage,
  findPrivatePackageForTeacherContext,
  findStudentPrivatePackageContexts,
} from '../privatePackageHelpers.js'
import {
  formatOpenPrivateSlotCompactPreviewText,
  getCalendarDayCountLabelDescriptor,
} from '../hooks/useCalendarSectionViewModel.js'
import { formatPrivateReservationHistoryLabels } from '../privateReservationHistoryFormatter.js'
import { computePrivatePackageCancelAllowance } from '../../booking/studentPrivateCancelAllowance.js'
import { resolveGroupLessonSubject } from '../groupClassRoomUtils.js'
import { rowMatchesTeacherScope } from '../teacherLessonRosterHelpers.js'
import FixedPrivateLessonActionModal from '../components/FixedPrivateLessonActionModal.jsx'

function calendarTimestampToMillis(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') {
    const millis = value.toMillis()
    return Number.isFinite(millis) ? millis : null
  }
  if (typeof value.toDate === 'function') {
    const millis = value.toDate().getTime()
    return Number.isFinite(millis) ? millis : null
  }
  if (value instanceof Date) {
    const millis = value.getTime()
    return Number.isFinite(millis) ? millis : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const millis = Date.parse(value)
    return Number.isFinite(millis) ? millis : null
  }
  return null
}

function seoulDateTimeToMillis(dateValue, timeValue) {
  const date = String(dateValue || '').trim()
  const time = String(timeValue || '').trim()
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const timeMatch = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!dateMatch || !timeMatch) return null
  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  return Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0)
}

function getPrivateReservationEndMillis(row) {
  const startMillis =
    calendarTimestampToMillis(row?.startAt) ||
    seoulDateTimeToMillis(row?.date, row?.time)
  if (startMillis == null) return null
  const duration = Number(row?.durationMinutes)
  const durationMinutes = Number.isFinite(duration) && duration > 0 ? duration : 50
  return startMillis + durationMinutes * 60 * 1000
}

const PRIVATE_RESERVATION_HISTORY_STATUSES = new Set([
  'active',
  'reserved',
  'confirmed',
  'booked',
  'cancelled',
  'canceled',
])

const PRIVATE_LESSON_STATUS_ACTION_ACTIVE_STATUSES = new Set([
  'active',
  'reserved',
  'confirmed',
  'booked',
])

const PRIVATE_LESSON_STATUS_ACTION_FINAL_STATUSES = new Set([
  'completed',
  'no_show',
  'cancelled',
  'canceled',
  'deleted',
  'archived',
  'seat_released',
])

const FIXED_PRIVATE_OUTCOME_ACTIVE_STATUSES = new Set([
  '',
  'active',
  'reserved',
  'assigned',
  'scheduled',
  'booked',
  'confirmed',
  'open',
])

function isFixedPrivateSourceRecord(lesson) {
  return (
    String(lesson?.sourceType || '').trim().toLowerCase() ===
      'fixed-private-slot-assignment' ||
    String(lesson?.reservationType || '').trim().toLowerCase() === 'fixed'
  )
}

function isLegacyDirectPrivateReservationRow(lesson) {
  return (
    String(lesson?._calendarRowKind || '').trim() === 'privateReservation' &&
    !isFixedPrivateSourceRecord(lesson)
  )
}

function isFixedPrivateOutcomeCalendarRow(lesson) {
  if (!isFixedPrivateSourceRecord(lesson)) return false
  const packageType = String(lesson?.packageType || '').trim()
  if (packageType && packageType !== 'private') return false
  const rowKind = String(lesson?._calendarRowKind || '').trim()
  const lessonId = String(
    rowKind === 'privateReservation'
      ? lesson?.lessonId || lesson?.fixedLessonId || lesson?.sourceLessonId || ''
      : lesson?.id || lesson?.lessonId || lesson?.fixedLessonId || ''
  ).trim()
  const reservationId = String(
    rowKind === 'privateReservation'
      ? lesson?.id ||
          lesson?.reservationId ||
          lesson?.privateLessonReservationId ||
          lesson?.privateReservationId ||
          ''
      : lesson?.reservationId ||
          lesson?.privateLessonReservationId ||
          lesson?.privateReservationId ||
          ''
  ).trim()
  const slotId = String(
    lesson?.slotId || lesson?.privateLessonSlotId || lesson?.privateSlotId || ''
  ).trim()
  const packageId = String(
    lesson?.packageId ||
      lesson?.deductionPackageId ||
      lesson?.linkedPackageId ||
      lesson?.fixedPrivatePackageId ||
      ''
  ).trim()
  return Boolean(lessonId && reservationId && slotId && packageId)
}

function normalizePrivateReservationLinkText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

function isStudentFixedPrivateSeatReleasedLesson(lesson) {
  const status = String(lesson?.status || '').trim().toLowerCase()
  const cancellationType = String(lesson?.cancellationType || '').trim().toLowerCase()
  const cancelledByRole = String(lesson?.cancelledByRole || lesson?.canceledByRole || '')
    .trim()
    .toLowerCase()
  const cancellationReason = String(lesson?.cancellationReason || lesson?.cancelledReason || '')
    .trim()
    .toLowerCase()
  return (
    (status === 'cancelled' || status === 'canceled') &&
    cancellationType === 'seat_released' &&
    (cancelledByRole === 'student' || cancellationReason.includes('student_cancelled')) &&
    (lesson?.releasedForPrivateBooking === true || lesson?.isSeatReleased === true)
  )
}

function addCalendarPrivateReservationLinkKeys(keys, source, slot = null) {
  if (!keys || !source) return
  ;[source.id, source.lessonId, source.fixedLessonId].forEach((lessonIdValue) => {
    const lessonId = String(lessonIdValue || '').trim()
    if (!lessonId) return
    keys.add(`lessonId:${lessonId}`)
    keys.add(`fixedLessonId:${lessonId}`)
  })

  const reservationId = String(source.reservationId || '').trim()
  if (reservationId) keys.add(`reservationId:${reservationId}`)

  const slotId = String(source.slotId || source.privateLessonSlotId || slot?.id || '').trim()
  if (slotId) keys.add(`slotId:${slotId}`)

  const date = String(getLessonStorageDateString(source) || source.date || slot?.date || '').trim()
  const time = String(source.time || slot?.time || '').trim()
  const studentKey = normalizePrivateReservationLinkText(
    source.studentId || source.studentID || source.studentName || source.student || getStudentName(source)
  )
  const teacherKey = normalizePrivateReservationLinkText(
    source.teacherName ||
      source.teacher ||
      source.teacherKey ||
      source.teacherUid ||
      slot?.teacherName ||
      slot?.teacher ||
      slot?.teacherKey ||
      slot?.teacherUid ||
      getTeacherName(source)
  )
  if (date && time && studentKey && teacherKey) {
    keys.add(`datetime:${date}|${time}|${studentKey}|${teacherKey}`)
  }
}

function getCalendarPrivateReservationLinkKeys(reservation, slot = null) {
  const keys = new Set()
  addCalendarPrivateReservationLinkKeys(keys, reservation, slot)
  return Array.from(keys)
}

function mergeCalendarReservationCancellationFromLesson(reservation, linkedLesson) {
  if (!isStudentFixedPrivateSeatReleasedLesson(linkedLesson)) return reservation
  return {
    ...(reservation || {}),
    status: 'cancelled',
    cancellationType: linkedLesson.cancellationType || 'seat_released',
    cancellationReason:
      linkedLesson.cancellationReason ||
      linkedLesson.cancelledReason ||
      reservation?.cancellationReason ||
      '',
    cancelledReason:
      linkedLesson.cancelledReason ||
      linkedLesson.cancellationReason ||
      reservation?.cancelledReason ||
      '',
    cancelledAt: linkedLesson.cancelledAt || linkedLesson.canceledAt || reservation?.cancelledAt,
    canceledAt: linkedLesson.canceledAt || linkedLesson.cancelledAt || reservation?.canceledAt,
    cancelledByRole:
      linkedLesson.cancelledByRole || linkedLesson.canceledByRole || reservation?.cancelledByRole,
    canceledByRole:
      linkedLesson.canceledByRole || linkedLesson.cancelledByRole || reservation?.canceledByRole,
    cancelledBy: linkedLesson.cancelledBy || linkedLesson.canceledBy || reservation?.cancelledBy,
    canceledBy: linkedLesson.canceledBy || linkedLesson.cancelledBy || reservation?.canceledBy,
    noDeduction: true,
    isSeatReleased: true,
    releasedForPrivateBooking: true,
  }
}

function getPrivateReservationHistoryPackage({
  reservation,
  linkedLesson,
  studentPackages,
  academyId,
}) {
  const directPackageId = String(
    reservation?.packageId ||
      reservation?.deductionPackageId ||
      reservation?.studentPackageId ||
      linkedLesson?.packageId ||
      ''
  ).trim()
  const directPackage = getPackageById(studentPackages, directPackageId)
  if (directPackage && String(directPackage.packageType || '').trim() === 'private') {
    return directPackage
  }

  const studentId = String(
    reservation?.studentId || reservation?.studentID || linkedLesson?.studentId || linkedLesson?.studentID || ''
  ).trim()
  if (!studentId) return null
  return findPrivatePackageForTeacherContext({
    studentPackages,
    academyId,
    studentId,
    teacher:
      reservation?.teacherName ||
      reservation?.teacher ||
      linkedLesson?.teacherName ||
      linkedLesson?.teacher,
  })
}

function parseStorageDateToLocalDate(value) {
  const text = String(value || '').trim()
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function offsetStorageDate(value, offsetDays) {
  const base = parseStorageDateToLocalDate(value) || new Date()
  base.setDate(base.getDate() + offsetDays)
  return base
}

function formatSelectedDateControlLabel(value, fallback) {
  const text = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.replaceAll('-', '.')
  return fallback || '-'
}

function formatRemainingCountFromPackage(pkg) {
  if (!pkg || pkg.remainingCount == null || pkg.remainingCount === '') return '—'
  const count = Number(pkg.remainingCount)
  return Number.isFinite(count) ? count : '—'
}

function isPrivateLessonCancelledWithoutDeduction(lesson) {
  const status = String(lesson?.status || '').trim().toLowerCase()
  const cancellationType = String(lesson?.cancellationType || '').trim().toLowerCase()
  const cancelledReason = String(lesson?.cancelledReason || '').trim().toLowerCase()
  if (lesson?.noDeduction === true) return true
  if (cancellationType === 'no_deduction' || cancellationType === 'class_closure') return true
  if (['holiday', 'teacher_unavailable', 'academy_closed'].includes(cancelledReason)) return true
  return status === 'cancelled' || status === 'canceled'
}

function getFixedPrivateLessonCancellationLabel(lesson) {
  const status = String(lesson?.status || '').trim().toLowerCase()
  if (status !== 'cancelled' && status !== 'canceled') return ''
  const cancellationType = String(lesson?.cancellationType || '').trim().toLowerCase()
  if (cancellationType === 'seat_released' || lesson?.isSeatReleased === true) return '자리 공개됨'
  if (cancellationType === 'lesson_cancelled') return '수업 취소'
  return ''
}

function getCalendarLessonBadgeLabel({ isGroupRow, isPrivateReservationRow, fixedPrivateCancellationLabel }) {
  if (isGroupRow) return '그룹'
  if (isPrivateReservationRow) return '학생 예약 1:1'
  if (fixedPrivateCancellationLabel === '자리 공개됨') return '고정수업 자리'
  return '개인'
}

function isFixedPrivateLesson(lesson) {
  return (
    String(lesson?.packageType || '').trim() === 'private' &&
    String(lesson?.sourceType || '').trim() === 'fixed-private-slot-assignment'
  )
}

function canOpenCalendarFixedPrivateRescheduleScopePreview({
  lesson,
  isAdmin,
  isGroupRow,
  isPrivateReservationRow,
}) {
  if (!isAdmin || !lesson || isGroupRow || isPrivateReservationRow) return false
  const rowKind = String(lesson?._calendarRowKind || '').trim()
  const packageType = String(lesson?.packageType || '').trim()
  const sourceType = String(lesson?.sourceType || '').trim()
  const status = String(lesson?.status || '').trim().toLowerCase()
  const statusKey = status.replace(/-/g, '_')
  const cancellationType = String(lesson?.cancellationType || '').trim().toLowerCase()
  const outcomeStatus = String(
    lesson?.outcomeStatus || lesson?.attendanceStatus || lesson?.lessonStatus || ''
  )
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')

  const isPrivateLessonRow = rowKind === 'private' || (!isGroupRow && !isPrivateReservationRow)
  const hasPrivatePackage = packageType === 'private' || isPrivateLessonRow
  const hasFixedPrivateSource =
    sourceType === 'fixed-private-slot-assignment' ||
    Boolean(String(lesson?.fixedPrivateAssignmentBatchId || '').trim())
  const hasStudent =
    Boolean(String(lesson?.studentId || lesson?.studentName || '').trim()) ||
    Boolean(String(getStudentName(lesson) || '').trim())
  const hasTeacher = Boolean(
    String(
      lesson?.teacherId ||
        lesson?.teacherUid ||
        lesson?.teacherKey ||
        lesson?.teacherName ||
        lesson?.teacher ||
        getTeacherName(lesson) ||
        ''
    ).trim()
  )
  const hasSchedule =
    Boolean(String(getLessonStorageDateString(lesson) || '').trim()) &&
    Boolean(String(lesson?.time || '').trim())
  const blockedStatus = new Set([
    'cancelled',
    'canceled',
    'completed',
    'no_show',
    'no-show',
    'deleted',
    'archived',
    'seat_released',
  ])
  const isBlocked =
    blockedStatus.has(status) ||
    blockedStatus.has(statusKey) ||
    blockedStatus.has(outcomeStatus) ||
    lesson?.completed === true ||
    lesson?.deleted === true ||
    lesson?.archived === true ||
    lesson?.isSeatReleased === true ||
    lesson?.releasedForPrivateBooking === true ||
    cancellationType === 'seat_released'
  const isActiveReservationState =
    status === '' || ['active', 'reserved', 'assigned', 'scheduled'].includes(status)

  return (
    isPrivateLessonRow &&
    hasPrivatePackage &&
    hasFixedPrivateSource &&
    hasStudent &&
    hasTeacher &&
    hasSchedule &&
    isActiveReservationState &&
    !isBlocked
  )
}

function isFuturePrivateLesson(lesson) {
  const date = getLessonStorageDateString(lesson)
  const time = String(lesson?.time || '').trim()
  const millis = seoulDateTimeToMillis(date, time)
  if (Number.isFinite(millis)) return millis > Date.now()
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= getTodayStorageDateString()
}

function getPackageById(studentPackages, packageId) {
  const pid = String(packageId || '').trim()
  if (!pid) return null
  return (Array.isArray(studentPackages) ? studentPackages : []).find((p) => p.id === pid) || null
}

function getPrivateLessonPackageContext({
  lesson,
  studentPackages,
  academyId,
  matchedStudentId,
}) {
  const directPackageId = String(lesson?.packageId || '').trim()
  const linkedPackage = getPackageById(studentPackages, lesson?.packageId)
  const linkedPrivatePackage =
    linkedPackage && linkedPackage.packageType === 'private' ? linkedPackage : null
  const studentPrivatePackages = matchedStudentId
    ? findStudentPrivatePackageContexts({
        studentPackages,
        academyId,
        studentId: matchedStudentId,
      })
    : []
  const fallbackPackage =
    !linkedPrivatePackage && matchedStudentId
      ? findPrivatePackageForTeacherContext({
          studentPackages,
          academyId,
          studentId: matchedStudentId,
          teacher: getTeacherName(lesson),
        })
      : null
  const linkedPackageStub =
    !linkedPrivatePackage && directPackageId
      ? {
          id: directPackageId,
          academyId,
          studentId: matchedStudentId,
          teacher: getTeacherName(lesson),
          teacherName: getTeacherName(lesson),
          packageType: 'private',
          __packageStub: true,
        }
      : null
  const contextPackage = linkedPrivatePackage || fallbackPackage || linkedPackageStub
  return {
    linkedPrivatePackage: linkedPrivatePackage || linkedPackageStub,
    contextPackage,
    hasDirectPackageLink: Boolean(directPackageId && contextPackage),
    hasTeacherScopedPackage: Boolean(contextPackage),
    hasAnyPrivatePackage: Boolean(contextPackage || studentPrivatePackages.length > 0),
    hasPackageMatchIncomplete: Boolean(!contextPackage && studentPrivatePackages.length > 0),
  }
}

function getPrivatePackageStateLabel({
  contextPackage,
  packageUsage,
  hasAnyPrivatePackage,
  hasPackageMatchIncomplete,
  hasDirectPackageLink,
}) {
  if (!contextPackage) {
    return hasAnyPrivatePackage || hasPackageMatchIncomplete
      ? '수강권 연결 필요'
      : '수강권 등록 필요'
  }

  const remainingCount = Number(formatRemainingCountFromPackage(contextPackage))
  if (Number.isFinite(remainingCount) && remainingCount <= 0) return '소진'

  const makeupAvailableCount = Number(packageUsage?.makeupAvailableCount)
  if (Number.isFinite(makeupAvailableCount)) {
    return `보충 가능 ${Math.max(0, makeupAvailableCount)}회`
  }

  return hasDirectPackageLink ? '수강권 연결됨' : '수강권 자동 연결'
}

function CalendarPrivateLessonDetailModal({
  detail,
  busyLessonId,
  onClose,
  onToggleDeduction,
  onOpenPackageEdit,
  teacherPortal = false,
}) {
  const { t } = useTranslation()
  const dialogRef = useRef(null)
  const closeRef = useRef(null)
  const text = (key, fallback, values) => (teacherPortal ? t(key, values) : fallback)
  useEffect(() => {
    if (!detail) return undefined
    return installDialogFocusContainment({
      container: dialogRef.current,
      initialFocus: closeRef.current,
      onClose,
    })
  }, [detail, onClose])
  if (!detail) return null
  const canRunDeductionAction =
    detail.canManagePrivateLessonDeductions &&
    detail.hasLinkedPrivatePackage &&
    detail.canToggleDeduction
  const canEditPackageCount = detail.canEditPackageCount && detail.contextPackage
  return (
    <div
      role="presentation"
      data-testid="calendar-private-lesson-detail-modal"
      className="teacher-dialog-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1003,
        padding: 16,
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-private-lesson-detail-title"
        tabIndex={-1}
        className="teacher-dialog-panel"
        style={{
          width: '100%',
          maxWidth: 460,
          background: '#151922',
          border: '1px solid #2e3240',
          borderRadius: 12,
          padding: 20,
          color: 'white',
          boxSizing: 'border-box',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="calendar-private-lesson-detail-title"
          style={{ margin: '0 0 12px 0', fontSize: '1.1rem' }}
        >
          {text('teacher.calendar.detail.title', '수업 차감 상세')}
        </h2>
        <div style={{ display: 'grid', gap: 8, fontSize: 13, lineHeight: 1.5 }}>
          <div>{text('teacher.common.student', '학생')}: {detail.studentName || '-'}</div>
          <div>
            {text('teacher.calendar.detail.dateTime', '일시')}: {formatLessonDateLabel(detail.lesson)} {formatLessonTimeLabel(detail.lesson)}
          </div>
          <div>{text('teacher.common.subject', '과목')}: {detail.subject || '-'}</div>
          <div>{text('teacher.common.status', '상태')}: {detail.statusLabel}</div>
          <div>{text('teacher.calendar.detail.remaining', '남은 횟수')}: {detail.remainingLessons}</div>
          {detail.packageUsage ? (
            <>
              <div>{text('teacher.calendar.detail.total', '총 횟수')}: {detail.packageUsage.totalCount}</div>
              <div>{text('teacher.calendar.detail.used', '사용 횟수')}: {detail.packageUsage.usedDeductedCount}</div>
              <div>{text('teacher.calendar.detail.futureFixed', '예정 고정수업')}: {detail.packageUsage.futureFixedAllocatedCount}</div>
              <div>{text('teacher.calendar.detail.reservedMakeup', '예약된 보충수업')}: {detail.packageUsage.activeFutureReservationAllocatedCount}</div>
              <div>{text('teacher.calendar.detail.makeup', '보충 가능')}: {detail.packageUsage.makeupAvailableCount}</div>
            </>
          ) : null}
          {detail.actionReason ? (
            <div
              data-testid="calendar-private-lesson-action-reason"
              style={{
                marginTop: 4,
                padding: 10,
                borderRadius: 8,
                border: '1px solid #554633',
                background: '#251f17',
                color: '#ffe0aa',
              }}
            >
              {detail.actionReason}
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
          {canEditPackageCount && detail.contextPackage?.__packageStub !== true ? (
            <button
              type="button"
              data-testid="calendar-package-count-edit-button"
              onClick={() => onOpenPackageEdit(detail.contextPackage)}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #335544',
                background: '#243528',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              수강권 횟수 수정
            </button>
          ) : null}
          {canRunDeductionAction ? (
            <button
              type="button"
              data-testid="calendar-deduction-toggle-button"
              onClick={() => onToggleDeduction(detail.lesson)}
              disabled={busyLessonId === detail.lesson.id}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #555',
                background: detail.lesson.isDeductCancelled ? '#4a2a2a' : '#1f2a44',
                color: 'white',
                cursor: busyLessonId === detail.lesson.id ? 'not-allowed' : 'pointer',
              }}
            >
              {busyLessonId === detail.lesson.id
                ? '처리 중...'
                : detail.lesson.isDeductCancelled
                  ? '차감복구'
                  : '차감취소'}
            </button>
          ) : null}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #555',
              background: 'transparent',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            {text('teacher.common.close', '닫기')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * view="month": 월 달력 그리드
 * view="lessons": 전체/선택일 수업 목록 + 상단 액션(캘린더 탭에서만 일부 노출)
 */
export default function CalendarSection(props) {
  const { language, t } = useTranslation()
  const teacherPortal = props.teacherPortal === true
  const text = (key, fallback, values) => (teacherPortal ? t(key, values) : fallback)
  const localizedDate = (value, options) => {
    if (!teacherPortal || !value) return ''
    const date = value instanceof Date ? value : new Date(`${value}T00:00:00`)
    if (Number.isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ko-KR', options).format(date)
  }
  const knownLabel = (value) => {
    if (!teacherPortal) return value
    const keyByLabel = {
      '예정': 'teacher.calendar.status.scheduled',
      '완료': 'teacher.calendar.status.completed',
      '노쇼': 'teacher.calendar.status.noShow',
      '예약 완료': 'teacher.calendar.status.reserved',
      '자동 차감 완료': 'teacher.calendar.status.autoDeducted',
      '정상 차감': 'teacher.calendar.status.deducted',
      '차감취소': 'teacher.calendar.status.deductionCancelled',
      '휴강 · 차감 없음': 'teacher.calendar.status.cancelledNoDeduction',
      '원 수업 휴강 · 차감 없음': 'teacher.calendar.status.cancelledNoDeduction',
      '수강권 등록 필요': 'teacher.calendar.status.packageRequired',
      '수강권 연결 필요': 'teacher.calendar.status.packageLinkRequired',
      '수강권 연결됨': 'teacher.calendar.status.packageLinked',
      '수강권 자동 연결': 'teacher.calendar.status.packageAutoLinked',
      '소진': 'teacher.calendar.status.depleted',
      '권한이 없습니다': 'teacher.calendar.permissionDenied',
      '아직 차감된 수업이 아닙니다': 'teacher.calendar.notDeductedYet',
      '학생 직접 예약: 가능': 'teacher.calendar.studentBookingEnabled',
      '학생 직접 예약: 비활성': 'teacher.calendar.studentBookingDisabled',
      '좌석: 예약 가능': 'teacher.calendar.seatOpen',
      '좌석: 마감': 'teacher.calendar.seatClosed',
      '자리 공개됨': 'teacher.private.status.seatReleased',
      '수업 취소': 'teacher.private.status.lessonCancelled',
    }
    const key = keyByLabel[String(value || '').trim()]
    if (key) return t(key)
    const raw = String(value || '')
    const makeupMatch = raw.match(/^보충 가능 (\d+)회$/)
    if (makeupMatch) {
      return t('teacher.calendar.status.makeupAvailable', { count: makeupMatch[1] })
    }
    const sessionMatch = raw.match(/^(\d+)회차$/)
    if (sessionMatch) {
      return t('teacher.calendar.sessionNumber', { count: sessionMatch[1] })
    }
    const minutesMatch = raw.match(/^(\d+)분$/)
    return minutesMatch ? t('teacher.common.minutes', { count: minutesMatch[1] }) : value
  }
  if (props.view === 'month') {
    const {
      setCalendarMonth,
      calendarMonthLabel,
      calendarDays,
      lessonsCountByDate,
      lessonsPreviewByDate,
      calendarMonth,
      selectedDate,
      setSelectedDate,
      setShowOnlySelectedDate,
      isAdmin,
      calendarTeacherFilterOptions = [],
      calendarTeacherFilterValue = '',
      setCalendarTeacherFilterValue,
    } = props
    const showTeacherFilter = isAdmin && calendarTeacherFilterOptions.length > 0

    return (
      <section
        className={`activity-section${teacherPortal ? ' teacher-calendar-month' : ''}`}
        data-testid={teacherPortal ? 'teacher-calendar-month' : undefined}
        style={{ marginBottom: 24 }}
      >
        <div
          className={teacherPortal ? 'teacher-calendar-toolbar' : undefined}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            aria-label={text('teacher.calendar.previousMonth', '이전 달')}
            onClick={() =>
              setCalendarMonth(
                (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
              )
            }
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #444',
              background: '#1f1f1f',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            ←
          </button>

          <div style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
            <h2 className="section-title" style={{ margin: 0 }}>
              {teacherPortal
                ? localizedDate(calendarMonth, { year: 'numeric', month: 'long' })
                : calendarMonthLabel}
            </h2>
            {showTeacherFilter ? (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  opacity: 0.9,
                }}
              >
                <span>표시할 선생님</span>
                <select
                  data-testid="calendar-teacher-filter-select"
                  aria-label="표시할 선생님"
                  value={calendarTeacherFilterValue}
                  onChange={(event) => setCalendarTeacherFilterValue?.(event.target.value)}
                  style={{
                    colorScheme: 'dark',
                    border: '1px solid #444',
                    borderRadius: 8,
                    background: '#111722',
                    color: 'white',
                    padding: '7px 9px',
                  }}
                >
                  <option value="">전체 선생님</option>
                  {calendarTeacherFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <button
            type="button"
            aria-label={text('teacher.calendar.nextMonth', '다음 달')}
            onClick={() =>
              setCalendarMonth(
                (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
              )
            }
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #444',
              background: '#1f1f1f',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            →
          </button>
        </div>

        <div
          className={teacherPortal ? 'teacher-calendar-weekdays' : undefined}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 8,
            marginBottom: 8,
            fontSize: 12,
            opacity: 0.8,
          }}
        >
          {[
            ['sun', '일'],
            ['mon', '월'],
            ['tue', '화'],
            ['wed', '수'],
            ['thu', '목'],
            ['fri', '금'],
            ['sat', '토'],
          ].map(([key, day]) => (
            <div key={key} style={{ textAlign: 'center' }}>
              {text(`teacher.calendar.weekday.${key}`, day)}
            </div>
          ))}
        </div>

        <div
          className={teacherPortal ? 'teacher-calendar-days' : undefined}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 8,
          }}
        >
          {calendarDays.map((day) => {
            const dateKey = getStorageDateStringFromDate(day)
            const count = lessonsCountByDate.get(dateKey) || 0
            const previews = lessonsPreviewByDate?.get(dateKey) || []
            const countLabelDescriptor = getCalendarDayCountLabelDescriptor({ count, previews })
            const countLabel = text(
              countLabelDescriptor.key,
              countLabelDescriptor.fallback,
              { count }
            )
            const isCurrentMonth = day.getMonth() === calendarMonth.getMonth()
            const isSelected = isSameStorageDate(day, selectedDate)

            return (
              <button
                key={dateKey}
                data-testid="calendar-day-button"
                data-date={dateKey}
                aria-label={`${dateKey}, ${countLabel}`}
                onClick={() => {
                  setSelectedDate(day)
                  setShowOnlySelectedDate(true)
                }}
                style={{
                  minHeight: 96,
                  borderRadius: 10,
                  border: isSelected ? '1px solid #6b8cff' : '1px solid #2e3240',
                  background: isSelected ? '#1f2a44' : '#151922',
                  color: isCurrentMonth ? 'white' : '#666',
                  padding: 8,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600 }}>{day.getDate()}</div>
                {count > 0 ? (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      opacity: 0.9,
                    }}
                  >
                    {countLabel}
                  </div>
                ) : null}
                {previews.slice(0, 2).map((preview) => (
                  <div
                    key={preview.id}
                    data-testid="calendar-day-preview-row"
                    data-row-kind={preview.kind || undefined}
                    data-teacher-name={preview.teacherName || undefined}
                    style={{
                      marginTop: 4,
                      fontSize: 11,
                      lineHeight: 1.35,
                      opacity: 0.82,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {preview.kind === 'openPrivateSlot'
                      ? formatOpenPrivateSlotCompactPreviewText(
                          text(
                            'teacher.calendar.openPrivateSlot.title',
                            '개인수업 예약 가능'
                          ),
                          preview.label
                        )
                      : preview.label}
                  </div>
                ))}
                {previews.length > 2 ? (
                  <div style={{ marginTop: 4, fontSize: 11, opacity: 0.62 }}>
                    +{previews.length - 2}
                  </div>
                ) : null}
              </button>
            )
          })}
        </div>
      </section>
    )
  }

  const {
    activeSection,
    showOnlySelectedDate,
    selectedDateString,
    selectedDateDisplayString,
    setSelectedDate,
    setShowOnlySelectedDate,
    showPrivateLessonAddInCalendar,
    loading,
    enableLegacyLessonMigrationButton,
    enableGroupLegacyBackfillTool,
    isAdmin,
    handleMigrateLessons,
    migrating,
    handleGroupLegacyBackfill,
    busyGroupLegacyBackfill,
    displayedLessons,
    getMatchedStudent,
    getMatchedStudentId,
    studentPackages,
    allPrivateLessons = [],
    privateLessonReservations = [],
    privateLessonSlots = [],
    selectedCalendarTeacher = null,
    teacherSelectOptions = [],
    handleDeductionToggle,
    canManageAttendance,
    canManagePrivateLessonDeductions,
    busyLessonId,
    busyPrivateLessonCrudId,
    busyFixedPrivateLessonCancelId,
    busyPrivateLessonAdd,
    busyPrivateReservationOutcomeId,
    openPrivateLessonEditModal,
    handleDeletePrivateLesson,
    onCancelFixedPrivateLesson,
    onMarkPrivateReservationOutcome,
    onReversePrivateReservationOutcome,
    canEditLesson,
    canDeleteLesson,
    onOpenCalendarGroupLessonAttendance,
    onOpenGroupLessonNoDeductionCancel,
    openStudentPackageEditModal,
    canEditStudentPackageCountsForPackage = () => false,
    onOpenFixedRescheduleScopePreview,
    onOpenPrivateLessonStatusActionPreview,
    canOpenFixedPrivateLessonOutcome = () => false,
    onOpenPrivateSlotManagement,
  } = props
  const [privateLessonDetail, setPrivateLessonDetail] = useState(null)
  const [fixedPrivateLessonAction, setFixedPrivateLessonAction] = useState(null)
  const displayedLessonRows =
    activeSection === 'groups'
      ? displayedLessons.filter((lesson) => lesson._calendarRowKind === 'group')
      : displayedLessons
  const emptyLessonMessage =
    activeSection === 'groups' && showOnlySelectedDate
      ? text('teacher.calendar.empty', '선택한 날짜의 단체반 수업이 없습니다.')
      : text('teacher.calendar.empty', '등록된 수업이 없습니다.')
  const privateSlotById = useMemo(() => {
    return new Map(
      (Array.isArray(privateLessonSlots) ? privateLessonSlots : []).map((slot) => [
        String(slot.id || '').trim(),
        slot,
      ])
    )
  }, [privateLessonSlots])
  const cancelledFixedPrivateLessonByReservationKey = useMemo(() => {
    const byKey = new Map()
    ;(Array.isArray(allPrivateLessons) ? allPrivateLessons : []).forEach((lesson) => {
      if (!isStudentFixedPrivateSeatReleasedLesson(lesson)) return
      const keys = new Set()
      addCalendarPrivateReservationLinkKeys(keys, lesson)
      keys.forEach((key) => {
        if (!byKey.has(key)) byKey.set(key, lesson)
      })
    })
    return byKey
  }, [allPrivateLessons])
  const privateReservationHistoryRows = useMemo(() => {
    if (activeSection !== 'calendar' || !showOnlySelectedDate || !selectedDateString) return []
    return (Array.isArray(privateLessonReservations) ? privateLessonReservations : [])
      .map((reservation) => {
        const slot = privateSlotById.get(String(reservation.slotId || '').trim()) || null
        const status = String(reservation.status || '').trim().toLowerCase()
        const date = String(reservation.date || slot?.date || '').trim()
        if (date !== selectedDateString || !PRIVATE_RESERVATION_HISTORY_STATUSES.has(status)) {
          return null
        }
        if (
          selectedCalendarTeacher &&
          !rowMatchesTeacherScope(reservation, selectedCalendarTeacher) &&
          !rowMatchesTeacherScope(slot, selectedCalendarTeacher)
        ) {
          return null
        }
        const duration = Number(reservation.durationMinutes || slot?.durationMinutes || 0)
        // Apply a linked student seat release before formatting the reservation-history labels.
        // Link matching covers lessonId/fixedLessonId plus reservationId/slotId/date-time fallbacks.
        const linkedCancelledLesson =
          getCalendarPrivateReservationLinkKeys(reservation, slot)
            .map((key) => cancelledFixedPrivateLessonByReservationKey.get(key) || null)
            .find(Boolean) || null
        const effectiveReservation = mergeCalendarReservationCancellationFromLesson(
          reservation,
          linkedCancelledLesson
        )
        const historyPackage = getPrivateReservationHistoryPackage({
          reservation: effectiveReservation,
          linkedLesson: linkedCancelledLesson,
          studentPackages,
          academyId: effectiveReservation.academyId || linkedCancelledLesson?.academyId,
        })
        const cancelUsage =
          historyPackage && String(historyPackage.packageType || '').trim() === 'private'
            ? computePrivatePackageCancelAllowance(historyPackage)
            : null
        const historyLabels = formatPrivateReservationHistoryLabels({
          row: effectiveReservation,
          slot,
          cancelUsage,
          text,
        })
        return {
          id: String(
            effectiveReservation.id ||
              effectiveReservation.reservationId ||
              effectiveReservation.slotId ||
              ''
          ),
          date,
          time: String(effectiveReservation.time || slot?.time || '').trim(),
          studentName:
            String(effectiveReservation.studentName || effectiveReservation.student || '').trim() ||
            String(effectiveReservation.studentId || '').trim() ||
            '-',
          teacherName: resolveTeacherDisplayName({
            teacherName: effectiveReservation.teacherName,
            teacherDisplayName: effectiveReservation.teacherDisplayName,
            displayName: effectiveReservation.displayName,
            teacherKey: effectiveReservation.teacherKey,
            teacher: effectiveReservation.teacher || slot?.teacher,
          }),
          subject:
            String(effectiveReservation.subject || '').trim() ||
            String(slot?.subject || '').trim() ||
            text('teacher.today.type.privateLesson', '1:1 수업'),
          durationLabel:
            Number.isFinite(duration) && duration > 0
              ? text('teacher.common.minutes', `${duration}분`, { count: duration })
              : '-',
          ...historyLabels,
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aKey = `${a.time || ''} ${a.studentName || ''} ${a.id || ''}`
        const bKey = `${b.time || ''} ${b.studentName || ''} ${b.id || ''}`
        return aKey.localeCompare(bKey, 'ko')
      })
  }, [
    activeSection,
    allPrivateLessons,
    cancelledFixedPrivateLessonByReservationKey,
    privateLessonReservations,
    privateSlotById,
    selectedDateString,
    selectedCalendarTeacher,
    showOnlySelectedDate,
    studentPackages,
    text,
  ])
  const showGroupSelectedDateControl = activeSection === 'groups'
  const selectedDateLocalizedLabel =
    localizedDate(selectedDateString, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short',
    }) || selectedDateDisplayString
  const selectedDateControlLabel = teacherPortal
    ? selectedDateLocalizedLabel
    : formatSelectedDateControlLabel(selectedDateString, selectedDateDisplayString)
  const changeSelectedDateBy = (offsetDays) => {
    setSelectedDate?.(offsetStorageDate(selectedDateString, offsetDays))
    setShowOnlySelectedDate(true)
  }
  const changeSelectedDateTo = (value) => {
    const nextDate = parseStorageDateToLocalDate(value)
    if (!nextDate) return
    setSelectedDate?.(nextDate)
    setShowOnlySelectedDate(true)
  }

  return (
    <section
      className={`activity-section${teacherPortal ? ' teacher-calendar-agenda' : ''}`}
      data-testid="calendar-lessons-section"
      data-shared-data-source={teacherPortal ? 'displayedLessons' : undefined}
      data-shared-handler-source={teacherPortal ? 'calendarSectionProps.lessons' : undefined}
    >
      <div
        className={teacherPortal ? 'teacher-selected-date-header' : undefined}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>
            {showOnlySelectedDate
              ? text(
                  'teacher.calendar.selectedLessons',
                  `${selectedDateLocalizedLabel} 수업`,
                  { date: selectedDateLocalizedLabel }
                )
              : text('teacher.calendar.allLessons', '전체 수업')}
          </h2>
          <p style={{ margin: '6px 0 0 0', opacity: 0.75, fontSize: 13 }}>
            {showOnlySelectedDate
              ? text('teacher.calendar.showingSelected', '선택한 날짜의 수업만 표시 중')
              : text('teacher.calendar.showingAll', '전체 수업 표시 중')}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {showGroupSelectedDateControl ? (
            <div
              data-testid="group-selected-date-control"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                border: '1px solid #333b4f',
                borderRadius: 10,
                padding: 6,
                background: '#171c27',
              }}
            >
              <button
                type="button"
                aria-label={text('teacher.common.previousDate', '이전 날짜')}
                onClick={() => changeSelectedDateBy(-1)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid #444',
                  background: '#1f1f1f',
                  color: 'white',
                  cursor: 'pointer',
                }}
              >
                {text('teacher.common.previousDate', '이전 날짜')}
              </button>
              <label
                data-testid="group-selected-date-label"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  whiteSpace: 'nowrap',
                }}
              >
                <span>
                  {text(
                    'teacher.common.selectedDate',
                    `선택 날짜: ${selectedDateControlLabel}`,
                    { date: selectedDateControlLabel }
                  )}
                </span>
                <input
                  type="date"
                  aria-label={text('teacher.common.selectedDate', '선택 날짜', {
                    date: selectedDateControlLabel,
                  })}
                  value={selectedDateString || ''}
                  onChange={(event) => changeSelectedDateTo(event.target.value)}
                  style={{
                    colorScheme: 'dark',
                    border: '1px solid #444',
                    borderRadius: 8,
                    background: '#111722',
                    color: 'white',
                    padding: '7px 9px',
                  }}
                />
              </label>
              <button
                type="button"
                aria-label={text('teacher.common.nextDate', '다음 날짜')}
                onClick={() => changeSelectedDateBy(1)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid #444',
                  background: '#1f1f1f',
                  color: 'white',
                  cursor: 'pointer',
                }}
              >
                {text('teacher.common.nextDate', '다음 날짜')}
              </button>
            </div>
          ) : null}

          <button
            onClick={() => setShowOnlySelectedDate((prev) => !prev)}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              border: '1px solid #444',
              background: '#1f1f1f',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            {showOnlySelectedDate
              ? text('teacher.calendar.showAll', '전체 보기')
              : text('teacher.calendar.showSelected', '선택 날짜만 보기')}
          </button>

          {activeSection === 'calendar' && showPrivateLessonAddInCalendar ? (
            <div
              data-testid="calendar-private-lesson-add-guidance"
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid #444',
                background: '#1f2a44',
                color: 'white',
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              고정 1:1 신규 배정은 1:1 예약 시간 관리 &gt; 주간 슬롯에서 진행하세요.
            </div>
          ) : null}

          {enableLegacyLessonMigrationButton && isAdmin ? (
            <button
              type="button"
              onClick={handleMigrateLessons}
              disabled={migrating}
              title="예전 수업 데이터 일괄 보정(관리자 전용). 상단 코드의 ENABLE_LEGACY_LESSON_MIGRATION_BUTTON 참고."
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
                cursor: migrating ? 'not-allowed' : 'pointer',
              }}
            >
              {migrating ? '변환 중...' : '예전 수업 데이터 일괄 보정'}
            </button>
          ) : null}

          {enableGroupLegacyBackfillTool && isAdmin ? (
            <button
              type="button"
              onClick={handleGroupLegacyBackfill}
              disabled={busyGroupLegacyBackfill || migrating}
              title="그룹 레거시 필드 보정(관리자 전용). Dashboard.jsx의 ENABLE_GROUP_LEGACY_BACKFILL_TOOL 참고."
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
                cursor:
                  busyGroupLegacyBackfill || migrating ? 'not-allowed' : 'pointer',
              }}
            >
              {busyGroupLegacyBackfill ? '보정 중...' : '그룹 레거시 데이터 보정'}
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <p>{text('teacher.common.loading', '불러오는 중...')}</p>
      ) : displayedLessonRows.length === 0 ? (
        <p>{emptyLessonMessage}</p>
      ) : (
        <div
          className={`activity-table${teacherPortal ? ' teacher-responsive-table teacher-calendar-agenda-list' : ''}`}
          data-testid={teacherPortal ? 'teacher-calendar-agenda-list' : undefined}
        >
          <div
            className="table-head"
            style={{
              gridTemplateColumns:
                'minmax(96px, 1fr) minmax(72px, 0.85fr) minmax(120px, 1.25fr) minmax(64px, 0.7fr) minmax(80px, 1fr) minmax(72px, 1fr) minmax(72px, 0.85fr) minmax(96px, 1fr) minmax(140px, auto)',
            }}
          >
            <span>{text('teacher.common.date', '날짜')}</span>
            <span>{text('teacher.common.time', '시간')}</span>
            <span>{text('teacher.calendar.header.studentOrClass', '학생 / 반')}</span>
            <span>{text('teacher.common.session', '회차')}</span>
            <span>{text('teacher.common.teacher', '선생님')}</span>
            <span>{text('teacher.common.subject', '과목')}</span>
            <span>{text('teacher.calendar.header.remaining', '남은 횟수')}</span>
            <span>{text('teacher.common.status', '상태')}</span>
            <span>{text('teacher.common.actions', '작업')}</span>
          </div>

          {displayedLessonRows.map((lesson) => {
            const isGroupRow = lesson._calendarRowKind === 'group'
            const isPrivateReservationRow = lesson._calendarRowKind === 'privateReservation'
            const isOpenPrivateSlotRow = lesson._calendarRowKind === 'openPrivateSlot'
            if (isOpenPrivateSlotRow) {
              const canNavigateToPrivateSlots =
                typeof onOpenPrivateSlotManagement === 'function'
              const openSlotTitle = text(
                'teacher.calendar.openPrivateSlot.title',
                '개인수업 예약 가능'
              )
              const availableLabel = text('student.status.available', '예약 가능')
              const openSlotTeacher = resolveTeacherDisplayName(
                lesson,
                teacherSelectOptions,
                '-'
              )
              const openSlotBadgeStyle = {
                display: 'inline-block',
                fontSize: 10,
                fontWeight: 600,
                lineHeight: 1.3,
                padding: '2px 6px',
                borderRadius: 4,
                marginRight: 6,
                verticalAlign: 'middle',
                border: '1px solid rgba(60, 140, 90, 0.55)',
                background: 'rgba(60, 120, 90, 0.35)',
                color: 'inherit',
                whiteSpace: 'nowrap',
              }
              const openPrivateSlotNavigate = () => {
                if (canNavigateToPrivateSlots) onOpenPrivateSlotManagement(lesson)
              }
              return (
                <div
                  key={lesson.id}
                  className="table-row"
                  data-testid="calendar-lesson-row"
                  data-row-kind="openPrivateSlot"
                  data-lesson-kind="openPrivateSlot"
                  data-lesson-id={lesson.id}
                  data-slot-id={lesson.slotId}
                  data-date={lesson.date}
                  data-time={lesson.time}
                  data-read-only="true"
                  role={canNavigateToPrivateSlots ? 'link' : undefined}
                  tabIndex={canNavigateToPrivateSlots ? 0 : undefined}
                  aria-label={
                    canNavigateToPrivateSlots
                      ? `${openSlotTitle}, ${lesson.timeRangeLabel}, ${openSlotTeacher}`
                      : undefined
                  }
                  onClick={canNavigateToPrivateSlots ? openPrivateSlotNavigate : undefined}
                  onKeyDown={
                    canNavigateToPrivateSlots
                      ? (event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          openPrivateSlotNavigate()
                        }
                      : undefined
                  }
                  style={{
                    gridTemplateColumns:
                      'minmax(96px, 1fr) minmax(72px, 0.85fr) minmax(120px, 1.25fr) minmax(64px, 0.7fr) minmax(80px, 1fr) minmax(72px, 1fr) minmax(72px, 0.85fr) minmax(96px, 1fr) minmax(140px, auto)',
                    cursor: canNavigateToPrivateSlots ? 'pointer' : 'default',
                    background: canNavigateToPrivateSlots
                      ? 'rgba(60, 120, 90, 0.08)'
                      : undefined,
                  }}
                >
                  <span data-label={text('teacher.common.date', '날짜')}>
                    {formatLessonDateLabel(lesson)}
                  </span>
                  <span data-label={text('teacher.common.time', '시간')}>
                    {lesson.timeRangeLabel}
                  </span>
                  <span
                    data-label={text('teacher.calendar.header.studentOrClass', '학생 / 반')}
                    style={{ lineHeight: 1.45 }}
                  >
                    <span style={openSlotBadgeStyle}>
                      {text('teacher.calendar.badge.private', '1:1')}
                    </span>
                    {openSlotTitle}
                  </span>
                  <span data-label={text('teacher.common.session', '회차')}>
                    {knownLabel(`${lesson.durationMinutes}분`)}
                  </span>
                  <span data-label={text('teacher.common.teacher', '선생님')}>
                    {openSlotTeacher}
                  </span>
                  <span data-label={text('teacher.common.subject', '과목')}>-</span>
                  <span data-label={text('teacher.calendar.header.remaining', '남은 횟수')}>
                    —
                  </span>
                  <span data-label={text('teacher.common.status', '상태')}>
                    <span
                      data-testid="calendar-open-private-slot-available-badge"
                      style={{
                        width: 'fit-content',
                        padding: '2px 7px',
                        borderRadius: 999,
                        border: '1px solid #4c7a5c',
                        background: 'rgba(52, 110, 70, 0.28)',
                        color: '#bde8c7',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {availableLabel}
                    </span>
                  </span>
                  <span
                    data-label={text('teacher.common.actions', '작업')}
                    className={teacherPortal ? 'teacher-card-actions' : undefined}
                    style={{ fontSize: 12, opacity: 0.65 }}
                  >
                    {text('teacher.common.readOnly', '읽기 전용')}
                  </span>
                </div>
              )
            }
            const isFixedPrivateSourceRow = isFixedPrivateSourceRecord(lesson)
            const canUseGenericPrivateLessonCrud =
              !isGroupRow && !isPrivateReservationRow && !isFixedPrivateSourceRow
            const isFixedPrivateOutcomeRow = isFixedPrivateOutcomeCalendarRow(lesson)
            const canUseLegacyPrivateReservationActions =
              isLegacyDirectPrivateReservationRow(lesson)
            const lessonDate = getLessonDate(lesson)
            const matchedStudent = getMatchedStudent(lesson)
            const matchedStudentId = getMatchedStudentId(lesson)
            const {
              contextPackage,
              hasDirectPackageLink,
              hasTeacherScopedPackage,
              hasAnyPrivatePackage,
              hasPackageMatchIncomplete,
            } = getPrivateLessonPackageContext({
              lesson,
              studentPackages,
              academyId: lesson.academyId,
              matchedStudentId,
            })
            const hasLinkedPrivatePackage = Boolean(contextPackage)
            const packageUsage =
              contextPackage && matchedStudentId
                ? computePrivateTeacherPackageUsage({
                    privatePackage: contextPackage,
                    privateLessons: allPrivateLessons,
                    privateReservations: privateLessonReservations,
                    academyId: lesson.academyId,
                    studentId: matchedStudentId,
                    teacher: getTeacherName(lesson),
                  })
                : null
            const privatePackageStateLabel = getPrivatePackageStateLabel({
              contextPackage,
              packageUsage,
              hasAnyPrivatePackage,
              hasPackageMatchIncomplete,
              hasDirectPackageLink,
            })
            const remainingLessons = isGroupRow || isPrivateReservationRow
              ? '—'
              : contextPackage
                ? privatePackageStateLabel
                : matchedStudent
                  ? privatePackageStateLabel
                  : '-'
            const todayString = getTodayStorageDateString()
            const lessonDateStr = getLessonStorageDateString(lesson)
            const isNoDeductionPrivateLesson =
              !isGroupRow &&
              !isPrivateReservationRow &&
              isPrivateLessonCancelledWithoutDeduction(lesson)
            const fixedPrivateCancellationLabel =
              !isGroupRow && !isPrivateReservationRow
                ? getFixedPrivateLessonCancellationLabel(lesson)
                : ''
            const isFutureFixedPrivateLessonRow =
              !isGroupRow &&
              !isPrivateReservationRow &&
              isFixedPrivateLesson(lesson) &&
              isFuturePrivateLesson(lesson)
            const canCancelFixedPrivateLesson =
              activeSection === 'calendar' &&
              isAdmin &&
              isFutureFixedPrivateLessonRow &&
              !fixedPrivateCancellationLabel
            const canOpenFixedPrivateRescheduleScopePreview =
              activeSection === 'calendar' &&
              canOpenCalendarFixedPrivateRescheduleScopePreview({
                lesson,
                isAdmin,
                isGroupRow,
                isPrivateReservationRow,
              })
            const isDeductedPrivateLesson =
              !isGroupRow &&
              !isPrivateReservationRow &&
              !isNoDeductionPrivateLesson &&
              hasLinkedPrivatePackage &&
              lesson.isDeductCancelled !== true &&
              Boolean(lessonDateStr && lessonDateStr <= todayString)
            const isPendingLinkedPrivateLesson =
              !isGroupRow &&
              !isPrivateReservationRow &&
              !isNoDeductionPrivateLesson &&
              hasLinkedPrivatePackage &&
              lesson.isDeductCancelled !== true &&
              Boolean(lessonDateStr && lessonDateStr > todayString)
            const canDeductionAction =
              !isGroupRow &&
              !isPrivateReservationRow &&
              !isFixedPrivateSourceRow &&
              canManagePrivateLessonDeductions &&
              (isDeductedPrivateLesson || lesson.isDeductCancelled === true) &&
              hasLinkedPrivatePackage
            const privateReservationStatus = String(lesson.status || '').trim()
            const privateReservationEndMillis = isPrivateReservationRow
              ? getPrivateReservationEndMillis(lesson)
              : null
            const privateReservationHasEnded =
              privateReservationEndMillis != null && Date.now() >= privateReservationEndMillis
            const statusLabel = knownLabel(isGroupRow
              ? lesson.calendarStatusLabel || '예정'
              : isPrivateReservationRow
                ? lesson.deductionSource === 'auto'
                  ? '자동 차감 완료'
                  : lesson.deductionApplied === true
                    ? '정상 차감'
                    : privateReservationStatus === 'completed'
                      ? '완료'
                      : privateReservationStatus === 'no_show'
                        ? '노쇼'
                        : '예약 완료'
                : isNoDeductionPrivateLesson
                  ? fixedPrivateCancellationLabel || '원 수업 휴강 · 차감 없음'
                  : lesson.isDeductCancelled
                  ? '차감취소'
                  : isDeductedPrivateLesson
                    ? '정상 차감'
                    : isPendingLinkedPrivateLesson
                      ? privatePackageStateLabel
                      : hasTeacherScopedPackage
                        ? privatePackageStateLabel
                      : hasPackageMatchIncomplete
                      ? '수강권 연결 필요'
                      : lessonDateStr && lessonDateStr <= todayString
                      ? '수강권 등록 필요'
                      : '예정')
            const actionReason = isGroupRow || isPrivateReservationRow
              ? ''
              : !canManagePrivateLessonDeductions
                ? '권한이 없습니다'
                : isNoDeductionPrivateLesson
                  ? fixedPrivateCancellationLabel
                    ? '원 수업 휴강 · 차감 없음'
                    : '휴강 · 차감 없음'
                  : !hasAnyPrivatePackage
                    ? '수강권 등록 필요'
                    : !hasTeacherScopedPackage
                    ? '수강권 연결 필요'
                    : lesson.isDeductCancelled === true
                      ? ''
                      : isDeductedPrivateLesson
                        ? ''
                      : packageUsage && Number(packageUsage.makeupAvailableCount || 0) <= 0
                        ? '보충 가능 0회'
                        : '아직 차감된 수업이 아닙니다'
            const canEditPackageCount =
              !isGroupRow &&
              !isPrivateReservationRow &&
              Boolean(contextPackage && contextPackage.__packageStub !== true) &&
              canEditStudentPackageCountsForPackage(contextPackage)
            const hasPrivateCountAdjustmentState =
              isDeductedPrivateLesson ||
              lesson.isDeductCancelled === true ||
              lesson.completed === true ||
              lesson.deductionApplied === true ||
              ['completed', 'no_show'].includes(privateReservationStatus)
            const showPackageCountEdit =
              canEditPackageCount &&
              !(isFutureFixedPrivateLessonRow && !hasPrivateCountAdjustmentState)
            const rowPrivateCrudBusy = busyPrivateLessonCrudId === lesson.id
            const reservationCompleteBusy =
              busyPrivateReservationOutcomeId === `${lesson.id}:completed`
            const reservationNoShowBusy =
              busyPrivateReservationOutcomeId === `${lesson.id}:no_show`
            const reservationReverseBusy =
              busyPrivateReservationOutcomeId === `${lesson.id}:reverse`
            const reservationOutcomeBusy =
              reservationCompleteBusy || reservationNoShowBusy || reservationReverseBusy
            const privateReservationActionStatus = privateReservationStatus.toLowerCase()
            const privateReservationId = String(
              lesson.reservationId || lesson.privateReservationId || lesson.id || ''
            ).trim()
            const canOpenPrivateLessonStatusActionPreview =
              activeSection === 'calendar' &&
              isAdmin &&
              canUseLegacyPrivateReservationActions &&
              Boolean(privateReservationId) &&
              PRIVATE_LESSON_STATUS_ACTION_ACTIVE_STATUSES.has(privateReservationActionStatus) &&
              !PRIVATE_LESSON_STATUS_ACTION_FINAL_STATUSES.has(privateReservationActionStatus) &&
              lesson.deleted !== true &&
              lesson.archived !== true &&
              lesson.releasedForPrivateBooking !== true
            const fixedPrivateOutcomeStatus = String(lesson.status || '')
              .trim()
              .toLowerCase()
            const canOpenFixedPrivateLessonOutcomePreview =
              activeSection === 'calendar' &&
              isFixedPrivateSourceRow &&
              canOpenFixedPrivateLessonOutcome(lesson) &&
              FIXED_PRIVATE_OUTCOME_ACTIVE_STATUSES.has(fixedPrivateOutcomeStatus) &&
              !PRIVATE_LESSON_STATUS_ACTION_FINAL_STATUSES.has(fixedPrivateOutcomeStatus) &&
              lesson.deleted !== true &&
              lesson.archived !== true &&
              lesson.isSeatReleased !== true &&
              lesson.releasedForPrivateBooking !== true
            const rowLessonActionBusy =
              busyLessonId === lesson.id ||
              rowPrivateCrudBusy ||
              busyPrivateLessonAdd ||
              busyFixedPrivateLessonCancelId === lesson.id
            const reservationDuration = Number(lesson.durationMinutes || 0)
            const sessionLabel = isPrivateReservationRow
              ? `${Number.isFinite(reservationDuration) && reservationDuration > 0 ? reservationDuration : 50}분`
              : formatLessonSessionNumber(lesson)
            const badgeStyle = {
              display: 'inline-block',
              fontSize: 10,
              fontWeight: 600,
              lineHeight: 1.3,
              padding: '2px 6px',
              borderRadius: 4,
              marginRight: 6,
              verticalAlign: 'middle',
              border: '1px solid rgba(120, 140, 200, 0.45)',
              background: isGroupRow
                ? 'rgba(80, 100, 160, 0.35)'
                : isPrivateReservationRow
                  ? 'rgba(110, 100, 55, 0.36)'
                  : 'rgba(60, 120, 90, 0.35)',
              color: 'inherit',
              whiteSpace: 'nowrap',
            }
            const nameLabel = isGroupRow
              ? lesson.groupClassDisplayName || '-'
              : getStudentName(lesson)
            const meaningHelperText = isPrivateReservationRow
              ? isFixedPrivateSourceRow
                ? text(
                    'teacher.calendar.fixedReservationHelp',
                    '고정 1:1 회차의 연결 예약입니다. 기존 직접예약 처리 경로는 사용할 수 없습니다.'
                  )
                : text(
                    'teacher.calendar.directReservationHelp',
                    '학생이 예약 화면에서 직접 예약한 1:1 수업입니다.'
                  )
              : fixedPrivateCancellationLabel === '자리 공개됨'
                ? text(
                    'teacher.calendar.releasedSeatHelp',
                    '다른 학생이 예약할 수 있도록 공개된 원래 고정수업 자리입니다.'
                  )
                : ''
            const rowGroupName = isGroupRow
              ? String(lesson.groupClassDisplayName || '').trim()
              : undefined
            const rowStudentName = !isGroupRow
              ? String(getStudentName(lesson) || '').trim()
              : undefined
            const canOpenGroupAttendance =
              isGroupRow && (isAdmin || canManageAttendance)
            const canOpenPrivateLessonDetail =
              activeSection === 'calendar' && !isGroupRow && !isPrivateReservationRow
            const privateLessonDetailPayload = canOpenPrivateLessonDetail
              ? {
                  lesson,
                  lessonDate,
                  studentName: getStudentName(lesson),
                  subject: isGroupRow
                    ? resolveGroupLessonSubject({
                        subject: lesson.subject,
                        groupClassName: lesson.groupClassDisplayName || lesson.groupClassName,
                        groupCourseType: lesson.groupCourseType,
                      })
                    : lesson.subject || '-',
                  statusLabel,
                  remainingLessons,
                  actionReason: knownLabel(actionReason),
                  canManagePrivateLessonDeductions,
                  canToggleDeduction:
                    !isFixedPrivateSourceRow &&
                    (isDeductedPrivateLesson || lesson.isDeductCancelled === true),
                  hasLinkedPrivatePackage,
                  contextPackage,
                  packageUsage,
                  canEditPackageCount: showPackageCountEdit,
                }
              : null
            const rowKind = isGroupRow
              ? 'group'
              : isPrivateReservationRow
                ? 'privateReservation'
                : 'private'
            const groupBookableLabel = isGroupRow
              ? lesson.isBookable === true
                ? text('teacher.calendar.studentBookingEnabled', '학생 직접 예약: 가능')
                : text('teacher.calendar.studentBookingDisabled', '학생 직접 예약: 비활성')
              : ''
            const groupSeatLabel = isGroupRow
              ? (() => {
                  const capacity = Number(lesson.capacity ?? 0)
                  const bookedCount = Number(lesson.bookedCount ?? 0)
                  if (!Number.isFinite(capacity) || capacity <= 0) {
                    return text('teacher.calendar.seatClosed', '좌석: 마감')
                  }
                  if (Number.isFinite(bookedCount) && bookedCount >= capacity) {
                    return text('teacher.calendar.seatClosed', '좌석: 마감')
                  }
                  return text('teacher.calendar.seatOpen', '좌석: 예약 가능')
                })()
              : ''
            return (
              <div
                key={lesson.id}
                className="table-row"
                data-testid="calendar-lesson-row"
                data-row-kind={rowKind}
                data-lesson-kind={rowKind}
                data-lesson-id={lesson.id}
                data-reservation-id={isPrivateReservationRow ? lesson.id : undefined}
                data-group-name={rowGroupName || undefined}
                data-student-name={rowStudentName || undefined}
                data-student-id={!isGroupRow ? matchedStudentId || undefined : undefined}
                data-date={getLessonStorageDateString(lesson) || undefined}
                data-time={String(lesson.time || '').trim() || undefined}
                onClick={
                  canOpenGroupAttendance
                    ? () => onOpenCalendarGroupLessonAttendance?.(lesson)
                    : canOpenPrivateLessonDetail
                      ? () => setPrivateLessonDetail(privateLessonDetailPayload)
                      : undefined
                }
                style={{
                  gridTemplateColumns:
                    'minmax(96px, 1fr) minmax(72px, 0.85fr) minmax(120px, 1.25fr) minmax(64px, 0.7fr) minmax(80px, 1fr) minmax(72px, 1fr) minmax(72px, 0.85fr) minmax(96px, 1fr) minmax(140px, auto)',
                  cursor:
                    canOpenGroupAttendance || canOpenPrivateLessonDetail ? 'pointer' : 'default',
                  background:
                    canOpenGroupAttendance || canOpenPrivateLessonDetail
                      ? 'rgba(90, 127, 208, 0.08)'
                      : undefined,
                }}
              >
                <span data-label={text('teacher.common.date', '날짜')}>
                  {formatLessonDateLabel(lesson)}
                </span>
                <span data-label={text('teacher.common.time', '시간')}>
                  {formatLessonTimeLabel(lesson)}
                </span>
                <span
                  data-label={text('teacher.calendar.header.studentOrClass', '학생 / 반')}
                  style={{ lineHeight: 1.45 }}
                >
                  <span style={badgeStyle}>
                    {teacherPortal
                      ? isGroupRow
                        ? t('teacher.calendar.badge.group')
                        : isPrivateReservationRow
                          ? t('teacher.calendar.badge.reservation')
                          : t('teacher.calendar.badge.private')
                      : getCalendarLessonBadgeLabel({
                          isGroupRow,
                          isPrivateReservationRow,
                          fixedPrivateCancellationLabel,
                        })}
                  </span>
                  {nameLabel}
                  {meaningHelperText ? (
                    <span
                      data-testid="calendar-row-meaning-helper"
                      style={{ display: 'block', marginTop: 4, fontSize: 12, opacity: 0.7 }}
                    >
                      {meaningHelperText}
                    </span>
                  ) : null}
                </span>
                <span data-label={text('teacher.common.session', '회차')}>
                  {knownLabel(sessionLabel) || '-'}
                </span>
                <span data-label={text('teacher.common.teacher', '선생님')}>
                  {isGroupRow
                    ? resolveTeacherDisplayName(
                        lesson,
                        teacherSelectOptions,
                        text('teacher.groups.teacherRequired', '선생님 선택 필요')
                      )
                    : getTeacherName(lesson)}
                </span>
                <span data-label={text('teacher.common.subject', '과목')}>
                  {isGroupRow
                    ? resolveGroupLessonSubject({
                        subject: lesson.subject,
                        groupClassName: lesson.groupClassDisplayName || lesson.groupClassName,
                        groupCourseType: lesson.groupCourseType,
                      })
                    : lesson.subject || '-'}
                </span>
                <span data-label={text('teacher.calendar.header.remaining', '남은 횟수')}>
                  {knownLabel(remainingLessons)}
                </span>
                <span
                  data-label={text('teacher.common.status', '상태')}
                  style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                  <span>{statusLabel}</span>
                  {groupSeatLabel ? (
                    <span
                      data-testid="calendar-group-lesson-seat-badge"
                      style={{
                        width: 'fit-content',
                        padding: '2px 7px',
                        borderRadius: 999,
                        border: '1px solid #3c4f68',
                        background: '#182234',
                        color: '#dbe8ff',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {groupSeatLabel}
                    </span>
                  ) : null}
                  {groupBookableLabel ? (
                    <span
                      data-testid="calendar-group-lesson-bookable-badge"
                      style={{
                        width: 'fit-content',
                        padding: '2px 7px',
                        borderRadius: 999,
                        border:
                          lesson.isBookable === true
                            ? '1px solid #4c7a5c'
                            : '1px solid #665044',
                        background:
                          lesson.isBookable === true
                            ? 'rgba(52, 110, 70, 0.28)'
                            : 'rgba(90, 65, 45, 0.28)',
                        color: lesson.isBookable === true ? '#bde8c7' : '#f0c7a8',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {groupBookableLabel}
                    </span>
                  ) : null}
                  {!isGroupRow && !isPrivateReservationRow && lesson.deductMemo ? (
                    <span style={{ fontSize: 12, opacity: 0.8 }}>
                      {text('teacher.calendar.memo', `메모: ${lesson.deductMemo}`, {
                        memo: lesson.deductMemo,
                      })}
                    </span>
                  ) : null}
                </span>
                <span
                  data-label={text('teacher.common.actions', '작업')}
                  className={teacherPortal ? 'teacher-card-actions' : undefined}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    alignItems: 'flex-start',
                  }}
                >
                  {canManagePrivateLessonDeductions &&
                  !isGroupRow &&
                  !isPrivateReservationRow &&
                  canDeductionAction ? (
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        handleDeductionToggle(lesson)
                      }}
                      disabled={busyLessonId === lesson.id}
                      data-testid="calendar-deduction-toggle-button"
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #555',
                        background: lesson.isDeductCancelled ? '#4a2a2a' : '#1f2a44',
                        color: 'white',
                        cursor: busyLessonId === lesson.id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {busyLessonId === lesson.id
                        ? '처리 중...'
                        : lesson.isDeductCancelled
                          ? '차감복구'
                          : '차감취소'}
                    </button>
                  ) : null}
                  {canManagePrivateLessonDeductions &&
                  !isGroupRow &&
                  !isPrivateReservationRow &&
                  !canDeductionAction &&
                  actionReason ? (
                    <span
                      data-testid="calendar-deduction-action-disabled-label"
                      style={{
                        fontSize: 12,
                        opacity: 0.72,
                        padding: '4px 0',
                      }}
                    >
                      {actionReason === '수강권이 연결되어 있지 않습니다'
                        ? text('teacher.calendar.status.packageLinkRequired', '수강권 연결 필요')
                        : knownLabel(actionReason)}
                    </span>
                  ) : null}
                  {activeSection === 'calendar' &&
                  !isGroupRow &&
                  !isPrivateReservationRow &&
                  showPackageCountEdit ? (
                    <button
                      type="button"
                      data-testid="calendar-package-count-edit-button"
                      onClick={(event) => {
                        event.stopPropagation()
                        openStudentPackageEditModal?.(contextPackage)
                      }}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #335544',
                        background: '#243528',
                        color: 'white',
                        cursor: 'pointer',
                      }}
                    >
                      횟수 수정
                    </button>
                  ) : null}
                  {activeSection === 'calendar' &&
                  canOpenFixedPrivateRescheduleScopePreview ? (
                    <button
                      type="button"
                      data-testid="calendar-fixed-private-reschedule-preview-button"
                      data-source-type={String(lesson.sourceType || '').trim() || undefined}
                      data-fixed-private-source={
                        String(lesson.sourceType || '').trim() === 'fixed-private-slot-assignment'
                          ? 'fixed-private-slot-assignment'
                          : undefined
                      }
                      data-calendar-row-kind={String(lesson._calendarRowKind || '').trim() || undefined}
                      data-is-seat-released={lesson.isSeatReleased === true ? 'true' : undefined}
                      data-released-for-private-booking={
                        lesson.releasedForPrivateBooking === true ? 'true' : undefined
                      }
                      data-excluded-statuses="seat_released completed no_show"
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenFixedRescheduleScopePreview?.(lesson)
                      }}
                      disabled={rowLessonActionBusy}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #3c7a5f',
                        background: '#1e3a2d',
                        color: 'white',
                        cursor: rowLessonActionBusy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      수정 범위 미리보기
                    </button>
                  ) : null}
                  {activeSection === 'calendar' &&
                  canCancelFixedPrivateLesson ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        setFixedPrivateLessonAction(lesson)
                      }}
                      disabled={rowLessonActionBusy}
                      data-testid="calendar-fixed-private-action-button"
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #4a6fff55',
                        background: '#1f2a44',
                        color: 'white',
                        cursor: rowLessonActionBusy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {busyFixedPrivateLessonCancelId === lesson.id ? '처리 중...' : '고정수업 처리'}
                    </button>
                  ) : null}
                  {activeSection === 'calendar' &&
                  canEditLesson &&
                  canUseGenericPrivateLessonCrud ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        openPrivateLessonEditModal(lesson)
                      }}
                      disabled={rowLessonActionBusy}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #555',
                        background: '#1f2a44',
                        color: 'white',
                        cursor: rowLessonActionBusy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {rowPrivateCrudBusy ? '처리 중...' : '수정'}
                    </button>
                  ) : null}
                  {activeSection === 'calendar' &&
                  canDeleteLesson &&
                  canUseGenericPrivateLessonCrud &&
                  !isFutureFixedPrivateLessonRow ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        handleDeletePrivateLesson(lesson)
                      }}
                      disabled={rowLessonActionBusy}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #553333',
                        background: '#4a2a2a',
                        color: 'white',
                        cursor: rowLessonActionBusy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {rowPrivateCrudBusy ? '처리 중...' : '삭제'}
                    </button>
                  ) : null}
                  {isGroupRow ? (
                    <>
                      <span style={{ fontSize: 12, opacity: 0.65 }}>
                        {text('teacher.common.readOnly', '읽기 전용')}
                        {canOpenGroupAttendance
                          ? ` · ${text('teacher.calendar.clickAttendance', '클릭해 출결 열기')}`
                          : ''}
                      </span>
                      {isAdmin && canEditLesson && lesson.status !== 'cancelled' ? (
                        <button
                          type="button"
                          onClick={() => onOpenGroupLessonNoDeductionCancel?.(lesson)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 8,
                            border: '1px solid #665533',
                            background: '#3a321f',
                            color: '#ffe8b8',
                            cursor: 'pointer',
                          }}
                        >
                          휴강 처리
                        </button>
                      ) : null}
                    </>
                  ) : null}
                  {isPrivateReservationRow ? (
                    <span style={{ fontSize: 12, opacity: 0.65 }}>
                      {text('teacher.common.readOnly', '읽기 전용')}
                    </span>
                  ) : null}
                  {canOpenPrivateLessonStatusActionPreview ||
                  canOpenFixedPrivateLessonOutcomePreview ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenPrivateLessonStatusActionPreview?.(lesson)
                      }}
                      disabled={canOpenFixedPrivateLessonOutcomePreview && rowLessonActionBusy}
                      data-testid={
                        canOpenFixedPrivateLessonOutcomePreview
                          ? 'fixed-private-lesson-outcome-preview-button'
                          : 'private-lesson-status-action-preview-button'
                      }
                      data-fixed-private-outcome={
                        canOpenFixedPrivateLessonOutcomePreview ? 'true' : undefined
                      }
                      data-fixed-private-links-complete={
                        canOpenFixedPrivateLessonOutcomePreview
                          ? isFixedPrivateOutcomeRow
                            ? 'true'
                            : 'false'
                          : undefined
                      }
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #3c7a5f',
                        background: '#1e3a2d',
                        color: 'white',
                        cursor:
                          canOpenFixedPrivateLessonOutcomePreview && rowLessonActionBusy
                            ? 'not-allowed'
                            : 'pointer',
                      }}
                    >
                      {canOpenFixedPrivateLessonOutcomePreview
                        ? isFixedPrivateOutcomeRow
                          ? text('teacher.calendar.action.processFixed', '고정수업 결과 처리')
                          : text('teacher.calendar.action.fixedLinkError', '고정수업 연결 오류 확인')
                        : text('teacher.calendar.action.processLesson', '수업 처리')}
                    </button>
                  ) : null}
                  {activeSection === 'calendar' &&
                  isAdmin &&
                  canUseLegacyPrivateReservationActions &&
                  privateReservationStatus === 'active' ? (
                    <>
                      {privateReservationHasEnded ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onMarkPrivateReservationOutcome?.(lesson, 'completed')}
                            disabled={reservationOutcomeBusy}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: '1px solid #555',
                              background: '#1f2a44',
                              color: 'white',
                              cursor: reservationOutcomeBusy ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {reservationCompleteBusy ? '처리 중...' : '완료 처리'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onMarkPrivateReservationOutcome?.(lesson, 'no_show')}
                            disabled={reservationOutcomeBusy}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: '1px solid #553333',
                              background: '#4a2a2a',
                              color: 'white',
                              cursor: reservationOutcomeBusy ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {reservationNoShowBusy ? '처리 중...' : '노쇼 처리'}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled
                          style={{
                            padding: '6px 10px',
                            borderRadius: 8,
                            border: '1px solid #555',
                            background: '#2a2f3a',
                            color: 'white',
                            cursor: 'not-allowed',
                            opacity: 0.72,
                          }}
                        >
                          수업 종료 후 처리
                        </button>
                      )}
                    </>
                  ) : null}
                  {activeSection === 'calendar' &&
                  isAdmin &&
                  canUseLegacyPrivateReservationActions &&
                  ['completed', 'no_show'].includes(privateReservationStatus) ? (
                    <button
                      type="button"
                      onClick={() => onReversePrivateReservationOutcome?.(lesson)}
                      disabled={reservationOutcomeBusy}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #555',
                        background: '#1f2a44',
                        color: 'white',
                        cursor: reservationOutcomeBusy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {reservationReverseBusy ? '처리 중...' : '완료취소'}
                    </button>
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {activeSection === 'calendar' && showOnlySelectedDate ? (
        <section
          data-testid="private-reservation-history-section"
          style={{
            marginTop: 18,
            border: '1px solid #333b4f',
            borderRadius: 12,
            background: '#141a26',
            padding: 16,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15 }}>
            {text('teacher.calendar.history.title', '1:1 예약 기록')}
          </h3>
          <p style={{ margin: '8px 0 0 0', opacity: 0.72, fontSize: 13 }}>
            {text(
              'teacher.calendar.history.description',
              '선택한 날짜의 학생 직접예약/취소 기록입니다. 현재 수업 목록과 별도로 보관됩니다.'
            )}
          </p>
          {privateReservationHistoryRows.length === 0 ? (
            <p
              data-testid="private-reservation-history-empty"
              style={{ margin: '10px 0 0 0', opacity: 0.72, fontSize: 13 }}
            >
              {text(
                'teacher.calendar.history.empty',
                '선택한 날짜의 1:1 예약 기록이 없습니다.'
              )}
            </p>
          ) : (
            <div
              className="teacher-reservation-history-list"
              style={{ display: 'grid', gap: 8, marginTop: 12 }}
            >
              {privateReservationHistoryRows.map((row) => (
                <article
                  key={row.id}
                  className="teacher-reservation-history-row"
                  data-testid="private-reservation-history-row"
                  data-reservation-id={row.id || undefined}
                  data-student-name={row.studentName || undefined}
                  data-status-label={row.statusLabel || undefined}
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'minmax(84px, 0.85fr) minmax(64px, 0.65fr) minmax(110px, 1fr) minmax(90px, 0.9fr) minmax(100px, 1fr) minmax(62px, 0.55fr) minmax(86px, 0.75fr) minmax(112px, 1fr)',
                    gap: 10,
                    alignItems: 'center',
                    border: '1px solid #283042',
                    borderRadius: 10,
                    background: '#101521',
                    padding: '10px 12px',
                    fontSize: 13,
                  }}
                >
                  <span data-label={text('teacher.common.date', '날짜')}>
                    {row.date || '-'}
                  </span>
                  <span data-label={text('teacher.common.time', '시간')}>
                    {row.time || '-'}
                  </span>
                  <span data-label={text('teacher.common.student', '학생')}>
                    {row.studentName || '-'}
                  </span>
                  <span data-label={text('teacher.common.teacher', '선생님')}>
                    {resolveTeacherDisplayName(row)}
                  </span>
                  <span data-label={text('teacher.common.subject', '과목')}>
                    {row.subject || '-'}
                  </span>
                  <span data-label={text('teacher.common.duration', '수업 시간')}>
                    {row.durationLabel || '-'}
                  </span>
                  <span data-label={text('teacher.common.status', '상태')}>
                    {row.statusLabel || '-'}
                  </span>
                  <span
                    data-label={text('teacher.common.details', '내용')}
                    style={{
                      opacity: row.detailLabel || row.cancelActorLabel || row.cancelledAtLabel ? 1 : 0.62,
                    }}
                  >
                    {row.detailLabel ||
                      [row.cancelActorLabel, row.cancelledAtLabel].filter(Boolean).join(' · ') ||
                      '-'}
                  </span>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
      {privateLessonDetail ? (
        <CalendarPrivateLessonDetailModal
          detail={privateLessonDetail}
          busyLessonId={busyLessonId}
          onClose={() => setPrivateLessonDetail(null)}
          onToggleDeduction={handleDeductionToggle}
          onOpenPackageEdit={(pkg) => {
            openStudentPackageEditModal?.(pkg)
            setPrivateLessonDetail(null)
          }}
          teacherPortal={teacherPortal}
        />
      ) : null}
      {fixedPrivateLessonAction ? (
        <FixedPrivateLessonActionModal
          lesson={fixedPrivateLessonAction}
          busy={busyFixedPrivateLessonCancelId === fixedPrivateLessonAction.id}
          onClose={() => setFixedPrivateLessonAction(null)}
          onAction={onCancelFixedPrivateLesson}
        />
      ) : null}
    </section>
  )
}
