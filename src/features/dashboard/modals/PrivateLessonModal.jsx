import { formatGroupStudentStartDate } from '../dashboardViewUtils.js'

export default function PrivateLessonModal({
  isAdmin,
  privateLessonForm,
  setPrivateLessonForm,
  privateLessonFormErrors,
  sortedPrivateStudents,
  privateLessonEligiblePackages,
  privateLessonSelectedPackagePreview,
  closePrivateLessonModal,
  submitPrivateLessonModal,
  isPrivateLessonModalSubmitting,
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="private-lesson-modal-title"
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
        if (e.target === e.currentTarget) closePrivateLessonModal()
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
          id="private-lesson-modal-title"
          style={{ margin: '0 0 16px 0', fontSize: '1.1rem', fontWeight: 600 }}
        >
          개인 수업 추가
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>학생</span>
            <select
              value={privateLessonForm.studentId}
              onChange={(e) =>
                setPrivateLessonForm((prev) => ({
                  ...prev,
                  studentId: e.target.value,
                  packageId: '',
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
              <option value="">선택</option>
              {sortedPrivateStudents.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || '-'}
                  {isAdmin && s.teacher ? ` (${s.teacher})` : ''}
                </option>
              ))}
            </select>
            {privateLessonFormErrors.studentId ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>
                {privateLessonFormErrors.studentId}
              </span>
            ) : null}
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>
              {isAdmin ? '사용할 개인 수강권을 선택' : '사용할 수업을 선택'}
            </span>
            <select
              value={privateLessonForm.packageId}
              onChange={(e) =>
                setPrivateLessonForm((prev) => ({ ...prev, packageId: e.target.value }))
              }
              disabled={!String(privateLessonForm.studentId || '').trim()}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
                opacity: String(privateLessonForm.studentId || '').trim() ? 1 : 0.5,
              }}
            >
              <option value="">
                {String(privateLessonForm.studentId || '').trim()
                  ? isAdmin
                    ? '수강권 선택'
                    : '수업 선택'
                  : '먼저 학생을 선택하세요'}
              </option>
              {privateLessonEligiblePackages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {String(pkg.title || '').trim() || '—'} (남은 횟수{' '}
                  {Number(pkg.remainingCount ?? 0)})
                </option>
              ))}
            </select>
            {privateLessonFormErrors.packageId ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>
                {privateLessonFormErrors.packageId}
              </span>
            ) : null}
          </label>

          {privateLessonSelectedPackagePreview ? (
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                border: '1px solid #333',
                background: '#1a1d26',
                fontSize: 12,
                lineHeight: 1.5,
                opacity: 0.95,
              }}
            >
              <div style={{ marginBottom: 6, fontWeight: 600, opacity: 0.9 }}>
                {isAdmin ? '선택 수강권' : '선택 정보'}
              </div>
              <div>
                <span style={{ opacity: 0.7 }}>title: </span>
                {String(privateLessonSelectedPackagePreview.title || '').trim() || '—'}
              </div>
              <div>
                <span style={{ opacity: 0.7 }}>totalCount: </span>
                {privateLessonSelectedPackagePreview.totalCount ?? '—'}
              </div>
              <div>
                <span style={{ opacity: 0.7 }}>usedCount: </span>
                {privateLessonSelectedPackagePreview.usedCount ?? '—'}
              </div>
              <div>
                <span style={{ opacity: 0.7 }}>남은 횟수: </span>
                {privateLessonSelectedPackagePreview.remainingCount ?? '—'}
              </div>
              <div>
                <span style={{ opacity: 0.7 }}>expiresAt: </span>
                {formatGroupStudentStartDate(privateLessonSelectedPackagePreview.expiresAt) ||
                  '—'}
              </div>
              <div>
                <span style={{ opacity: 0.7 }}>amountPaid: </span>
                {privateLessonSelectedPackagePreview.amountPaid ?? '—'}
              </div>
              <div>
                <span style={{ opacity: 0.7 }}>memo: </span>
                {String(privateLessonSelectedPackagePreview.memo || '').trim() || '—'}
              </div>
            </div>
          ) : null}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>날짜 (선택한 캘린더 날짜)</span>
            <input
              type="date"
              value={privateLessonForm.date}
              readOnly
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#252525',
                color: 'white',
                cursor: 'default',
              }}
            />
            {privateLessonFormErrors.date ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>{privateLessonFormErrors.date}</span>
            ) : null}
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>시간</span>
            <input
              type="time"
              value={privateLessonForm.time}
              onChange={(e) =>
                setPrivateLessonForm((prev) => ({ ...prev, time: e.target.value }))
              }
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
              }}
            />
            {privateLessonFormErrors.time ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>{privateLessonFormErrors.time}</span>
            ) : null}
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>과목</span>
            <input
              type="text"
              value={privateLessonForm.subject}
              onChange={(e) =>
                setPrivateLessonForm((prev) => ({ ...prev, subject: e.target.value }))
              }
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
              }}
            />
            {privateLessonFormErrors.subject ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>
                {privateLessonFormErrors.subject}
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
            onClick={closePrivateLessonModal}
            disabled={isPrivateLessonModalSubmitting}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #555',
              background: 'transparent',
              color: 'white',
              cursor: isPrivateLessonModalSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={submitPrivateLessonModal}
            disabled={isPrivateLessonModalSubmitting}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #4a6fff55',
              background: '#1f2a44',
              color: 'white',
              cursor: isPrivateLessonModalSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            {isPrivateLessonModalSubmitting ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
