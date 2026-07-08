import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { PRIVATE_WEEKLY_SLOT_WEEKDAYS } from '../../booking/privateWeeklySlotBulk.js'
import FixedPrivateLessonActionModal from '../components/FixedPrivateLessonActionModal.jsx'

function slotStatusLabel(status) {
  if (status === 'reserved') return '예약 완료'
  if (status === 'cancelled') return '취소된 시간'
  if (status === 'blocked') return '차단된 시간'
  return '예약 가능한 시간'
}

function isTeacherUnavailablePrivateSlot(slot) {
  return [
    'teacher_absent',
    'teacher_unavailable',
    'teacher_unavailable_closed',
    'teacher_absence',
    'teacher_no_show',
    'closed',
    'academy_closed',
    'holiday',
    'class_closure',
  ].includes(
    String(slot?.releaseReason || slot?.cancellationReason || slot?.cancelledReason || '')
      .trim()
      .toLowerCase()
  )
}

function isPrivateSlotClosedByTeacher(slot) {
  const status = String(slot?.status || '').trim().toLowerCase()
  return ['cancelled', 'canceled', 'blocked'].includes(status) && isTeacherUnavailablePrivateSlot(slot)
}

function privateSlotStatusLabel(slot) {
  if (isPrivateSlotClosedByTeacher(slot)) {
    return '선생님 수업불가로 닫힘'
  }
  if (
    slot?.releasedFromFixed === true ||
    String(slot?.slotType || '').trim() === 'released_fixed'
  ) {
    return '고정 취소로 예약 가능'
  }
  return slotStatusLabel(slot?.status)
}

function reservationStatusLabel(status) {
  return status === 'active' ? '예약 완료' : '예약 취소됨'
}

function isFixedPrivateLesson(lesson) {
  return (
    String(lesson?.packageType || '').trim() === 'private' &&
    String(lesson?.sourceType || '').trim() === 'fixed-private-slot-assignment'
  )
}

function fixedLessonStatusLabel(lesson) {
  const status = String(lesson?.status || '').trim().toLowerCase()
  const cancellationType = String(lesson?.cancellationType || '').trim().toLowerCase()
  if (status === 'cancelled' || status === 'canceled') {
    if (cancellationType === 'seat_released' || lesson?.isSeatReleased === true) return '자리 공개됨'
    return '수업 취소'
  }
  return '배정됨'
}

function fixedLessonMatchesReservation(lesson, reservation) {
  if (!lesson || !reservation) return false
  const lessonDate = String(lesson.date || '').trim()
  const lessonTime = String(lesson.time || '').trim()
  const reservationDate = String(reservation.date || '').trim()
  const reservationTime = String(reservation.time || '').trim()
  if (!lessonDate || !lessonTime || lessonDate !== reservationDate || lessonTime !== reservationTime) {
    return false
  }
  const lessonTeacherKeys = getPrivateSlotTeacherDisplay(lesson).toLowerCase().split(' · ')
  const reservationTeacherLabel = getPrivateSlotTeacherDisplay(reservation).toLowerCase()
  return lessonTeacherKeys.some((key) => key && reservationTeacherLabel.includes(key))
}

function getFixedRescheduleStudentId(lesson) {
  return String(lesson?.studentId || lesson?.studentID || '').trim()
}

function getFixedRescheduleLessonId(lesson) {
  return String(lesson?.id || lesson?.lessonId || lesson?.fixedLessonId || '').trim()
}

function getFixedRescheduleLessonDate(lesson) {
  return String(lesson?.date || lesson?.lessonDate || lesson?.scheduleDate || '').trim()
}

function getFixedRescheduleLessonTime(lesson) {
  return String(lesson?.time || lesson?.startTime || lesson?.scheduleTime || '').trim()
}

function getFixedRescheduleDurationMinutes(lesson) {
  const duration = Number(
    lesson?.durationMinutes ||
      lesson?.duration ||
      lesson?.lessonDurationMinutes ||
      lesson?.classDurationMinutes
  )
  return Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 60
}

function getFixedRescheduleWeekday(lesson) {
  const date = getFixedRescheduleLessonDate(lesson)
  if (!isYmd(date)) return ''
  const parsed = new Date(`${date}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? '' : String(parsed.getDay())
}

function getFixedReschedulePackageIds(lesson) {
  const seen = new Set()
  const ids = []
  ;[
    lesson?.packageId,
    lesson?.deductionPackageId,
    lesson?.linkedPackageId,
    lesson?.fixedPrivatePackageId,
  ].forEach((value) => {
    const id = String(value || '').trim()
    if (!id || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  })
  return ids
}

function getFixedReschedulePrimaryPackageId(lesson) {
  return getFixedReschedulePackageIds(lesson)[0] || ''
}

function getFixedRescheduleTeacherKeys(lesson) {
  const seen = new Set()
  const keys = []
  ;[
    lesson?.teacherUid,
    lesson?.teacherUID,
    lesson?.teacherId,
    lesson?.teacherID,
    lesson?.teacherKey,
    lesson?.teacher,
    lesson?.teacherName,
  ].forEach((value) => {
    const key = String(value || '').trim().toLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    keys.push(key)
  })
  return keys
}

function fixedRescheduleTeacherMatches(a, b) {
  const left = getFixedRescheduleTeacherKeys(a)
  const right = new Set(getFixedRescheduleTeacherKeys(b))
  return left.length > 0 && left.some((key) => right.has(key))
}

function isFixedRescheduleActiveLesson(lesson) {
  const status = String(lesson?.status || 'active').trim().toLowerCase()
  const cancellationType = String(lesson?.cancellationType || '').trim().toLowerCase()
  const outcome = String(lesson?.outcome || lesson?.attendanceStatus || '').trim().toLowerCase()
  if (['cancelled', 'canceled', 'deleted', 'archived', 'completed'].includes(status)) return false
  if (['completed', 'no_show', 'no-show'].includes(outcome)) return false
  if (['lesson_cancelled', 'lesson_canceled', 'fixed_lesson_cancelled'].includes(cancellationType)) {
    return false
  }
  if (lesson?.completed === true || lesson?.isSeatReleased === true) return false
  if (lesson?.releasedForPrivateBooking === true) return false
  return isFixedPrivateLesson(lesson)
}

function fixedRescheduleSamePattern(a, b) {
  if (getFixedRescheduleStudentId(a) !== getFixedRescheduleStudentId(b)) return false
  if (!fixedRescheduleTeacherMatches(a, b)) return false
  if (getFixedRescheduleWeekday(a) !== getFixedRescheduleWeekday(b)) return false
  if (getFixedRescheduleLessonTime(a) !== getFixedRescheduleLessonTime(b)) return false
  if (getFixedRescheduleDurationMinutes(a) !== getFixedRescheduleDurationMinutes(b)) return false
  const templateA = String(a?.privateLessonAvailabilityTemplateId || '').trim()
  const templateB = String(b?.privateLessonAvailabilityTemplateId || '').trim()
  if (templateA && templateB && templateA !== templateB) return false
  const packageIdsA = getFixedReschedulePackageIds(a)
  const packageIdsB = new Set(getFixedReschedulePackageIds(b))
  if (packageIdsA.length > 0 && packageIdsB.size > 0) {
    return packageIdsA.some((packageId) => packageIdsB.has(packageId))
  }
  return true
}

function getFixedRescheduleBatchId(lesson) {
  return String(lesson?.fixedPrivateAssignmentBatchId || '').trim()
}

const WEEKDAY_OPTIONS = [
  { value: '1', label: '월요일' },
  { value: '2', label: '화요일' },
  { value: '3', label: '수요일' },
  { value: '4', label: '목요일' },
  { value: '5', label: '금요일' },
  { value: '6', label: '토요일' },
]

function weekdayLabel(value) {
  return PRIVATE_WEEKLY_SLOT_WEEKDAYS.find((option) => option.value === String(value))?.label || '-'
}

function getShortIdentity(value) {
  const text = String(value || '').trim()
  return text.length > 10 ? text.slice(0, 10) : text
}

function getPrivateSlotTeacherDisplay(row) {
  const displayName = String(row?.teacherName || row?.teacher || '').trim()
  const identity =
    String(row?.teacherKey || '').trim() ||
    String(row?.teacherEmail || '').trim() ||
    getShortIdentity(row?.teacherUid)
  if (!displayName) return identity || '-'
  if (!identity || identity === displayName) return displayName
  return `${displayName} · ${identity}`
}

function getFixedRescheduleLessonName(lesson) {
  return String(lesson?.subject || lesson?.lessonName || lesson?.name || lesson?.title || '1:1 수업').trim()
}

function buildFixedRescheduleTargetDraft(lesson) {
  return {
    targetDate: getFixedRescheduleLessonDate(lesson),
    targetTime: getFixedRescheduleLessonTime(lesson),
    targetTeacherKey: String(
      lesson?.teacherKey || lesson?.teacherUid || lesson?.teacherUID || lesson?.teacherName || lesson?.teacher || ''
    ).trim(),
    targetTeacherUid: String(lesson?.teacherUid || lesson?.teacherUID || '').trim(),
    targetTeacherName: String(
      lesson?.teacherName || lesson?.displayName || lesson?.teacher || lesson?.name || ''
    ).trim(),
    targetTeacherId: String(lesson?.teacherId || lesson?.teacherID || '').trim(),
    targetDurationMinutes: String(getFixedRescheduleDurationMinutes(lesson) || 60),
    targetLessonName: getFixedRescheduleLessonName(lesson),
  }
}

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim())
}

function getTemplateTeacherKeys(template) {
  const seen = new Set()
  const out = []
  ;[
    template?.teacherUid,
    template?.teacherUID,
    template?.teacherId,
    template?.teacherID,
    template?.teacherKey,
    template?.teacher,
    template?.teacherName,
  ].forEach((value) => {
    const key = String(value || '').trim().toLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(key)
  })
  return out
}

function getTeacherOptionKeys(option) {
  return [
    option?.value,
    option?.teacherUid,
    option?.teacherKey,
    option?.displayName,
    option?.label,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
}

function privateTemplateMatchesTeacherOption(template, option) {
  if (!option) return true
  const templateKeys = getTemplateTeacherKeys(template)
  const optionKeys = getTeacherOptionKeys(option)
  if (templateKeys.length === 0 || optionKeys.length === 0) return false
  return optionKeys.some((key) => templateKeys.includes(key))
}

function getTemplateAssignmentDefaultRange(template) {
  return {
    startDate: isYmd(template?.effectiveStartDate) ? String(template.effectiveStartDate) : '',
    endDate: isYmd(template?.effectiveEndDate) ? String(template.effectiveEndDate) : '',
  }
}

function getTemplateAssignmentOptionLabel(template) {
  const range =
    template.effectiveStartDate && template.effectiveEndDate
      ? `${template.effectiveStartDate} ~ ${template.effectiveEndDate}`
      : '기간 제한 없음'
  return `${getPrivateSlotTeacherDisplay(template)} · ${weekdayLabel(template.weekday)} ${
    template.time || '-'
  } · ${Number(template.durationMinutes || 0) || '-'}분 · ${range}`
}

function isTemplateForFixedAssignment(template) {
  return template?.useForFixedAssignment !== false
}

function isTemplateOpenForStudentBooking(template) {
  return template?.openForStudentBooking === true
}

function getTemplateUsageLabel(template) {
  const labels = []
  if (isTemplateForFixedAssignment(template)) labels.push('고정 수업 배정용')
  if (isTemplateOpenForStudentBooking(template)) labels.push('학생 직접 예약 허용')
  return labels.join(' · ') || '용도 없음'
}

function normalizePrivateWeeklyTemplateStatus(template) {
  const status = String(template?.status || '').trim().toLowerCase()
  if (!status) return 'active'
  if (['active', 'enabled', 'enable', 'use', 'using', 'used', '사용'].includes(status)) {
    return 'active'
  }
  if (
    [
      'inactive',
      'disabled',
      'disable',
      'stop',
      'stopped',
      'pause',
      'paused',
      '비활성',
      '중지',
    ].includes(status)
  ) {
    return 'inactive'
  }
  return 'active'
}

function normalizeEligibleStudentIds(values) {
  const out = []
  const seen = new Set()
  const source = Array.isArray(values) ? values : []
  source.forEach((value) => {
    const studentId = String(value || '').trim()
    if (!studentId || seen.has(studentId)) return
    seen.add(studentId)
    out.push(studentId)
  })
  return out
}

function toggleStudentId(values, studentId) {
  const normalizedId = String(studentId || '').trim()
  if (!normalizedId) return normalizeEligibleStudentIds(values)
  const current = normalizeEligibleStudentIds(values)
  if (current.includes(normalizedId)) return current.filter((value) => value !== normalizedId)
  return [...current, normalizedId]
}

function formatYmd(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateAsKstYmd(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`
}

function formatPrivateWeeklyTemplateDateValueYmd(value) {
  if (!value) return ''
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (isYmd(trimmed)) return trimmed
    const parsed = new Date(trimmed)
    return Number.isNaN(parsed.getTime()) ? '' : formatDateAsKstYmd(parsed)
  }
  if (value instanceof Date) {
    return formatDateAsKstYmd(value)
  }
  if (typeof value?.toDate === 'function') {
    return formatDateAsKstYmd(value.toDate())
  }
  const seconds = Number.isFinite(value?.seconds) ? value.seconds : value?._seconds
  if (Number.isFinite(seconds)) {
    return formatDateAsKstYmd(new Date(seconds * 1000))
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatDateAsKstYmd(new Date(value < 10000000000 ? value * 1000 : value))
  }
  return ''
}

function getKstTodayYmd() {
  return formatDateAsKstYmd(new Date())
}

function shouldHidePrivateWeeklyTemplateByDefault(template, todayYmd) {
  if (normalizePrivateWeeklyTemplateStatus(template) === 'inactive') return true
  const effectiveEndDate = formatPrivateWeeklyTemplateDateValueYmd(template?.effectiveEndDate)
  return Boolean(effectiveEndDate && todayYmd && effectiveEndDate < todayYmd)
}

const PRIVATE_LESSON_SLOT_DATE_FIELDS = ['date', 'lessonDate', 'slotDate', 'startAt', 'startsAt']
const FIXED_PRIVATE_LESSON_DATE_FIELDS = ['date', 'lessonDate', 'startAt', 'startsAt']

function getPrivateRecordDateYmd(record, fields) {
  for (const field of fields) {
    const ymd = formatPrivateWeeklyTemplateDateValueYmd(record?.[field])
    if (ymd) return ymd
  }
  return ''
}

function shouldHidePastPrivateRecordByDefault(record, fields, todayYmd) {
  const recordDate = getPrivateRecordDateYmd(record, fields)
  return Boolean(recordDate && todayYmd && recordDate < todayYmd)
}

function addDaysToYmd(ymd, days) {
  const base = new Date(`${ymd}T00:00:00`)
  if (Number.isNaN(base.getTime())) return ''
  base.setDate(base.getDate() + days)
  return formatYmd(base)
}

function getMondayYmd(value = new Date()) {
  const date = value instanceof Date ? new Date(value) : new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return formatYmd(new Date())
  const day = date.getDay()
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1))
  return formatYmd(date)
}

function getWeekdayShortLabel(ymd) {
  const date = new Date(`${ymd}T00:00:00`)
  const labels = ['일', '월', '화', '수', '목', '금', '토']
  return labels[date.getDay()] || ''
}

function buildPrivateTemplateSlotId({ templateId, date, time }) {
  const safeTemplateId = String(templateId || '').trim().replace(/[^A-Za-z0-9_-]/g, '_')
  const safeDate = String(date || '').trim().replace(/-/g, '')
  const safeTime = String(time || '').trim().replace(/:/g, '')
  return `template__${safeTemplateId}__${safeDate}__${safeTime}`
}

function privateAvailabilityTemplateAppliesToDate(template, date) {
  const safeDate = String(date || '').trim()
  if (!isYmd(safeDate)) return false
  const effectiveStartDate = isYmd(template?.effectiveStartDate)
    ? String(template.effectiveStartDate)
    : ''
  const effectiveEndDate = isYmd(template?.effectiveEndDate) ? String(template.effectiveEndDate) : ''
  if (effectiveStartDate && safeDate < effectiveStartDate) return false
  if (effectiveEndDate && safeDate > effectiveEndDate) return false
  return true
}

function privateBoardRowMatchesTeacher(row, option) {
  if (!option) return false
  const rowKeys = getTemplateTeacherKeys(row)
  const optionKeys = getTeacherOptionKeys(option)
  if (rowKeys.length === 0 || optionKeys.length === 0) return false
  return optionKeys.some((key) => rowKeys.includes(key))
}

function isActivePrivateReservation(reservation) {
  return ['active', 'reserved', 'confirmed', 'booked'].includes(
    String(reservation?.status || '').trim().toLowerCase()
  )
}

function isFixedPrivateReservation(reservation, slot) {
  const sourceType = String(reservation?.sourceType || '').trim()
  const reservationType = String(reservation?.reservationType || reservation?.type || '').trim()
  const source = String(reservation?.source || '').trim()
  const slotType = String(slot?.slotType || '').trim()
  return (
    sourceType === 'fixed-private-slot-assignment' ||
    sourceType === 'weekly-slot-fixed-assignment' ||
    reservationType === 'fixed' ||
    reservationType === 'fixed_private' ||
    source === 'fixed_admin' ||
    slotType === 'fixed'
  )
}

function isCancelledLessonStatus(value) {
  return ['cancelled', 'canceled'].includes(String(value || '').trim().toLowerCase())
}

function getPrivateBoardSlotKey({ date, time }) {
  return `${String(date || '').trim()}__${String(time || '').trim()}`
}

function getPrivateBoardSlotStatusLabel({ slot, reservation, fixedLesson }) {
  if (slot && isPrivateSlotClosedByTeacher(slot)) {
    return '선생님 수업불가로 닫힘'
  }
  if (fixedLesson || isFixedPrivateReservation(reservation, slot)) return '고정 예약'
  if (reservation && isActivePrivateReservation(reservation)) return '학생 예약 있음'
  if (
    slot?.releasedFromFixed === true ||
    String(slot?.slotType || '').trim() === 'released_fixed'
  ) {
    return '고정 취소로 예약 가능'
  }
  return '예약 가능'
}

function getPrivateBoardSlotDetail({ slot, reservation, fixedLesson }) {
  if (fixedLesson) {
    return `학생: ${fixedLesson.studentName || fixedLesson.student || fixedLesson.studentId || '-'}`
  }
  if (reservation && isActivePrivateReservation(reservation)) {
    return `예약: ${reservation.studentName || reservation.studentId || '-'}`
  }
  if (
    slot?.releasedFromFixed === true ||
    String(slot?.slotType || '').trim() === 'released_fixed'
  ) {
    return `원래 학생: ${slot.fixedStudentName || slot.fixedStudentId || '-'}`
  }
  if (slot && ['cancelled', 'canceled', 'blocked'].includes(String(slot.status || '').trim())) {
    return '닫힌 시간'
  }
  return '예약 없음'
}

