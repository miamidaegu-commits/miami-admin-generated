import { GROUP_RECURRENCE_WEEKDAY_TOGGLES } from '../dashboardViewUtils.js'

export default function GroupModal({
  groupModal,
  groupForm,
  setGroupForm,
  groupFormErrors,
  setGroupFormErrors,
  teacherSelectOptions,
  closeGroupModal,
  submitGroupModal,
  isGroupModalSubmitting,
}) {
  const normalizedTeacher = String(groupForm.teacher || '').trim()
  const hasTeacherOption = teacherSelectOptions.some((opt) => opt.value === normalizedTeacher)
  const mergedTeacherOptions =
    normalizedTeacher && !hasTeacherOption
      ? [{ value: normalizedTeacher, label: `기존 값: ${normalizedTeacher}` }, ...teacherSelectOptions]
      : teacherSelectOptions

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeGroupModal()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          background: '#151922',
          border: '1px solid #2e3240',
          borderRadius: 12,
          padding: 20,
          color: 'white',
          boxSizing: 'border-box',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="group-modal-title"
          style={{ margin: '0 0 10px 0', fontSize: '1.1rem', fontWeight: 600 }}
        >
          {groupModal.type === 'add' ? '정규반 만들기' : '반 수정'}
        </h2>

        {groupModal.type === 'add' ? (
          <p style={{ margin: '0 0 14px 0', fontSize: 12, opacity: 0.72, lineHeight: 1.45 }}>
            반 정보·수업 시간·반복 요일을 저장하면, 시작일부터 약 1년간 수업 일정이 자동으로
            만들어집니다.
          </p>
        ) : null}

        <div
          style={{
            maxHeight: 'min(72vh, 560px)',
            overflowY: 'auto',
            paddingRight: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.92 }}>
              반 정보
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>반 이름</span>
                <input
                  type="text"
                  value={groupForm.name}
                  onChange={(e) =>
                    setGroupForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {groupFormErrors.name ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>{groupFormErrors.name}</span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>담당 선생님</span>
                <select
                  value={groupForm.teacher}
                  onChange={(e) =>
                    setGroupForm((prev) => ({ ...prev, teacher: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                >
                  <option value="">선생님 선택</option>
                  {mergedTeacherOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {groupFormErrors.teacher ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {groupFormErrors.teacher}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>정원 (명)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={groupForm.maxStudents}
                  onChange={(e) =>
                    setGroupForm((prev) => ({ ...prev, maxStudents: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {groupFormErrors.maxStudents ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {groupFormErrors.maxStudents}
                  </span>
                ) : null}
              </label>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.92 }}>
              수업 정보
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {groupModal.type === 'add' ? (
                <label
                  style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}
                >
                  <span style={{ opacity: 0.85 }}>수업 시작일 (자동 일정 기준)</span>
                  <input
                    type="date"
                    value={groupForm.startDate}
                    onChange={(e) =>
                      setGroupForm((prev) => ({ ...prev, startDate: e.target.value }))
                    }
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                    }}
                  />
                  {groupFormErrors.startDate ? (
                    <span style={{ color: '#f08080', fontSize: 12 }}>
                      {groupFormErrors.startDate}
                    </span>
                  ) : null}
                </label>
              ) : null}

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>기본 시간 (HH:mm)</span>
                <input
                  type="time"
                  value={groupForm.time}
                  onChange={(e) =>
                    setGroupForm((prev) => ({ ...prev, time: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {groupFormErrors.time ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>{groupFormErrors.time}</span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>과목</span>
                <input
                  type="text"
                  value={groupForm.subject}
                  onChange={(e) =>
                    setGroupForm((prev) => ({ ...prev, subject: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {groupFormErrors.subject ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {groupFormErrors.subject}
                  </span>
                ) : null}
              </label>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.92 }}>
              반복 설정
            </div>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>
              recurrenceMode: <code style={{ fontSize: 11 }}>fixedWeekdays</code> (고정 요일,
              읽기 전용)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              <span style={{ opacity: 0.85 }}>요일 (1=일 … 7=토)</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {GROUP_RECURRENCE_WEEKDAY_TOGGLES.map(({ value, label }) => {
                  const checked =
                    Array.isArray(groupForm.weekdays) && groupForm.weekdays.includes(value)
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setGroupForm((prev) => {
                          const prevWd = Array.isArray(prev.weekdays) ? prev.weekdays : []
                          const set = new Set(prevWd)
                          if (set.has(value)) set.delete(value)
                          else set.add(value)
                          return { ...prev, weekdays: [...set].sort((a, b) => a - b) }
                        })
                      }}
                      style={{
                        minWidth: 38,
                        height: 32,
                        borderRadius: 999,
                        border: checked ? '1px solid #5f7dff' : '1px solid #444',
                        background: checked ? '#273a7a' : '#1b1f29',
                        color: checked ? '#dbe4ff' : 'white',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: checked ? 700 : 500,
                        padding: '0 12px',
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              <span style={{ fontSize: 12, opacity: 0.72 }}>
                선택한 요일 수 = 주 {Array.isArray(groupForm.weekdays) ? groupForm.weekdays.length : 0}
                회 (예: 주 2회=2개, 주 3회=3개)
              </span>
              {groupFormErrors.weekdays ? (
                <span style={{ color: '#f08080', fontSize: 12 }}>
                  {groupFormErrors.weekdays}
                </span>
              ) : null}
            </div>
          </div>

          {groupModal.type === 'edit' ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.92 }}>
                이후 수업 일정
              </div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  fontSize: 13,
                  cursor: isGroupModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(groupForm.rebuildFutureLessons)}
                  disabled={isGroupModalSubmitting}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setGroupForm((prev) => ({ ...prev, rebuildFutureLessons: checked }))
                    if (!checked) {
                      setGroupFormErrors((prev) => {
                        const next = { ...prev }
                        delete next.rebuildFromDate
                        return next
                      })
                    }
                  }}
                  style={{ marginTop: 3, flexShrink: 0 }}
                />
                <span style={{ opacity: 0.9, lineHeight: 1.45 }}>
                  이 날짜부터 이후 수업도 함께 변경
                </span>
              </label>
              {groupForm.rebuildFutureLessons ? (
                <div style={{ marginTop: 12 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                    <span style={{ opacity: 0.85 }}>변경 적용 시작일</span>
                    <input
                      type="date"
                      value={groupForm.rebuildFromDate || ''}
                      onChange={(e) =>
                        setGroupForm((prev) => ({ ...prev, rebuildFromDate: e.target.value }))
                      }
                      disabled={isGroupModalSubmitting}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid #444',
                        background: '#1f1f1f',
                        color: 'white',
                      }}
                    />
                    {groupFormErrors.rebuildFromDate ? (
                      <span style={{ color: '#f08080', fontSize: 12 }}>
                        {groupFormErrors.rebuildFromDate}
                      </span>
                    ) : null}
                  </label>
                  <ul
                    style={{
                      margin: '10px 0 0 1em',
                      padding: 0,
                      fontSize: 12,
                      opacity: 0.72,
                      lineHeight: 1.55,
                    }}
                  >
                    <li>과거 수업은 유지됩니다.</li>
                    <li>선택한 날짜 이후의 미래 정규 수업만 새 규칙으로 다시 생성합니다.</li>
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 20,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={closeGroupModal}
            disabled={isGroupModalSubmitting}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #555',
              background: 'transparent',
              color: 'white',
              cursor: isGroupModalSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={submitGroupModal}
            disabled={isGroupModalSubmitting}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #4a6fff55',
              background: '#1f2a44',
              color: 'white',
              cursor: isGroupModalSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            {isGroupModalSubmitting ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
