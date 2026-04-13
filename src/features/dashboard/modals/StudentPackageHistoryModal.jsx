import {
  formatCreditTransactionActionTypeLabel,
  formatCreditTransactionCreatedAtDisplay,
  formatCreditTransactionDeltaCountDisplay,
  formatStudentPackageDetailTypeLabel,
} from '../dashboardViewUtils.js'

export default function StudentPackageHistoryModal({
  studentPackageHistoryModalPackage,
  studentPackageHistoryLoading,
  studentPackageHistoryRows,
  closeStudentPackageHistoryModal,
}) {
  return (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-package-history-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1004,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeStudentPackageHistoryModal()
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 640,
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
              id="student-package-history-modal-title"
              style={{ margin: '0 0 10px 0', fontSize: '1.1rem', fontWeight: 600 }}
            >
              수강권 이력
            </h2>
            <div
              style={{
                marginBottom: 14,
                fontSize: 13,
                opacity: 0.88,
                lineHeight: 1.55,
              }}
            >
              <div>
                <span style={{ opacity: 0.72 }}>수강권 제목</span>{' '}
                {studentPackageHistoryModalPackage.title != null &&
                String(studentPackageHistoryModalPackage.title).trim()
                  ? String(studentPackageHistoryModalPackage.title)
                  : '-'}
              </div>
              <div>
                <span style={{ opacity: 0.72 }}>학생</span>{' '}
                {String(studentPackageHistoryModalPackage.studentName || '').trim() || '-'}
              </div>
              <div>
                <span style={{ opacity: 0.72 }}>유형</span>{' '}
                {formatStudentPackageDetailTypeLabel(studentPackageHistoryModalPackage.packageType)}
              </div>
              <div>
                <span style={{ opacity: 0.72 }}>연결 반</span>{' '}
                {studentPackageHistoryModalPackage.groupClassName != null &&
                String(studentPackageHistoryModalPackage.groupClassName).trim()
                  ? String(studentPackageHistoryModalPackage.groupClassName)
                  : '-'}
              </div>
            </div>

            {studentPackageHistoryLoading ? (
              <p style={{ margin: '12px 0', fontSize: 13, opacity: 0.85 }}>불러오는 중...</p>
            ) : studentPackageHistoryRows.length === 0 ? (
              <p style={{ margin: '12px 0', fontSize: 13, opacity: 0.85 }}>
                등록된 이력이 없습니다.
              </p>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  marginTop: 4,
                }}
              >
                {studentPackageHistoryRows.map((row) => (
                  <div
                    key={row.id}
                    style={{
                      border: '1px solid #2a3140',
                      borderRadius: 8,
                      padding: '10px 12px',
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    <div style={{ opacity: 0.9, marginBottom: 4 }}>
                      <strong>{formatCreditTransactionCreatedAtDisplay(row.createdAt)}</strong>
                      {' · '}
                      {formatCreditTransactionActionTypeLabel(row.actionType)}
                      {' · '}
                      {formatCreditTransactionDeltaCountDisplay(row.deltaCount)}
                    </div>
                    <div style={{ opacity: 0.82, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      메모: {String(row.memo ?? '').trim() || '-'}
                    </div>
                    <div style={{ opacity: 0.72, fontSize: 12, marginTop: 4 }}>
                      처리 역할: {String(row.actorRole ?? '').trim() || '-'}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: 18,
              }}
            >
              <button
                type="button"
                onClick={closeStudentPackageHistoryModal}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor: 'pointer',
                }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>

  )
}
