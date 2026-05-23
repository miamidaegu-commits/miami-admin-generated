import { useMemo, useState } from 'react'

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

const WEEKDAY_OPTIONS = [
  { value: '1', label: '월요일' },
  { value: '2', label: '화요일' },
  { value: '3', label: '수요일' },
  { value: '4', label: '목요일' },
  { value: '5', label: '금요일' },
  { value: '6', label: '토요일' },
]

function weekdayLabel(value) {
  return WEEKDAY_OPTIONS.find((option) => option.value === String(value))?.label || '-'
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
  privateAvailabilityTemplateForm,
  setPrivateAvailabilityTemplateForm,
  privateAvailabilityTemplateErrors,
  createPrivateAvailabilityTemplate,
  updatePrivateAvailabilityTemplateStatus,
  privateAvailabilityTemplates = [],
  privateAvailabilityTemplatesLoading,
  busyPrivateAvailabilityTemplateId,
  privateStudents = [],
  createPrivateSlot,
  updatePrivateSlotEligibility,
  isPrivateSlotSubmitting,
  privateLessonSlots,
  privateLessonSlotsLoading,
  privateLessonReservations,
  privateLessonReservationsLoading,
  busyPrivateSlotActionId,
  cancelPrivateSlotOrReservation,
  isAdmin,
}) {
  const [editingEligibilitySlotId, setEditingEligibilitySlotId] = useState('')
  const [editingEligibilityStudentIds, setEditingEligibilityStudentIds] = useState([])

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

  const reservationsBySlotId = new Map()
  privateLessonReservations.forEach((reservation) => {
    const slotId = String(reservation.slotId || '').trim()
    if (!slotId) return
    if (!reservationsBySlotId.has(slotId)) reservationsBySlotId.set(slotId, [])
    reservationsBySlotId.get(slotId).push(reservation)
  })

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
            <h3 style={{ margin: 0, fontSize: 16 }}>주간 1:1 가능 시간</h3>
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
              <p style={{ margin: 0, opacity: 0.76 }}>등록된 주간 가능 시간이 없습니다.</p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {privateAvailabilityTemplates.map((template) => {
                  const busy = busyPrivateAvailabilityTemplateId === template.id
                  const status = String(template.status || 'active') === 'active' ? 'active' : 'inactive'
                  return (
                    <div
                      key={template.id}
                      data-testid="private-availability-template-row"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 0.8fr 0.8fr 0.8fr auto',
                        gap: 8,
                        alignItems: 'center',
                        border: '1px solid #2e3240',
                        borderRadius: 8,
                        padding: 10,
                      }}
                    >
                      <span>{template.teacherName || template.teacher || '-'}</span>
                      <span>{weekdayLabel(template.weekday)}</span>
                      <span>{template.time || '-'}</span>
                      <span>{status === 'active' ? '사용' : '중지'}</span>
                      <button
                        type="button"
                        disabled={busy}
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
                        {busy ? '처리 중...' : status === 'active' ? '중지' : '사용'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

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
                style={{ gridTemplateColumns: '1fr 0.9fr 0.8fr 1fr 1fr minmax(160px, auto)' }}
              >
                <span>{[slot.date, slot.time].filter(Boolean).join(' ') || slot.id}</span>
                <span>{slot.teacherName || slot.teacher || '-'}</span>
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
    </section>
  )
}
