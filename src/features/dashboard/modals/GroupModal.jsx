import { GROUP_RECURRENCE_WEEKDAY_TOGGLES } from '../dashboardViewUtils.js'

export default function GroupModal({
  groupModal,
  groupForm,
  setGroupForm,
  groupFormErrors,
  closeGroupModal,
  submitGroupModal,
  isGroupModalSubmitting,
}) {
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
                <input
                  type="text"
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
                />
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
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 14px' }}>
                {GROUP_RECURRENCE_WEEKDAY_TOGGLES.map(({ value, label }) => {
                  const checked =
                    Array.isArray(groupForm.weekdays) && groupForm.weekdays.includes(value)
                  return (
                    <label
                      key={value}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setGroupForm((prev) => {
                            const prevWd = Array.isArray(prev.weekdays) ? prev.weekdays : []
                            const set = new Set(prevWd)
                            if (set.has(value)) set.delete(value)
                            else set.add(value)
                            return { ...prev, weekdays: [...set].sort((a, b) => a - b) }
                          })
                        }}
                      />
                      {label}
                    </label>
                  )
                })}
              </div>
              {groupFormErrors.weekdays ? (
                <span style={{ color: '#f08080', fontSize: 12 }}>
                  {groupFormErrors.weekdays}
                </span>
              ) : null}
            </div>
          </div>
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
