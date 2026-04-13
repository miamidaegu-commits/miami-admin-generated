
export default function PostStudentCreateModal({
  postStudentCreateModalStudent,
  closePostStudentCreateModal,
  selectPostStudentCreatePrivatePackage,
  selectPostStudentCreateGroupPackage,
}) {
  return (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="post-student-create-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1001,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closePostStudentCreateModal()
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
              id="post-student-create-modal-title"
              style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
            >
              학생을 등록했습니다
            </h2>
            <p style={{ margin: '0 0 12px 0', fontSize: 14, opacity: 0.9 }}>
              바로 수강권을 추가할까요?
            </p>
            <p style={{ margin: '0 0 20px 0', fontSize: 13, opacity: 0.8 }}>
              {postStudentCreateModalStudent.name || '-'} ·{' '}
              {postStudentCreateModalStudent.teacher || '-'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                onClick={selectPostStudentCreatePrivatePackage}
                style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: '1px solid #4a6fff55',
                  background: '#1f2a44',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                개인 수강권 추가
              </button>
              <button
                type="button"
                onClick={selectPostStudentCreateGroupPackage}
                style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: '1px solid #4a6fff55',
                  background: '#1f2a44',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                그룹 수강권 추가
              </button>
              <button
                type="button"
                onClick={closePostStudentCreateModal}
                style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                나중에 하기
              </button>
            </div>
          </div>
        </div>

  )
}
