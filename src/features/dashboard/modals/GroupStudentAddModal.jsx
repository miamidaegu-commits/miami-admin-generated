import { formatGroupStudentStartDate } from '../dashboardViewUtils.js'

export default function GroupStudentAddModal({
  selectedGroupClass,
  isAdmin,
  canViewPaymentFields = false,
  groupStudentForm,
  setGroupStudentForm,
  groupStudentFormErrors,
  groupStudentEligiblePackages,
  groupStudentSelectedPackagePreview,
  groupStudentCandidateStudents,
  groupStudentSelectedStudentPreview,
  activeFixedMemberCount,
  selectedGroupCapacity,
  isGroupAtCapacity,
  closeGroupStudentAddModal,
  submitGroupStudentAdd,
  isGroupStudentModalSubmitting,
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-student-modal-title"
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
        if (e.target === e.currentTarget) closeGroupStudentAddModal()
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
          id="group-student-modal-title"
          style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
        >
          학생 등록
        </h2>
        <p style={{ margin: '0 0 16px 0', fontSize: 13, opacity: 0.8 }}>
          {selectedGroupClass.name || '-'}
        </p>
        <p style={{ margin: '-8px 0 16px 0', fontSize: 12, opacity: 0.78 }}>
          반 등록 학생 {activeFixedMemberCount ?? 0} / 정원 {selectedGroupCapacity ?? 4}명
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {isGroupAtCapacity ? (
            <div
              role="alert"
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #7a3d3d',
                background: '#3a1f1f',
                color: '#ffd4d4',
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              정원이 가득 차서 반 등록 학생을 더 추가할 수 없습니다.
            </div>
          ) : null}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>반 등록 학생 검색</span>
            <input
              type="text"
              value={groupStudentForm.studentSearch || ''}
              onChange={(e) =>
                setGroupStudentForm((prev) => ({
                  ...prev,
                  studentSearch: e.target.value,
                }))
              }
              placeholder="학생 이름/전화번호 검색"
              disabled={isGroupStudentModalSubmitting || isGroupAtCapacity}
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
            <span style={{ opacity: 0.85 }}>반 등록 학생 선택</span>
            <select
              value={groupStudentForm.studentId || ''}
              onChange={(e) =>
                setGroupStudentForm((prev) => ({
                  ...prev,
                  studentId: e.target.value,
                  packageId: e.target.value ? '' : prev.packageId,
                }))
              }
              disabled={isGroupStudentModalSubmitting || isGroupAtCapacity}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
              }}
            >
              <option value="">학생을 선택하세요</option>
              {(groupStudentCandidateStudents || []).map((student) => {
                const studentId = String(student.id || student.studentId || '').trim()
                return (
                  <option key={studentId} value={studentId}>
                    {student.name || student.studentName || '-'}
                  </option>
                )
              })}
            </select>
            {groupStudentFormErrors.studentId ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>
                {groupStudentFormErrors.studentId}
              </span>
            ) : null}
          </label>

          {groupStudentSelectedStudentPreview ? (
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                padding: 12,
                borderRadius: 8,
                border: '1px solid #333',
                background: '#1a1d26',
                opacity: 0.95,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6, opacity: 0.9 }}>
                반 등록 학생 정보 (읽기 전용)
              </div>
              <div>
                studentName:{' '}
                {groupStudentSelectedStudentPreview.name ??
                  groupStudentSelectedStudentPreview.studentName ??
                  '-'}
              </div>
              <div>
                teacher:{' '}
                {groupStudentSelectedStudentPreview.teacher ??
                  groupStudentSelectedStudentPreview.teacherName ??
                  '-'}
              </div>
            </div>
          ) : null}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>
              {isAdmin ? '이 반에서 사용할 수강권을 선택 (선택)' : '이 반에서 사용할 등록을 선택'}
            </span>
            <select
              value={groupStudentForm.packageId}
              onChange={(e) =>
                setGroupStudentForm((prev) => ({
                  ...prev,
                  packageId: e.target.value,
                  studentId: e.target.value ? '' : prev.studentId,
                }))
              }
              disabled={isGroupStudentModalSubmitting || isGroupAtCapacity}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
              }}
            >
              <option value="">
                {isAdmin ? '수강권 없이 반 등록 학생으로 추가 (비권장)' : '등록을 선택하세요'}
              </option>
              {groupStudentEligiblePackages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.studentName || '-'} — {p.title || '(제목 없음)'}
                </option>
              ))}
            </select>
            {groupStudentEligiblePackages.length === 0 ? (
              <span style={{ fontSize: 12, opacity: 0.75 }}>
                {isAdmin
                  ? '이 반에 연결된 활성 그룹 수강권이 없습니다.'
                  : '이 반에서 사용할 수 있는 남은 횟수가 있는 그룹 등록이 없습니다.'}
              </span>
            ) : null}
            {groupStudentFormErrors.packageId ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>
                {groupStudentFormErrors.packageId}
              </span>
            ) : null}
          </label>

          {(() => {
            const pkg = groupStudentSelectedPackagePreview
            if (!pkg) return null
            return (
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.5,
                  padding: 12,
                  borderRadius: 8,
                  border: '1px solid #333',
                  background: '#1a1d26',
                  opacity: 0.95,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 6, opacity: 0.9 }}>
                  {isAdmin ? '수강권 정보 (읽기 전용)' : '수업 등록 정보 (읽기 전용)'}
                </div>
                <div>studentName: {pkg.studentName ?? '-'}</div>
                <div>teacher: {pkg.teacher ?? '-'}</div>
                <div>title: {pkg.title ?? '-'}</div>
                <div>totalCount: {pkg.totalCount ?? '-'}</div>
                <div>usedCount: {pkg.usedCount ?? '-'}</div>
                <div>남은 횟수: {pkg.remainingCount ?? '-'}</div>
                <div>expiresAt: {formatGroupStudentStartDate(pkg.expiresAt)}</div>
                {canViewPaymentFields ? (
                  <>
                    <div>amountPaid: {pkg.amountPaid ?? 0}</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>memo: {pkg.memo || '—'}</div>
                  </>
                ) : null}
              </div>
            )
          })()}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>시작일</span>
            <input
              type="date"
              value={groupStudentForm.startDate}
              onChange={(e) =>
                setGroupStudentForm((prev) => ({
                  ...prev,
                  startDate: e.target.value,
                }))
              }
              disabled={isGroupStudentModalSubmitting || isGroupAtCapacity}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
              }}
            />
            {groupStudentFormErrors.startDate ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>
                {groupStudentFormErrors.startDate}
              </span>
            ) : null}
          </label>
          {groupStudentFormErrors.submit ? (
            <span style={{ color: '#f08080', fontSize: 12 }}>
              {groupStudentFormErrors.submit}
            </span>
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
            onClick={closeGroupStudentAddModal}
            disabled={isGroupStudentModalSubmitting}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #555',
              background: 'transparent',
              color: 'white',
              cursor: isGroupStudentModalSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={submitGroupStudentAdd}
            disabled={isGroupStudentModalSubmitting || isGroupAtCapacity}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #4a6fff55',
              background: '#1f2a44',
              color: 'white',
              cursor: isGroupStudentModalSubmitting || isGroupAtCapacity ? 'not-allowed' : 'pointer',
            }}
          >
            {isGroupStudentModalSubmitting ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
