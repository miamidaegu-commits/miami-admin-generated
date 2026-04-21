
export default function StudentModal({
  studentModal,
  studentForm,
  setStudentForm,
  studentFormErrors,
  isAdmin,
  teacherSelectOptions,
  isStudentModalSubmitting,
  closeStudentModal,
  submitStudentModal,
}) {
  const normalizedTeacher = String(studentForm.teacher || '').trim()
  const hasTeacherOption = teacherSelectOptions.some((opt) => opt.value === normalizedTeacher)
  const mergedTeacherOptions =
    isAdmin && normalizedTeacher && !hasTeacherOption
      ? [{ value: normalizedTeacher, label: `기존 값: ${normalizedTeacher}` }, ...teacherSelectOptions]
      : teacherSelectOptions

  return (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-modal-title"
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
            if (e.target === e.currentTarget) closeStudentModal()
          }}
        >
          <div
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
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="student-modal-title"
              style={{ margin: '0 0 6px 0', fontSize: '1.1rem', fontWeight: 600 }}
            >
              {studentModal.type === 'add' ? '학생 추가' : '학생 수정'}
            </h2>
            <p style={{ margin: '0 0 16px 0', fontSize: 13, opacity: 0.78, lineHeight: 1.45 }}>
              학생의 기본 정보를 입력해 주세요.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>이름</span>
                <input
                  type="text"
                  value={studentForm.name}
                  onChange={(e) =>
                    setStudentForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  autoComplete="name"
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {studentFormErrors.name ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>{studentFormErrors.name}</span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>담당 선생님</span>
                {isAdmin ? (
                  <select
                    value={studentForm.teacher}
                    onChange={(e) =>
                      setStudentForm((prev) => ({ ...prev, teacher: e.target.value }))
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
                ) : (
                  <input
                    type="text"
                    value={studentForm.teacher}
                    readOnly
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                    }}
                  />
                )}
                {studentFormErrors.teacher ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>{studentFormErrors.teacher}</span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>전화번호</span>
                <input
                  type="tel"
                  value={studentForm.phone}
                  onChange={(e) =>
                    setStudentForm((prev) => ({ ...prev, phone: e.target.value }))
                  }
                  autoComplete="tel"
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>차번호</span>
                <input
                  type="text"
                  value={studentForm.carNumber}
                  onChange={(e) =>
                    setStudentForm((prev) => ({ ...prev, carNumber: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>수강 목적</span>
                <textarea
                  value={studentForm.learningPurpose}
                  onChange={(e) =>
                    setStudentForm((prev) => ({ ...prev, learningPurpose: e.target.value }))
                  }
                  rows={2}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                    resize: 'vertical',
                    minHeight: 48,
                    fontFamily: 'inherit',
                    fontSize: 13,
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>첫 등록일</span>
                <input
                  type="date"
                  value={studentForm.firstRegisteredAt}
                  onChange={(e) =>
                    setStudentForm((prev) => ({
                      ...prev,
                      firstRegisteredAt: e.target.value,
                    }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {studentFormErrors.firstRegisteredAt ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentFormErrors.firstRegisteredAt}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>메모</span>
                <textarea
                  value={studentForm.note}
                  onChange={(e) =>
                    setStudentForm((prev) => ({ ...prev, note: e.target.value }))
                  }
                  rows={3}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                    resize: 'vertical',
                    minHeight: 72,
                    fontFamily: 'inherit',
                    fontSize: 13,
                  }}
                />
              </label>
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
                onClick={closeStudentModal}
                disabled={isStudentModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor: isStudentModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitStudentModal}
                disabled={isStudentModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #4a6fff55',
                  background: '#1f2a44',
                  color: 'white',
                  cursor: isStudentModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                {isStudentModalSubmitting ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>

  )
}