export default function PrivateLessonSlotsSection({
  canManagePrivateSlots,
  teacherSelectOptions,
  privateSlotForm,
  setPrivateSlotForm,
  privateSlotFormErrors,
  privateSlotCreateResult,
  privateAvailabilityBulkForm,
  setPrivateAvailabilityBulkForm,
  privateAvailabilityBulkErrors,
  privateAvailabilityBulkResult,
  previewPrivateAvailabilityBulkTemplates,
  createPrivateAvailabilityBulkTemplates,
  privateAvailabilityTemplateForm,
  setPrivateAvailabilityTemplateForm,
  privateAvailabilityTemplateErrors,
  createPrivateAvailabilityTemplate,
  updatePrivateAvailabilityTemplateStatus,
  updatePrivateAvailabilityTemplateDetails,
  privateAvailabilityTemplates = [],
  privateAvailabilityTemplatesLoading,
  busyPrivateAvailabilityTemplateId,
  privateStudents = [],
  privateFixedSlotAssignmentForm,
  setPrivateFixedSlotAssignmentForm,
  privateFixedSlotAssignmentErrors,
  privateFixedSlotAssignmentPreview,
  privateFixedSlotAssignmentPackageOptions = [],
  previewPrivateFixedSlotAssignment,
  createPrivateFixedSlotAssignment,
  busyPrivateFixedSlotAssignment,
  fixedPrivateRenewalSeedLessonId = '',
  setFixedPrivateRenewalSeedLessonId,
  fixedPrivateRenewalPackageId = '',
  setFixedPrivateRenewalPackageId,
  showExistingRenewalPackageChoice = false,
  setShowExistingRenewalPackageChoice,
  handleUseFixedPrivateRenewalDraftPackage,
  fixedPrivateRenewalStartDate = '',
  setFixedPrivateRenewalStartDate,
  fixedPrivateRenewalEndDate = '',
  setFixedPrivateRenewalEndDate,
  fixedPrivateRenewalDraftCount = '',
  setFixedPrivateRenewalDraftCount,
  fixedPrivateRenewalDraftPackage = null,
  fixedPrivateRenewalDraftNote = '',
  fixedPrivateRenewalAutoSuggestion = null,
  fixedPrivateRenewalSeedOptions = [],
  fixedPrivateRenewalDraftPackageOption = null,
  fixedPrivateRenewalExistingPackageOptions = [],
  fixedPrivateRenewalPackageOptions = [],
  fixedPrivateRenewalPlan = null,
  fixedPrivateRenewalServerPreview = null,
  fixedPrivateRenewalServerPreviewBusy = false,
  fixedPrivateRenewalServerPreviewError = '',
  fixedPrivateRenewalServerPreviewPayload = null,
  fixedPrivateRenewalCommitBusy = false,
  fixedPrivateRenewalCommitError = '',
  fixedPrivateRenewalCommitResult = null,
  fixedPrivateRenewalServerPreviewDisabledReason = '',
  previewFixedPrivateRenewalOnServer,
  onCommitFixedPrivateRenewal,
  fixedRescheduleServerPreview = null,
  fixedRescheduleServerPreviewBusy = false,
  fixedRescheduleServerPreviewError = '',
  fixedRescheduleServerPreviewPayload = null,
  fixedRescheduleCommitBusy = false,
  fixedRescheduleCommitError = '',
  fixedRescheduleCommitResult = null,
  fixedRescheduleCommitPayload = null,
  fixedRescheduleInspectorResult = null,
  fixedRescheduleInspectorBusy = false,
  fixedRescheduleInspectorError = '',
  fixedRescheduleInspectorPayload = null,
  onPreviewFixedRescheduleScopeOnServer,
  onClearFixedRescheduleServerPreview,
  onCommitFixedReschedule,
  onClearFixedRescheduleCommitState,
  onInspectFixedRescheduleStateOnServer,
  onClearFixedRescheduleInspectorState,
  createPrivateSlot,
  updatePrivateSlotEligibility,
  isPrivateSlotSubmitting,
  privateLessonSlots,
  privateLessonSlotsLoading,
  privateLessonReservations,
  privateLessonReservationsLoading,
  busyPrivateSlotActionId,
  cancelPrivateSlotOrReservation,
  closePrivateLessonSlot,
  reopenPrivateLessonSlot,
  privateFixedLessons = [],
  busyFixedPrivateLessonCancelId = '',
  onCancelFixedPrivateLesson,
  isAdmin,
}) {
  const [editingEligibilitySlotId, setEditingEligibilitySlotId] = useState('')
  const [editingEligibilityStudentIds, setEditingEligibilityStudentIds] = useState([])
  const [fixedPrivateLessonAction, setFixedPrivateLessonAction] = useState(null)
  const [editingAvailabilityTemplateId, setEditingAvailabilityTemplateId] = useState('')
  const [editingAvailabilityTemplateForm, setEditingAvailabilityTemplateForm] = useState({
    effectiveStartDate: '',
    effectiveEndDate: '',
    status: 'active',
    useForFixedAssignment: true,
    openForStudentBooking: false,
  })
  const [editingAvailabilityTemplateErrors, setEditingAvailabilityTemplateErrors] = useState({})
  const [privateBoardTeacherValue, setPrivateBoardTeacherValue] = useState('')
  const [privateBoardWeekStart, setPrivateBoardWeekStart] = useState(() => getMondayYmd())
  const [showPastPrivateWeeklyTemplates, setShowPastPrivateWeeklyTemplates] = useState(false)
  const [showPastPrivateLessonSlots, setShowPastPrivateLessonSlots] = useState(false)
  const [showPastFixedPrivateLessons, setShowPastFixedPrivateLessons] = useState(false)
  const [showFixedPrivateRenewalConfirmModal, setShowFixedPrivateRenewalConfirmModal] =
    useState(false)
  const [showFixedRescheduleCommitConfirmModal, setShowFixedRescheduleCommitConfirmModal] =
    useState(false)
  const [selectedFixedRescheduleLesson, setSelectedFixedRescheduleLesson] = useState(null)
  const [fixedRescheduleScopeMode, setFixedRescheduleScopeMode] = useState('single')
  const [fixedRescheduleRangeStart, setFixedRescheduleRangeStart] = useState('')
  const [fixedRescheduleRangeEnd, setFixedRescheduleRangeEnd] = useState('')
  const [fixedRescheduleTargetDraft, setFixedRescheduleTargetDraft] = useState(
    buildFixedRescheduleTargetDraft(null)
  )
  const [showFixedRescheduleScopePreview, setShowFixedRescheduleScopePreview] = useState(false)
  const fixedPrivateLessonsSectionRef = useRef(null)
  const fixedPrivateRenewalConfirmationPlan =
    fixedPrivateRenewalServerPreview?.normalizedPlan || {}
  const fixedPrivateRenewalConfirmationWouldCreate =
    fixedPrivateRenewalServerPreview?.wouldCreate || null
  const fixedPrivateRenewalConfirmationWarnings = Array.isArray(
    fixedPrivateRenewalServerPreview?.warnings
  )
    ? fixedPrivateRenewalServerPreview.warnings
    : []
  const fixedPrivateRenewalConfirmationDates = Array.isArray(
    fixedPrivateRenewalConfirmationPlan.assignableDates
  )
    ? fixedPrivateRenewalConfirmationPlan.assignableDates
    : Array.isArray(fixedPrivateRenewalPlan?.assignableDates)
      ? fixedPrivateRenewalPlan.assignableDates
      : []
  const fixedPrivateRenewalConfirmationTeacherTimeStatus = String(
    fixedPrivateRenewalConfirmationPlan.teacherTimePreparation?.status ||
      fixedPrivateRenewalPlan?.teacherTimePreparation?.status ||
      ''
  ).trim()
  const canOpenFixedPrivateRenewalConfirmModal = Boolean(
    fixedPrivateRenewalServerPreview &&
      fixedPrivateRenewalServerPreview.ok === true &&
      fixedPrivateRenewalServerPreview.dryRun === true &&
      fixedPrivateRenewalServerPreview.previewOnly === true &&
      fixedPrivateRenewalConfirmationWouldCreate &&
      !fixedPrivateRenewalServerPreviewBusy &&
      !fixedPrivateRenewalServerPreviewError &&
      fixedPrivateRenewalConfirmationDates.length > 0 &&
      !['conflict', 'missing_info'].includes(
        fixedPrivateRenewalConfirmationTeacherTimeStatus
      )
  )
  const canCommitFixedPrivateRenewal = Boolean(
    canOpenFixedPrivateRenewalConfirmModal &&
      fixedPrivateRenewalServerPreviewPayload &&
      typeof onCommitFixedPrivateRenewal === 'function' &&
      !fixedPrivateRenewalCommitBusy &&
      !fixedPrivateRenewalCommitResult
  )
  const fixedPrivateRenewalCommitCreated = fixedPrivateRenewalCommitResult?.created || {}
  const fixedPrivateRenewalCommitBatchId =
    fixedPrivateRenewalCommitResult?.renewalBatchIdCandidate ||
    fixedPrivateRenewalCommitResult?.renewalBatchId ||
    ''
  const fixedPrivateRenewalCommitLessonIds = Array.isArray(
    fixedPrivateRenewalCommitCreated.lessons
  )
    ? fixedPrivateRenewalCommitCreated.lessons
    : []
  const createdRenewalLessonIds = useMemo(
    () =>
      new Set(
        fixedPrivateRenewalCommitLessonIds
          .map((lesson) =>
            typeof lesson === 'string'
              ? lesson
              : lesson?.id || lesson?.lessonId || lesson?.fixedLessonId || ''
          )
          .map((lessonId) => String(lessonId || '').trim())
          .filter(Boolean)
      ),
    [fixedPrivateRenewalCommitLessonIds]
  )
  const createdRenewalLessonCount = createdRenewalLessonIds.size
  const fixedPrivateRenewalCommitSlotIds = Array.isArray(
    fixedPrivateRenewalCommitCreated.privateLessonSlots
  )
    ? fixedPrivateRenewalCommitCreated.privateLessonSlots
    : []
  const fixedPrivateRenewalCommitReservationIds = Array.isArray(
    fixedPrivateRenewalCommitCreated.privateLessonReservations
  )
    ? fixedPrivateRenewalCommitCreated.privateLessonReservations
    : []
  const fixedPrivateRenewalConfirmationSeedLesson = fixedPrivateRenewalPlan?.seedLesson || {}
  const fixedPrivateRenewalConfirmationStudentLabel =
    fixedPrivateRenewalDraftPackage?.studentName ||
    fixedPrivateRenewalConfirmationSeedLesson.studentName ||
    fixedPrivateRenewalConfirmationSeedLesson.student ||
    fixedPrivateRenewalConfirmationPlan.studentId ||
    '-'
  const fixedPrivateRenewalConfirmationTeacherLabel =
    fixedPrivateRenewalConfirmationPlan.teacherName ||
    fixedPrivateRenewalPlan?.teacherTimePreparation?.teacherName ||
    fixedPrivateRenewalConfirmationSeedLesson.teacherName ||
    fixedPrivateRenewalConfirmationSeedLesson.teacher ||
    fixedPrivateRenewalConfirmationPlan.teacherKey ||
    '-'
  const fixedPrivateRenewalConfirmationPackageMode = String(
    fixedPrivateRenewalConfirmationPlan.packageMode || ''
  ).trim()
  const fixedPrivateRenewalConfirmationPackageModeLabel =
    fixedPrivateRenewalConfirmationPackageMode === 'draft'
      ? '새 수강권 초안'
      : fixedPrivateRenewalConfirmationPackageMode === 'existing'
        ? '기존 수강권'
        : '-'

  useEffect(() => {
    if (!canOpenFixedPrivateRenewalConfirmModal) {
      setShowFixedPrivateRenewalConfirmModal(false)
    }
  }, [canOpenFixedPrivateRenewalConfirmModal])

  function viewCreatedFixedPrivateRenewalLessons() {
    setShowFixedPrivateRenewalConfirmModal(false)
    const scrollToCreatedLessons = () => {
      fixedPrivateLessonsSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(scrollToCreatedLessons)
      return
    }
    setTimeout(scrollToCreatedLessons, 0)
  }

  function clearFixedRescheduleServerPreview() {
    setShowFixedRescheduleCommitConfirmModal(false)
    onClearFixedRescheduleServerPreview?.()
  }

  function closeFixedRescheduleCommitConfirmModal() {
    if (fixedRescheduleCommitBusy) return
    setShowFixedRescheduleCommitConfirmModal(false)
    onClearFixedRescheduleCommitState?.()
    onClearFixedRescheduleInspectorState?.()
  }

  function handleViewUpdatedFixedRescheduleLessons() {
    if (fixedRescheduleCommitBusy) return
    setShowFixedRescheduleCommitConfirmModal(false)
    setShowFixedRescheduleScopePreview(false)
    const scrollToUpdatedLessons = () => {
      fixedPrivateLessonsSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(scrollToUpdatedLessons)
      return
    }
    setTimeout(scrollToUpdatedLessons, 0)
  }

  function resetFixedRescheduleTargetDraft(lesson) {
    setFixedRescheduleTargetDraft(buildFixedRescheduleTargetDraft(lesson))
  }

  function openFixedRescheduleScopePreview(lesson) {
    const date = getFixedRescheduleLessonDate(lesson)
    clearFixedRescheduleServerPreview()
    resetFixedRescheduleTargetDraft(lesson)
    setSelectedFixedRescheduleLesson(lesson)
    setFixedRescheduleScopeMode('single')
    setFixedRescheduleRangeStart(date)
    setFixedRescheduleRangeEnd(date)
    setShowFixedRescheduleScopePreview(true)
  }

  function closeFixedRescheduleScopePreview() {
    clearFixedRescheduleServerPreview()
    setShowFixedRescheduleScopePreview(false)
  }

  function changeFixedRescheduleScopeMode(nextScopeMode) {
    clearFixedRescheduleServerPreview()
    setFixedRescheduleScopeMode(nextScopeMode)
  }

  function changeFixedRescheduleRangeStart(nextRangeStart) {
    clearFixedRescheduleServerPreview()
    setFixedRescheduleRangeStart(nextRangeStart)
  }

  function changeFixedRescheduleRangeEnd(nextRangeEnd) {
    clearFixedRescheduleServerPreview()
    setFixedRescheduleRangeEnd(nextRangeEnd)
  }

  function changeFixedRescheduleTargetDraft(nextPatch) {
    clearFixedRescheduleServerPreview()
    setFixedRescheduleTargetDraft((prev) => ({
      ...prev,
      ...nextPatch,
    }))
  }

  function changeFixedRescheduleTargetTeacher(nextValue) {
    clearFixedRescheduleServerPreview()
    const selectedOption =
      teacherSelectOptions.find((option) => String(option.value || '') === String(nextValue || '')) ||
      null
    if (!selectedOption) {
      const defaultDraft = buildFixedRescheduleTargetDraft(selectedFixedRescheduleLesson)
      setFixedRescheduleTargetDraft((prev) => ({
        ...prev,
        targetTeacherId: defaultDraft.targetTeacherId,
        targetTeacherKey: defaultDraft.targetTeacherKey,
        targetTeacherName: defaultDraft.targetTeacherName,
        targetTeacherUid: defaultDraft.targetTeacherUid,
      }))
      return
    }
    setFixedRescheduleTargetDraft((prev) => ({
      ...prev,
      targetTeacherId: String(selectedOption.teacherId || '').trim(),
      targetTeacherKey: String(selectedOption.teacherKey || selectedOption.value || '').trim(),
      targetTeacherName: String(
        selectedOption.displayName || selectedOption.teacherName || selectedOption.label || ''
      ).trim(),
      targetTeacherUid: String(selectedOption.teacherUid || selectedOption.value || '').trim(),
    }))
  }

  function previewFixedRescheduleScopeOnServer() {
    if (fixedRescheduleServerPreviewDisabledReason) return
    setShowFixedRescheduleCommitConfirmModal(false)
    onPreviewFixedRescheduleScopeOnServer?.({
      selectedLesson: selectedFixedRescheduleLesson,
      scopeMode: fixedRescheduleScopeMode,
      rangeStart: fixedRescheduleRangeStart,
      rangeEnd: fixedRescheduleRangeEnd,
      targetDraft: fixedRescheduleTargetDraft,
    })
  }

  function openAvailabilityTemplateEdit(template) {
    setEditingAvailabilityTemplateId(String(template?.id || ''))
    setEditingAvailabilityTemplateForm({
      effectiveStartDate: isYmd(template?.effectiveStartDate) ? String(template.effectiveStartDate) : '',
      effectiveEndDate: isYmd(template?.effectiveEndDate) ? String(template.effectiveEndDate) : '',
      status: normalizePrivateWeeklyTemplateStatus(template),
      useForFixedAssignment: isTemplateForFixedAssignment(template),
      openForStudentBooking: isTemplateOpenForStudentBooking(template),
    })
    setEditingAvailabilityTemplateErrors({})
  }

  async function saveAvailabilityTemplateEdit(template) {
    if (typeof updatePrivateAvailabilityTemplateDetails !== 'function') return
    const result = await updatePrivateAvailabilityTemplateDetails(
      template,
      editingAvailabilityTemplateForm
    )
    if (result?.ok) {
      setEditingAvailabilityTemplateId('')
      setEditingAvailabilityTemplateErrors({})
      return
    }
    setEditingAvailabilityTemplateErrors(result?.errors || {})
  }

  const privateStudentOptions = useMemo(() => {
    return [...privateStudents]
      .map((student) => ({
        id: String(student.id || '').trim(),
        name: String(student.name || '').trim(),
        teacher: String(student.teacher || '').trim(),
      }))
      .filter((student) => student.id)
      .sort((a, b) =>
        `${a.name || a.id} ${a.teacher}`.localeCompare(`${b.name || b.id} ${b.teacher}`, 'ko')
      )
  }, [privateStudents])

  const selectedAssignmentTeacherOption = useMemo(
    () =>
      teacherSelectOptions.find(
        (option) => option.value === String(privateFixedSlotAssignmentForm?.teacher || '').trim()
      ) || null,
    [privateFixedSlotAssignmentForm?.teacher, teacherSelectOptions]
  )

  const privateFixedAssignmentTemplateOptions = useMemo(() => {
    return [...privateAvailabilityTemplates]
      .filter((template) => String(template.status || 'active') === 'active')
      .filter(isTemplateForFixedAssignment)
      .filter((template) =>
        privateTemplateMatchesTeacherOption(template, selectedAssignmentTeacherOption)
      )
      .sort((a, b) => {
        const aKey = `${getPrivateSlotTeacherDisplay(a)} ${a.weekday} ${a.time || ''}`
        const bKey = `${getPrivateSlotTeacherDisplay(b)} ${b.weekday} ${b.time || ''}`
        return aKey.localeCompare(bKey, 'ko')
      })
  }, [privateAvailabilityTemplates, selectedAssignmentTeacherOption])

  const privateWeeklyTemplateTodayYmd = useMemo(() => getKstTodayYmd(), [])
  const privateAvailabilityTemplateView = useMemo(() => {
    const allTemplates = Array.isArray(privateAvailabilityTemplates)
      ? privateAvailabilityTemplates
      : []
    const hiddenByDefault = allTemplates.filter((template) =>
      shouldHidePrivateWeeklyTemplateByDefault(template, privateWeeklyTemplateTodayYmd)
    )
    return {
      allTemplates,
      hiddenByDefaultCount: hiddenByDefault.length,
      visibleTemplates: showPastPrivateWeeklyTemplates
        ? allTemplates
        : allTemplates.filter(
            (template) =>
              !shouldHidePrivateWeeklyTemplateByDefault(template, privateWeeklyTemplateTodayYmd)
          ),
    }
  }, [privateAvailabilityTemplates, privateWeeklyTemplateTodayYmd, showPastPrivateWeeklyTemplates])
  const visiblePrivateAvailabilityTemplates = privateAvailabilityTemplateView.visibleTemplates
  const hiddenPrivateAvailabilityTemplateCount =
    privateAvailabilityTemplateView.hiddenByDefaultCount

  const privateLessonSlotView = useMemo(() => {
    const allSlots = Array.isArray(privateLessonSlots) ? privateLessonSlots : []
    const hiddenByDefault = allSlots.filter((slot) =>
      shouldHidePastPrivateRecordByDefault(
        slot,
        PRIVATE_LESSON_SLOT_DATE_FIELDS,
        privateWeeklyTemplateTodayYmd
      )
    )
    return {
      allSlots,
      hiddenByDefaultCount: hiddenByDefault.length,
      visibleSlots: showPastPrivateLessonSlots
        ? allSlots
        : allSlots.filter(
            (slot) =>
              !shouldHidePastPrivateRecordByDefault(
                slot,
                PRIVATE_LESSON_SLOT_DATE_FIELDS,
                privateWeeklyTemplateTodayYmd
              )
          ),
    }
  }, [privateLessonSlots, privateWeeklyTemplateTodayYmd, showPastPrivateLessonSlots])
  const visiblePrivateLessonSlots = privateLessonSlotView.visibleSlots
  const hiddenPrivateLessonSlotCount = privateLessonSlotView.hiddenByDefaultCount

  const reservationsBySlotId = new Map()
  privateLessonReservations.forEach((reservation) => {
    const slotId = String(reservation.slotId || '').trim()
    if (!slotId) return
    if (!reservationsBySlotId.has(slotId)) reservationsBySlotId.set(slotId, [])
    reservationsBySlotId.get(slotId).push(reservation)
  })

  const sortedFixedPrivateLessons = useMemo(() => {
    return (Array.isArray(privateFixedLessons) ? privateFixedLessons : [])
      .filter((lesson) => isFixedPrivateLesson(lesson))
      .sort((a, b) =>
        `${a.date || ''} ${a.time || ''} ${a.teacherName || a.teacher || ''}`.localeCompare(
          `${b.date || ''} ${b.time || ''} ${b.teacherName || b.teacher || ''}`,
          'ko'
        )
      )
  }, [privateFixedLessons])

  const futureFixedPrivateLessons = useMemo(() => {
    return sortedFixedPrivateLessons.filter(
      (lesson) =>
        !shouldHidePastPrivateRecordByDefault(
          lesson,
          FIXED_PRIVATE_LESSON_DATE_FIELDS,
          privateWeeklyTemplateTodayYmd
        )
    )
  }, [privateWeeklyTemplateTodayYmd, sortedFixedPrivateLessons])
  const fixedPrivateLessonView = useMemo(() => {
    const hiddenByDefault = sortedFixedPrivateLessons.filter((lesson) =>
      shouldHidePastPrivateRecordByDefault(
        lesson,
        FIXED_PRIVATE_LESSON_DATE_FIELDS,
        privateWeeklyTemplateTodayYmd
      )
    )
    return {
      allLessons: sortedFixedPrivateLessons,
      hiddenByDefaultCount: hiddenByDefault.length,
      visibleLessons: showPastFixedPrivateLessons
        ? sortedFixedPrivateLessons
        : futureFixedPrivateLessons,
    }
  }, [
    futureFixedPrivateLessons,
    privateWeeklyTemplateTodayYmd,
    showPastFixedPrivateLessons,
    sortedFixedPrivateLessons,
  ])
  const visibleFixedPrivateLessons = fixedPrivateLessonView.visibleLessons
  const hiddenFixedPrivateLessonCount = fixedPrivateLessonView.hiddenByDefaultCount
  const fixedRescheduleScopePreview = useMemo(() => {
    const selected = selectedFixedRescheduleLesson
    if (!selected) {
      return {
        includedLessons: [],
        excludedLessons: [],
        warnings: [],
      }
    }

    const selectedId = getFixedRescheduleLessonId(selected)
    const selectedDate = getFixedRescheduleLessonDate(selected)
    const selectedStudentId = getFixedRescheduleStudentId(selected)
    const selectedBatchId = getFixedRescheduleBatchId(selected)
    const selectedPackageIds = new Set(getFixedReschedulePackageIds(selected))
    const warnings = []

    if (fixedRescheduleScopeMode === 'package_remaining') {
      warnings.push(
        '같은 수강권에 여러 시간 패턴이 포함될 수 있습니다. 실제 저장 전 서버 검증이 필요합니다.'
      )
      if (selectedPackageIds.size === 0) {
        warnings.push('선택한 수업의 수강권 연결 정보가 없어 후보 계산이 제한됩니다.')
      }
    }
    if (fixedRescheduleScopeMode === 'future_series' && !selectedBatchId) {
      warnings.push('배치 ID가 없어 학생/선생님/요일/시간/길이 기준으로 후보를 계산합니다.')
    }

    const rangeStart =
      fixedRescheduleScopeMode === 'date_range'
        ? String(fixedRescheduleRangeStart || '').trim()
        : selectedDate
    const rangeEnd =
      fixedRescheduleScopeMode === 'date_range'
        ? String(fixedRescheduleRangeEnd || '').trim()
        : ''

    if (
      fixedRescheduleScopeMode === 'date_range' &&
      (!isYmd(rangeStart) || !isYmd(rangeEnd) || rangeEnd < rangeStart)
    ) {
      warnings.push('직접 날짜 범위의 시작일과 종료일을 확인해 주세요.')
    }

    function hasPackageOverlap(lesson) {
      if (selectedPackageIds.size === 0) return false
      return getFixedReschedulePackageIds(lesson).some((packageId) =>
        selectedPackageIds.has(packageId)
      )
    }

    function isRelevantLesson(lesson) {
      if (!isFixedPrivateLesson(lesson)) return false
      const lessonId = getFixedRescheduleLessonId(lesson)
      const lessonStudentId = getFixedRescheduleStudentId(lesson)
      if (fixedRescheduleScopeMode === 'single') return lessonId === selectedId
      if (!selectedStudentId || lessonStudentId !== selectedStudentId) return false
      if (fixedRescheduleScopeMode === 'future_series') {
        return selectedBatchId ? getFixedRescheduleBatchId(lesson) === selectedBatchId : true
      }
      if (fixedRescheduleScopeMode === 'package_remaining') return hasPackageOverlap(lesson)
      return fixedRescheduleSamePattern(selected, lesson)
    }

    function getOutOfScopeReason(lesson) {
      const date = getFixedRescheduleLessonDate(lesson)
      if (!isFixedRescheduleActiveLesson(lesson)) return '수정 대상이 아닌 상태'
      if (fixedRescheduleScopeMode === 'single') {
        return getFixedRescheduleLessonId(lesson) === selectedId ? '' : '선택한 수업 아님'
      }
      if (
        fixedRescheduleScopeMode !== 'date_range' &&
        (!isYmd(date) || !isYmd(selectedDate) || date < selectedDate)
      ) {
        return '선택한 날짜 이전'
      }
      if (fixedRescheduleScopeMode === 'future_series' && !selectedBatchId) {
        return fixedRescheduleSamePattern(selected, lesson) ? '' : '패턴 다름'
      }
      if (fixedRescheduleScopeMode === 'package_remaining') {
        return hasPackageOverlap(lesson) ? '' : '수강권 다름'
      }
      if (fixedRescheduleScopeMode === 'date_range') {
        if (!isYmd(rangeStart) || !isYmd(rangeEnd) || rangeEnd < rangeStart) return '날짜 범위 필요'
        if (date < rangeStart || date > rangeEnd) return '날짜 범위 밖'
        return fixedRescheduleSamePattern(selected, lesson) ? '' : '패턴 다름'
      }
      return ''
    }

    const includedLessons = []
    const excludedLessons = []
    sortedFixedPrivateLessons
      .filter(isRelevantLesson)
      .forEach((lesson) => {
        const reason = getOutOfScopeReason(lesson)
        if (reason) {
          excludedLessons.push({ lesson, reason })
          return
        }
        includedLessons.push(lesson)
      })

    const sortByDateTime = (a, b) =>
      `${getFixedRescheduleLessonDate(a)} ${getFixedRescheduleLessonTime(a)}`.localeCompare(
        `${getFixedRescheduleLessonDate(b)} ${getFixedRescheduleLessonTime(b)}`,
        'ko'
      )

    return {
      includedLessons: includedLessons.sort(sortByDateTime),
      excludedLessons: excludedLessons.sort((a, b) => sortByDateTime(a.lesson, b.lesson)),
      warnings,
    }
  }, [
    fixedRescheduleRangeEnd,
    fixedRescheduleRangeStart,
    fixedRescheduleScopeMode,
    selectedFixedRescheduleLesson,
    sortedFixedPrivateLessons,
  ])
  const fixedRescheduleServerPreviewDisabledReason = useMemo(() => {
    if (fixedRescheduleServerPreviewBusy) return '서버 기준 검증 중입니다.'
    if (!selectedFixedRescheduleLesson) return '서버 검증에 사용할 고정 수업을 선택해 주세요.'
    if (!fixedRescheduleScopeMode) return '수정 범위를 선택해 주세요.'
    if (
      fixedRescheduleScopeMode === 'date_range' &&
      (!isYmd(fixedRescheduleRangeStart) ||
        !isYmd(fixedRescheduleRangeEnd) ||
        fixedRescheduleRangeEnd < fixedRescheduleRangeStart)
    ) {
      return '직접 날짜 범위의 시작일과 종료일을 확인해 주세요.'
    }
    if (typeof onPreviewFixedRescheduleScopeOnServer !== 'function') {
      return '서버 기준 범위 검증을 실행할 수 없습니다.'
    }
    return ''
  }, [
    fixedRescheduleRangeEnd,
    fixedRescheduleRangeStart,
    fixedRescheduleScopeMode,
    fixedRescheduleServerPreviewBusy,
    onPreviewFixedRescheduleScopeOnServer,
    selectedFixedRescheduleLesson,
  ])
  const fixedRescheduleServerPreviewConflicts = Array.isArray(
    fixedRescheduleServerPreview?.conflicts
  )
    ? fixedRescheduleServerPreview.conflicts
    : []
  const fixedRescheduleServerPreviewWarnings = Array.isArray(
    fixedRescheduleServerPreview?.warnings
  )
    ? fixedRescheduleServerPreview.warnings
    : []
  const fixedRescheduleServerPreviewWouldUpdate =
    fixedRescheduleServerPreview?.wouldUpdate || {}
  const fixedRescheduleServerPreviewPlan = fixedRescheduleServerPreview?.normalizedPlan || {}
  const fixedRescheduleServerPreviewTeacherTime =
    fixedRescheduleServerPreview?.teacherTimePreparation || {}
  const fixedRescheduleServerPreviewIncludedLessons = Array.isArray(
    fixedRescheduleServerPreview?.includedLessons
  )
    ? fixedRescheduleServerPreview.includedLessons
    : []
  const fixedRescheduleServerPreviewExcludedLessons = Array.isArray(
    fixedRescheduleServerPreview?.excludedLessons
  )
    ? fixedRescheduleServerPreview.excludedLessons
    : []
  const fixedRescheduleCommitTeacherTimeStatus = String(
    fixedRescheduleServerPreviewTeacherTime.status ||
      fixedRescheduleServerPreviewPlan.teacherTimePreparation?.status ||
      ''
  ).trim()
  const canOpenFixedRescheduleCommitConfirmModal = Boolean(
    fixedRescheduleServerPreview &&
      fixedRescheduleServerPreview.ok === true &&
      fixedRescheduleServerPreviewPayload &&
      fixedRescheduleServerPreviewIncludedLessons.length > 0 &&
      fixedRescheduleServerPreviewConflicts.length === 0 &&
      !['conflict', 'missing_info'].includes(fixedRescheduleCommitTeacherTimeStatus) &&
      !fixedRescheduleCommitBusy &&
      !fixedRescheduleCommitResult
  )
  const fixedRescheduleInspectorTargetConflicts = Array.isArray(
    fixedRescheduleInspectorResult?.targetConflicts?.conflicts
  )
    ? fixedRescheduleInspectorResult.targetConflicts.conflicts
    : []
  const fixedRescheduleInspectorWarnings = Array.isArray(
    fixedRescheduleInspectorResult?.dryRunPreview?.warnings
  )
    ? fixedRescheduleInspectorResult.dryRunPreview.warnings
    : []
  const fixedRescheduleInspectorCanProceed =
    fixedRescheduleInspectorResult?.readOnly === true &&
    fixedRescheduleInspectorResult?.consistency?.canProceedToCommitCandidate === true &&
    fixedRescheduleInspectorPayload?.requestId === fixedRescheduleServerPreviewPayload?.requestId &&
    fixedRescheduleInspectorTargetConflicts.length === 0
  const hasFixedRescheduleCommitFeedback = Boolean(
    fixedRescheduleCommitBusy || fixedRescheduleCommitResult || fixedRescheduleCommitError
  )
  const canInspectFixedRescheduleState = Boolean(
    canOpenFixedRescheduleCommitConfirmModal &&
      typeof onInspectFixedRescheduleStateOnServer === 'function' &&
      fixedRescheduleServerPreviewPayload &&
      fixedRescheduleServerPreview?.ok === true &&
      !fixedRescheduleInspectorBusy &&
      !fixedRescheduleCommitBusy &&
      !fixedRescheduleCommitResult
  )
  const canCommitFixedReschedule = Boolean(
    canOpenFixedRescheduleCommitConfirmModal &&
      typeof onCommitFixedReschedule === 'function' &&
      fixedRescheduleInspectorResult &&
      fixedRescheduleInspectorCanProceed &&
      !fixedRescheduleCommitBusy &&
      !fixedRescheduleCommitResult &&
      !fixedRescheduleCommitError
  )
  const fixedRescheduleCommitUpdated = fixedRescheduleCommitResult?.updated || {}
  const fixedRescheduleCommitUpdatedLessons = Array.isArray(fixedRescheduleCommitUpdated.lessons)
    ? fixedRescheduleCommitUpdated.lessons
    : []
  const fixedRescheduleCommitUpdatedSlots = Array.isArray(
    fixedRescheduleCommitUpdated.privateLessonSlots
  )
    ? fixedRescheduleCommitUpdated.privateLessonSlots
    : []
  const fixedRescheduleCommitUpdatedReservations = Array.isArray(
    fixedRescheduleCommitUpdated.privateLessonReservations
  )
    ? fixedRescheduleCommitUpdated.privateLessonReservations
    : []
  const fixedRescheduleUpdatedLessonIds = Array.isArray(fixedRescheduleCommitUpdated.lessons)
    ? fixedRescheduleCommitUpdated.lessons
    : []
  const updatedRescheduleLessonIds = useMemo(
    () =>
      new Set(
        fixedRescheduleUpdatedLessonIds
          .map((lesson) =>
            typeof lesson === 'string'
              ? lesson
              : lesson?.id || lesson?.lessonId || lesson?.fixedLessonId || ''
          )
          .map((lessonId) => String(lessonId || '').trim())
          .filter(Boolean)
      ),
    [fixedRescheduleUpdatedLessonIds]
  )
  const updatedRescheduleLessonCount = updatedRescheduleLessonIds.size
  const fixedRescheduleTargetTeacherOption = useMemo(() => {
    const draftKeys = getFixedRescheduleTeacherKeys({
      teacherId: fixedRescheduleTargetDraft.targetTeacherId,
      teacherKey: fixedRescheduleTargetDraft.targetTeacherKey,
      teacherName: fixedRescheduleTargetDraft.targetTeacherName,
      teacherUid: fixedRescheduleTargetDraft.targetTeacherUid,
    })
    return (
      teacherSelectOptions.find((option) => {
        const optionKeys = getTeacherOptionKeys(option)
        return draftKeys.some((key) => optionKeys.includes(key))
      }) || null
    )
  }, [fixedRescheduleTargetDraft, teacherSelectOptions])
  const fixedRescheduleServerPreviewTargetSummary =
    fixedRescheduleServerPreview?.includedLessons?.[0]?.target || {}

  useEffect(() => {
    if (
      showFixedRescheduleCommitConfirmModal &&
      !canOpenFixedRescheduleCommitConfirmModal &&
      !hasFixedRescheduleCommitFeedback &&
      !fixedRescheduleCommitBusy &&
      !fixedRescheduleCommitResult &&
      !fixedRescheduleCommitError
    ) {
      setShowFixedRescheduleCommitConfirmModal(false)
    }
  }, [
    canOpenFixedRescheduleCommitConfirmModal,
    fixedRescheduleCommitBusy,
    fixedRescheduleCommitError,
    fixedRescheduleCommitResult,
    hasFixedRescheduleCommitFeedback,
    showFixedRescheduleCommitConfirmModal,
  ])

  const selectedPrivateBoardTeacherOption = useMemo(() => {
    if (teacherSelectOptions.length === 0) return null
    return (
      teacherSelectOptions.find((option) => option.value === privateBoardTeacherValue) ||
      teacherSelectOptions[0]
    )
  }, [privateBoardTeacherValue, teacherSelectOptions])

  const privateBoardWeekDays = useMemo(
    () =>
      Array.from({ length: 6 }, (_, index) => {
        const date = addDaysToYmd(privateBoardWeekStart, index)
        return {
          date,
          label: `${date} (${getWeekdayShortLabel(date)})`,
        }
      }),
    [privateBoardWeekStart]
  )

  const privateBoardRows = useMemo(() => {
    if (!selectedPrivateBoardTeacherOption) return []
    const weekDateSet = new Set(privateBoardWeekDays.map((day) => day.date))
    const rowsByKey = new Map()
    const activeReservationsBySlotId = new Map()

    ;(Array.isArray(privateLessonReservations) ? privateLessonReservations : []).forEach(
      (reservation) => {
        if (!isActivePrivateReservation(reservation)) return
        const slotId = String(reservation.slotId || '').trim()
        if (slotId) activeReservationsBySlotId.set(slotId, reservation)
      }
    )

    const matchingSlots = (Array.isArray(privateLessonSlots) ? privateLessonSlots : []).filter(
      (slot) =>
        weekDateSet.has(String(slot.date || '').trim()) &&
        privateBoardRowMatchesTeacher(slot, selectedPrivateBoardTeacherOption)
    )
    const slotByDateTime = new Map()
    matchingSlots.forEach((slot) => {
      const key = getPrivateBoardSlotKey(slot)
      if (!slotByDateTime.has(key)) slotByDateTime.set(key, slot)
    })

    ;(Array.isArray(privateAvailabilityTemplates) ? privateAvailabilityTemplates : [])
      .filter((template) => String(template.status || 'active') === 'active')
      .filter((template) => privateBoardRowMatchesTeacher(template, selectedPrivateBoardTeacherOption))
      .forEach((template) => {
        const weekday = Number(template.weekday)
        const time = String(template.time || '').trim()
        if (!Number.isInteger(weekday) || weekday < 1 || weekday > 6 || !time) return
        const date = privateBoardWeekDays[weekday - 1]?.date || ''
        if (!date || !privateAvailabilityTemplateAppliesToDate(template, date)) return
        const key = getPrivateBoardSlotKey({ date, time })
        const existingSlot = slotByDateTime.get(key) || null
        const slot =
          existingSlot ||
          {
            id: buildPrivateTemplateSlotId({ templateId: template.id, date, time }),
            academyId: template.academyId,
            teacher: template.teacher,
            teacherName: template.teacherName,
            teacherKey: template.teacherKey,
            teacherUid: template.teacherUid || template.teacherUID || template.teacherId,
            teacherEmail: template.teacherEmail,
            date,
            time,
            durationMinutes: Number(template.durationMinutes || 60),
            status: 'open',
            slotType: 'template',
            availabilityTemplateId: template.id,
            isGeneratedFromTemplate: true,
            openForStudentBooking: template.openForStudentBooking === true,
            useForFixedAssignment: template.useForFixedAssignment !== false,
          }
        rowsByKey.set(key, {
          key,
          date,
          time,
          slot,
          template,
          reservation: activeReservationsBySlotId.get(slot.id) || null,
          fixedLesson: null,
          source: existingSlot ? 'slot' : 'template',
        })
      })

    matchingSlots.forEach((slot) => {
      const key = getPrivateBoardSlotKey(slot)
      if (rowsByKey.has(key)) return
      rowsByKey.set(key, {
        key,
        date: String(slot.date || '').trim(),
        time: String(slot.time || '').trim(),
        slot,
        template: null,
        reservation: activeReservationsBySlotId.get(slot.id) || null,
        fixedLesson: null,
        source: 'slot',
      })
    })

    ;(Array.isArray(privateFixedLessons) ? privateFixedLessons : [])
      .filter((lesson) => isFixedPrivateLesson(lesson))
      .filter((lesson) => !isCancelledLessonStatus(lesson.status))
      .filter((lesson) => weekDateSet.has(String(lesson.date || '').trim()))
      .filter((lesson) => privateBoardRowMatchesTeacher(lesson, selectedPrivateBoardTeacherOption))
      .forEach((lesson) => {
        const key = getPrivateBoardSlotKey(lesson)
        const existing = rowsByKey.get(key) || {}
        if (existing.reservation && !isFixedPrivateReservation(existing.reservation, existing.slot)) return
        if (existing.slot && isPrivateSlotClosedByTeacher(existing.slot)) return
        rowsByKey.set(key, {
          ...existing,
          key,
          date: String(lesson.date || '').trim(),
          time: String(lesson.time || '').trim(),
          slot: existing.slot || null,
          reservation: existing.reservation || null,
          fixedLesson: lesson,
          source: 'fixedLesson',
        })
      })

    return Array.from(rowsByKey.values()).sort((a, b) =>
      `${a.date || ''} ${a.time || ''}`.localeCompare(`${b.date || ''} ${b.time || ''}`, 'ko')
    )
  }, [
    privateAvailabilityTemplates,
    privateBoardWeekDays,
    privateFixedLessons,
    privateLessonReservations,
    privateLessonSlots,
    selectedPrivateBoardTeacherOption,
  ])

  const showPrivateBoardActions = canManagePrivateSlots === true
  const privateBoardGridTemplate = showPrivateBoardActions
    ? '0.85fr 0.55fr 0.8fr 1fr 1fr minmax(150px, auto)'
    : '0.85fr 0.55fr 0.8fr 1fr 1fr'

  return (
    <section className="activity-section" data-testid="private-slots-section">
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
          1:1 예약 시간 관리
        </h2>
      </div>

      {canManagePrivateSlots ? (
        <>
          <section
            data-testid="private-time-management-teacher-time-group"
            style={{
              display: 'grid',
              gap: 16,
              padding: 18,
              border: '1px solid #3b4152',
              borderRadius: 14,
              background: '#101722',
              marginBottom: 22,
            }}
          >
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>선생님 1:1 시간 만들기</h3>
            <p
              data-testid="private-time-management-teacher-time-copy"
              style={{ margin: '8px 0 0 0', opacity: 0.78, fontSize: 13, lineHeight: 1.6 }}
            >
              선생님이 수업할 수 있는 시간을 등록하고 확인합니다.
              <br />
              학생 수강권 기간과 상관없이 미리 길게 등록할 수 있습니다.
              <br />
              학생은 자신의 수강권 기간 안에 있는 날짜만 예약할 수 있습니다.
              <br />
              학생 직접 예약 허용을 켠 시간만 학생 화면에 공개됩니다.
              <br />
              고정 수업 배정용은 학생 고정 배정에서 사용할 수 있는 시간입니다.
            </p>
          </div>
          <details
            open
            data-testid="private-time-management-teacher-board-panel"
            style={{
              display: 'grid',
              gap: 12,
              padding: 14,
              border: '1px solid #2e3240',
              borderRadius: 10,
              background: '#111722',
            }}
          >
            <summary
              style={{
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 15,
                color: '#f2f5ff',
              }}
            >
              선생님별 시간표/예약판
            </summary>
            <p
              style={{ margin: 0, opacity: 0.74, fontSize: 12, lineHeight: 1.55 }}
            >
              선생님별 주간 1:1 시간표와 예약판을 확인합니다. 예약된 수업과 빈 시간을 한 화면에서 관리합니다.
            </p>
      {isAdmin || selectedPrivateBoardTeacherOption ? (
          <section
            data-testid="private-teacher-weekly-board-section"
            style={{
              display: 'grid',
              gap: 12,
              padding: 16,
              border: '1px solid #3b4152',
              borderRadius: 10,
              background: '#141b28',
              marginBottom: 20,
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: 16 }}>
                {showPrivateBoardActions ? '선생님별 1:1 시간표/예약판' : '내 주간 1:1 시간표'}
              </h3>
              <p style={{ margin: '6px 0 0 0', opacity: 0.74, fontSize: 12, lineHeight: 1.5 }}>
                {showPrivateBoardActions
                  ? '학생 예약 화면처럼 선생님별 주간 슬롯을 보고, 예약된 수업과 빈 주간 슬롯을 해당 날짜만 수업불가로 닫거나 다시 엽니다.'
                  : '본인에게 연결된 주간 1:1 시간표와 예약 상태를 읽기 전용으로 확인합니다.'}
              </p>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(180px, 1fr) minmax(220px, auto)',
                gap: 12,
                alignItems: 'end',
              }}
            >
              <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                선생님
                <select
                  value={selectedPrivateBoardTeacherOption?.value || ''}
                  data-testid="private-teacher-weekly-board-teacher-select"
                  onChange={(event) => setPrivateBoardTeacherValue(event.target.value)}
                  disabled={!showPrivateBoardActions}
                >
                  {teacherSelectOptions.length === 0 ? (
                    <option value="">선생님 없음</option>
                  ) : null}
                  {teacherSelectOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  data-testid="private-teacher-weekly-board-prev-week-button"
                  onClick={() => setPrivateBoardWeekStart((prev) => addDaysToYmd(prev, -7))}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#252a35',
                    color: 'white',
                  }}
                >
                  이전 주
                </button>
                <button
                  type="button"
                  data-testid="private-teacher-weekly-board-this-week-button"
                  onClick={() => setPrivateBoardWeekStart(getMondayYmd())}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#252a35',
                    color: 'white',
                  }}
                >
                  이번 주
                </button>
                <button
                  type="button"
                  data-testid="private-teacher-weekly-board-next-week-button"
                  onClick={() => setPrivateBoardWeekStart((prev) => addDaysToYmd(prev, 7))}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#252a35',
                    color: 'white',
                  }}
                >
                  다음 주
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', opacity: 0.72, fontSize: 12 }}>
              {privateBoardWeekDays.map((day) => (
                <span key={day.date}>{day.label}</span>
              ))}
            </div>
            {privateLessonSlotsLoading || privateLessonReservationsLoading || privateAvailabilityTemplatesLoading ? (
              <p style={{ margin: 0, opacity: 0.76 }}>예약판을 불러오는 중...</p>
            ) : !selectedPrivateBoardTeacherOption ? (
              <p style={{ margin: 0, opacity: 0.76 }}>선생님을 먼저 등록해 주세요.</p>
            ) : privateBoardRows.length === 0 ? (
              <p style={{ margin: 0, opacity: 0.76 }}>해당 주에 표시할 1:1 시간이 없습니다.</p>
            ) : (
              <div className="activity-table">
                <div
                  className="table-head"
                  style={{ gridTemplateColumns: privateBoardGridTemplate }}
                >
                  <span>날짜</span>
                  <span>시간</span>
                  <span>상태</span>
                  <span>내용</span>
                  <span>출처</span>
                  {showPrivateBoardActions ? <span>작업</span> : null}
                </div>
                {privateBoardRows.map((row) => {
                  const statusLabel = getPrivateBoardSlotStatusLabel(row)
                  const isClosed = statusLabel === '선생님 수업불가로 닫힘'
                  const busy =
                    (row.slot?.id && busyPrivateSlotActionId === row.slot.id) ||
                    (row.fixedLesson?.id && busyFixedPrivateLessonCancelId === row.fixedLesson.id)
                  const sourceLabel =
                    row.source === 'fixedLesson'
                      ? '고정 수업'
                      : row.source === 'template'
                        ? '주간 시간표'
                        : row.slot?.isGeneratedFromTemplate
                          ? '주간 시간표'
                          : '날짜별 슬롯'
                  return (
                    <div
                      key={row.key}
                      className="table-row"
                      data-testid="private-teacher-weekly-board-slot-row"
                      data-slot-id={row.slot?.id || ''}
                      data-lesson-id={row.fixedLesson?.id || ''}
                      data-date={row.date || ''}
                      data-time={row.time || ''}
                      style={{ gridTemplateColumns: privateBoardGridTemplate }}
                    >
                      <span>{row.date || '-'}</span>
                      <span>{row.time || '-'}</span>
                      <span data-testid="private-teacher-weekly-board-slot-status">
                        {statusLabel}
                      </span>
                      <span>{getPrivateBoardSlotDetail(row)}</span>
                      <span>
                        {sourceLabel}
                        {row.slot?.openForStudentBooking === true ? (
                          <span style={{ display: 'block', marginTop: 4, opacity: 0.7, fontSize: 12 }}>
                            학생 직접 예약 허용
                          </span>
                        ) : null}
                      </span>
                      {showPrivateBoardActions ? (
                        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {isClosed ? (
                            <button
                              type="button"
                              disabled={busy}
                              data-testid="private-teacher-weekly-board-reopen-button"
                              onClick={() => reopenPrivateLessonSlot?.(row.slot)}
                              style={{
                                padding: '6px 10px',
                                borderRadius: 8,
                                border: '1px solid #456034',
                                background: '#2d4d2d',
                                color: 'white',
                                cursor: busy ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {busy ? '처리 중...' : '수업불가 해제'}
                            </button>
                          ) : (
                            <>
                              {row.reservation || row.fixedLesson ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  data-testid="private-teacher-weekly-board-release-button"
                                  onClick={() => {
                                    if (row.fixedLesson) {
                                      onCancelFixedPrivateLesson?.(row.fixedLesson, 'seat_released')
                                      return
                                    }
                                    cancelPrivateSlotOrReservation(row.slot, row.reservation)
                                  }}
                                  style={{
                                    padding: '6px 10px',
                                    borderRadius: 8,
                                    border: '1px solid #553333',
                                    background: '#4a2a2a',
                                    color: 'white',
                                    cursor: busy ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  {busy ? '처리 중...' : '예약 취소 후 공개'}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                disabled={busy}
                                data-testid="private-teacher-weekly-board-close-button"
                                onClick={() => {
                                  if (row.reservation) {
                                    cancelPrivateSlotOrReservation(row.slot, row.reservation, {
                                      closeAsTeacherUnavailable: true,
                                    })
                                    return
                                  }
                                  if (row.fixedLesson) {
                                    onCancelFixedPrivateLesson?.(row.fixedLesson, 'lesson_cancelled', {
                                      reason: 'teacher_unavailable',
                                    })
                                    return
                                  }
                                  closePrivateLessonSlot?.(row.slot)
                                }}
                                style={{
                                  padding: '6px 10px',
                                  borderRadius: 8,
                                  border: '1px solid #6b4d2a',
                                  background: '#4a351f',
                                  color: 'white',
                                  cursor: busy ? 'not-allowed' : 'pointer',
                                }}
                              >
                                {busy ? '처리 중...' : '수업불가로 닫기'}
                              </button>
                            </>
                          )}
                        </span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
            <p style={{ margin: 0, opacity: 0.65, fontSize: 12 }}>
              {showPrivateBoardActions
                ? '“예약 취소 후 공개”는 다른 학생에게 열고, “수업불가로 닫기”는 누구에게도 열지 않습니다. “수업불가 해제”는 해당 날짜/시간만 다시 예약 가능하게 엽니다.'
                : '이 화면은 읽기 전용입니다. 수업불가 닫기/해제와 예약 조작은 관리자만 할 수 있습니다.'}
            </p>
          </section>
      ) : null}
          </details>

          <details
            data-testid="private-time-management-bulk-create-panel"
            style={{
              display: 'grid',
              gap: 12,
              padding: 14,
              border: '1px solid #2e3240',
              borderRadius: 10,
              background: '#111722',
            }}
          >
            <summary
              data-testid="private-time-management-bulk-create-summary"
              style={{
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 15,
                color: '#f2f5ff',
              }}
            >
              빠른 일괄 추가
            </summary>
            <p
              style={{ margin: 0, opacity: 0.74, fontSize: 12, lineHeight: 1.55 }}
            >
              여러 요일과 여러 시간을 한 번에 등록합니다.
              <br />
              요일 1개와 시간 1개만 입력하면 개별 추가처럼 사용할 수 있습니다.
              <br />
              학생 직접 예약 허용을 켠 시간만 학생 화면에 공개됩니다.
              <br />
              고정 수업 배정용은 학생 고정 배정에서 사용할 수 있습니다.
            </p>

          <section
            data-testid="private-weekly-slot-bulk-section"
            style={{
              display: 'grid',
              gap: 12,
              padding: 16,
              border: '1px solid #2e3240',
              borderRadius: 8,
              background: '#151922',
              marginBottom: 20,
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: 16 }}>주간 1:1 시간표 일괄 등록</h3>
              <p style={{ margin: '6px 0 0 0', opacity: 0.74, fontSize: 12 }}>
                선생님별 반복 요일과 시작 시간을 한 번에 등록합니다. 학생 화면에는 기존처럼
                이번 주와 다음 주 범위만 표시됩니다.
              </p>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                createPrivateAvailabilityBulkTemplates()
              }}
              style={{
                display: 'grid',
                gap: 12,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                  gap: 12,
                }}
              >
                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  선생님
                  <select
                    value={privateAvailabilityBulkForm.teacher}
                    data-testid="private-weekly-bulk-teacher-select"
                    onChange={(event) =>
                      setPrivateAvailabilityBulkForm((prev) => ({
                        ...prev,
                        teacher: event.target.value,
                      }))
                    }
                  >
                    <option value="">선택</option>
                    {teacherSelectOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {privateAvailabilityBulkErrors.teacher ? (
                    <span style={{ color: '#f4a7a7' }}>
                      {privateAvailabilityBulkErrors.teacher}
                    </span>
                  ) : null}
                </label>

                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  분
                  <input
                    type="number"
                    min="10"
                    max="180"
                    step="5"
                    value={privateAvailabilityBulkForm.durationMinutes}
                    data-testid="private-weekly-bulk-duration-input"
                    onChange={(event) =>
                      setPrivateAvailabilityBulkForm((prev) => ({
                        ...prev,
                        durationMinutes: event.target.value,
                      }))
                    }
                  />
                  {privateAvailabilityBulkErrors.durationMinutes ? (
                    <span style={{ color: '#f4a7a7' }}>
                      {privateAvailabilityBulkErrors.durationMinutes}
                    </span>
                  ) : null}
                </label>

                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  상태
                  <select
                    value={privateAvailabilityBulkForm.status}
                    data-testid="private-weekly-bulk-status-select"
                    onChange={(event) =>
                      setPrivateAvailabilityBulkForm((prev) => ({
                        ...prev,
                        status: event.target.value,
                      }))
                    }
                  >
                    <option value="active">사용</option>
                    <option value="inactive">비활성</option>
                  </select>
                </label>

                <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  <span>용도</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={privateAvailabilityBulkForm.useForFixedAssignment !== false}
                      data-testid="private-weekly-bulk-use-fixed-checkbox"
                      onChange={(event) =>
                        setPrivateAvailabilityBulkForm((prev) => ({
                          ...prev,
                          useForFixedAssignment: event.target.checked,
                        }))
                      }
                    />
                    고정 수업 배정용
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={privateAvailabilityBulkForm.openForStudentBooking === true}
                      data-testid="private-weekly-bulk-open-booking-checkbox"
                      onChange={(event) =>
                        setPrivateAvailabilityBulkForm((prev) => ({
                          ...prev,
                          openForStudentBooking: event.target.checked,
                        }))
                      }
                    />
                    학생 직접 예약 허용
                  </label>
                  {privateAvailabilityBulkErrors.usage ? (
                    <span style={{ color: '#f4a7a7' }}>
                      {privateAvailabilityBulkErrors.usage}
                    </span>
                  ) : null}
                </div>

                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  시작일
                  <input
                    type="date"
                    value={privateAvailabilityBulkForm.effectiveStartDate}
                    data-testid="private-weekly-bulk-start-date-input"
                    onChange={(event) =>
                      setPrivateAvailabilityBulkForm((prev) => ({
                        ...prev,
                        effectiveStartDate: event.target.value,
                      }))
                    }
                  />
                  {privateAvailabilityBulkErrors.effectiveStartDate ? (
                    <span style={{ color: '#f4a7a7' }}>
                      {privateAvailabilityBulkErrors.effectiveStartDate}
                    </span>
                  ) : null}
                </label>

                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  종료일
                  <input
                    type="date"
                    value={privateAvailabilityBulkForm.effectiveEndDate}
                    data-testid="private-weekly-bulk-end-date-input"
                    onChange={(event) =>
                      setPrivateAvailabilityBulkForm((prev) => ({
                        ...prev,
                        effectiveEndDate: event.target.value,
                      }))
                    }
                  />
                  {privateAvailabilityBulkErrors.effectiveEndDate ? (
                    <span style={{ color: '#f4a7a7' }}>
                      {privateAvailabilityBulkErrors.effectiveEndDate}
                    </span>
                  ) : null}
                </label>
              </div>

              <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                <span>요일</span>
                <div
                  data-testid="private-weekly-bulk-weekday-group"
                  style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}
                >
                  {PRIVATE_WEEKLY_SLOT_WEEKDAYS.map((option) => (
                    <label
                      key={option.value}
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <input
                        type="checkbox"
                        value={option.value}
                        checked={(privateAvailabilityBulkForm.weekdays || []).includes(option.value)}
                        data-testid={`private-weekly-bulk-weekday-${option.value}`}
                        onChange={(event) =>
                          setPrivateAvailabilityBulkForm((prev) => {
                            const current = Array.isArray(prev.weekdays) ? prev.weekdays : []
                            const next = event.target.checked
                              ? [...current, option.value]
                              : current.filter((value) => value !== option.value)
                            return { ...prev, weekdays: next }
                          })
                        }
                      />
                      {option.shortLabel}
                    </label>
                  ))}
                  <span style={{ opacity: 0.62 }}>일요일은 현재 예약 정책상 제외</span>
                </div>
                {privateAvailabilityBulkErrors.weekdays ? (
                  <span style={{ color: '#f4a7a7' }}>
                    {privateAvailabilityBulkErrors.weekdays}
                  </span>
                ) : null}
              </div>

              <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                시작 시간 목록
                <textarea
                  value={privateAvailabilityBulkForm.timesText}
                  data-testid="private-weekly-bulk-times-input"
                  placeholder="13:00, 14:10, 15:20, 16:30"
                  rows={3}
                  onChange={(event) =>
                    setPrivateAvailabilityBulkForm((prev) => ({
                      ...prev,
                      timesText: event.target.value,
                    }))
                  }
                  style={{ resize: 'vertical' }}
                />
                {privateAvailabilityBulkErrors.timesText ? (
                  <span style={{ color: '#f4a7a7' }}>
                    {privateAvailabilityBulkErrors.timesText}
                  </span>
                ) : null}
              </label>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={previewPrivateAvailabilityBulkTemplates}
                  disabled={busyPrivateAvailabilityTemplateId === '__bulk__'}
                  data-testid="private-weekly-bulk-preview-button"
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#252a35',
                    color: 'white',
                    cursor:
                      busyPrivateAvailabilityTemplateId === '__bulk__' ? 'not-allowed' : 'pointer',
                  }}
                >
                  미리보기
                </button>
                <button
                  type="submit"
                  disabled={busyPrivateAvailabilityTemplateId === '__bulk__'}
                  data-testid="private-weekly-bulk-submit-button"
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid #456034',
                    background: '#2d4d2d',
                    color: 'white',
                    cursor:
                      busyPrivateAvailabilityTemplateId === '__bulk__' ? 'not-allowed' : 'pointer',
                  }}
                >
                  {busyPrivateAvailabilityTemplateId === '__bulk__' ? '등록 중...' : '등록'}
                </button>
              </div>

              {privateAvailabilityBulkResult ? (
                <div
                  data-testid="private-weekly-bulk-result"
                  style={{ color: '#b8f7c0', fontSize: 13 }}
                >
                  {privateAvailabilityBulkResult.mode === 'preview'
                    ? '미리보기 · '
                    : privateAvailabilityBulkResult.mode === 'blocked'
                      ? '등록 중단 · '
                      : ''}
                  생성 {privateAvailabilityBulkResult.createdCount}개 · 중복 제외{' '}
                  {privateAvailabilityBulkResult.skippedDuplicateCount}개 · 시간 겹침 제외{' '}
                  {privateAvailabilityBulkResult.skippedOverlapCount}개 · 오류{' '}
                  {privateAvailabilityBulkResult.errorCount}개
                  {privateAvailabilityBulkResult.effectiveStartDate &&
                  privateAvailabilityBulkResult.effectiveEndDate
                    ? ` · 기간: ${privateAvailabilityBulkResult.effectiveStartDate} ~ ${privateAvailabilityBulkResult.effectiveEndDate}`
                    : ''}
                  {Array.isArray(privateAvailabilityBulkResult.conflictMessages) &&
                  privateAvailabilityBulkResult.conflictMessages.length > 0 ? (
                    <div style={{ display: 'grid', gap: 8, marginTop: 8, color: '#f4d48f' }}>
                      {privateAvailabilityBulkResult.conflictMessages.map((message) => (
                        <pre
                          key={message}
                          style={{
                            margin: 0,
                            whiteSpace: 'pre-wrap',
                            fontFamily: 'inherit',
                            lineHeight: 1.5,
                          }}
                        >
                          {message}
                        </pre>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </form>
          </section>
          </details>

          <details
            open
            data-testid="private-time-management-weekly-template-panel"
            style={{
              display: 'grid',
              gap: 12,
              padding: 14,
              border: '1px solid #2e3240',
              borderRadius: 10,
              background: '#111722',
            }}
          >
            <summary
              data-testid="private-time-management-weekly-template-summary"
              style={{
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 15,
                color: '#f2f5ff',
              }}
            >
              기존 반복 시간표
            </summary>
            <p
              style={{ margin: 0, opacity: 0.74, fontSize: 12, lineHeight: 1.55 }}
            >
              등록된 선생님의 반복 1:1 시간을 확인하고 수정/비활성화합니다.
            </p>

          <section
            data-testid="private-availability-template-section"
            style={{
              display: 'grid',
              gap: 12,
              padding: 16,
              border: '1px solid #2e3240',
              borderRadius: 8,
              background: '#151922',
              marginBottom: 20,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16 }}>선생님 주간 1:1 시간표</h3>
            <p style={{ margin: 0, opacity: 0.74, fontSize: 12, lineHeight: 1.5 }}>
              선생님의 반복 가능한 1:1 요일과 시간을 만들고, 그 시간에 학생을 고정 배정합니다.
              <br />
              학생 직접 예약 허용은 학생이 직접 예약할 수 있는 공개 시간입니다.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                createPrivateAvailabilityTemplate()
              }}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 12,
              }}
            >
              <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                선생님
                <select
                  value={privateAvailabilityTemplateForm.teacher}
                  data-testid="private-availability-template-teacher-select"
                  onChange={(event) =>
                    setPrivateAvailabilityTemplateForm((prev) => ({
                      ...prev,
                      teacher: event.target.value,
                    }))
                  }
                >
                  <option value="">선택</option>
                  {teacherSelectOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {privateAvailabilityTemplateErrors.teacher ? (
                  <span style={{ color: '#f4a7a7' }}>
                    {privateAvailabilityTemplateErrors.teacher}
                  </span>
                ) : null}
              </label>
              <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                요일
                <select
                  value={privateAvailabilityTemplateForm.weekday}
                  data-testid="private-availability-template-weekday"
                  onChange={(event) =>
                    setPrivateAvailabilityTemplateForm((prev) => ({
                      ...prev,
                      weekday: event.target.value,
                    }))
                  }
                >
                  {WEEKDAY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {privateAvailabilityTemplateErrors.weekday ? (
                  <span style={{ color: '#f4a7a7' }}>
                    {privateAvailabilityTemplateErrors.weekday}
                  </span>
                ) : null}
              </label>
              <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                시간
                <input
                  type="time"
                  value={privateAvailabilityTemplateForm.time}
                  data-testid="private-availability-template-time"
                  onChange={(event) =>
                    setPrivateAvailabilityTemplateForm((prev) => ({
                      ...prev,
                      time: event.target.value,
                    }))
                  }
                />
                {privateAvailabilityTemplateErrors.time ? (
                  <span style={{ color: '#f4a7a7' }}>{privateAvailabilityTemplateErrors.time}</span>
                ) : null}
              </label>
              <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                분
                <input
                  type="number"
                  min="10"
                  max="240"
                  step="5"
                  value={privateAvailabilityTemplateForm.durationMinutes}
                  onChange={(event) =>
                    setPrivateAvailabilityTemplateForm((prev) => ({
                      ...prev,
                      durationMinutes: event.target.value,
                    }))
                  }
                />
                {privateAvailabilityTemplateErrors.durationMinutes ? (
                  <span style={{ color: '#f4a7a7' }}>
                    {privateAvailabilityTemplateErrors.durationMinutes}
                  </span>
                ) : null}
              </label>
              <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                시작일
                <input
                  type="date"
                  value={privateAvailabilityTemplateForm.effectiveStartDate || ''}
                  data-testid="private-availability-template-start-date-input"
                  onChange={(event) =>
                    setPrivateAvailabilityTemplateForm((prev) => ({
                      ...prev,
                      effectiveStartDate: event.target.value,
                    }))
                  }
                />
                {privateAvailabilityTemplateErrors.effectiveStartDate ? (
                  <span style={{ color: '#f4a7a7' }}>
                    {privateAvailabilityTemplateErrors.effectiveStartDate}
                  </span>
                ) : null}
              </label>
              <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                종료일
                <input
                  type="date"
                  value={privateAvailabilityTemplateForm.effectiveEndDate || ''}
                  data-testid="private-availability-template-end-date-input"
                  onChange={(event) =>
                    setPrivateAvailabilityTemplateForm((prev) => ({
                      ...prev,
                      effectiveEndDate: event.target.value,
                    }))
                  }
                />
                {privateAvailabilityTemplateErrors.effectiveEndDate ? (
                  <span style={{ color: '#f4a7a7' }}>
                    {privateAvailabilityTemplateErrors.effectiveEndDate}
                  </span>
                ) : null}
              </label>
              <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                상태
                <select
                  value={privateAvailabilityTemplateForm.status}
                  data-testid="private-availability-template-status"
                  onChange={(event) =>
                    setPrivateAvailabilityTemplateForm((prev) => ({
                      ...prev,
                      status: event.target.value,
                    }))
                  }
                >
                  <option value="active">사용</option>
                  <option value="inactive">중지</option>
                </select>
              </label>
              <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                <span>용도</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={privateAvailabilityTemplateForm.useForFixedAssignment !== false}
                    data-testid="private-availability-template-use-fixed-checkbox"
                    onChange={(event) =>
                      setPrivateAvailabilityTemplateForm((prev) => ({
                        ...prev,
                        useForFixedAssignment: event.target.checked,
                      }))
                    }
                  />
                  고정 수업 배정용
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={privateAvailabilityTemplateForm.openForStudentBooking === true}
                    data-testid="private-availability-template-open-booking-checkbox"
                    onChange={(event) =>
                      setPrivateAvailabilityTemplateForm((prev) => ({
                        ...prev,
                        openForStudentBooking: event.target.checked,
                      }))
                    }
                  />
                  학생 직접 예약 허용
                </label>
                {privateAvailabilityTemplateErrors.usage ? (
                  <span style={{ color: '#f4a7a7' }}>
                    {privateAvailabilityTemplateErrors.usage}
                  </span>
                ) : null}
              </div>
              <div style={{ display: 'flex', alignItems: 'end' }}>
                <button
                  type="submit"
                  disabled={busyPrivateAvailabilityTemplateId === '__add__'}
                  data-testid="private-availability-template-add-button"
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid #456034',
                    background: '#2d4d2d',
                    color: 'white',
                    cursor:
                      busyPrivateAvailabilityTemplateId === '__add__' ? 'not-allowed' : 'pointer',
                    width: '100%',
                  }}
                >
                  {busyPrivateAvailabilityTemplateId === '__add__' ? '추가 중...' : '추가'}
                </button>
              </div>
              {privateAvailabilityTemplateErrors.form ? (
                <div
                  data-testid="private-availability-template-form-error"
                  style={{
                    gridColumn: '1 / -1',
                    color: '#f4d48f',
                    fontSize: 13,
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.5,
                  }}
                >
                  {privateAvailabilityTemplateErrors.form}
                </div>
              ) : null}
            </form>
            <div
              style={{
                display: 'grid',
                gap: 8,
                padding: 12,
                border: '1px solid #2e3240',
                borderRadius: 8,
                background: '#111722',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={showPastPrivateWeeklyTemplates}
                  data-testid="private-weekly-template-history-toggle"
                  onChange={(event) => setShowPastPrivateWeeklyTemplates(event.target.checked)}
                />
                지난/비활성 포함
              </label>
              <p style={{ margin: 0, opacity: 0.74, fontSize: 12, lineHeight: 1.5 }}>
                기본으로 현재 사용 중이거나 앞으로 사용할 반복 시간표만 표시합니다.
                <br />
                지난 기간 또는 비활성 시간표는 “지난/비활성 포함”을 켜면 다시 볼 수 있습니다.
              </p>
              {!showPastPrivateWeeklyTemplates && hiddenPrivateAvailabilityTemplateCount > 0 ? (
                <p
                  data-testid="private-weekly-template-hidden-count"
                  style={{ margin: 0, opacity: 0.72, fontSize: 12, color: '#d7def0' }}
                >
                  숨김 {hiddenPrivateAvailabilityTemplateCount}개 · 지난/비활성 포함을 켜면
                  표시됩니다.
                </p>
              ) : null}
            </div>
            {privateAvailabilityTemplatesLoading ? (
              <p style={{ margin: 0, opacity: 0.76 }}>불러오는 중...</p>
            ) : privateAvailabilityTemplates.length === 0 ? (
              <p
                data-testid={
                  showPastPrivateWeeklyTemplates
                    ? 'private-weekly-template-empty-all'
                    : 'private-weekly-template-empty-current'
                }
                style={{ margin: 0, opacity: 0.76, lineHeight: 1.5 }}
              >
                {showPastPrivateWeeklyTemplates
                  ? '등록된 반복 시간표가 없습니다.'
                  : '현재/예정 반복 시간표가 없습니다.'}
                {!showPastPrivateWeeklyTemplates ? (
                  <>
                    <br />
                    지난/비활성 포함을 켜면 과거/비활성 시간표를 확인할 수 있습니다.
                  </>
                ) : null}
              </p>
            ) : visiblePrivateAvailabilityTemplates.length === 0 ? (
              <p
                data-testid="private-weekly-template-empty-current"
                style={{ margin: 0, opacity: 0.76, lineHeight: 1.5 }}
              >
                현재/예정 반복 시간표가 없습니다.
                <br />
                지난/비활성 포함을 켜면 과거/비활성 시간표를 확인할 수 있습니다.
              </p>
            ) : (
              <div
                data-testid="private-weekly-template-visible-list"
                style={{ display: 'grid', gap: 8 }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 0.7fr 0.7fr 0.7fr 0.9fr 1.1fr 1fr 1.3fr',
                    gap: 8,
                    alignItems: 'center',
                    opacity: 0.72,
                    fontSize: 12,
                    padding: '0 10px',
                  }}
                >
                  <span>선생님</span>
                  <span>요일</span>
                  <span>시간</span>
                  <span>분</span>
                  <span>상태</span>
                  <span>용도</span>
                  <span>기간</span>
                  <span>작업</span>
                </div>
                {visiblePrivateAvailabilityTemplates.map((template) => {
                  const busy = busyPrivateAvailabilityTemplateId === template.id
                  const status = normalizePrivateWeeklyTemplateStatus(template)
                  const editing = editingAvailabilityTemplateId === template.id
                  return (
                    <Fragment key={template.id}>
                      <div
                        data-testid="private-availability-template-row"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 0.7fr 0.7fr 0.7fr 0.9fr 1.1fr 1fr 1.3fr',
                          gap: 8,
                          alignItems: 'center',
                          border: '1px solid #2e3240',
                          borderRadius: 8,
                          padding: 10,
                        }}
                      >
                        <span>{getPrivateSlotTeacherDisplay(template)}</span>
                        <span>{weekdayLabel(template.weekday)}</span>
                        <span>{template.time || '-'}</span>
                        <span>{Number(template.durationMinutes || 0) || '-'}분</span>
                        <span data-testid="private-availability-template-status-cell">
                          {status === 'active' ? '사용' : '비활성'}
                        </span>
                        <span data-testid="private-availability-template-usage-cell">
                          {getTemplateUsageLabel(template)}
                        </span>
                        <span data-testid="private-availability-template-period-cell">
                          {template.effectiveStartDate && template.effectiveEndDate
                            ? `${template.effectiveStartDate} ~ ${template.effectiveEndDate}`
                            : '기간 제한 없음'}
                        </span>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            disabled={busy}
                            data-testid="private-availability-template-edit-button"
                            onClick={() => openAvailabilityTemplateEdit(template)}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: '1px solid #555',
                              background: '#242a38',
                              color: 'white',
                              cursor: busy ? 'not-allowed' : 'pointer',
                            }}
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            data-testid="private-availability-template-status-toggle-button"
                            onClick={() =>
                              updatePrivateAvailabilityTemplateStatus(
                                template,
                                status === 'active' ? 'inactive' : 'active'
                              )
                            }
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: '1px solid #444',
                              background: '#1f2a44',
                              color: 'white',
                              cursor: busy ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {busy ? '처리 중...' : status === 'active' ? '비활성화' : '사용'}
                          </button>
                        </div>
                      </div>
                      {editing ? (
                        <form
                          data-testid="private-availability-template-edit-form"
                          onSubmit={(event) => {
                            event.preventDefault()
                            saveAvailabilityTemplateEdit(template)
                          }}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                            gap: 12,
                            border: '1px solid #3c4354',
                            borderRadius: 8,
                            padding: 12,
                            background: '#111722',
                          }}
                        >
                          <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                            시작일
                            <input
                              type="date"
                              value={editingAvailabilityTemplateForm.effectiveStartDate}
                              data-testid="private-availability-template-edit-start-date-input"
                              onChange={(event) =>
                                setEditingAvailabilityTemplateForm((prev) => ({
                                  ...prev,
                                  effectiveStartDate: event.target.value,
                                }))
                              }
                            />
                            {editingAvailabilityTemplateErrors.effectiveStartDate ? (
                              <span style={{ color: '#f4a7a7' }}>
                                {editingAvailabilityTemplateErrors.effectiveStartDate}
                              </span>
                            ) : null}
                          </label>
                          <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                            종료일
                            <input
                              type="date"
                              value={editingAvailabilityTemplateForm.effectiveEndDate}
                              data-testid="private-availability-template-edit-end-date-input"
                              onChange={(event) =>
                                setEditingAvailabilityTemplateForm((prev) => ({
                                  ...prev,
                                  effectiveEndDate: event.target.value,
                                }))
                              }
                            />
                            {editingAvailabilityTemplateErrors.effectiveEndDate ? (
                              <span style={{ color: '#f4a7a7' }}>
                                {editingAvailabilityTemplateErrors.effectiveEndDate}
                              </span>
                            ) : null}
                          </label>
                          <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                            상태
                            <select
                              value={editingAvailabilityTemplateForm.status}
                              data-testid="private-availability-template-edit-status-select"
                              onChange={(event) =>
                                setEditingAvailabilityTemplateForm((prev) => ({
                                  ...prev,
                                  status: event.target.value,
                                }))
                              }
                            >
                              <option value="active">사용</option>
                              <option value="inactive">중지</option>
                            </select>
                            {editingAvailabilityTemplateErrors.status ? (
                              <span style={{ color: '#f4a7a7' }}>
                                {editingAvailabilityTemplateErrors.status}
                              </span>
                            ) : null}
                          </label>
                          <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                            <span>용도</span>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input
                                type="checkbox"
                                checked={editingAvailabilityTemplateForm.useForFixedAssignment !== false}
                                data-testid="private-availability-template-edit-use-fixed-checkbox"
                                onChange={(event) =>
                                  setEditingAvailabilityTemplateForm((prev) => ({
                                    ...prev,
                                    useForFixedAssignment: event.target.checked,
                                  }))
                                }
                              />
                              고정 수업 배정용
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input
                                type="checkbox"
                                checked={editingAvailabilityTemplateForm.openForStudentBooking === true}
                                data-testid="private-availability-template-edit-open-booking-checkbox"
                                onChange={(event) =>
                                  setEditingAvailabilityTemplateForm((prev) => ({
                                    ...prev,
                                    openForStudentBooking: event.target.checked,
                                  }))
                                }
                              />
                              학생 직접 예약 허용
                            </label>
                            {editingAvailabilityTemplateErrors.usage ? (
                              <span style={{ color: '#f4a7a7' }}>
                                {editingAvailabilityTemplateErrors.usage}
                              </span>
                            ) : null}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
                            <button
                              type="submit"
                              disabled={busy}
                              data-testid="private-availability-template-edit-save-button"
                              style={{
                                padding: '8px 12px',
                                borderRadius: 8,
                                border: '1px solid #456034',
                                background: '#2d4d2d',
                                color: 'white',
                                cursor: busy ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {busy ? '저장 중...' : '저장'}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              data-testid="private-availability-template-edit-cancel-button"
                              onClick={() => {
                                setEditingAvailabilityTemplateId('')
                                setEditingAvailabilityTemplateErrors({})
                              }}
                              style={{
                                padding: '8px 12px',
                                borderRadius: 8,
                                border: '1px solid #444',
                                background: '#242a38',
                                color: 'white',
                                cursor: busy ? 'not-allowed' : 'pointer',
                              }}
                            >
                              취소
                            </button>
                          </div>
                          {editingAvailabilityTemplateErrors.form ? (
                            <div style={{ color: '#f4a7a7', fontSize: 13 }}>
                              {editingAvailabilityTemplateErrors.form}
                            </div>
                          ) : null}
                        </form>
                      ) : null}
                    </Fragment>
                  )
                })}
              </div>
            )}
          </section>
          </details>

          <details
            data-testid="private-time-management-dated-slot-panel"
            style={{
              display: 'grid',
              gap: 12,
              padding: 14,
              border: '1px solid #2e3240',
              borderRadius: 10,
              background: '#111722',
            }}
          >
            <summary
              data-testid="private-time-management-dated-slot-summary"
              style={{
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 15,
                color: '#f2f5ff',
              }}
            >
              날짜별/임시 예약 가능 시간
            </summary>
            <p
              style={{ margin: 0, opacity: 0.74, fontSize: 12, lineHeight: 1.55 }}
            >
              반복 시간표가 아닌 특정 날짜의 예외 시간을 관리합니다.
              <br />
              보충수업, 임시 오픈, 특별 예약 가능 시간에 사용하세요.
              <br />
              반복되는 시간은 빠른 일괄 추가 또는 기존 반복 시간표를 사용하세요.
            </p>

          <div
            data-testid="private-dated-availability-helper"
            style={{
              display: 'grid',
              gap: 6,
              padding: 16,
              border: '1px solid #2e3240',
              borderRadius: 8,
              background: '#151922',
              marginBottom: 12,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16 }}>
              날짜별 1:1 예약 가능 시간 (학생 직접 예약 허용)
            </h3>
            <p style={{ margin: 0, opacity: 0.74, fontSize: 12, lineHeight: 1.5 }}>
              이 목록은 학생이 직접 예약할 수 있는 날짜별 시간입니다.
              <br />
                고정 1:1 배정에 사용하려면 선생님 주간 1:1 시간표로 등록하세요.
            </p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              createPrivateSlot()
            }}
            data-testid="private-slot-form"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
              padding: 16,
              border: '1px solid #2e3240',
              borderRadius: 12,
              background: '#151922',
              marginBottom: 20,
            }}
          >
          {isAdmin ? (
            <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
              선생님
              <select
                value={privateSlotForm.teacher}
                data-testid="private-slot-teacher-select"
                onChange={(event) =>
                  setPrivateSlotForm((prev) => ({ ...prev, teacher: event.target.value }))
                }
                aria-label="1:1 수업 선생님"
              >
                <option value="">선택</option>
                {teacherSelectOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {privateSlotFormErrors.teacher ? (
                <span style={{ color: '#f4a7a7' }}>{privateSlotFormErrors.teacher}</span>
              ) : null}
            </label>
          ) : null}
          <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
            날짜
            <input
              type="date"
              value={privateSlotForm.date}
              onChange={(event) =>
                setPrivateSlotForm((prev) => ({ ...prev, date: event.target.value }))
              }
              aria-label="1:1 수업 날짜"
            />
            {privateSlotFormErrors.date ? (
              <span style={{ color: '#f4a7a7' }}>{privateSlotFormErrors.date}</span>
            ) : null}
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
            시간
            <input
              type="time"
              value={privateSlotForm.time}
              onChange={(event) =>
                setPrivateSlotForm((prev) => ({ ...prev, time: event.target.value }))
              }
              aria-label="1:1 수업 시작 시간"
            />
            {privateSlotFormErrors.time ? (
              <span style={{ color: '#f4a7a7' }}>{privateSlotFormErrors.time}</span>
            ) : null}
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
            분
            <input
              type="number"
              min="10"
              max="240"
              step="5"
              value={privateSlotForm.durationMinutes}
              onChange={(event) =>
                setPrivateSlotForm((prev) => ({
                  ...prev,
                  durationMinutes: event.target.value,
                }))
              }
              aria-label="1:1 수업 진행 시간"
            />
            {privateSlotFormErrors.durationMinutes ? (
              <span style={{ color: '#f4a7a7' }}>{privateSlotFormErrors.durationMinutes}</span>
            ) : null}
          </label>
          <label
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              fontSize: 13,
              alignSelf: 'end',
              minHeight: 40,
            }}
          >
            <input
              type="checkbox"
              checked={privateSlotForm.repeatWeekly === true}
              onChange={(event) =>
                setPrivateSlotForm((prev) => ({
                  ...prev,
                  repeatWeekly: event.target.checked,
                }))
              }
              aria-label="매주 반복 생성"
            />
            매주 반복
          </label>
          {privateSlotForm.repeatWeekly === true ? (
            <>
              <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                반복 주 수
                <input
                  type="number"
                  min="1"
                  max="52"
                  step="1"
                  value={privateSlotForm.repeatWeeks}
                  onChange={(event) =>
                    setPrivateSlotForm((prev) => ({
                      ...prev,
                      repeatWeeks: event.target.value,
                    }))
                  }
                  aria-label="1:1 수업 반복 주 수"
                />
                {privateSlotFormErrors.repeatWeeks ? (
                  <span style={{ color: '#f4a7a7' }}>{privateSlotFormErrors.repeatWeeks}</span>
                ) : null}
              </label>
              <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                종료일
                <input
                  type="date"
                  value={privateSlotForm.repeatEndDate}
                  onChange={(event) =>
                    setPrivateSlotForm((prev) => ({
                      ...prev,
                      repeatEndDate: event.target.value,
                    }))
                  }
                  aria-label="1:1 수업 반복 종료일"
                />
                {privateSlotFormErrors.repeatEndDate ? (
                  <span style={{ color: '#f4a7a7' }}>{privateSlotFormErrors.repeatEndDate}</span>
                ) : null}
              </label>
            </>
          ) : null}
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button
              type="submit"
              disabled={isPrivateSlotSubmitting}
              data-testid="private-slot-create-button"
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid #444',
                background: '#1f2a44',
                color: 'white',
                cursor: isPrivateSlotSubmitting ? 'not-allowed' : 'pointer',
                width: '100%',
              }}
            >
              {isPrivateSlotSubmitting ? '생성 중...' : '수업 시간 추가'}
            </button>
          </div>
          {privateSlotCreateResult ? (
            <div
              data-testid="private-slot-create-result"
              style={{
                gridColumn: '1 / -1',
                color: '#b8f7c0',
                fontSize: 13,
              }}
            >
              생성 {privateSlotCreateResult.createdCount}개
              {privateSlotCreateResult.skippedDuplicateCount > 0
                ? ` · 중복 ${privateSlotCreateResult.skippedDuplicateCount}개 건너뜀`
                : ''}
            </div>
          ) : null}
          </form>
      {isAdmin ? (
        <>
          <div
            style={{
              display: 'grid',
              gap: 6,
              margin: '12px 0',
              padding: '10px 12px',
              border: '1px solid #293246',
              borderRadius: 8,
              background: '#111722',
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={showPastPrivateLessonSlots}
                data-testid="private-dated-slot-history-toggle"
                onChange={(event) => setShowPastPrivateLessonSlots(event.target.checked)}
              />
              지난 날짜별 시간 포함
            </label>
            <p style={{ margin: 0, opacity: 0.74, fontSize: 12, lineHeight: 1.5 }}>
              기본 화면에는 오늘 이후 날짜별/임시 시간만 표시됩니다.
              <br />
              지난 날짜별 시간은 삭제되지 않으며, 필요할 때 포함해서 볼 수 있습니다.
            </p>
            {!showPastPrivateLessonSlots && hiddenPrivateLessonSlotCount > 0 ? (
              <p
                data-testid="private-dated-slot-hidden-count"
                style={{ margin: 0, opacity: 0.72, fontSize: 12, color: '#d7def0' }}
              >
                숨김 {hiddenPrivateLessonSlotCount}개 · 지난 날짜별 시간 포함을 켜면
                표시됩니다.
              </p>
            ) : null}
          </div>
          {privateLessonSlotsLoading || privateLessonReservationsLoading ? (
            <p>불러오는 중...</p>
          ) : privateLessonSlotView.allSlots.length === 0 ? (
            <p style={{ opacity: 0.8 }}>등록된 1:1 수업 시간이 없습니다.</p>
          ) : visiblePrivateLessonSlots.length === 0 ? (
            <p style={{ opacity: 0.8, lineHeight: 1.5 }}>
              현재/예정 날짜별 1:1 수업 시간이 없습니다.
              <br />
              지난 날짜별 시간 포함을 켜면 과거 시간을 확인할 수 있습니다.
            </p>
          ) : (
            <div className="activity-table">
          <div
            className="table-head"
            style={{ gridTemplateColumns: '1fr 0.9fr 0.8fr 1fr 1fr minmax(160px, auto)' }}
          >
            <span>일시</span>
            <span>선생님</span>
            <span>상태</span>
            <span>예약 가능 대상</span>
            <span>예약</span>
            <span>작업</span>
          </div>
          {visiblePrivateLessonSlots.map((slot) => {
            const slotReservations = reservationsBySlotId.get(slot.id) || []
            const activeReservation =
              slotReservations.find((reservation) => reservation.status === 'active') || null
            const busy = busyPrivateSlotActionId === slot.id
            const closedByTeacher = isPrivateSlotClosedByTeacher(slot)
            const eligibleStudentIds = normalizeEligibleStudentIds(slot.eligibleStudentIds)
            const eligibleStudentLabels = eligibleStudentIds.map((studentId) => {
              const student = privateStudentOptions.find((option) => option.id === studentId)
              return student?.name || studentId
            })
            const isEditingEligibility = editingEligibilitySlotId === slot.id
            return (
              <div
                key={slot.id}
                className="table-row"
                data-testid="private-slot-row"
                data-slot-id={slot.id}
                data-academy-id={slot.academyId || ''}
                style={{ gridTemplateColumns: '1fr 0.9fr 0.8fr 1fr 1fr minmax(160px, auto)' }}
              >
                <span>{[slot.date, slot.time].filter(Boolean).join(' ') || slot.id}</span>
                <span>{getPrivateSlotTeacherDisplay(slot)}</span>
                <span>
                  {privateSlotStatusLabel(slot)}
                  {isAdmin &&
                  (slot.releasedFromFixed === true ||
                    String(slot.slotType || '').trim() === 'released_fixed') ? (
                    <span style={{ display: 'block', opacity: 0.75, fontSize: 12, marginTop: 4 }}>
                      원래 학생: {slot.fixedStudentName || slot.fixedStudentId || '-'}
                    </span>
                  ) : null}
                </span>
                <span data-testid="private-slot-eligible-students">
                  {eligibleStudentLabels.length > 0
                    ? `특정 학생 제한: ${eligibleStudentLabels.join(', ')}`
                    : '해당 선생님 개인 수강권 보유 학생'}
                </span>
                <span>
                  {activeReservation
                    ? `${activeReservation.studentName || activeReservation.studentId || '-'} · ${reservationStatusLabel(activeReservation.status)}`
                    : '예약 없음'}
                </span>
                <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (isEditingEligibility) {
                          setEditingEligibilitySlotId('')
                          setEditingEligibilityStudentIds([])
                        } else {
                          setEditingEligibilitySlotId(slot.id)
                          setEditingEligibilityStudentIds(eligibleStudentIds)
                        }
                      }}
                      disabled={busy}
                      data-testid="private-slot-edit-eligibility-button"
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #444',
                        background: '#1f2a44',
                        color: 'white',
                        cursor: busy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      대상 수정
                    </button>
                  ) : null}
                  {closedByTeacher ? (
                    <button
                      type="button"
                      onClick={() => reopenPrivateLessonSlot?.(slot)}
                      disabled={busy}
                      data-testid="private-slot-reopen-unavailable-button"
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #456034',
                        background: '#2d4d2d',
                        color: 'white',
                        cursor: busy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {busy ? '처리 중...' : '수업불가 해제'}
                    </button>
                  ) : null}
                  {!closedByTeacher && slot.status !== 'cancelled' && slot.status !== 'blocked' ? (
                    <button
                      type="button"
                      onClick={() => cancelPrivateSlotOrReservation(slot, activeReservation)}
                      disabled={busy}
                      data-testid="private-slot-cancel-button"
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #553333',
                        background: '#4a2a2a',
                        color: 'white',
                        cursor: busy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {busy ? '처리 중...' : activeReservation ? '예약 취소 후 공개' : '수업 시간 취소'}
                    </button>
                  ) : null}
                  {!closedByTeacher && slot.status !== 'cancelled' && slot.status !== 'blocked' ? (
                    <button
                      type="button"
                      onClick={() =>
                        cancelPrivateSlotOrReservation(slot, activeReservation, {
                          closeAsTeacherUnavailable: true,
                        })
                      }
                      disabled={busy}
                      data-testid="private-slot-close-unavailable-button"
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #6b4d2a',
                        background: '#4a351f',
                        color: 'white',
                        cursor: busy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {busy ? '처리 중...' : '수업불가로 닫기'}
                    </button>
                  ) : null}
                </span>
                {isEditingEligibility ? (
                  <div
                    style={{
                      gridColumn: '1 / -1',
                      display: 'grid',
                      gap: 10,
                      padding: 12,
                      borderTop: '1px solid #2e3240',
                    }}
                    data-testid="private-slot-eligibility-editor"
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: 8,
                      }}
                    >
                      {privateStudentOptions.map((student) => (
                        <label
                          key={student.id}
                          style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                            fontSize: 13,
                            minWidth: 0,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={editingEligibilityStudentIds.includes(student.id)}
                            onChange={() =>
                              setEditingEligibilityStudentIds((prev) =>
                                toggleStudentId(prev, student.id)
                              )
                            }
                            data-testid="private-slot-edit-eligible-student-checkbox"
                          />
                          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                            {student.name || student.id}
                            {student.teacher ? ` · ${student.teacher}` : ''}
                          </span>
                        </label>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingEligibilitySlotId('')
                          setEditingEligibilityStudentIds([])
                        }}
                        disabled={busy}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid #444',
                          background: '#252a35',
                          color: 'white',
                          cursor: busy ? 'not-allowed' : 'pointer',
                        }}
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await updatePrivateSlotEligibility(slot, editingEligibilityStudentIds)
                          setEditingEligibilitySlotId('')
                          setEditingEligibilityStudentIds([])
                        }}
                        disabled={busy}
                        data-testid="private-slot-save-eligibility-button"
                        style={{
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid #456034',
                          background: '#2d4d2d',
                          color: 'white',
                          cursor: busy ? 'not-allowed' : 'pointer',
                        }}
                      >
                        저장
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
          </div>
          )}
        </>
      ) : null}
          </details>
          </section>

          <section
            data-testid="private-time-management-student-assignment-group"
            style={{
              display: 'grid',
              gap: 16,
              padding: 18,
              border: '1px solid #3b4152',
              borderRadius: 14,
              background: '#101722',
              marginBottom: 22,
            }}
          >
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>학생 고정 배정 / 연장</h3>
            <p
              data-testid="private-time-management-student-assignment-copy"
              style={{ margin: '8px 0 0 0', opacity: 0.78, fontSize: 13, lineHeight: 1.6 }}
            >
              선생님 1:1 시간 중 특정 학생에게 고정 수업을 배정합니다.
              <br />
              수강권 기간 안 날짜만 배정 가능하며, 기간 밖 날짜는 제외됩니다.
              <br />
              수강권만 등록하면 수업 일정은 자동 생성되지 않습니다.
              <br />
              먼저 선생님 시간을 만든 뒤 학생에게 배정합니다.
            </p>
          </div>
          <div
            data-testid="private-time-extension-placeholder"
            style={{
              display: 'grid',
              gap: 12,
              padding: 16,
              border: '1px solid #2e3240',
              borderRadius: 8,
              background: '#111722',
              color: '#d7def0',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <section
              data-testid="private-fixed-renewal-preview-section"
              style={{ display: 'grid', gap: 12 }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: 16 }}>같은 시간으로 연장 미리보기</h3>
                <p
                  data-testid="private-fixed-renewal-preview-only-note"
                  style={{ margin: '6px 0 0 0', opacity: 0.76, fontSize: 12, lineHeight: 1.6 }}
                >
                  기존 고정 수업을 기준으로 같은 선생님, 같은 요일, 같은 시간에 연장 가능한
                  날짜를 확인합니다.
                  <br />
                  기존 고정 일정에 표시되는 고정 수업 패턴과 자리 공개된 수업도 같은 시간
                  연장 기준으로 선택할 수 있습니다.
                  <br />
                  먼저 저장하지 않고 미리보기로 생성 예정 항목을 확인합니다.
                  <br />
                  서버 검증 통과 후 최종 확인에서 실제 생성할 수 있습니다.
                </p>
                <p
                  data-testid="private-fixed-renewal-auto-prefill-note"
                  style={{ margin: '8px 0 0 0', opacity: 0.78, fontSize: 12, lineHeight: 1.6 }}
                >
                  {'기존 고정 수업을 선택하면 연장 시작일, 종료일, 회수, 새 수강권 초안을 자동으로 채웁니다.'}
                  <br />
                  필요한 경우 연장 회수와 기간을 수정해 미리보기를 다시 확인할 수 있습니다.
                </p>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 12,
                }}
              >
                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  기존 고정 수업 선택
                  <select
                    value={fixedPrivateRenewalSeedLessonId}
                    data-testid="private-fixed-renewal-seed-select"
                    onChange={(event) => {
                      setFixedPrivateRenewalSeedLessonId?.(event.target.value)
                      setFixedPrivateRenewalPackageId?.('')
                      setShowExistingRenewalPackageChoice?.(false)
                    }}
                  >
                    <option value="">선택</option>
                    {fixedPrivateRenewalSeedOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {fixedPrivateRenewalSeedOptions.length === 0 ? (
                    <span style={{ opacity: 0.72 }}>연장 기준으로 사용할 기존 고정 수업이 없습니다.</span>
                  ) : null}
                </label>
                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  연장 회수
                  <input
                    type="text"
                    inputMode="numeric"
                    value={fixedPrivateRenewalDraftCount}
                    data-testid="private-fixed-renewal-draft-count"
                    onChange={(event) => {
                      const nextCount = event.target.value
                      setFixedPrivateRenewalDraftCount?.(nextCount)
                      const parsedCount = Number.parseInt(String(nextCount || '').trim(), 10)
                      if (
                        Number.isInteger(parsedCount) &&
                        parsedCount > 0 &&
                        isYmd(fixedPrivateRenewalStartDate)
                      ) {
                        setFixedPrivateRenewalEndDate?.(
                          addDaysToYmd(fixedPrivateRenewalStartDate, 7 * (parsedCount - 1))
                        )
                      }
                    }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  연장 시작일
                  <input
                    type="date"
                    value={fixedPrivateRenewalStartDate}
                    data-testid="private-fixed-renewal-start-date"
                    onChange={(event) => {
                      const nextStartDate = event.target.value
                      setFixedPrivateRenewalStartDate?.(nextStartDate)
                      const parsedCount = Number.parseInt(
                        String(fixedPrivateRenewalDraftCount || '').trim(),
                        10
                      )
                      if (isYmd(nextStartDate) && Number.isInteger(parsedCount) && parsedCount > 0) {
                        setFixedPrivateRenewalEndDate?.(
                          addDaysToYmd(nextStartDate, 7 * (parsedCount - 1))
                        )
                      }
                    }}
                  />
                  {fixedPrivateRenewalAutoSuggestion?.startDateAdjustedToFuture ? (
                    <span style={{ opacity: 0.72 }}>
                      마지막 수업 다음 날짜가 과거라 오늘 이후 같은 요일로 보정했습니다.
                    </span>
                  ) : null}
                </label>
                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  연장 종료일
                  <input
                    type="date"
                    value={fixedPrivateRenewalEndDate}
                    data-testid="private-fixed-renewal-end-date"
                    onChange={(event) => setFixedPrivateRenewalEndDate?.(event.target.value)}
                  />
                </label>
              </div>
              {fixedPrivateRenewalSeedLessonId && fixedPrivateRenewalDraftPackage ? (
                <div
                  data-testid="private-fixed-renewal-draft-package-card"
                  style={{
                    display: 'grid',
                    gap: 6,
                    border: '1px solid #293246',
                    borderRadius: 8,
                    padding: 12,
                    background: '#151922',
                  }}
                >
                  <strong data-testid="private-fixed-renewal-draft-package-label">
                    새 수강권 초안 · 저장 전
                  </strong>
                  <span>학생: {fixedPrivateRenewalDraftPackage.studentName || '-'}</span>
                  <span>
                    선생님:{' '}
                    {fixedPrivateRenewalDraftPackage.teacherName ||
                      fixedPrivateRenewalDraftPackage.teacher ||
                      '-'}
                  </span>
                  <span>총 회수: {Number(fixedPrivateRenewalDraftPackage.totalCount || 0)}회</span>
                  <span>
                    수강기간: {fixedPrivateRenewalDraftPackage.registrationStartDate || '-'} ~{' '}
                    {fixedPrivateRenewalDraftPackage.endDate || '-'}
                  </span>
                  <span>메모: {fixedPrivateRenewalDraftNote || '연장 자동 초안 · 저장 전'}</span>
                  <span style={{ opacity: 0.78 }}>
                    새 수강권 초안은 기본 연장 방식입니다.
                  </span>
                  {fixedPrivateRenewalPackageId &&
                  fixedPrivateRenewalPackageId !==
                    (fixedPrivateRenewalDraftPackageOption?.id || fixedPrivateRenewalDraftPackage.id) ? (
                    <span style={{ color: '#f5c17a' }}>
                      현재 미리보기: 기존 수강권 기준
                    </span>
                  ) : null}
                  <span
                    data-testid="private-fixed-renewal-draft-preview-only-note"
                    style={{ opacity: 0.74 }}
                  >
                    이 초안은 저장되지 않았으며, 실제 발행은 다음 단계에서 진행됩니다.
                    <br />
                    이 화면에서는 수강권을 발행하거나 수업을 저장하지 않습니다.
                  </span>
                </div>
              ) : fixedPrivateRenewalSeedLessonId ? (
                <div
                  data-testid="private-fixed-renewal-draft-package-card"
                  style={{
                    border: '1px solid #293246',
                    borderRadius: 8,
                    padding: 12,
                    background: '#151922',
                    color: '#f5c17a',
                  }}
                >
                  연장 시작일을 선택해 주세요. 새 수강권 초안은 저장 전 미리보기 용도로만
                  사용됩니다.
                </div>
              ) : null}
              {fixedPrivateRenewalSeedLessonId ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <button
                    type="button"
                    data-testid="private-fixed-renewal-existing-package-toggle"
                    onClick={() => {
                      const nextOpen = !showExistingRenewalPackageChoice
                      if (!nextOpen) {
                        handleUseFixedPrivateRenewalDraftPackage?.()
                        return
                      }
                      setShowExistingRenewalPackageChoice?.(true)
                    }}
                    style={{
                      justifySelf: 'start',
                      border: '1px solid #3b4252',
                      borderRadius: 6,
                      background: showExistingRenewalPackageChoice ? '#253047' : '#151922',
                      color: '#d7def0',
                      padding: '8px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    기존 남은 수강권으로 미리보기
                  </button>
                  {showExistingRenewalPackageChoice ? (
                    <div
                      data-testid="private-fixed-renewal-existing-package-panel"
                      style={{
                        display: 'grid',
                        gap: 8,
                        border: '1px solid #293246',
                        borderRadius: 8,
                        padding: 12,
                        background: '#151922',
                      }}
                    >
                      <span
                        data-testid="private-fixed-renewal-existing-package-note"
                        style={{ opacity: 0.78, lineHeight: 1.6 }}
                      >
                        {'기존 수강권을 선택하면 새 수강권 초안 대신 해당 수강권의 남은 횟수와 기간으로 미리보기합니다.'}
                        <br />
                        일반적인 연장은 새 수강권 초안을 사용하는 것을 권장합니다.
                        <br />
                        패널을 닫으면 새 수강권 초안 기준으로 돌아갑니다.
                      </span>
                      <label
                        data-testid="private-fixed-renewal-existing-package-select"
                        style={{ display: 'grid', gap: 6, fontSize: 13 }}
                      >
                        기존 수강권 선택
                        <select
                          value={
                            fixedPrivateRenewalExistingPackageOptions.some(
                              (option) => option.id === fixedPrivateRenewalPackageId
                            )
                              ? fixedPrivateRenewalPackageId
                              : ''
                          }
                          data-testid="private-fixed-renewal-package-select"
                          onChange={(event) => {
                            const nextPackageId = event.target.value
                            if (!nextPackageId) {
                              handleUseFixedPrivateRenewalDraftPackage?.()
                              return
                            }
                            setFixedPrivateRenewalPackageId?.(nextPackageId)
                          }}
                        >
                          <option value="" disabled>
                            기존 수강권을 선택해 주세요
                          </option>
                          {fixedPrivateRenewalExistingPackageOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {fixedPrivateRenewalExistingPackageOptions.length === 0 ? (
                          <span style={{ color: '#f4a7a7' }}>
                            선택한 고정 수업의 학생/선생님에 맞는 기존 남은 수강권이 없습니다.
                          </span>
                        ) : null}
                      </label>
                      <button
                        type="button"
                        data-testid="private-fixed-renewal-use-draft-package"
                        onClick={() => {
                          handleUseFixedPrivateRenewalDraftPackage?.()
                        }}
                        style={{
                          justifySelf: 'start',
                          border: '1px solid #3b4252',
                          borderRadius: 6,
                          background: '#111722',
                          color: '#d7def0',
                          padding: '8px 10px',
                          cursor: 'pointer',
                        }}
                      >
                        새 수강권 초안으로 돌아가기
                      </button>
                      <span style={{ opacity: 0.74 }}>
                        기존 수강권 선택을 취소하고 새 수강권 초안 기준으로 미리보기합니다.
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {fixedPrivateRenewalPlan?.teacherTimePreparation ? (
                <div
                  data-testid="private-fixed-renewal-teacher-time-preparation"
                  style={{
                    display: 'grid',
                    gap: 8,
                    border: '1px solid #293246',
                    borderRadius: 8,
                    padding: 12,
                    background: '#151922',
                  }}
                >
                  <strong>선생님 시간 준비</strong>
                  <span data-testid="private-fixed-renewal-teacher-time-status">
                    상태: {fixedPrivateRenewalPlan.teacherTimePreparation.statusLabel || '-'}
                  </span>
                  <span data-testid="private-fixed-renewal-teacher-time-action">
                    처리 예정: {fixedPrivateRenewalPlan.teacherTimePreparation.actionLabel || '-'}
                  </span>
                  <span data-testid="private-fixed-renewal-teacher-time-target">
                    선생님: {fixedPrivateRenewalPlan.teacherTimePreparation.teacherName || '-'} ·{' '}
                    {fixedPrivateRenewalPlan.teacherTimePreparation.weekdayLabel || '-'}{' '}
                    {fixedPrivateRenewalPlan.teacherTimePreparation.time || '-'} ·{' '}
                    {Number(fixedPrivateRenewalPlan.teacherTimePreparation.durationMinutes || 0)}분 ·{' '}
                    기간 {fixedPrivateRenewalPlan.teacherTimePreparation.startDate || '-'} ~{' '}
                    {fixedPrivateRenewalPlan.teacherTimePreparation.endDate || '-'}
                  </span>
                  <span data-testid="private-fixed-renewal-teacher-time-fixed-assignment">
                    고정 수업 배정용: 켬
                  </span>
                  <span data-testid="private-fixed-renewal-teacher-time-direct-booking">
                    학생 직접 예약 허용: 끔
                  </span>
                  {fixedPrivateRenewalPlan.teacherTimePreparation.overlappingTemplates?.length > 0 ||
                  fixedPrivateRenewalPlan.teacherTimePreparation.blockingConflicts?.length > 0 ? (
                    <div
                      data-testid="private-fixed-renewal-teacher-time-conflicts"
                      style={{ color: '#f5c17a', display: 'grid', gap: 4 }}
                    >
                      <strong>시간 겹침 충돌</strong>
                      {fixedPrivateRenewalPlan.teacherTimePreparation.overlappingTemplates.map(
                        (template) => (
                          <span key={template.id || `${template.weekday}-${template.time}`}>
                            {template.teacherName || template.teacher || '선생님'} ·{' '}
                            {template.time || '-'} · {Number(template.durationMinutes || 0)}분
                          </span>
                        )
                      )}
                    </div>
                  ) : null}
                  <span
                    data-testid="private-fixed-renewal-teacher-time-preview-only-note"
                    style={{ opacity: 0.74, lineHeight: 1.6 }}
                  >
                    이 단계에서는 선생님 시간을 실제로 만들거나 변경하지 않습니다.
                    <br />
                    실제 저장 단계에서 필요한 선생님 시간을 함께 준비할 예정입니다.
                    <br />
                    학생 직접 예약 허용은 자동으로 켜지지 않습니다.
                  </span>
                </div>
              ) : null}
              <div
                data-testid="private-fixed-renewal-plan"
                style={{
                  display: 'grid',
                  gap: 8,
                  border: '1px solid #293246',
                  borderRadius: 8,
                  padding: 12,
                  background: '#151922',
                }}
              >
                <strong>연장 미리보기 결과</strong>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <span>
                    연장 예정 {Number(fixedPrivateRenewalPlan?.candidateCount || 0)}회
                  </span>
                  <span data-testid="private-fixed-renewal-assignable-count">
                    연장 가능 {Number(fixedPrivateRenewalPlan?.assignableCount || 0)}회
                  </span>
                  <span data-testid="private-fixed-renewal-excluded-count">
                    제외 {Number(fixedPrivateRenewalPlan?.excludedCount || 0)}회
                  </span>
                </div>
                {['conflict', 'missing_info'].includes(
                  fixedPrivateRenewalPlan?.teacherTimePreparation?.status
                ) ? (
                  <div style={{ color: '#f5c17a' }}>
                    {fixedPrivateRenewalPlan.teacherTimePreparation.statusLabel} · 저장 전
                    미리보기이며, 실제 선생님 시간 변경은 아직 발생하지 않았습니다.
                  </div>
                ) : fixedPrivateRenewalPlan?.teacherTimePreparation?.status ? (
                  <div style={{ opacity: 0.78 }}>
                    {fixedPrivateRenewalPlan.teacherTimePreparation.statusLabel} · 저장 전
                    미리보기이며, 실제 선생님 시간 변경은 아직 발생하지 않았습니다.
                  </div>
                ) : null}
                {fixedPrivateRenewalPlan?.blockingReasons?.length > 0 ? (
                  <div style={{ color: '#f5c17a', display: 'grid', gap: 4 }}>
                    {fixedPrivateRenewalPlan.blockingReasons.map((reason) => (
                      <span key={reason}>{reason}</span>
                    ))}
                  </div>
                ) : null}
                {fixedPrivateRenewalPlan?.assignableDates?.length > 0 ? (
                  <div style={{ display: 'grid', gap: 4 }}>
                    <strong>가능 날짜</strong>
                    {fixedPrivateRenewalPlan.assignableDates.map((date) => (
                      <span key={date}>{date}</span>
                    ))}
                  </div>
                ) : null}
                {fixedPrivateRenewalPlan?.excludedDates?.length > 0 ? (
                  <div style={{ display: 'grid', gap: 4, color: '#f5c17a' }}>
                    <strong>제외 날짜</strong>
                    {fixedPrivateRenewalPlan.excludedDates.map((row) => (
                      <span key={`${row.date}-${row.time}-${row.reason}`}>
                        {row.date} {row.time || ''} · {row.reason || '제외'}
                      </span>
                    ))}
                  </div>
                ) : null}
                <span style={{ opacity: 0.72 }}>
                  저장하지 않고 미리보기만 제공되며, 실제 고정 수업 생성은 다음 단계에서
                  진행합니다.
                </span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gap: 8,
                  border: '1px solid #293246',
                  borderRadius: 8,
                  padding: 12,
                  background: '#151922',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    data-testid="private-fixed-renewal-server-preview-button"
                    onClick={() => previewFixedPrivateRenewalOnServer?.()}
                    disabled={
                      fixedPrivateRenewalServerPreviewBusy ||
                      Boolean(fixedPrivateRenewalServerPreviewDisabledReason)
                    }
                    style={{
                      border: '1px solid #3b4252',
                      borderRadius: 6,
                      background: '#253047',
                      color: '#d7def0',
                      padding: '8px 10px',
                      cursor:
                        fixedPrivateRenewalServerPreviewBusy ||
                        fixedPrivateRenewalServerPreviewDisabledReason
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    저장 전 서버 검증
                  </button>
                  {fixedPrivateRenewalServerPreviewBusy ? (
                    <span data-testid="private-fixed-renewal-server-preview-loading">
                      서버 검증 중...
                    </span>
                  ) : fixedPrivateRenewalServerPreviewDisabledReason ? (
                    <span style={{ color: '#f5c17a' }}>
                      {fixedPrivateRenewalServerPreviewDisabledReason}
                    </span>
                  ) : null}
                </div>
                <span
                  data-testid="private-fixed-renewal-server-preview-no-write-note"
                  style={{ opacity: 0.76, lineHeight: 1.6 }}
                >
                  이 단계에서는 저장하지 않습니다.
                  <br />
                  서버 기준으로 생성 예정 항목을 확인합니다.
                  <br />
                  최종 확인에서 실제 생성 전 한 번 더 확인합니다.
                  <br />
                  수강권 발행이나 수업 저장은 아직 실행되지 않습니다.
                </span>
                {fixedPrivateRenewalServerPreviewError ? (
                  <div
                    data-testid="private-fixed-renewal-server-preview-error"
                    style={{ color: '#f4a7a7' }}
                  >
                    {fixedPrivateRenewalServerPreviewError}
                  </div>
                ) : null}
                {fixedPrivateRenewalServerPreview ? (
                  <div
                    data-testid="private-fixed-renewal-server-preview-result"
                    style={{
                      display: 'grid',
                      gap: 8,
                      border: '1px solid #3b4252',
                      borderRadius: 8,
                      padding: 12,
                      background: '#111722',
                    }}
                  >
                    <strong>서버 검증 결과</strong>
                    <span>
                      검증 상태:{' '}
                      {fixedPrivateRenewalServerPreview.ok ? '통과' : '확인 필요'} · dryRun{' '}
                      {fixedPrivateRenewalServerPreview.dryRun ? 'true' : 'false'} · previewOnly{' '}
                      {fixedPrivateRenewalServerPreview.previewOnly ? 'true' : 'false'}
                    </span>
                    <div
                      data-testid="private-fixed-renewal-server-preview-would-create"
                      style={{ display: 'grid', gap: 4 }}
                    >
                      <strong>생성 예정 요약</strong>
                      <span>
                        새 수강권:{' '}
                        {fixedPrivateRenewalServerPreview.wouldCreate?.studentPackage ? '예' : '아니오'}
                      </span>
                      <span>
                        선생님 시간 생성:{' '}
                        {fixedPrivateRenewalServerPreview.wouldCreate?.teacherTemplate ? '예' : '아니오'}
                      </span>
                      <span>
                        선생님 시간 재활성화:{' '}
                        {fixedPrivateRenewalServerPreview.wouldCreate?.reactivateTeacherTemplate
                          ? '예'
                          : '아니오'}
                      </span>
                      <span>
                        고정 수업 {Number(fixedPrivateRenewalServerPreview.wouldCreate?.lessons || 0)}
                        회 · 날짜별 슬롯{' '}
                        {Number(fixedPrivateRenewalServerPreview.wouldCreate?.privateLessonSlots || 0)}
                        개 · 예약 문서{' '}
                        {Number(
                          fixedPrivateRenewalServerPreview.wouldCreate?.privateLessonReservations || 0
                        )}
                        개
                      </span>
                    </div>
                    <div style={{ display: 'grid', gap: 4 }}>
                      <strong>서버 정규화 요약</strong>
                      <span>
                        기간 {fixedPrivateRenewalServerPreview.normalizedPlan?.startDate || '-'} ~{' '}
                        {fixedPrivateRenewalServerPreview.normalizedPlan?.endDate || '-'} ·{' '}
                        {Number(fixedPrivateRenewalServerPreview.normalizedPlan?.count || 0)}회
                      </span>
                      <span>
                        배정 가능{' '}
                        {fixedPrivateRenewalServerPreview.normalizedPlan?.assignableDates?.length || 0}
                        회 · 제외{' '}
                        {fixedPrivateRenewalServerPreview.normalizedPlan?.excludedDates?.length || 0}
                        회
                      </span>
                      <span>
                        선생님 시간:{' '}
                        {fixedPrivateRenewalServerPreview.normalizedPlan?.teacherTimePreparation?.status ||
                          '-'}
                      </span>
                    </div>
                    <span data-testid="private-fixed-renewal-server-preview-batch-id">
                      renewalBatchIdCandidate:{' '}
                      {fixedPrivateRenewalServerPreview.renewalBatchIdCandidate || '-'}
                    </span>
                    <span data-testid="private-fixed-renewal-server-preview-idempotency-key">
                      idempotencyKey: {fixedPrivateRenewalServerPreview.idempotencyKey || '-'}
                    </span>
                    {fixedPrivateRenewalServerPreview.warnings?.length > 0 ? (
                      <div
                        data-testid="private-fixed-renewal-server-preview-warning"
                        style={{ color: '#f5c17a', display: 'grid', gap: 4 }}
                      >
                        <strong>서버 경고</strong>
                        {fixedPrivateRenewalServerPreview.warnings.map((warning, index) => (
                          <span key={`${warning.code || 'warning'}-${index}`}>
                            {warning.message || warning.code || '확인 필요'}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {fixedPrivateRenewalServerPreview.nextStep ? (
                      <span style={{ opacity: 0.76 }}>
                        nextStep: 최종 확인 모달에서 실제 생성을 진행할 수 있습니다.
                      </span>
                    ) : null}
                    {canOpenFixedPrivateRenewalConfirmModal ? (
                      <button
                        type="button"
                        data-testid="private-fixed-renewal-confirmation-open"
                        onClick={() => setShowFixedPrivateRenewalConfirmModal(true)}
                        style={{
                          justifySelf: 'start',
                          border: '1px solid #456034',
                          borderRadius: 6,
                          background: '#213b2b',
                          color: '#d9f0df',
                          padding: '8px 10px',
                          cursor: 'pointer',
                        }}
                      >
                        생성 예정 항목 확인
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </section>
          </div>
          <section
            data-testid="private-fixed-slot-assignment-section"
            style={{
              display: 'grid',
              gap: 12,
              padding: 16,
              border: '1px solid #2e3240',
              borderRadius: 8,
              background: '#151922',
              marginBottom: 20,
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: 16 }}>주간 시간에 학생 고정 배정</h3>
              <p style={{ margin: '6px 0 0 0', opacity: 0.74, fontSize: 12 }}>
                먼저 선생님의 주간 1:1 시간표를 만들고, 그 시간에 학생을 고정 배정합니다.
                <br />
                수강권만 등록하면 수업 일정은 자동 생성되지 않습니다.
                <br />
                고정 배정은 ‘고정 수업 배정용’으로 켜진 주간 시간에서만 만들 수 있습니다.
                <br />
                학생 직접 예약 허용은 학생이 직접 예약할 수 있는 공개 시간입니다.
              </p>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                createPrivateFixedSlotAssignment()
              }}
              style={{ display: 'grid', gap: 12 }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 12,
                }}
              >
                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  선생님
                  <select
                    value={privateFixedSlotAssignmentForm.teacher}
                    data-testid="private-fixed-assignment-teacher-select"
                    onChange={(event) =>
                      setPrivateFixedSlotAssignmentForm((prev) => ({
                        ...prev,
                        teacher: event.target.value,
                        templateId: '',
                        packageId: '',
                        startDate: '',
                        endDate: '',
                      }))
                    }
                  >
                    <option value="">선택</option>
                    {teacherSelectOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  배정할 주간 시간 선택
                  <select
                    value={privateFixedSlotAssignmentForm.templateId}
                    data-testid="private-fixed-assignment-template-select"
                    onChange={(event) => {
                      const templateId = event.target.value
                      const template =
                        privateAvailabilityTemplates.find((row) => row.id === templateId) || null
                      const range = getTemplateAssignmentDefaultRange(template)
                      setPrivateFixedSlotAssignmentForm((prev) => ({
                        ...prev,
                        templateId,
                        packageId: '',
                        startDate: range.startDate || prev.startDate,
                        endDate: range.endDate || prev.endDate,
                      }))
                    }}
                  >
                    <option value="">선택</option>
                    {privateFixedAssignmentTemplateOptions.map((template) => (
                      <option key={template.id} value={template.id}>
                        {getTemplateAssignmentOptionLabel(template)}
                      </option>
                    ))}
                  </select>
                  {privateFixedSlotAssignmentErrors.templateId ? (
                    <span style={{ color: '#f4a7a7' }}>
                      {privateFixedSlotAssignmentErrors.templateId}
                    </span>
                  ) : null}
                  {privateFixedSlotAssignmentForm.teacher &&
                  privateFixedAssignmentTemplateOptions.length === 0 ? (
                    <span style={{ color: '#f4a7a7' }}>
                      등록된 고정 수업 배정용 주간 시간이 없습니다.
                      <br />
                      위의 선생님 주간 1:1 시간표에서 고정 수업 배정용을 켜서 등록하세요.
                    </span>
                  ) : null}
                </label>

                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  학생
                  <select
                    value={privateFixedSlotAssignmentForm.studentId}
                    data-testid="private-fixed-assignment-student-select"
                    onChange={(event) =>
                      setPrivateFixedSlotAssignmentForm((prev) => ({
                        ...prev,
                        studentId: event.target.value,
                        packageId: '',
                      }))
                    }
                  >
                    <option value="">선택</option>
                    {privateStudentOptions.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.name || student.id}
                        {student.teacher ? ` · ${student.teacher}` : ''}
                      </option>
                    ))}
                  </select>
                  {privateFixedSlotAssignmentErrors.studentId ? (
                    <span style={{ color: '#f4a7a7' }}>
                      {privateFixedSlotAssignmentErrors.studentId}
                    </span>
                  ) : null}
                </label>

                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  개인 수강권
                  <span style={{ fontSize: 12, lineHeight: 1.45, opacity: 0.72 }}>
                    개인 수강권은 선택한 선생님 수업에만 사용할 수 있습니다.
                  </span>
                  <select
                    value={privateFixedSlotAssignmentForm.packageId}
                    data-testid="private-fixed-assignment-package-select"
                    onChange={(event) =>
                      setPrivateFixedSlotAssignmentForm((prev) => ({
                        ...prev,
                        packageId: event.target.value,
                      }))
                    }
                  >
                    <option value="">선택</option>
                    {privateFixedSlotAssignmentPackageOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {privateFixedSlotAssignmentForm.studentId &&
                  privateFixedSlotAssignmentForm.templateId &&
                  privateFixedSlotAssignmentPackageOptions.length === 0 ? (
                    <span style={{ color: '#f4a7a7' }}>
                      조건에 맞는 개인 수강권이 없습니다.
                    </span>
                  ) : null}
                  {privateFixedSlotAssignmentErrors.packageId ? (
                    <span style={{ color: '#f4a7a7' }}>
                      {privateFixedSlotAssignmentErrors.packageId}
                    </span>
                  ) : null}
                </label>

                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  수업명
                  <input
                    type="text"
                    value={privateFixedSlotAssignmentForm.subject}
                    data-testid="private-fixed-assignment-subject-input"
                    onChange={(event) =>
                      setPrivateFixedSlotAssignmentForm((prev) => ({
                        ...prev,
                        subject: event.target.value,
                      }))
                    }
                    placeholder="1:1 수업"
                  />
                </label>

                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  시작일
                  <input
                    type="date"
                    value={privateFixedSlotAssignmentForm.startDate}
                    data-testid="private-fixed-assignment-start-date-input"
                    onChange={(event) =>
                      setPrivateFixedSlotAssignmentForm((prev) => ({
                        ...prev,
                        startDate: event.target.value,
                      }))
                    }
                  />
                </label>

                <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                  종료일
                  <input
                    type="date"
                    value={privateFixedSlotAssignmentForm.endDate}
                    data-testid="private-fixed-assignment-end-date-input"
                    onChange={(event) =>
                      setPrivateFixedSlotAssignmentForm((prev) => ({
                        ...prev,
                        endDate: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>

              {privateFixedSlotAssignmentErrors.dateRange ||
              privateFixedSlotAssignmentErrors.academy ? (
                <p style={{ margin: 0, color: '#f4a7a7', fontSize: 13 }}>
                  {privateFixedSlotAssignmentErrors.dateRange ||
                    privateFixedSlotAssignmentErrors.academy}
                </p>
              ) : null}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={previewPrivateFixedSlotAssignment}
                  disabled={busyPrivateFixedSlotAssignment}
                  data-testid="private-fixed-assignment-preview-button"
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#252a35',
                    color: 'white',
                    cursor: busyPrivateFixedSlotAssignment ? 'not-allowed' : 'pointer',
                  }}
                >
                  미리보기
                </button>
                <button
                  type="submit"
                  disabled={busyPrivateFixedSlotAssignment}
                  data-testid="private-fixed-assignment-submit-button"
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid #456034',
                    background: '#2d4d2d',
                    color: 'white',
                    cursor: busyPrivateFixedSlotAssignment ? 'not-allowed' : 'pointer',
                  }}
                >
                  {busyPrivateFixedSlotAssignment ? '배정 중...' : '학생 고정 배정'}
                </button>
              </div>

              {privateFixedSlotAssignmentPreview ? (
                <div
                  data-testid="private-fixed-assignment-preview"
                  style={{
                    display: 'grid',
                    gap: 8,
                    border: '1px solid #2e3240',
                    borderRadius: 8,
                    padding: 12,
                    fontSize: 13,
                  }}
                >
                  <strong>
                    {privateFixedSlotAssignmentPreview.mode === 'created'
                      ? `배정 완료 ${privateFixedSlotAssignmentPreview.requestedCount}회`
                      : `배정 예정 ${privateFixedSlotAssignmentPreview.requestedCount}회`}
                  </strong>
                  {Number(privateFixedSlotAssignmentPreview.excludedCount || 0) > 0 ? (
                    <div style={{ opacity: 0.78 }}>
                      배정 가능 {privateFixedSlotAssignmentPreview.requestedCount}회 · 제외{' '}
                      {privateFixedSlotAssignmentPreview.excludedCount}회
                    </div>
                  ) : null}
                  {privateFixedSlotAssignmentPreview.mode === 'created' &&
                  Number.isFinite(Number(privateFixedSlotAssignmentPreview.availableAssignmentCount)) ? (
                    <div>
                      배정 후 새 배정 가능{' '}
                      {Math.max(
                        0,
                        Number(privateFixedSlotAssignmentPreview.availableAssignmentCount) || 0
                      )}
                      회
                    </div>
                  ) : null}
                  {privateFixedSlotAssignmentPreview.dates.length > 0 ? (
                    <div style={{ display: 'grid', gap: 4 }}>
                      {privateFixedSlotAssignmentPreview.dates.map((date) => (
                        <span key={date} data-testid="private-fixed-assignment-preview-date">
                          {date} {privateAvailabilityTemplates.find(
                            (row) => row.id === privateFixedSlotAssignmentForm.templateId
                          )?.time || ''}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {privateFixedSlotAssignmentPreview.excludedDates?.length > 0 ? (
                    <div style={{ display: 'grid', gap: 4, color: '#f5c17a' }}>
                      <strong style={{ color: '#f5c17a' }}>
                        제외 {privateFixedSlotAssignmentPreview.excludedDates.length}회
                      </strong>
                      {privateFixedSlotAssignmentPreview.excludedDates.map((row) => (
                        <span
                          key={`${row.date}-${row.time}-${row.reason}`}
                          data-testid="private-fixed-assignment-excluded-date"
                        >
                          {row.date} {row.time || ''} · {row.reason || '제외'}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {privateFixedSlotAssignmentPreview.blockingReasons.length > 0 ? (
                    <div style={{ color: '#f4a7a7', display: 'grid', gap: 4 }}>
                      {privateFixedSlotAssignmentPreview.blockingReasons.map((reason) => (
                        <span key={reason}>{reason}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </form>
          </section>

          <section
            ref={fixedPrivateLessonsSectionRef}
            data-testid="private-fixed-lessons-management-section"
            style={{
              display: 'grid',
              gap: 12,
              padding: 16,
              border: '1px solid #2e3240',
              borderRadius: 8,
              background: '#151922',
              marginBottom: 20,
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: 16 }}>기존 고정 1:1 수업 일정</h3>
              <p style={{ margin: '6px 0 0 0', opacity: 0.74, fontSize: 12 }}>
                예전 방식으로 생성된 고정수업을 유지 표시합니다. 새 고정 배정은 위의 주간
                시간에 학생 고정 배정에서 관리합니다.
              </p>
            </div>
            {fixedPrivateRenewalCommitResult ? (
              <div
                data-testid="private-fixed-renewal-created-lessons-banner"
                style={{
                  display: 'grid',
                  gap: 6,
                  padding: '12px 14px',
                  border: '1px solid #1f6f43',
                  borderRadius: 8,
                  background: '#0f2419',
                  color: '#c7f9d4',
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                <strong data-testid="private-fixed-renewal-created-lessons-count">
                  방금 생성된 연장 {createdRenewalLessonCount}건
                </strong>
                <span data-testid="private-fixed-renewal-created-lessons-note">
                  기존 고정 1:1 수업 일정에서 생성된 수업을 확인하세요.
                </span>
                <span>생성된 행에는 “방금 생성됨” 표시가 붙습니다.</span>
              </div>
            ) : null}
            {fixedRescheduleCommitResult && updatedRescheduleLessonCount > 0 ? (
              <div
                data-testid="private-fixed-reschedule-success-card"
                style={{
                  display: 'grid',
                  gap: 6,
                  padding: '12px 14px',
                  border: '1px solid #1f6f43',
                  borderRadius: 8,
                  background: '#0f2419',
                  color: '#c7f9d4',
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                <strong data-testid="private-fixed-reschedule-success-card-updated-count">
                  방금 수정된 고정 수업 {updatedRescheduleLessonCount}건
                </strong>
                <span>
                  수정된 row는 “방금 수정됨”으로 표시됩니다. 기존 고정 1:1 수업 일정에서
                  확인할 수 있습니다.
                </span>
                <span>
                  updated lessons {fixedRescheduleCommitUpdatedLessons.length}건 · privateLessonSlots{' '}
                  {fixedRescheduleCommitUpdatedSlots.length}건 · privateLessonReservations{' '}
                  {fixedRescheduleCommitUpdatedReservations.length}건
                </span>
                <span data-testid="private-fixed-reschedule-success-card-template-action">
                  teacherTemplateAction {fixedRescheduleCommitUpdated.teacherTemplateAction || '-'}
                </span>
                <span data-testid="private-fixed-reschedule-success-card-batch-id">
                  batchId{' '}
                  {fixedRescheduleCommitResult.batchId ||
                    fixedRescheduleCommitPayload?.requestId ||
                    '-'}
                </span>
              </div>
            ) : null}
            <div
              style={{
                display: 'grid',
                gap: 6,
                padding: '10px 12px',
                border: '1px solid #293246',
                borderRadius: 8,
                background: '#111722',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={showPastFixedPrivateLessons}
                  data-testid="private-fixed-lesson-history-toggle"
                  onChange={(event) => setShowPastFixedPrivateLessons(event.target.checked)}
                />
                지난 고정 일정 포함
              </label>
              <p style={{ margin: 0, opacity: 0.74, fontSize: 12, lineHeight: 1.5 }}>
                기본 화면에는 현재 또는 앞으로 예정된 고정 일정만 표시됩니다.
                <br />
                지난 고정 일정은 삭제되지 않으며, 필요할 때 포함해서 볼 수 있습니다.
              </p>
              {!showPastFixedPrivateLessons && hiddenFixedPrivateLessonCount > 0 ? (
                <p
                  data-testid="private-fixed-lesson-hidden-count"
                  style={{ margin: 0, opacity: 0.72, fontSize: 12, color: '#d7def0' }}
                >
                  숨김 {hiddenFixedPrivateLessonCount}개 · 지난 고정 일정 포함을 켜면 표시됩니다.
                </p>
              ) : null}
            </div>
            {fixedPrivateLessonView.allLessons.length === 0 ? (
              <p style={{ margin: 0, opacity: 0.78 }}>예정된 기존 고정 1:1 수업이 없습니다.</p>
            ) : visibleFixedPrivateLessons.length === 0 ? (
              <p style={{ margin: 0, opacity: 0.78, lineHeight: 1.5 }}>
                예정된 기존 고정 1:1 수업이 없습니다.
                <br />
                지난 고정 일정 포함을 켜면 과거 고정 일정을 확인할 수 있습니다.
              </p>
            ) : (
              <div className="activity-table">
                <div
                  className="table-head"
                  style={{ gridTemplateColumns: '0.9fr 0.65fr 0.9fr 0.9fr 1fr 0.8fr minmax(160px, auto)' }}
                >
                  <span>날짜</span>
                  <span>시간</span>
                  <span>선생님</span>
                  <span>학생</span>
                  <span>수업명</span>
                  <span>상태</span>
                  <span>작업</span>
                </div>
                {visibleFixedPrivateLessons.map((lesson) => {
                  const statusLabel = fixedLessonStatusLabel(lesson)
                  const isCancelled = statusLabel !== '배정됨'
                  const isCreatedRenewalLesson = createdRenewalLessonIds.has(
                    String(lesson.id || lesson.lessonId || '').trim()
                  )
                  const isUpdatedRescheduleLesson = updatedRescheduleLessonIds.has(
                    String(lesson.id || lesson.lessonId || '').trim()
                  )
                  const matchingReservation = privateLessonReservations.find(
                    (reservation) =>
                      String(reservation.status || '').trim() === 'active' &&
                      fixedLessonMatchesReservation(lesson, reservation)
                  )
                  const busy = busyFixedPrivateLessonCancelId === lesson.id
                  return (
                    <div
                      key={lesson.id}
                      className="table-row"
                      data-testid="private-fixed-lesson-row"
                      data-lesson-id={lesson.id}
                      data-created-from-renewal={isCreatedRenewalLesson ? 'true' : undefined}
                      data-updated-from-reschedule={isUpdatedRescheduleLesson ? 'true' : undefined}
                      data-created-row-testid={
                        isCreatedRenewalLesson ? 'private-fixed-renewal-created-lesson-row' : ''
                      }
                      style={{
                        gridTemplateColumns: '0.9fr 0.65fr 0.9fr 0.9fr 1fr 0.8fr minmax(160px, auto)',
                        border:
                          isCreatedRenewalLesson || isUpdatedRescheduleLesson
                            ? '1px solid #1f6f43'
                            : undefined,
                        background:
                          isCreatedRenewalLesson || isUpdatedRescheduleLesson
                            ? '#10251a'
                            : undefined,
                        boxShadow:
                          isCreatedRenewalLesson || isUpdatedRescheduleLesson
                            ? '0 0 0 1px rgba(34, 197, 94, 0.18)'
                            : undefined,
                      }}
                    >
                      <span>{lesson.date || '-'}</span>
                      <span>{lesson.time || '-'}</span>
                      <span>{getPrivateSlotTeacherDisplay(lesson)}</span>
                      <span>{lesson.studentName || lesson.student || lesson.studentId || '-'}</span>
                      <span>{lesson.subject || '1:1 수업'}</span>
                      <span>
                        {statusLabel}
                        {matchingReservation ? (
                          <span style={{ display: 'block', marginTop: 4, opacity: 0.72, fontSize: 12 }}>
                            예약: {matchingReservation.studentName || matchingReservation.studentId || '-'}
                          </span>
                        ) : null}
                        {isCreatedRenewalLesson ? (
                          <span
                            data-testid="private-fixed-renewal-created-lesson-row"
                            style={{ display: 'block', marginTop: 4 }}
                          >
                            <span
                              data-testid="private-fixed-renewal-created-lesson-badge"
                              style={{
                                display: 'inline-block',
                                padding: '2px 6px',
                                borderRadius: 999,
                                border: '1px solid #1f6f43',
                                background: '#0f2419',
                                color: '#c7f9d4',
                                fontSize: 12,
                                fontWeight: 700,
                              }}
                            >
                              방금 생성됨
                            </span>
                          </span>
                        ) : null}
                        {isUpdatedRescheduleLesson ? (
                          <span style={{ display: 'block', marginTop: 4 }}>
                            <span
                              data-testid="private-fixed-reschedule-updated-badge"
                              style={{
                                display: 'inline-block',
                                padding: '2px 6px',
                                borderRadius: 999,
                                border: '1px solid #1f6f43',
                                background: '#0f2419',
                                color: '#c7f9d4',
                                fontSize: 12,
                                fontWeight: 700,
                              }}
                            >
                              방금 수정됨
                            </span>
                          </span>
                        ) : null}
                      </span>
                      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {!isCancelled ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openFixedRescheduleScopePreview(lesson)}
                              disabled={busy}
                              data-testid="private-fixed-reschedule-scope-preview-open"
                              style={{
                                padding: '6px 10px',
                                borderRadius: 8,
                                border: '1px solid #34d39966',
                                background: '#123327',
                                color: '#d7ffe8',
                                cursor: busy ? 'not-allowed' : 'pointer',
                              }}
                            >
                              수정 범위 미리보기
                            </button>
                            <button
                              type="button"
                              onClick={() => setFixedPrivateLessonAction(lesson)}
                              disabled={busy}
                              data-testid="private-fixed-lesson-action-button"
                              style={{
                                padding: '6px 10px',
                                borderRadius: 8,
                                border: '1px solid #4a6fff55',
                                background: '#1f2a44',
                                color: 'white',
                                cursor: busy ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {busy ? '처리 중...' : '고정수업 처리'}
                            </button>
                          </>
                        ) : (
                          <span style={{ opacity: 0.65, fontSize: 12 }}>처리 완료</span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          </section>
        </>
      ) : (
        <>
      {isAdmin || selectedPrivateBoardTeacherOption ? (
          <section
            data-testid="private-teacher-weekly-board-section"
            style={{
              display: 'grid',
              gap: 12,
              padding: 16,
              border: '1px solid #3b4152',
              borderRadius: 10,
              background: '#141b28',
              marginBottom: 20,
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: 16 }}>
                {showPrivateBoardActions ? '선생님별 1:1 시간표/예약판' : '내 주간 1:1 시간표'}
              </h3>
              <p style={{ margin: '6px 0 0 0', opacity: 0.74, fontSize: 12, lineHeight: 1.5 }}>
                {showPrivateBoardActions
                  ? '학생 예약 화면처럼 선생님별 주간 슬롯을 보고, 예약된 수업과 빈 주간 슬롯을 해당 날짜만 수업불가로 닫거나 다시 엽니다.'
                  : '본인에게 연결된 주간 1:1 시간표와 예약 상태를 읽기 전용으로 확인합니다.'}
              </p>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(180px, 1fr) minmax(220px, auto)',
                gap: 12,
                alignItems: 'end',
              }}
            >
              <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                선생님
                <select
                  value={selectedPrivateBoardTeacherOption?.value || ''}
                  data-testid="private-teacher-weekly-board-teacher-select"
                  onChange={(event) => setPrivateBoardTeacherValue(event.target.value)}
                  disabled={!showPrivateBoardActions}
                >
                  {teacherSelectOptions.length === 0 ? (
                    <option value="">선생님 없음</option>
                  ) : null}
                  {teacherSelectOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  data-testid="private-teacher-weekly-board-prev-week-button"
                  onClick={() => setPrivateBoardWeekStart((prev) => addDaysToYmd(prev, -7))}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#252a35',
                    color: 'white',
                  }}
                >
                  이전 주
                </button>
                <button
                  type="button"
                  data-testid="private-teacher-weekly-board-this-week-button"
                  onClick={() => setPrivateBoardWeekStart(getMondayYmd())}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#252a35',
                    color: 'white',
                  }}
                >
                  이번 주
                </button>
                <button
                  type="button"
                  data-testid="private-teacher-weekly-board-next-week-button"
                  onClick={() => setPrivateBoardWeekStart((prev) => addDaysToYmd(prev, 7))}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#252a35',
                    color: 'white',
                  }}
                >
                  다음 주
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', opacity: 0.72, fontSize: 12 }}>
              {privateBoardWeekDays.map((day) => (
                <span key={day.date}>{day.label}</span>
              ))}
            </div>
            {privateLessonSlotsLoading || privateLessonReservationsLoading || privateAvailabilityTemplatesLoading ? (
              <p style={{ margin: 0, opacity: 0.76 }}>예약판을 불러오는 중...</p>
            ) : !selectedPrivateBoardTeacherOption ? (
              <p style={{ margin: 0, opacity: 0.76 }}>선생님을 먼저 등록해 주세요.</p>
            ) : privateBoardRows.length === 0 ? (
              <p style={{ margin: 0, opacity: 0.76 }}>해당 주에 표시할 1:1 시간이 없습니다.</p>
            ) : (
              <div className="activity-table">
                <div
                  className="table-head"
                  style={{ gridTemplateColumns: privateBoardGridTemplate }}
                >
                  <span>날짜</span>
                  <span>시간</span>
                  <span>상태</span>
                  <span>내용</span>
                  <span>출처</span>
                  {showPrivateBoardActions ? <span>작업</span> : null}
                </div>
                {privateBoardRows.map((row) => {
                  const statusLabel = getPrivateBoardSlotStatusLabel(row)
                  const isClosed = statusLabel === '선생님 수업불가로 닫힘'
                  const busy =
                    (row.slot?.id && busyPrivateSlotActionId === row.slot.id) ||
                    (row.fixedLesson?.id && busyFixedPrivateLessonCancelId === row.fixedLesson.id)
                  const sourceLabel =
                    row.source === 'fixedLesson'
                      ? '고정 수업'
                      : row.source === 'template'
                        ? '주간 시간표'
                        : row.slot?.isGeneratedFromTemplate
                          ? '주간 시간표'
                          : '날짜별 슬롯'
                  return (
                    <div
                      key={row.key}
                      className="table-row"
                      data-testid="private-teacher-weekly-board-slot-row"
                      data-slot-id={row.slot?.id || ''}
                      data-lesson-id={row.fixedLesson?.id || ''}
                      data-date={row.date || ''}
                      data-time={row.time || ''}
                      style={{ gridTemplateColumns: privateBoardGridTemplate }}
                    >
                      <span>{row.date || '-'}</span>
                      <span>{row.time || '-'}</span>
                      <span data-testid="private-teacher-weekly-board-slot-status">
                        {statusLabel}
                      </span>
                      <span>{getPrivateBoardSlotDetail(row)}</span>
                      <span>
                        {sourceLabel}
                        {row.slot?.openForStudentBooking === true ? (
                          <span style={{ display: 'block', marginTop: 4, opacity: 0.7, fontSize: 12 }}>
                            학생 직접 예약 허용
                          </span>
                        ) : null}
                      </span>
                      {showPrivateBoardActions ? (
                        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {isClosed ? (
                            <button
                              type="button"
                              disabled={busy}
                              data-testid="private-teacher-weekly-board-reopen-button"
                              onClick={() => reopenPrivateLessonSlot?.(row.slot)}
                              style={{
                                padding: '6px 10px',
                                borderRadius: 8,
                                border: '1px solid #456034',
                                background: '#2d4d2d',
                                color: 'white',
                                cursor: busy ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {busy ? '처리 중...' : '수업불가 해제'}
                            </button>
                          ) : (
                            <>
                              {row.reservation || row.fixedLesson ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  data-testid="private-teacher-weekly-board-release-button"
                                  onClick={() => {
                                    if (row.fixedLesson) {
                                      onCancelFixedPrivateLesson?.(row.fixedLesson, 'seat_released')
                                      return
                                    }
                                    cancelPrivateSlotOrReservation(row.slot, row.reservation)
                                  }}
                                  style={{
                                    padding: '6px 10px',
                                    borderRadius: 8,
                                    border: '1px solid #553333',
                                    background: '#4a2a2a',
                                    color: 'white',
                                    cursor: busy ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  {busy ? '처리 중...' : '예약 취소 후 공개'}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                disabled={busy}
                                data-testid="private-teacher-weekly-board-close-button"
                                onClick={() => {
                                  if (row.reservation) {
                                    cancelPrivateSlotOrReservation(row.slot, row.reservation, {
                                      closeAsTeacherUnavailable: true,
                                    })
                                    return
                                  }
                                  if (row.fixedLesson) {
                                    onCancelFixedPrivateLesson?.(row.fixedLesson, 'lesson_cancelled', {
                                      reason: 'teacher_unavailable',
                                    })
                                    return
                                  }
                                  closePrivateLessonSlot?.(row.slot)
                                }}
                                style={{
                                  padding: '6px 10px',
                                  borderRadius: 8,
                                  border: '1px solid #6b4d2a',
                                  background: '#4a351f',
                                  color: 'white',
                                  cursor: busy ? 'not-allowed' : 'pointer',
                                }}
                              >
                                {busy ? '처리 중...' : '수업불가로 닫기'}
                              </button>
                            </>
                          )}
                        </span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
            <p style={{ margin: 0, opacity: 0.65, fontSize: 12 }}>
              {showPrivateBoardActions
                ? '“예약 취소 후 공개”는 다른 학생에게 열고, “수업불가로 닫기”는 누구에게도 열지 않습니다. “수업불가 해제”는 해당 날짜/시간만 다시 예약 가능하게 엽니다.'
                : '이 화면은 읽기 전용입니다. 수업불가 닫기/해제와 예약 조작은 관리자만 할 수 있습니다.'}
            </p>
          </section>
      ) : null}

        </>
      )}

      {showFixedPrivateRenewalConfirmModal && canOpenFixedPrivateRenewalConfirmModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="private-fixed-renewal-confirmation-title"
          data-testid="private-fixed-renewal-confirmation-modal"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            background: 'rgba(0, 0, 0, 0.58)',
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setShowFixedPrivateRenewalConfirmModal(false)
            }
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 720,
              maxHeight: '86vh',
              overflow: 'auto',
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
              id="private-fixed-renewal-confirmation-title"
              style={{ margin: '0 0 10px 0', fontSize: '1.1rem', fontWeight: 700 }}
            >
              최종 확인
            </h2>
            <div
              data-testid="private-fixed-renewal-confirmation-no-write-note"
              style={{
                display: 'grid',
                gap: 4,
                marginBottom: 14,
                padding: 12,
                border: '1px solid #3b4252',
                borderRadius: 8,
                background: '#111722',
                color: '#d7def0',
                lineHeight: 1.6,
              }}
            >
              <span>아직 저장하지 않습니다. 아래 생성 버튼을 누르기 전까지는 실행되지 않습니다.</span>
              <span>서버 검증 결과를 다시 확인한 뒤 실제 생성을 진행하세요.</span>
            </div>

            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                fontSize: 13,
                lineHeight: 1.65,
              }}
            >
              <div style={{ display: 'grid', gap: 4 }}>
                <strong>대상</strong>
                <span>학생: {fixedPrivateRenewalConfirmationStudentLabel}</span>
                <span>선생님: {fixedPrivateRenewalConfirmationTeacherLabel}</span>
                <span>수강권 mode: {fixedPrivateRenewalConfirmationPackageModeLabel}</span>
                <span>
                  수강기간 {fixedPrivateRenewalConfirmationPlan.startDate || '-'} ~{' '}
                  {fixedPrivateRenewalConfirmationPlan.endDate || '-'}
                </span>
                <span>
                  총 회수 {Number(fixedPrivateRenewalConfirmationPlan.count || 0)}회
                </span>
              </div>

              <div
                data-testid="private-fixed-renewal-confirmation-would-create"
                style={{ display: 'grid', gap: 4 }}
              >
                <strong>생성 예정 항목</strong>
                <span>
                  새 수강권 생성:{' '}
                  {fixedPrivateRenewalConfirmationWouldCreate?.studentPackage ? '예' : '아니오'}
                </span>
                <span>
                  기존 수강권 사용:{' '}
                  {fixedPrivateRenewalConfirmationPackageMode === 'existing' ? '예' : '아니오'}
                </span>
                <span>
                  선생님 시간 생성:{' '}
                  {fixedPrivateRenewalConfirmationWouldCreate?.teacherTemplate ? '예' : '아니오'}
                </span>
                <span>
                  선생님 시간 재활성화:{' '}
                  {fixedPrivateRenewalConfirmationWouldCreate?.reactivateTeacherTemplate
                    ? '예'
                    : '아니오'}
                </span>
                <span>
                  고정 수업 생성{' '}
                  {Number(fixedPrivateRenewalConfirmationWouldCreate?.lessons || 0)}회
                </span>
                <span>
                  날짜별 슬롯 생성{' '}
                  {Number(fixedPrivateRenewalConfirmationWouldCreate?.privateLessonSlots || 0)}개
                </span>
                <span>
                  예약 문서 생성{' '}
                  {Number(
                    fixedPrivateRenewalConfirmationWouldCreate?.privateLessonReservations || 0
                  )}
                  개
                </span>
              </div>
            </div>

            <div
              data-testid="private-fixed-renewal-confirmation-dates"
              style={{
                display: 'grid',
                gap: 6,
                marginTop: 14,
                padding: 12,
                border: '1px solid #293246',
                borderRadius: 8,
                background: '#101521',
                fontSize: 13,
              }}
            >
              <strong>생성 예정 날짜</strong>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {fixedPrivateRenewalConfirmationDates.map((date) => (
                  <span
                    key={date}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 999,
                      border: '1px solid #3b4252',
                      background: '#151922',
                    }}
                  >
                    {date}
                  </span>
                ))}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gap: 6,
                marginTop: 14,
                fontSize: 12,
                lineHeight: 1.6,
                wordBreak: 'break-all',
              }}
            >
              <span data-testid="private-fixed-renewal-confirmation-batch-id">
                renewalBatchIdCandidate:{' '}
                {fixedPrivateRenewalServerPreview.renewalBatchIdCandidate || '-'}
              </span>
              <span data-testid="private-fixed-renewal-confirmation-idempotency-key">
                idempotencyKey: {fixedPrivateRenewalServerPreview.idempotencyKey || '-'}
              </span>
            </div>

            <div
              data-testid="private-fixed-renewal-confirmation-warnings"
              style={{
                display: 'grid',
                gap: 4,
                marginTop: 14,
                color: fixedPrivateRenewalConfirmationWarnings.length > 0 ? '#f5c17a' : '#d7def0',
                fontSize: 13,
              }}
            >
              <strong>warnings</strong>
              {fixedPrivateRenewalConfirmationWarnings.length > 0 ? (
                fixedPrivateRenewalConfirmationWarnings.map((warning, index) => (
                  <span key={`${warning.code || 'warning'}-${index}`}>
                    {warning.message || warning.code || '확인 필요'}
                  </span>
                ))
              ) : (
                <span>서버 경고 없음</span>
              )}
            </div>

            <div
              data-testid="private-fixed-renewal-commit-warning-note"
              style={{
                display: 'grid',
                gap: 4,
                marginTop: 14,
                padding: 12,
                border: '1px solid #7a4d18',
                borderRadius: 8,
                background: '#20170c',
                color: '#ffd89a',
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              <span>이 버튼을 누르면 수강권과 고정 수업이 실제 생성됩니다.</span>
              <span>생성 후에는 기존 관리 화면에서 확인/수정할 수 있습니다.</span>
              <span>중복 클릭을 막기 위해 처리 중에는 버튼이 잠깁니다.</span>
            </div>

            {fixedPrivateRenewalCommitError ? (
              <div
                data-testid="private-fixed-renewal-commit-error"
                role="alert"
                style={{
                  marginTop: 14,
                  padding: 12,
                  border: '1px solid #7f1d1d',
                  borderRadius: 8,
                  background: '#2a1010',
                  color: '#fecaca',
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                <strong>저장 중 오류가 발생했습니다.</strong>
                <div style={{ marginTop: 4, wordBreak: 'break-word' }}>
                  {fixedPrivateRenewalCommitError}
                </div>
              </div>
            ) : null}

            {fixedPrivateRenewalCommitResult ? (
              <div
                data-testid="private-fixed-renewal-commit-result"
                style={{
                  display: 'grid',
                  gap: 8,
                  marginTop: 14,
                  padding: 12,
                  border: '1px solid #1f6f43',
                  borderRadius: 8,
                  background: '#0f2419',
                  color: '#c7f9d4',
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                <strong>연장 생성이 완료되었습니다</strong>
                <span>목록에 자동 반영됩니다. 기존 고정 1:1 수업 일정에서 확인하세요.</span>
                <span data-testid="private-fixed-renewal-commit-result-batch-id">
                  batchId: {fixedPrivateRenewalCommitBatchId || '-'}
                </span>
                <span>idempotentReplay: {fixedPrivateRenewalCommitResult.idempotentReplay ? '예' : '아니오'}</span>
                <div
                  data-testid="private-fixed-renewal-commit-result-created"
                  style={{ display: 'grid', gap: 4 }}
                >
                  <span>
                    packageId:{' '}
                    {fixedPrivateRenewalCommitCreated.packageId ||
                      fixedPrivateRenewalCommitCreated.studentPackage ||
                      '-'}
                  </span>
                  <span>templateId: {fixedPrivateRenewalCommitCreated.templateId || '-'}</span>
                  <span>lessons: {fixedPrivateRenewalCommitLessonIds.length}개</span>
                  <span>slots: {fixedPrivateRenewalCommitSlotIds.length}개</span>
                  <span>reservations: {fixedPrivateRenewalCommitReservationIds.length}개</span>
                </div>
                {createdRenewalLessonCount > 0 ? (
                  <button
                    type="button"
                    data-testid="private-fixed-renewal-commit-view-created-lessons"
                    onClick={viewCreatedFixedPrivateRenewalLessons}
                    style={{
                      justifySelf: 'start',
                      marginTop: 4,
                      padding: '7px 11px',
                      borderRadius: 8,
                      border: '1px solid #34d399',
                      background: '#14532d',
                      color: '#dcfce7',
                      cursor: 'pointer',
                      fontWeight: 700,
                    }}
                  >
                    생성된 일정 보기
                  </button>
                ) : null}
              </div>
            ) : null}

            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end',
                marginTop: 18,
              }}
            >
              <button
                type="button"
                data-testid="private-fixed-renewal-commit-button"
                onClick={onCommitFixedPrivateRenewal}
                disabled={!canCommitFixedPrivateRenewal}
                style={{
                  padding: '9px 14px',
                  borderRadius: 8,
                  border: '1px solid #60a5fa',
                  background: canCommitFixedPrivateRenewal ? '#2563eb' : '#1f2937',
                  color: canCommitFixedPrivateRenewal ? 'white' : '#9ca3af',
                  cursor: canCommitFixedPrivateRenewal ? 'pointer' : 'not-allowed',
                  fontWeight: 700,
                }}
              >
                {fixedPrivateRenewalCommitBusy ? (
                  <span data-testid="private-fixed-renewal-commit-loading">생성 중...</span>
                ) : (
                  '위 내용으로 연장 생성'
                )}
              </button>
              <button
                type="button"
                data-testid="private-fixed-renewal-confirmation-close"
                onClick={() => setShowFixedPrivateRenewalConfirmModal(false)}
                style={{
                  padding: '9px 14px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor: 'pointer',
                }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showFixedRescheduleScopePreview && selectedFixedRescheduleLesson ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="private-fixed-reschedule-scope-preview-title"
          data-testid="private-fixed-reschedule-scope-preview-panel"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.58)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1006,
            padding: 16,
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeFixedRescheduleScopePreview()
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 760,
              maxHeight: '90vh',
              overflowY: 'auto',
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
              id="private-fixed-reschedule-scope-preview-title"
              style={{ margin: '0 0 8px 0', fontSize: 18 }}
            >
              고정 수업 수정 범위 미리보기
            </h2>
            <div
              data-testid="private-fixed-reschedule-scope-no-write-note"
              style={{
                display: 'grid',
                gap: 4,
                padding: 12,
                border: '1px solid #3b4252',
                borderRadius: 8,
                background: '#111722',
                color: '#d7def0',
                fontSize: 13,
                lineHeight: 1.6,
                marginBottom: 14,
              }}
            >
              <span>아직 저장하지 않습니다.</span>
              <span>변경 범위에 포함될 수업만 미리 확인합니다.</span>
              <span>실제 수정은 다음 단계에서 제공합니다.</span>
              <span>이 미리보기는 현재 화면 데이터 기준입니다.</span>
              <span>저장 전 서버 검증이 필요합니다.</span>
            </div>

            <div
              data-testid="private-fixed-reschedule-scope-selected-lesson"
              style={{
                display: 'grid',
                gap: 4,
                padding: 12,
                border: '1px solid #293246',
                borderRadius: 8,
                background: '#101724',
                fontSize: 13,
                lineHeight: 1.6,
                marginBottom: 14,
              }}
            >
              <strong>선택한 수업</strong>
              <span>
                {getFixedRescheduleLessonDate(selectedFixedRescheduleLesson) || '-'}{' '}
                {getFixedRescheduleLessonTime(selectedFixedRescheduleLesson) || '-'} ·{' '}
                {getPrivateSlotTeacherDisplay(selectedFixedRescheduleLesson)} ·{' '}
                {selectedFixedRescheduleLesson.studentName ||
                  selectedFixedRescheduleLesson.student ||
                  selectedFixedRescheduleLesson.studentId ||
                  '-'}
              </span>
              <span>
                package:{' '}
                {getFixedReschedulePrimaryPackageId(selectedFixedRescheduleLesson) || '-'} · batch:{' '}
                {getFixedRescheduleBatchId(selectedFixedRescheduleLesson) || '-'} · template:{' '}
                {selectedFixedRescheduleLesson.privateLessonAvailabilityTemplateId || '-'}
              </span>
            </div>

            <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="radio"
                  name="fixed-reschedule-scope-mode"
                  value="single"
                  checked={fixedRescheduleScopeMode === 'single'}
                  onChange={() => changeFixedRescheduleScopeMode('single')}
                  data-testid="private-fixed-reschedule-scope-mode-single"
                />
                이 수업만 수정
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="radio"
                  name="fixed-reschedule-scope-mode"
                  value="future_series"
                  checked={fixedRescheduleScopeMode === 'future_series'}
                  onChange={() => changeFixedRescheduleScopeMode('future_series')}
                  data-testid="private-fixed-reschedule-scope-mode-future-series"
                />
                이 날짜부터 이후 고정 수업에 적용
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="radio"
                  name="fixed-reschedule-scope-mode"
                  value="package_remaining"
                  checked={fixedRescheduleScopeMode === 'package_remaining'}
                  onChange={() => changeFixedRescheduleScopeMode('package_remaining')}
                  data-testid="private-fixed-reschedule-scope-mode-package-remaining"
                />
                이 수강권 안의 남은 고정 수업에 적용
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="radio"
                  name="fixed-reschedule-scope-mode"
                  value="date_range"
                  checked={fixedRescheduleScopeMode === 'date_range'}
                  onChange={() => changeFixedRescheduleScopeMode('date_range')}
                  data-testid="private-fixed-reschedule-scope-mode-date-range"
                />
                직접 날짜 범위 선택
              </label>
            </div>

            {fixedRescheduleScopeMode === 'date_range' ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                  <span>시작일</span>
                  <input
                    type="date"
                    value={fixedRescheduleRangeStart}
                    onChange={(event) => changeFixedRescheduleRangeStart(event.target.value)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                    }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                  <span>종료일</span>
                  <input
                    type="date"
                    value={fixedRescheduleRangeEnd}
                    onChange={(event) => changeFixedRescheduleRangeEnd(event.target.value)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                    }}
                  />
                </label>
              </div>
            ) : null}

            <div
              data-testid="private-fixed-reschedule-target-inputs"
              style={{
                display: 'grid',
                gap: 10,
                padding: 12,
                border: '1px solid #293246',
                borderRadius: 8,
                background: '#101724',
                fontSize: 13,
                lineHeight: 1.6,
                marginBottom: 14,
              }}
            >
              <strong>변경 후 값</strong>
              <div style={{ display: 'grid', gap: 4, color: '#d7def0' }}>
                <span>선택하지 않은 항목은 기존 값을 유지합니다.</span>
                <span>서버 검증 후 충돌 여부를 확인하세요.</span>
                <span>아직 저장하지 않습니다.</span>
                <span>실제 수정은 다음 단계에서 제공합니다.</span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 10,
                }}
              >
                {fixedRescheduleScopeMode === 'single' ? (
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span>변경 후 날짜</span>
                    <input
                      type="date"
                      value={fixedRescheduleTargetDraft.targetDate}
                      data-testid="private-fixed-reschedule-target-date"
                      onChange={(event) =>
                        changeFixedRescheduleTargetDraft({ targetDate: event.target.value })
                      }
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid #444',
                        background: '#1f1f1f',
                        color: 'white',
                      }}
                    />
                  </label>
                ) : null}
                <label style={{ display: 'grid', gap: 4 }}>
                  <span>변경 후 시간</span>
                  <input
                    type="time"
                    value={fixedRescheduleTargetDraft.targetTime}
                    data-testid="private-fixed-reschedule-target-time"
                    onChange={(event) =>
                      changeFixedRescheduleTargetDraft({ targetTime: event.target.value })
                    }
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                    }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span>변경 후 선생님</span>
                  <select
                    value={fixedRescheduleTargetTeacherOption?.value || ''}
                    data-testid="private-fixed-reschedule-target-teacher"
                    disabled={teacherSelectOptions.length === 0}
                    onChange={(event) => changeFixedRescheduleTargetTeacher(event.target.value)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                    }}
                  >
                    <option value="">기존 선생님 유지</option>
                    {teacherSelectOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span>변경 후 수업 길이</span>
                  <input
                    type="number"
                    min="1"
                    value={fixedRescheduleTargetDraft.targetDurationMinutes}
                    data-testid="private-fixed-reschedule-target-duration"
                    onChange={(event) =>
                      changeFixedRescheduleTargetDraft({
                        targetDurationMinutes: event.target.value,
                      })
                    }
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                    }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span>변경 후 수업명</span>
                  <input
                    type="text"
                    value={fixedRescheduleTargetDraft.targetLessonName}
                    data-testid="private-fixed-reschedule-target-lesson-name"
                    onChange={(event) =>
                      changeFixedRescheduleTargetDraft({ targetLessonName: event.target.value })
                    }
                    placeholder="1:1 수업"
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                    }}
                  />
                </label>
              </div>
            </div>

            <div
              data-testid="private-fixed-reschedule-scope-preview-result"
              style={{
                display: 'grid',
                gap: 10,
                padding: 12,
                border: '1px solid #293246',
                borderRadius: 8,
                background: '#101724',
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              <strong>
                scope mode:{' '}
                {fixedRescheduleScopeMode === 'single'
                  ? '이 수업만 수정'
                  : fixedRescheduleScopeMode === 'future_series'
                    ? '이 날짜부터 이후 고정 수업에 적용'
                    : fixedRescheduleScopeMode === 'package_remaining'
                      ? '이 수강권 안의 남은 고정 수업에 적용'
                      : '직접 날짜 범위 선택'}
              </strong>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span data-testid="private-fixed-reschedule-scope-included-count">
                  포함 예정 수업 {fixedRescheduleScopePreview.includedLessons.length}건
                </span>
                <span data-testid="private-fixed-reschedule-scope-excluded-count">
                  제외된 수업 {fixedRescheduleScopePreview.excludedLessons.length}건
                </span>
              </div>

              {fixedRescheduleScopePreview.warnings.length > 0 ? (
                <div style={{ display: 'grid', gap: 4, color: '#f5c17a' }}>
                  {fixedRescheduleScopePreview.warnings.map((warning) => (
                    <span key={warning} data-testid="private-fixed-reschedule-scope-warning">
                      {warning}
                    </span>
                  ))}
                </div>
              ) : (
                <span data-testid="private-fixed-reschedule-scope-warning" style={{ opacity: 0.72 }}>
                  현재 화면 데이터 기준으로 추가 경고는 없습니다.
                </span>
              )}

              <div style={{ display: 'grid', gap: 6 }}>
                <strong>포함 예정 목록</strong>
                {fixedRescheduleScopePreview.includedLessons.length === 0 ? (
                  <span style={{ opacity: 0.72 }}>포함될 수업이 없습니다.</span>
                ) : (
                  fixedRescheduleScopePreview.includedLessons.map((lesson) => (
                    <div
                      key={getFixedRescheduleLessonId(lesson)}
                      data-testid="private-fixed-reschedule-scope-included-row"
                      style={{
                        display: 'grid',
                        gap: 2,
                        padding: '8px 10px',
                        border: '1px solid #26364f',
                        borderRadius: 8,
                        background: '#151d2c',
                      }}
                    >
                      <span>
                        {getFixedRescheduleLessonDate(lesson) || '-'}{' '}
                        {getFixedRescheduleLessonTime(lesson) || '-'} ·{' '}
                        {getPrivateSlotTeacherDisplay(lesson)} ·{' '}
                        {lesson.studentName || lesson.student || lesson.studentId || '-'}
                      </span>
                      <span style={{ opacity: 0.75 }}>
                        package {getFixedReschedulePrimaryPackageId(lesson) || '-'} · batch{' '}
                        {getFixedRescheduleBatchId(lesson) || '-'} · template{' '}
                        {lesson.privateLessonAvailabilityTemplateId || '-'}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {fixedRescheduleScopePreview.excludedLessons.length > 0 ? (
                <div style={{ display: 'grid', gap: 4, opacity: 0.76 }}>
                  <strong>제외된 수업</strong>
                  {fixedRescheduleScopePreview.excludedLessons.slice(0, 8).map(({ lesson, reason }) => (
                    <span key={`${getFixedRescheduleLessonId(lesson)}:${reason}`}>
                      {getFixedRescheduleLessonDate(lesson) || '-'}{' '}
                      {getFixedRescheduleLessonTime(lesson) || '-'} · {reason}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div
              data-testid="private-fixed-reschedule-server-preview-no-write-note"
              style={{
                display: 'grid',
                gap: 4,
                padding: 12,
                border: '1px solid #3b4252',
                borderRadius: 8,
                background: '#111722',
                color: '#d7def0',
                fontSize: 13,
                lineHeight: 1.6,
                marginTop: 12,
              }}
            >
              <span>이 단계에서는 저장하지 않습니다.</span>
              <span>서버 기준으로 변경 범위를 검증합니다.</span>
              <span>실제 수정은 다음 단계에서 제공합니다.</span>
              <span>수업, 슬롯, 예약 문서는 아직 수정되지 않습니다.</span>
              <span>선택하지 않은 항목은 기존 값을 유지합니다.</span>
              <span>서버 검증 후 충돌 여부를 확인하세요.</span>
            </div>

            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  data-testid="private-fixed-reschedule-server-preview-button"
                  onClick={previewFixedRescheduleScopeOnServer}
                  disabled={Boolean(fixedRescheduleServerPreviewDisabledReason)}
                  style={{
                    padding: '9px 14px',
                    borderRadius: 8,
                    border: '1px solid #60a5fa',
                    background: fixedRescheduleServerPreviewDisabledReason ? '#1f2937' : '#2563eb',
                    color: fixedRescheduleServerPreviewDisabledReason ? '#9ca3af' : 'white',
                    cursor: fixedRescheduleServerPreviewDisabledReason ? 'not-allowed' : 'pointer',
                    fontWeight: 700,
                  }}
                >
                  {fixedRescheduleServerPreviewBusy ? (
                    <span data-testid="private-fixed-reschedule-server-preview-loading">
                      서버 기준 검증 중...
                    </span>
                  ) : (
                    '서버 기준 범위 검증'
                  )}
                </button>
                <span style={{ opacity: 0.72, fontSize: 12, lineHeight: 1.5 }}>
                  서버 데이터 기준으로 포함/제외 수업과 충돌 여부를 다시 확인합니다.
                </span>
              </div>

              {fixedRescheduleServerPreviewDisabledReason &&
              !fixedRescheduleServerPreviewBusy ? (
                <span style={{ color: '#f5c17a', fontSize: 12 }}>
                  {fixedRescheduleServerPreviewDisabledReason}
                </span>
              ) : null}

              {fixedRescheduleServerPreviewError ? (
                <div
                  data-testid="private-fixed-reschedule-server-preview-error"
                  style={{
                    padding: 12,
                    border: '1px solid #7f1d1d',
                    borderRadius: 8,
                    background: '#2b1111',
                    color: '#fecaca',
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  {fixedRescheduleServerPreviewError}
                </div>
              ) : null}

              {fixedRescheduleServerPreview ? (
                <div
                  data-testid="private-fixed-reschedule-server-preview-result"
                  style={{
                    display: 'grid',
                    gap: 10,
                    padding: 12,
                    border: '1px solid #294064',
                    borderRadius: 8,
                    background: '#101724',
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  <strong>서버 기준 범위 검증 결과</strong>
                  <div data-testid="private-fixed-reschedule-server-preview-ok">
                    {fixedRescheduleServerPreview.ok ? '통과' : '확인 필요'} · dryRun{' '}
                    {fixedRescheduleServerPreview.dryRun ? 'true' : 'false'} · previewOnly{' '}
                    {fixedRescheduleServerPreview.previewOnly ? 'true' : 'false'}
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <span data-testid="private-fixed-reschedule-server-preview-included-count">
                      포함 {fixedRescheduleServerPreview.includedLessons?.length || 0}건
                    </span>
                    <span data-testid="private-fixed-reschedule-server-preview-excluded-count">
                      제외 {fixedRescheduleServerPreview.excludedLessons?.length || 0}건
                    </span>
                  </div>
                  <div data-testid="private-fixed-reschedule-server-preview-would-update">
                    wouldUpdate: lessons {Number(fixedRescheduleServerPreviewWouldUpdate.lessons || 0)} ·
                    slots {Number(fixedRescheduleServerPreviewWouldUpdate.privateLessonSlots || 0)} ·
                    reservations{' '}
                    {Number(fixedRescheduleServerPreviewWouldUpdate.privateLessonReservations || 0)} ·
                    template {fixedRescheduleServerPreviewWouldUpdate.teacherTemplateAction || '-'}
                  </div>
                  <div data-testid="private-fixed-reschedule-server-preview-teacher-time">
                    teacherTimePreparation: {fixedRescheduleServerPreviewTeacherTime.status || '-'}
                  </div>
                  <div data-testid="private-fixed-reschedule-server-preview-normalized-plan">
                    normalizedPlan: {fixedRescheduleServerPreviewPlan.scopeMode || '-'} · count{' '}
                    {Number(fixedRescheduleServerPreviewPlan.count || 0)} · from{' '}
                    {fixedRescheduleServerPreviewPlan.from || '-'} · to{' '}
                    {fixedRescheduleServerPreviewPlan.to || '-'}
                    {fixedRescheduleServerPreviewPayload?.requestId ? (
                      <> · requestId {fixedRescheduleServerPreviewPayload.requestId}</>
                    ) : null}
                  </div>
                  {fixedRescheduleServerPreviewTargetSummary.date ||
                  fixedRescheduleServerPreviewTargetSummary.time ||
                  fixedRescheduleServerPreviewTargetSummary.teacherName ||
                  fixedRescheduleServerPreviewTargetSummary.teacherKey ||
                  fixedRescheduleServerPreviewTargetSummary.durationMinutes ||
                  fixedRescheduleServerPreviewTargetSummary.lessonName ? (
                    <div
                      data-testid="private-fixed-reschedule-target-summary"
                      style={{ display: 'grid', gap: 4 }}
                    >
                      <strong>변경 후 값 요약</strong>
                      <span data-testid="private-fixed-reschedule-target-summary-date">
                        변경 후 날짜: {fixedRescheduleServerPreviewTargetSummary.date || '-'}
                      </span>
                      <span data-testid="private-fixed-reschedule-target-summary-time">
                        변경 후 시간: {fixedRescheduleServerPreviewTargetSummary.time || '-'}
                      </span>
                      <span data-testid="private-fixed-reschedule-target-summary-teacher">
                        변경 후 선생님:{' '}
                        {fixedRescheduleServerPreviewTargetSummary.teacherName ||
                          fixedRescheduleServerPreviewTargetSummary.teacherKey ||
                          fixedRescheduleServerPreviewTargetSummary.teacherUid ||
                          '-'}
                      </span>
                      <span data-testid="private-fixed-reschedule-target-summary-duration">
                        변경 후 수업 길이:{' '}
                        {Number(fixedRescheduleServerPreviewTargetSummary.durationMinutes || 0) ||
                          '-'}
                        분
                      </span>
                      <span data-testid="private-fixed-reschedule-target-summary-lesson-name">
                        변경 후 수업명: {fixedRescheduleServerPreviewTargetSummary.lessonName || '-'}
                      </span>
                    </div>
                  ) : null}
                  {fixedRescheduleServerPreviewConflicts.length > 0 ? (
                    <div style={{ display: 'grid', gap: 4, color: '#fca5a5' }}>
                      <strong>conflicts</strong>
                      {fixedRescheduleServerPreviewConflicts.map((conflict, index) => (
                        <span
                          key={`fixed-reschedule-server-conflict-${index}`}
                          data-testid="private-fixed-reschedule-server-preview-conflict"
                        >
                          {typeof conflict === 'string'
                            ? conflict
                            : conflict.message || conflict.code || JSON.stringify(conflict)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span data-testid="private-fixed-reschedule-server-preview-conflict">
                      서버 기준 conflict 없음
                    </span>
                  )}
                  {fixedRescheduleServerPreviewWarnings.length > 0 ? (
                    <div style={{ display: 'grid', gap: 4, color: '#f5c17a' }}>
                      <strong>warnings</strong>
                      {fixedRescheduleServerPreviewWarnings.map((warning, index) => (
                        <span
                          key={`fixed-reschedule-server-warning-${index}`}
                          data-testid="private-fixed-reschedule-server-preview-warning"
                        >
                          {typeof warning === 'string'
                            ? warning
                            : warning.message || warning.code || JSON.stringify(warning)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span data-testid="private-fixed-reschedule-server-preview-warning">
                      서버 기준 warning 없음
                    </span>
                  )}
                  {fixedRescheduleServerPreview.nextStep ? (
                    <span data-testid="private-fixed-reschedule-server-preview-next-step">
                      {fixedRescheduleServerPreview.nextStep}
                    </span>
                  ) : null}
                  <div
                    style={{
                      display: 'grid',
                      gap: 8,
                      paddingTop: 8,
                      borderTop: '1px solid #293246',
                    }}
                  >
                    <span style={{ color: '#d7def0' }}>
                      서버 검증이 통과한 경우에만 실제 수정 전 최종 확인을 진행합니다.
                    </span>
                    <span style={{ color: '#9ca3af' }}>아직 이 버튼만으로는 수정되지 않습니다.</span>
                    <button
                      type="button"
                      data-testid="private-fixed-reschedule-commit-confirm-open"
                      disabled={!canOpenFixedRescheduleCommitConfirmModal}
                      onClick={() => setShowFixedRescheduleCommitConfirmModal(true)}
                      style={{
                        justifySelf: 'start',
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid #60a5fa',
                        background: canOpenFixedRescheduleCommitConfirmModal ? '#2563eb' : '#1f2937',
                        color: canOpenFixedRescheduleCommitConfirmModal ? 'white' : '#9ca3af',
                        cursor: canOpenFixedRescheduleCommitConfirmModal ? 'pointer' : 'not-allowed',
                        fontWeight: 700,
                      }}
                    >
                      수정 내용 최종 확인
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                type="button"
                data-testid="private-fixed-reschedule-scope-close"
                onClick={closeFixedRescheduleScopePreview}
                style={{
                  padding: '9px 14px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor: 'pointer',
                }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showFixedRescheduleCommitConfirmModal && selectedFixedRescheduleLesson ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="private-fixed-reschedule-commit-confirm-title"
          data-testid="private-fixed-reschedule-commit-confirm-modal"
          data-commit-feedback-state={hasFixedRescheduleCommitFeedback ? 'present' : 'none'}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.62)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1007,
            padding: 16,
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget && !fixedRescheduleCommitBusy) {
              closeFixedRescheduleCommitConfirmModal()
            }
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 860,
              maxHeight: '90vh',
              overflowY: 'auto',
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
              id="private-fixed-reschedule-commit-confirm-title"
              style={{ margin: '0 0 8px 0', fontSize: 18 }}
            >
              고정 수업 수정 최종 확인
            </h2>
            <div
              style={{
                display: 'grid',
                gap: 4,
                padding: 12,
                border: '1px solid #3b4252',
                borderRadius: 8,
                background: '#111722',
                color: '#d7def0',
                fontSize: 13,
                lineHeight: 1.6,
                marginBottom: 14,
              }}
            >
              <span>아직 수정하지 않았습니다.</span>
              <span>아래 생성/수정 버튼을 누르면 고정 수업, 슬롯, 예약 문서가 실제 수정됩니다.</span>
              <span>실행 전 변경 범위와 변경 후 값을 다시 확인하세요.</span>
            </div>

            <div style={{ display: 'grid', gap: 12, fontSize: 13, lineHeight: 1.6 }}>
              <div
                data-testid="private-fixed-reschedule-commit-selected-lesson"
                style={{ padding: 12, border: '1px solid #293246', borderRadius: 8 }}
              >
                <strong>선택한 수업</strong>
                <div>
                  {getFixedRescheduleLessonDate(selectedFixedRescheduleLesson) || '-'}{' '}
                  {getFixedRescheduleLessonTime(selectedFixedRescheduleLesson) || '-'} · 학생{' '}
                  {selectedFixedRescheduleLesson.studentName ||
                    selectedFixedRescheduleLesson.student ||
                    getFixedRescheduleStudentId(selectedFixedRescheduleLesson) ||
                    '-'}{' '}
                  · 선생님 {getPrivateSlotTeacherDisplay(selectedFixedRescheduleLesson)}
                </div>
                <div>
                  package {getFixedReschedulePrimaryPackageId(selectedFixedRescheduleLesson) || '-'} ·
                  batch {getFixedRescheduleBatchId(selectedFixedRescheduleLesson) || '-'} · template{' '}
                  {selectedFixedRescheduleLesson.privateLessonAvailabilityTemplateId || '-'}
                </div>
              </div>

              <div
                data-testid="private-fixed-reschedule-commit-scope-summary"
                style={{ padding: 12, border: '1px solid #293246', borderRadius: 8 }}
              >
                <strong>변경 범위</strong>
                <div>
                  scope mode {fixedRescheduleServerPreview?.scopeMode || fixedRescheduleScopeMode || '-'} ·
                  included {fixedRescheduleServerPreviewIncludedLessons.length}건 · excluded{' '}
                  {fixedRescheduleServerPreviewExcludedLessons.length}건
                </div>
              </div>

              <div
                data-testid="private-fixed-reschedule-commit-before-summary"
                style={{ padding: 12, border: '1px solid #293246', borderRadius: 8 }}
              >
                <strong>변경 전 값</strong>
                <div>기존 날짜: {getFixedRescheduleLessonDate(selectedFixedRescheduleLesson) || '-'}</div>
                <div>기존 시간: {getFixedRescheduleLessonTime(selectedFixedRescheduleLesson) || '-'}</div>
                <div>기존 선생님: {getPrivateSlotTeacherDisplay(selectedFixedRescheduleLesson)}</div>
                <div>
                  기존 수업 길이: {getFixedRescheduleDurationMinutes(selectedFixedRescheduleLesson)}분
                </div>
                <div>기존 수업명: {getFixedRescheduleLessonName(selectedFixedRescheduleLesson)}</div>
              </div>

              <div
                data-testid="private-fixed-reschedule-commit-target-summary"
                style={{ padding: 12, border: '1px solid #293246', borderRadius: 8 }}
              >
                <strong>변경 후 값</strong>
                <div>targetDate: {fixedRescheduleServerPreviewTargetSummary.date || '-'}</div>
                <div>targetTime: {fixedRescheduleServerPreviewTargetSummary.time || '-'}</div>
                <div>
                  targetTeacherName:{' '}
                  {fixedRescheduleServerPreviewTargetSummary.teacherName ||
                    fixedRescheduleServerPreviewTargetSummary.teacherKey ||
                    fixedRescheduleServerPreviewTargetSummary.teacherUid ||
                    '-'}
                </div>
                <div>
                  targetDurationMinutes:{' '}
                  {Number(fixedRescheduleServerPreviewTargetSummary.durationMinutes || 0) || '-'}
                </div>
                <div>targetLessonName: {fixedRescheduleServerPreviewTargetSummary.lessonName || '-'}</div>
              </div>

              <div
                data-testid="private-fixed-reschedule-commit-would-update"
                style={{ padding: 12, border: '1px solid #293246', borderRadius: 8 }}
              >
                <strong>수정 예정 항목</strong>
                <div>
                  lessons {Number(fixedRescheduleServerPreviewWouldUpdate.lessons || 0)}건 ·
                  privateLessonSlots{' '}
                  {Number(fixedRescheduleServerPreviewWouldUpdate.privateLessonSlots || 0)}건 ·
                  privateLessonReservations{' '}
                  {Number(fixedRescheduleServerPreviewWouldUpdate.privateLessonReservations || 0)}건
                </div>
                <div>
                  teacherTemplateAction{' '}
                  {fixedRescheduleServerPreviewWouldUpdate.teacherTemplateAction || '-'} ·
                  teacherTimePreparation.status {fixedRescheduleCommitTeacherTimeStatus || '-'}
                </div>
              </div>

              <div style={{ padding: 12, border: '1px solid #293246', borderRadius: 8 }}>
                <strong>included lessons</strong>
                <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                  {fixedRescheduleServerPreviewIncludedLessons.map((lesson, index) => (
                    <span
                      key={`fixed-reschedule-commit-included-${lesson.id || index}`}
                      data-testid="private-fixed-reschedule-commit-included-row"
                    >
                      {lesson.date || '-'} {lesson.time || '-'} · 학생{' '}
                      {lesson.studentName || lesson.studentId || '-'} · 선생님{' '}
                      {lesson.teacherName || lesson.teacherKey || lesson.teacherUid || '-'}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ padding: 12, border: '1px solid #293246', borderRadius: 8 }}>
                <strong>excluded lessons</strong>
                <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                  {fixedRescheduleServerPreviewExcludedLessons.length > 0 ? (
                    fixedRescheduleServerPreviewExcludedLessons.map((lesson, index) => (
                      <span
                        key={`fixed-reschedule-commit-excluded-${lesson.id || index}`}
                        data-testid="private-fixed-reschedule-commit-excluded-row"
                      >
                        {lesson.date || '-'} {lesson.time || '-'} ·{' '}
                        {lesson.reason || lesson.message || lesson.code || '-'}
                      </span>
                    ))
                  ) : (
                    <span data-testid="private-fixed-reschedule-commit-excluded-row">제외 없음</span>
                  )}
                </div>
              </div>

              <div style={{ padding: 12, border: '1px solid #293246', borderRadius: 8 }}>
                <strong>warnings/conflicts</strong>
                <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                  {fixedRescheduleServerPreviewConflicts.length > 0 ? (
                    fixedRescheduleServerPreviewConflicts.map((conflict, index) => (
                      <span
                        key={`fixed-reschedule-commit-conflict-${index}`}
                        data-testid="private-fixed-reschedule-commit-conflict"
                        style={{ color: '#fca5a5' }}
                      >
                        conflicts가 있다면 commit 불가 ·{' '}
                        {typeof conflict === 'string'
                          ? conflict
                          : conflict.message || conflict.code || JSON.stringify(conflict)}
                      </span>
                    ))
                  ) : (
                    <span data-testid="private-fixed-reschedule-commit-conflict">
                      commit 차단 conflict 없음
                    </span>
                  )}
                  {fixedRescheduleServerPreviewWarnings.length > 0 ? (
                    fixedRescheduleServerPreviewWarnings.map((warning, index) => (
                      <span
                        key={`fixed-reschedule-commit-warning-${index}`}
                        data-testid="private-fixed-reschedule-commit-warning"
                        style={{ color: '#f5c17a' }}
                      >
                        {typeof warning === 'string'
                          ? warning
                          : warning.message || warning.code || JSON.stringify(warning)}
                      </span>
                    ))
                  ) : (
                    <span data-testid="private-fixed-reschedule-commit-warning">warning 없음</span>
                  )}
                </div>
              </div>

              <div
                data-testid="private-fixed-reschedule-commit-request-id"
                style={{ padding: 12, border: '1px solid #293246', borderRadius: 8 }}
              >
                <strong>requestId / batch 후보</strong>
                <div>requestId: {fixedRescheduleServerPreviewPayload?.requestId || '-'}</div>
                <div>
                  payload source: 서버 dryRun 통과 시 보관한 fixedRescheduleServerPreviewPayload를
                  그대로 사용합니다.
                </div>
              </div>
            </div>

            {fixedRescheduleCommitError ? (
              <div
                data-testid="private-fixed-reschedule-commit-error"
                style={{
                  display: 'grid',
                  gap: 4,
                  marginTop: 14,
                  padding: 12,
                  border: '1px solid #7f1d1d',
                  borderRadius: 8,
                  background: '#2f1111',
                  color: '#fecaca',
                  fontSize: 13,
                }}
              >
                <strong>수정 실행 중 오류가 발생했습니다.</strong>
                <span data-testid="private-fixed-reschedule-commit-error-persisted">
                  고정 수업 수정 실행 중 오류가 발생했습니다.
                </span>
                <span>{fixedRescheduleCommitError}</span>
                <span>상태를 확인한 뒤 서버 기준 범위 검증과 DB 원장 확인을 다시 실행하세요.</span>
                <span>같은 요청을 반복해서 누르지 마세요.</span>
              </div>
            ) : null}

            {fixedRescheduleCommitResult ? (
              <div
                data-testid="private-fixed-reschedule-commit-result"
                style={{
                  display: 'grid',
                  gap: 6,
                  marginTop: 14,
                  padding: 12,
                  border: '1px solid #166534',
                  borderRadius: 8,
                  background: '#102719',
                  color: '#dcfce7',
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                <strong>고정 수업 수정이 완료되었습니다</strong>
                <span data-testid="private-fixed-reschedule-commit-result-persisted">
                  고정 수업 수정이 완료되었습니다
                </span>
                <span data-testid="private-fixed-reschedule-commit-result-batch-id">
                  batchId: {fixedRescheduleCommitResult.batchId || '-'}
                </span>
                <span data-testid="private-fixed-reschedule-commit-result-idempotent-replay">
                  idempotentReplay: {fixedRescheduleCommitResult.idempotentReplay ? '예' : '아니오'}
                </span>
                <span data-testid="private-fixed-reschedule-commit-result-updated">
                  updated lessons {fixedRescheduleCommitUpdatedLessons.length}건 ·
                  privateLessonSlots {fixedRescheduleCommitUpdatedSlots.length}건 ·
                  privateLessonReservations {fixedRescheduleCommitUpdatedReservations.length}건
                </span>
                <span data-testid="private-fixed-reschedule-commit-result-teacher-template">
                  teacherTemplateAction {fixedRescheduleCommitUpdated.teacherTemplateAction || '-'} ·
                  teacherTemplateId {fixedRescheduleCommitUpdated.teacherTemplateId || '-'}
                </span>
                <span data-testid="private-fixed-reschedule-commit-result-normalized-plan">
                  normalizedPlan:{' '}
                  {JSON.stringify(fixedRescheduleCommitResult.normalizedPlan || {})}
                </span>
                <span>nextStep: {fixedRescheduleCommitResult.nextStep || '-'}</span>
                <span>requestId: {fixedRescheduleCommitPayload?.requestId || '-'}</span>
                {updatedRescheduleLessonCount > 0 ? (
                  <button
                    type="button"
                    data-testid="private-fixed-reschedule-view-updated-lessons"
                    onClick={handleViewUpdatedFixedRescheduleLessons}
                    disabled={fixedRescheduleCommitBusy}
                    style={{
                      justifySelf: 'start',
                      marginTop: 6,
                      padding: '7px 12px',
                      borderRadius: 8,
                      border: '1px solid #1f6f43',
                      background: '#166534',
                      color: '#dcfce7',
                      fontWeight: 700,
                      cursor: fixedRescheduleCommitBusy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    수정된 일정 보기
                  </button>
                ) : null}
              </div>
            ) : null}

            <div
              data-testid="private-fixed-reschedule-inspector-no-write-note"
              style={{
                display: 'grid',
                gap: 8,
                marginTop: 14,
                padding: 12,
                border: '1px solid #1d4ed8',
                borderRadius: 8,
                background: '#0f172a',
                color: '#dbeafe',
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              <strong>DB 원장 확인</strong>
              <span>실제 수정 전 DB 원장 확인을 먼저 실행하세요.</span>
              <span>이 확인은 read-only이며 수업, 슬롯, 예약 문서를 수정하지 않습니다.</span>
              <span>원장 확인이 통과하면 실제 수정 버튼이 활성화됩니다.</span>
              <button
                type="button"
                data-testid="private-fixed-reschedule-inspector-button"
                onClick={onInspectFixedRescheduleStateOnServer}
                disabled={!canInspectFixedRescheduleState}
                style={{
                  justifySelf: 'start',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid #60a5fa',
                  background: canInspectFixedRescheduleState ? '#1d4ed8' : '#1f2937',
                  color: canInspectFixedRescheduleState ? 'white' : '#9ca3af',
                  cursor: canInspectFixedRescheduleState ? 'pointer' : 'not-allowed',
                  fontWeight: 700,
                }}
              >
                {fixedRescheduleInspectorBusy ? (
                  <span data-testid="private-fixed-reschedule-inspector-loading">
                    DB 원장 확인 중...
                  </span>
                ) : (
                  'DB 원장 확인'
                )}
              </button>
            </div>

            {fixedRescheduleInspectorError ? (
              <div
                data-testid="private-fixed-reschedule-inspector-error"
                style={{
                  display: 'grid',
                  gap: 4,
                  marginTop: 14,
                  padding: 12,
                  border: '1px solid #7f1d1d',
                  borderRadius: 8,
                  background: '#2f1111',
                  color: '#fecaca',
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                <strong>DB 원장 확인 중 오류가 발생했습니다.</strong>
                <span>{fixedRescheduleInspectorError}</span>
                <span>서버 기준 범위 검증을 다시 실행한 뒤 확인하세요.</span>
              </div>
            ) : null}

            {fixedRescheduleInspectorResult ? (
              <div
                data-testid="private-fixed-reschedule-inspector-result"
                style={{
                  display: 'grid',
                  gap: 6,
                  marginTop: 14,
                  padding: 12,
                  border: '1px solid #14532d',
                  borderRadius: 8,
                  background: '#0f2217',
                  color: '#dcfce7',
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                <strong>DB 원장 확인 결과</strong>
                <span data-testid="private-fixed-reschedule-inspector-readonly">
                  readOnly: {fixedRescheduleInspectorResult.readOnly ? 'true' : 'false'} · mode{' '}
                  {fixedRescheduleInspectorResult.inspectMode ||
                    fixedRescheduleInspectorPayload?.mode ||
                    '-'}
                </span>
                <span data-testid="private-fixed-reschedule-inspector-selected-lesson">
                  selectedLesson:{' '}
                  {fixedRescheduleInspectorResult.selectedLesson?.exists ? 'exists' : 'missing'} ·
                  status {fixedRescheduleInspectorResult.selectedLesson?.status || '-'} ·{' '}
                  {fixedRescheduleInspectorResult.selectedLesson?.date || '-'}{' '}
                  {fixedRescheduleInspectorResult.selectedLesson?.time || '-'}
                </span>
                <span data-testid="private-fixed-reschedule-inspector-linked-slot">
                  linkedSlot:{' '}
                  {fixedRescheduleInspectorResult.linkedSlot?.rows?.[0]?.exists
                    ? 'exists'
                    : fixedRescheduleInspectorResult.linkedSlot?.count > 0
                      ? '확인 필요'
                      : 'missing'}{' '}
                  · status {fixedRescheduleInspectorResult.linkedSlot?.rows?.[0]?.status || '-'} ·{' '}
                  {fixedRescheduleInspectorResult.linkedSlot?.rows?.[0]?.date || '-'}{' '}
                  {fixedRescheduleInspectorResult.linkedSlot?.rows?.[0]?.time || '-'}
                </span>
                <span data-testid="private-fixed-reschedule-inspector-linked-reservation">
                  linkedReservation:{' '}
                  {fixedRescheduleInspectorResult.linkedReservation?.rows?.[0]?.exists
                    ? 'exists'
                    : fixedRescheduleInspectorResult.linkedReservation?.count > 0
                      ? '확인 필요'
                      : 'missing'}{' '}
                  · status{' '}
                  {fixedRescheduleInspectorResult.linkedReservation?.rows?.[0]?.status || '-'} ·{' '}
                  {fixedRescheduleInspectorResult.linkedReservation?.rows?.[0]?.date || '-'}{' '}
                  {fixedRescheduleInspectorResult.linkedReservation?.rows?.[0]?.time || '-'}
                </span>
                <span data-testid="private-fixed-reschedule-inspector-target-template">
                  targetTemplate: status {fixedRescheduleInspectorResult.targetTemplate?.status || '-'} ·
                  actionCandidate{' '}
                  {fixedRescheduleInspectorResult.targetTemplate?.actionCandidate ||
                    fixedRescheduleInspectorResult.targetTemplate?.action ||
                    '-'}
                </span>
                <span data-testid="private-fixed-reschedule-inspector-conflict">
                  targetConflicts: {fixedRescheduleInspectorTargetConflicts.length}건
                </span>
                <span data-testid="private-fixed-reschedule-inspector-batch">
                  fixedPrivateRescheduleBatch:{' '}
                  {fixedRescheduleInspectorResult.fixedPrivateRescheduleBatch?.exists
                    ? 'exists'
                    : 'missing'}{' '}
                  · status {fixedRescheduleInspectorResult.fixedPrivateRescheduleBatch?.status || '-'}
                </span>
                <span data-testid="private-fixed-reschedule-inspector-consistency">
                  canProceedToCommitCandidate:{' '}
                  {fixedRescheduleInspectorResult.consistency?.canProceedToCommitCandidate
                    ? 'true'
                    : 'false'}
                </span>
                {fixedRescheduleInspectorWarnings.length > 0 ? (
                  fixedRescheduleInspectorWarnings.map((warning, index) => (
                    <span
                      key={`fixed-reschedule-inspector-warning-${index}`}
                      data-testid="private-fixed-reschedule-inspector-warning"
                      style={{ color: '#f5c17a' }}
                    >
                      {typeof warning === 'string'
                        ? warning
                        : warning.message || warning.code || JSON.stringify(warning)}
                    </span>
                  ))
                ) : (
                  <span data-testid="private-fixed-reschedule-inspector-warning">
                    warning 없음
                  </span>
                )}
                <span data-testid="private-fixed-reschedule-inspector-next-step">
                  nextStep: {fixedRescheduleInspectorResult.nextStep || '-'}
                </span>
              </div>
            ) : null}

            <div
              data-testid="private-fixed-reschedule-commit-warning-note"
              style={{
                display: 'grid',
                gap: 4,
                marginTop: 14,
                padding: 12,
                border: '1px solid #92400e',
                borderRadius: 8,
                background: '#231609',
                color: '#fed7aa',
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              <span>이 버튼을 누르면 고정 수업, 슬롯, 예약 문서가 실제 수정됩니다.</span>
              <span>처리 중에는 중복 클릭을 막기 위해 버튼이 잠깁니다.</span>
              <span>수정 후에는 기존 고정 1:1 수업 일정에서 확인할 수 있습니다.</span>
              {!fixedRescheduleInspectorCanProceed ? (
                <span data-testid="private-fixed-reschedule-commit-gated-note">
                  DB 원장 확인이 통과해야 실제 수정 버튼이 활성화됩니다.
                </span>
              ) : null}
              {fixedRescheduleCommitBusy ? (
                <span data-testid="private-fixed-reschedule-commit-busy-keep-open-note">
                  처리 중에는 이 창을 닫지 말고 결과를 기다려주세요.
                </span>
              ) : null}
              {fixedRescheduleCommitError ? (
                <span>오류 후에는 서버 기준 범위 검증과 DB 원장 확인을 다시 실행하세요.</span>
              ) : null}
            </div>

            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end',
                marginTop: 18,
              }}
            >
              <button
                type="button"
                data-testid="private-fixed-reschedule-commit-button"
                onClick={onCommitFixedReschedule}
                disabled={!canCommitFixedReschedule}
                style={{
                  padding: '9px 14px',
                  borderRadius: 8,
                  border: '1px solid #60a5fa',
                  background: canCommitFixedReschedule ? '#2563eb' : '#1f2937',
                  color: canCommitFixedReschedule ? 'white' : '#9ca3af',
                  cursor: canCommitFixedReschedule ? 'pointer' : 'not-allowed',
                  fontWeight: 700,
                }}
              >
                {fixedRescheduleCommitBusy ? (
                  <span data-testid="private-fixed-reschedule-commit-loading">
                    고정 수업 수정 중...
                  </span>
                ) : (
                  '위 내용으로 고정 수업 수정'
                )}
              </button>
              <button
                type="button"
                data-testid="private-fixed-reschedule-commit-close"
                onClick={closeFixedRescheduleCommitConfirmModal}
                disabled={fixedRescheduleCommitBusy}
                style={{
                  padding: '9px 14px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: fixedRescheduleCommitBusy ? '#9ca3af' : 'white',
                  cursor: fixedRescheduleCommitBusy ? 'not-allowed' : 'pointer',
                }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
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
