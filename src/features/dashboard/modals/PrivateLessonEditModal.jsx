import { getStudentName, getTeacherName } from '../dashboardViewUtils.js'

export default function PrivateLessonEditModal({
  privateLessonEditModal,
  privateLessonEditForm,
  setPrivateLessonEditForm,
  privateLessonEditFormErrors,
  closePrivateLessonEditModal,
  submitPrivateLessonEditModal,
  isPrivateLessonEditSubmitting,
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="private-lesson-edit-modal-title"
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
        if (e.target === e.currentTarget) closePrivateLessonEditModal()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
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
          id="private-lesson-edit-modal-title"
          style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
        >
          개인 수업 수정
        </h2>
        <p style={{ margin: '0 0 16px 0', fontSize: 13, opacity: 0.8 }}>
          {getStudentName(privateLessonEditModal.lesson)} ·{' '}
          {getTeacherName(privateLessonEditModal.lesson)}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>날짜</span>
            <input
              type="date"
              value={privateLessonEditForm.date}
              onChange={(e) =>
                setPrivateLessonEditForm((prev) => ({ ...prev, date: e.target.value }))
              }
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
              }}
            />
            {privateLessonEditFormErrors.date ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>
                {privateLessonEditFormErrors.date}
              </span>
            ) : null}
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>시간</span>
            <input
              type="time"
              value={privateLessonEditForm.time}
              onChange={(e) =>
                setPrivateLessonEditForm((prev) => ({ ...prev, time: e.target.value }))
              }
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
              }}
            />
            {privateLessonEditFormErrors.time ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>
                {privateLessonEditFormErrors.time}
              </span>
            ) : null}
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>과목</span>
            <input
              type="text"
              value={privateLessonEditForm.subject}
              onChange={(e) =>
                setPrivateLessonEditForm((prev) => ({ ...prev, subject: e.target.value }))
              }
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
              }}
            />
            {privateLessonEditFormErrors.subject ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>
                {privateLessonEditFormErrors.subject}
              </span>
            ) : null}
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
            onClick={closePrivateLessonEditModal}
            disabled={isPrivateLessonEditSubmitting}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #555',
              background: 'transparent',
              color: 'white',
              cursor: isPrivateLessonEditSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={submitPrivateLessonEditModal}
            disabled={isPrivateLessonEditSubmitting}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #4a6fff55',
              background: '#1f2a44',
              color: 'white',
              cursor: isPrivateLessonEditSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            {isPrivateLessonEditSubmitting ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
