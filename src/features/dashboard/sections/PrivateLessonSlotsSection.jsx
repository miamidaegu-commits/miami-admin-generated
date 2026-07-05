import { Fragment, useMemo, useState } from 'react'
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
                  이번 단계에서는 저장하지 않고 미리보기만 제공합니다.
                  <br />
                  실제 연장 저장 기능은 다음 단계에서 제공됩니다.
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
                      style={{ gridTemplateColumns: '0.9fr 0.65fr 0.9fr 0.9fr 1fr 0.8fr minmax(160px, auto)' }}
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
                      </span>
                      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {!isCancelled ? (
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
