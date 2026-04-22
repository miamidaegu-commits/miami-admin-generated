import { formatGroupStudentStartDate } from '../dashboardViewUtils.js'

export default function GroupStudentManageModal({
  groupStudent,
  studentPackages,
  form,
  formErrors,
  onFieldChange,
  onAddExcludedDate,
  onRemoveExcludedDate,
  onClose,
  onSave,
  isSubmitting,
}) {
  const pkg = studentPackages.find((p) => p.id === groupStudent?.packageId)
  const displayName =
    String(groupStudent?.studentName || groupStudent?.name || '').trim() || '-'
  const pkgTitle = pkg ? String(pkg.title || '').trim() || '-' : '-'
  const remainingDisplay =
    pkg && pkg.remainingCount != null && pkg.remainingCount !== ''
      ? String(pkg.remainingCount)
      : '-'
  const startDateStr = String(form?.startDateStr || '')
  const studentStatus = form?.studentStatus === 'onBreak' ? 'onBreak' : 'active'
  const breakStartStr = String(form?.breakStartStr || '')
  const breakEndStr = String(form?.breakEndStr || '')
  const excludeAddInput = String(form?.excludeAddInput || '')
  const excludedDates = Array.isArray(form?.excludedDates) ? form.excludedDates : []

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-student-manage-title"
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
        if (e.target === e.currentTarget && !isSubmitting) onClose()
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
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="group-student-manage-title"
          style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
        >
          그룹 학생 관리
        </h2>
        <p style={{ margin: '0 0 16px 0', fontSize: 13, opacity: 0.82 }}>
          학생: <strong>{displayName}</strong>
        </p>
        <div
          style={{
            fontSize: 13,
            opacity: 0.88,
            marginBottom: 16,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #2e3240',
            background: '#1a1f2a',
          }}
        >
          <div>연결 수강권: {pkgTitle}</div>
          <div style={{ marginTop: 4 }}>남은 횟수: {remainingDisplay}</div>
          <div style={{ marginTop: 4, opacity: 0.75 }}>
            현재 시작일(문서): {formatGroupStudentStartDate(groupStudent?.startDate)}
          </div>
        </div>

        <form onSubmit={onSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>시작일</span>
            <input
              type="date"
              value={startDateStr}
              onChange={(e) => onFieldChange('startDateStr', e.target.value)}
              disabled={isSubmitting}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
              }}
            />
            {formErrors.startDate ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>{formErrors.startDate}</span>
            ) : null}
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>운영 상태</span>
            <select
              value={studentStatus}
              onChange={(e) => onFieldChange('studentStatus', e.target.value)}
              disabled={isSubmitting}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
              }}
            >
              <option value="active">재원 (active)</option>
              <option value="onBreak">휴원 (onBreak)</option>
            </select>
          </label>

          {studentStatus === 'onBreak' ? (
            <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>휴원 시작일</span>
                <input
                  type="date"
                  value={breakStartStr}
                  onChange={(e) => onFieldChange('breakStartStr', e.target.value)}
                  disabled={isSubmitting}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {formErrors.breakStartDate ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>{formErrors.breakStartDate}</span>
                ) : null}
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>휴원 종료일</span>
                <input
                  type="date"
                  value={breakEndStr}
                  onChange={(e) => onFieldChange('breakEndStr', e.target.value)}
                  disabled={isSubmitting}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {formErrors.breakEndDate ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>{formErrors.breakEndDate}</span>
                ) : null}
              </label>
            </>
          ) : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>제외 날짜 (yyyy-MM-dd)</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <input
                type="date"
                value={excludeAddInput}
                onChange={(e) => onFieldChange('excludeAddInput', e.target.value)}
                disabled={isSubmitting}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid #444',
                  background: '#1f1f1f',
                  color: 'white',
                }}
              />
              <button
                type="button"
                onClick={onAddExcludedDate}
                disabled={isSubmitting}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid #335533',
                  background: '#2a3d2a',
                  color: 'white',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                날짜 추가
              </button>
            </div>
            {formErrors.excludeAdd ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>{formErrors.excludeAdd}</span>
            ) : null}
            {excludedDates.length === 0 ? (
              <span style={{ fontSize: 12, opacity: 0.7 }}>등록된 제외일이 없습니다.</span>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                {excludedDates.map((d) => (
                  <li key={d} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{d}</span>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => onRemoveExcludedDate(d)}
                      style={{
                        fontSize: 12,
                        padding: '2px 8px',
                        borderRadius: 6,
                        border: '1px solid #553333',
                        background: '#3a2525',
                        color: 'white',
                        cursor: isSubmitting ? 'not-allowed' : 'pointer',
                      }}
                    >
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#2a2a2a',
                color: 'white',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid #335533',
                background: '#2a4a2a',
                color: 'white',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              {isSubmitting ? '저장 중...' : '저장'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
