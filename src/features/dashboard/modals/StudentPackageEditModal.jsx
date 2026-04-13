
export default function StudentPackageEditModal({
  studentPackageEditModalPackage,
  studentPackageEditForm,
  setStudentPackageEditForm,
  studentPackageEditFormErrors,
  busyStudentPackageActionId,
  closeStudentPackageEditModal,
  submitStudentPackageEditModal,
}) {
  return (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-package-edit-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1002,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeStudentPackageEditModal()
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 480,
              background: '#151922',
              border: '1px solid #2e3240',
              borderRadius: 12,
              padding: 20,
              color: 'white',
              boxSizing: 'border-box',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="student-package-edit-modal-title"
              style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
            >
              수강권 수정
            </h2>
            <p style={{ margin: '0 0 14px 0', fontSize: 12, opacity: 0.78, lineHeight: 1.5 }}>
              studentId: {studentPackageEditModalPackage.studentId || '-'} · studentName:{' '}
              {studentPackageEditModalPackage.studentName || '-'}
              <br />
              teacher: {studentPackageEditModalPackage.teacher || '-'} · packageType:{' '}
              {String(studentPackageEditModalPackage.packageType || '-')}
              <br />
              groupClassId: {studentPackageEditModalPackage.groupClassId || '-'} ·
              groupClassName: {studentPackageEditModalPackage.groupClassName || '-'}
            </p>
            <p style={{ margin: '0 0 12px 0', fontSize: 13, opacity: 0.85 }}>
              사용 횟수(usedCount): {Number(studentPackageEditModalPackage.usedCount ?? 0)} (수정
              불가)
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>제목</span>
                <input
                  type="text"
                  value={studentPackageEditForm.title}
                  onChange={(e) =>
                    setStudentPackageEditForm((prev) => ({ ...prev, title: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {studentPackageEditFormErrors.title ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentPackageEditFormErrors.title}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>총 횟수 (totalCount)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={studentPackageEditForm.totalCount}
                  onChange={(e) =>
                    setStudentPackageEditForm((prev) => ({
                      ...prev,
                      totalCount: e.target.value,
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
                {studentPackageEditFormErrors.totalCount ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentPackageEditFormErrors.totalCount}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>만료일 (선택)</span>
                <input
                  type="date"
                  value={studentPackageEditForm.expiresAt}
                  onChange={(e) =>
                    setStudentPackageEditForm((prev) => ({
                      ...prev,
                      expiresAt: e.target.value,
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
                {studentPackageEditFormErrors.expiresAt ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentPackageEditFormErrors.expiresAt}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>결제 금액 (선택)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={studentPackageEditForm.amountPaid}
                  onChange={(e) =>
                    setStudentPackageEditForm((prev) => ({
                      ...prev,
                      amountPaid: e.target.value,
                    }))
                  }
                  placeholder="0"
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {studentPackageEditFormErrors.amountPaid ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentPackageEditFormErrors.amountPaid}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>메모 (선택)</span>
                <textarea
                  value={studentPackageEditForm.memo}
                  onChange={(e) =>
                    setStudentPackageEditForm((prev) => ({ ...prev, memo: e.target.value }))
                  }
                  rows={3}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                    resize: 'vertical',
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
                onClick={closeStudentPackageEditModal}
                disabled={busyStudentPackageActionId === studentPackageEditModalPackage.id}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor:
                    busyStudentPackageActionId === studentPackageEditModalPackage.id
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitStudentPackageEditModal}
                disabled={busyStudentPackageActionId === studentPackageEditModalPackage.id}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #4a6fff55',
                  background: '#1f2a44',
                  color: 'white',
                  cursor:
                    busyStudentPackageActionId === studentPackageEditModalPackage.id
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                {busyStudentPackageActionId === studentPackageEditModalPackage.id
                  ? '저장 중...'
                  : '저장'}
              </button>
            </div>
          </div>
        </div>

  )
}
