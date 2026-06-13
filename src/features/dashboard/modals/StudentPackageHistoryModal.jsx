import {
  formatCreditTransactionActionTypeLabel,
  formatCreditTransactionCreatedAtDisplay,
  formatCreditTransactionDeltaCountDisplay,
  formatGroupStudentStartDate,
  formatStudentPackageDetailStatusLabel,
  formatStudentPackageDetailTypeLabel,
  parseYmdToLocalDate,
} from '../dashboardViewUtils.js'
import { getGroupCourseTypeLabel } from '../../group-booking/groupCourseTypes.js'

function docDateToDate(raw) {
  if (!raw) return null
  if (raw instanceof Date) return raw
  if (typeof raw.toDate === 'function') return raw.toDate()
  if (raw.seconds != null) return new Date(Number(raw.seconds) * 1000)
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return parseYmdToLocalDate(trimmed)
    const ms = Date.parse(trimmed)
    return Number.isFinite(ms) ? new Date(ms) : null
  }
  return null
}

function formatYmdDate(raw, fallback = '-') {
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    return raw.trim()
  }
  const date = docDateToDate(raw)
  if (!date || !Number.isFinite(date.getTime())) return fallback
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`
}

function formatYmdDateTime(raw, fallback = '기록 없음') {
  const date = docDateToDate(raw)
  if (!date || !Number.isFinite(date.getTime())) return fallback
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')} ${byType.get('hour')}:${byType.get('minute')}`
}

function formatPaymentDate(pkg) {
  return formatYmdDate(pkg?.paymentDate || pkg?.paidDate || pkg?.paidAt, '기록 없음')
}

function formatTeacherScope(pkg) {
  const display = String(pkg?.teacherName || '').trim()
  const key = String(pkg?.teacherKey || pkg?.teacher || '').trim()
  if (display && key && display !== key) return `${display} · ${key}`
  return display || key || '-'
}

function formatHistoryActionLabel(row) {
  const actionType = String(row?.actionType || '').trim()
  if (actionType === 'private_package_top_up' || actionType === 'package_top_up') {
    const label = String(row?.registrationLabel || '').trim()
    if (label) return label
    const round = Number(row?.registrationRound ?? row?.roundNumber ?? 0)
    if (Number.isFinite(round) && round > 0) return `${round}회차 등록`
    return '추가 등록'
  }
  return formatCreditTransactionActionTypeLabel(actionType)
}

function formatHistoryMemo(row) {
  const explicitMemo = String(row?.registrationMemo || '').trim()
  if (explicitMemo) return explicitMemo
  const label = formatHistoryActionLabel(row)
  const delta = formatCreditTransactionDeltaCountDisplay(row?.deltaCount)
  const deltaWithUnit = delta && !delta.endsWith('회') ? `${delta}회` : delta
  return (
    String(row?.memo ?? '')
      .split(' · ')
      .map((part) => part.trim())
      .filter((part) => part && part !== label && part !== delta && part !== deltaWithUnit)
      .join(' · ')
      .trim() || '-'
  )
}

function formatHistoryDelta(row) {
  const delta = formatCreditTransactionDeltaCountDisplay(row?.deltaCount)
  if (!delta || delta === '-') return delta
  return delta.endsWith('회') ? delta : `${delta}회`
}

function hasHistoryPaymentAmount(row) {
  if (row?.amountPaid == null) return false
  return String(row.amountPaid).trim() !== ''
}

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
                <span style={{ opacity: 0.72 }}>상태</span>{' '}
                {formatStudentPackageDetailStatusLabel(studentPackageHistoryModalPackage.status)}
              </div>
              {String(studentPackageHistoryModalPackage.status || '').trim().toLowerCase() ===
              'revoked' ? (
                <>
                  <div>
                    <span style={{ opacity: 0.72 }}>회수 사유</span>{' '}
                    {String(studentPackageHistoryModalPackage.revokeReason || '').trim() || '-'}
                  </div>
                  <div>
                    <span style={{ opacity: 0.72 }}>회수일</span>{' '}
                    {formatYmdDateTime(studentPackageHistoryModalPackage.revokedAt)}
                  </div>
                </>
              ) : null}
              <div>
                <span style={{ opacity: 0.72 }}>등록일</span>{' '}
                {formatYmdDateTime(studentPackageHistoryModalPackage.createdAt)}
              </div>
              <div>
                <span style={{ opacity: 0.72 }}>결제일</span>{' '}
                {formatPaymentDate(studentPackageHistoryModalPackage)}
              </div>
              <div>
                <span style={{ opacity: 0.72 }}>수강권 시작일</span>{' '}
                {formatYmdDate(
                  studentPackageHistoryModalPackage.registrationStartDate ||
                    studentPackageHistoryModalPackage.startDate,
                  '-'
                )}
              </div>
              <div>
                <span style={{ opacity: 0.72 }}>만료일</span>{' '}
                {formatGroupStudentStartDate(studentPackageHistoryModalPackage.expiresAt)}
              </div>
              {String(studentPackageHistoryModalPackage.packageType || '').trim() === 'private' ? (
                <div>
                  <span style={{ opacity: 0.72 }}>사용 가능 선생님</span>{' '}
                  {formatTeacherScope(studentPackageHistoryModalPackage)}
                </div>
              ) : null}
              <div>
                <span style={{ opacity: 0.72 }}>연결 반</span>{' '}
                {studentPackageHistoryModalPackage.groupClassName != null &&
                String(studentPackageHistoryModalPackage.groupClassName).trim()
                  ? String(studentPackageHistoryModalPackage.groupClassName)
                  : '-'}
              </div>
              <div>
                <span style={{ opacity: 0.72 }}>코스 유형</span>{' '}
                {getGroupCourseTypeLabel(studentPackageHistoryModalPackage.groupCourseType) || '-'}
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
                      {formatHistoryActionLabel(row)}
                      {' · '}
                      {formatHistoryDelta(row)}
                    </div>
                    {String(row.paymentDate || '').trim() ? (
                      <div style={{ opacity: 0.82 }}>
                        결제일 {String(row.paymentDate || '').trim()}
                      </div>
                    ) : null}
                    {hasHistoryPaymentAmount(row) ? (
                      <div style={{ opacity: 0.82 }}>
                        결제 금액 {String(row.amountPaid).trim()}
                      </div>
                    ) : null}
                    <div style={{ opacity: 0.82, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      메모: {formatHistoryMemo(row)}
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
