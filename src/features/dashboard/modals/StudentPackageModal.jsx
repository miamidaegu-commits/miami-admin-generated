import { formatGroupStudentStartDate } from '../dashboardViewUtils.js'

export default function StudentPackageModal({
  studentPackageModalStudent,
  studentPackageForm,
  setStudentPackageForm,
  studentPackageFormErrors,
  sortedGroupClasses,
  studentPackageModalActiveSameScopeDuplicates,
  isStudentPackageModalSubmitting,
  closeStudentPackageModal,
  submitStudentPackageModal,
}) {
  return (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-package-modal-title"
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
            if (e.target === e.currentTarget) closeStudentPackageModal()
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
              id="student-package-modal-title"
              style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
            >
              학생 수강권 추가
            </h2>
            <p style={{ margin: '0 0 16px 0', fontSize: 13, opacity: 0.85 }}>
              {studentPackageModalStudent.name || '-'} · {studentPackageModalStudent.teacher || '-'}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>수강권 유형</span>
                <select
                  value={studentPackageForm.packageType}
                  onChange={(e) => {
                    const packageType = e.target.value
                    setStudentPackageForm((prev) => ({
                      ...prev,
                      packageType,
                      groupClassId:
                        packageType === 'private' ? '' : prev.groupClassId,
                    }))
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                >
                  <option value="private">개인 (private)</option>
                  <option value="group">그룹 (group)</option>
                  <option value="openGroup">오픈 그룹 (openGroup)</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>제목</span>
                <input
                  type="text"
                  value={studentPackageForm.title}
                  onChange={(e) =>
                    setStudentPackageForm((prev) => ({ ...prev, title: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {studentPackageFormErrors.title ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentPackageFormErrors.title}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>총 횟수 (totalCount)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={studentPackageForm.totalCount}
                  onChange={(e) =>
                    setStudentPackageForm((prev) => ({ ...prev, totalCount: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {studentPackageFormErrors.totalCount ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentPackageFormErrors.totalCount}
                  </span>
                ) : null}
              </label>

              {studentPackageForm.packageType === 'group' ||
              studentPackageForm.packageType === 'openGroup' ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ opacity: 0.85 }}>그룹 수업</span>
                  <select
                    value={studentPackageForm.groupClassId}
                    onChange={(e) =>
                      setStudentPackageForm((prev) => ({
                        ...prev,
                        groupClassId: e.target.value,
                      }))
                    }
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                    }}
                  >
                    <option value="">그룹을 선택하세요</option>
                    {sortedGroupClasses.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name || '-'} ({g.teacher || '-'})
                      </option>
                    ))}
                  </select>
                  {studentPackageFormErrors.groupClassId ? (
                    <span style={{ color: '#f08080', fontSize: 12 }}>
                      {studentPackageFormErrors.groupClassId}
                    </span>
                  ) : null}
                </label>
              ) : null}

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>만료일 (선택)</span>
                <input
                  type="date"
                  value={studentPackageForm.expiresAt}
                  onChange={(e) =>
                    setStudentPackageForm((prev) => ({ ...prev, expiresAt: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {studentPackageFormErrors.expiresAt ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentPackageFormErrors.expiresAt}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>결제 금액 (선택)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={studentPackageForm.amountPaid}
                  onChange={(e) =>
                    setStudentPackageForm((prev) => ({ ...prev, amountPaid: e.target.value }))
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
                {studentPackageFormErrors.amountPaid ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentPackageFormErrors.amountPaid}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>메모 (선택)</span>
                <textarea
                  value={studentPackageForm.memo}
                  onChange={(e) =>
                    setStudentPackageForm((prev) => ({ ...prev, memo: e.target.value }))
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

            {studentPackageModalActiveSameScopeDuplicates.length > 0 ? (
              <div
                style={{
                  marginTop: 16,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(220, 140, 60, 0.55)',
                  background: 'rgba(80, 50, 20, 0.35)',
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 8, opacity: 0.95 }}>
                  같은 범위의 사용 중 수강권이 이미 있습니다.
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, opacity: 0.9 }}>
                  {studentPackageModalActiveSameScopeDuplicates.map((p) => (
                    <li key={p.id} style={{ marginBottom: 6 }}>
                      <span style={{ opacity: 0.85 }}>제목</span> {String(p.title || '').trim() || '-'}
                      {' · '}
                      <span style={{ opacity: 0.85 }}>남은</span>{' '}
                      {p.remainingCount != null && p.remainingCount !== ''
                        ? String(p.remainingCount)
                        : '-'}
                      {' · '}
                      <span style={{ opacity: 0.85 }}>만료</span>{' '}
                      {formatGroupStudentStartDate(p.expiresAt)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

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
                onClick={closeStudentPackageModal}
                disabled={isStudentPackageModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor: isStudentPackageModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitStudentPackageModal}
                disabled={isStudentPackageModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #4a6fff55',
                  background: '#1f2a44',
                  color: 'white',
                  cursor: isStudentPackageModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                {isStudentPackageModalSubmitting ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>

  )
}
