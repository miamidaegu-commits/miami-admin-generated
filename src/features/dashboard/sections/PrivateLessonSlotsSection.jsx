import { Fragment, useMemo, useState } from 'react'
import { PRIVATE_WEEKLY_SLOT_WEEKDAYS } from '../../booking/privateWeeklySlotBulk.js'
import FixedPrivateLessonActionModal from '../components/FixedPrivateLessonActionModal.jsx'

function slotStatusLabel(status) {
  if (status === 'reserved') return '예약 완료'
  if (status === 'cancelled') return '취소된 시간'
  return '예약 가능한 시간'
}

function privateSlotStatusLabel(slot) {
  if (
    slot?.releasedFromFixed === true ||
    String(slot?.slotType || '').trim() === 'released_fixed'
  ) {
    return '고정 취소로 오픈됨'
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
    if (cancellationType === 'seat_released' || lesson?.isSeatReleased === true) return '자리 공개'
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
  createPrivateSlot,
  updatePrivateSlotEligibility,
  isPrivateSlotSubmitting,
  privateLessonSlots,
  privateLessonSlotsLoading,
  privateLessonReservations,
  privateLessonReservationsLoading,
  busyPrivateSlotActionId,
  cancelPrivateSlotOrReservation,
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
  })
  const [editingAvailabilityTemplateErrors, setEditingAvailabilityTemplateErrors] = useState({})

  function openAvailabilityTemplateEdit(template) {
    setEditingAvailabilityTemplateId(String(template?.id || ''))
    setEditingAvailabilityTemplateForm({
      effectiveStartDate: isYmd(template?.effectiveStartDate) ? String(template.effectiveStartDate) : '',
      effectiveEndDate: isYmd(template?.effectiveEndDate) ? String(template.effectiveEndDate) : '',
      status: String(template?.status || 'active') === 'active' ? 'active' : 'inactive',
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
      .filter((template) =>
        privateTemplateMatchesTeacherOption(template, selectedAssignmentTeacherOption)
      )
      .sort((a, b) => {
        const aKey = `${getPrivateSlotTeacherDisplay(a)} ${a.weekday} ${a.time || ''}`
        const bKey = `${getPrivateSlotTeacherDisplay(b)} ${b.weekday} ${b.time || ''}`
        return aKey.localeCompare(bKey, 'ko')
      })
  }, [privateAvailabilityTemplates, selectedAssignmentTeacherOption])

  const reservationsBySlotId = new Map()
  privateLessonReservations.forEach((reservation) => {
    const slotId = String(reservation.slotId || '').trim()
    if (!slotId) return
    if (!reservationsBySlotId.has(slotId)) reservationsBySlotId.set(slotId, [])
    reservationsBySlotId.get(slotId).push(reservation)
  })

  const futureFixedPrivateLessons = useMemo(() => {
    const today = new Date()
    const y = today.getFullYear()
    const m = String(today.getMonth() + 1).padStart(2, '0')
    const d = String(today.getDate()).padStart(2, '0')
    const todayYmd = `${y}-${m}-${d}`
    return (Array.isArray(privateFixedLessons) ? privateFixedLessons : [])
      .filter((lesson) => isFixedPrivateLesson(lesson))
      .filter((lesson) => String(lesson.date || '').trim() >= todayYmd)
      .sort((a, b) =>
        `${a.date || ''} ${a.time || ''} ${a.teacherName || a.teacher || ''}`.localeCompare(
          `${b.date || ''} ${b.time || ''} ${b.teacherName || b.teacher || ''}`,
          'ko'
        )
      )
  }, [privateFixedLessons])

  if (!isAdmin) return null

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
              <h3 style={{ margin: 0, fontSize: 16 }}>기본 1:1 슬롯 일괄 등록</h3>
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
                  {privateAvailabilityBulkResult.mode === 'preview' ? '미리보기 · ' : ''}
                  생성 {privateAvailabilityBulkResult.createdCount}개 · 중복 제외{' '}
                  {privateAvailabilityBulkResult.skippedDuplicateCount}개 · 시간 겹침 제외{' '}
                  {privateAvailabilityBulkResult.skippedOverlapCount}개 · 오류{' '}
                  {privateAvailabilityBulkResult.errorCount}개
                  {privateAvailabilityBulkResult.effectiveStartDate &&
                  privateAvailabilityBulkResult.effectiveEndDate
                    ? ` · 기간: ${privateAvailabilityBulkResult.effectiveStartDate} ~ ${privateAvailabilityBulkResult.effectiveEndDate}`
                    : ''}
                </div>
              ) : null}
            </form>
          </section>

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
            <h3 style={{ margin: 0, fontSize: 16 }}>주간 기본 슬롯 (고정 배정용)</h3>
            <p style={{ margin: 0, opacity: 0.74, fontSize: 12, lineHeight: 1.5 }}>
              특정 기간만 고정 배정에 사용하려면 시작일과 종료일을 입력하세요.
              <br />
              비워두면 기간 제한 없이 반복됩니다.
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
            </form>
            {privateAvailabilityTemplatesLoading ? (
              <p style={{ margin: 0, opacity: 0.76 }}>불러오는 중...</p>
            ) : privateAvailabilityTemplates.length === 0 ? (
              <p style={{ margin: 0, opacity: 0.76 }}>등록된 주간 기본 슬롯이 없습니다.</p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 0.7fr 0.7fr 0.7fr 0.7fr 1fr 1.3fr',
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
                  <span>기간</span>
                  <span>작업</span>
                </div>
                {privateAvailabilityTemplates.map((template) => {
                  const busy = busyPrivateAvailabilityTemplateId === template.id
                  const status = String(template.status || 'active') === 'active' ? 'active' : 'inactive'
                  const editing = editingAvailabilityTemplateId === template.id
                  return (
                    <Fragment key={template.id}>
                      <div
                        data-testid="private-availability-template-row"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 0.7fr 0.7fr 0.7fr 0.7fr 1fr 1.3fr',
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
              <h3 style={{ margin: 0, fontSize: 16 }}>고정 1:1 수업 배정</h3>
              <p style={{ margin: '6px 0 0 0', opacity: 0.74, fontSize: 12 }}>
                주간 기본 슬롯은 선생님 가능 시간으로 유지하고, 선택한 기간의 실제 고정 1:1
                수업만 생성합니다.
                <br />
                수강권 횟수를 사용해 날짜별 고정수업을 생성합니다.
                <br />
                수강권만 등록하면 수업 일정은 자동 생성되지 않습니다.
                <br />
                고정수업은 주간 기본 슬롯에서만 만들 수 있습니다.
                <br />
                원하는 시간이 보이지 않으면 위의 주간 기본 슬롯에 요일/시간/기간을 먼저
                등록하세요.
                <br />
                날짜별 예약 가능 시간은 학생 직접 예약용입니다.
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
                  주간 기본 슬롯 선택
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
                      등록된 주간 기본 슬롯이 없습니다.
                      <br />
                      위의 주간 기본 슬롯 (고정 배정용)에서 먼저 등록하세요.
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
                  {busyPrivateFixedSlotAssignment ? '생성 중...' : '배정 생성'}
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
                      ? `생성 완료 ${privateFixedSlotAssignmentPreview.requestedCount}회`
                      : `생성 예정 ${privateFixedSlotAssignmentPreview.requestedCount}회`}
                  </strong>
                  {privateFixedSlotAssignmentPreview.mode === 'created' &&
                  Number.isFinite(Number(privateFixedSlotAssignmentPreview.availableAssignmentCount)) ? (
                    <div>
                      생성 후 새 배정 가능{' '}
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
              <h3 style={{ margin: 0, fontSize: 16 }}>고정 1:1 수업 일정</h3>
              <p style={{ margin: '6px 0 0 0', opacity: 0.74, fontSize: 12 }}>
                수강권으로 배정된 날짜별 고정수업을 한 번씩 취소하거나 공개합니다.
              </p>
            </div>
            {futureFixedPrivateLessons.length === 0 ? (
              <p style={{ margin: 0, opacity: 0.78 }}>예정된 고정 1:1 수업이 없습니다.</p>
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
                {futureFixedPrivateLessons.map((lesson) => {
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
              날짜별 예약 가능 시간 (학생 직접 예약용)
            </h3>
            <p style={{ margin: 0, opacity: 0.74, fontSize: 12, lineHeight: 1.5 }}>
              이 목록은 학생이 직접 예약할 수 있는 날짜별 시간입니다.
              <br />
              고정 1:1 배정에 사용하려면 주간 기본 슬롯으로 등록하세요.
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
        </>
      ) : null}

      {privateLessonSlotsLoading || privateLessonReservationsLoading ? (
        <p>불러오는 중...</p>
      ) : privateLessonSlots.length === 0 ? (
        <p style={{ opacity: 0.8 }}>등록된 1:1 수업 시간이 없습니다.</p>
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
          {privateLessonSlots.map((slot) => {
            const slotReservations = reservationsBySlotId.get(slot.id) || []
            const activeReservation =
              slotReservations.find((reservation) => reservation.status === 'active') || null
            const busy = busyPrivateSlotActionId === slot.id
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
                  {slot.status !== 'cancelled' ? (
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
                      {busy ? '처리 중...' : activeReservation ? '예약 취소' : '수업 시간 취소'}
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
