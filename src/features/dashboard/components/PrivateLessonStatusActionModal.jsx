import { getStudentName, getTeacherName } from '../dashboardViewUtils.js'

const ACTION_LABELS = {
  complete: '수업완료',
  no_show: '노쇼',
}

function formatJson(value) {
  if (value == null || value === '') return '-'
  try {
    return JSON.stringify(value, null, 2)
  } catch (error) {
    return String(value)
  }
}

function FieldBlock({ label, value }) {
  return (
    <div
      style={{
        border: '1px solid #2c3447',
        borderRadius: 10,
        background: '#111827',
        padding: 10,
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.72, marginBottom: 6 }}>{label}</div>
      <pre
        style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 12,
          lineHeight: 1.45,
          color: '#dbe8ff',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        }}
      >
        {formatJson(value)}
      </pre>
    </div>
  )
}

function ListBlock({ title, items }) {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : []
  return (
    <section
      style={{
        border: '1px solid #2c3447',
        borderRadius: 10,
        background: '#111827',
        padding: 12,
      }}
    >
      <h3 style={{ margin: 0, fontSize: 14 }}>{title}</h3>
      {safeItems.length > 0 ? (
        <ul style={{ margin: '8px 0 0 18px', padding: 0, lineHeight: 1.55 }}>
          {safeItems.map((item) => (
            <li key={String(item)}>{String(item)}</li>
          ))}
        </ul>
      ) : (
        <p style={{ margin: '8px 0 0 0', opacity: 0.72, fontSize: 13 }}>없음</p>
      )}
    </section>
  )
}

export default function PrivateLessonStatusActionModal({
  target,
  actionType,
  setActionType,
  preview,
  previewBusy,
  previewError,
  previewPayload,
  onPreview,
  onClose,
}) {
  if (!target) return null
  const blockedReasons = Array.isArray(preview?.blockedReasons) ? preview.blockedReasons : []
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : []
  const row = target || {}
  const currentStatus = preview?.currentState?.status || row.status || '-'
  const proposedStatus =
    preview?.proposedState?.reservation?.status ||
    preview?.proposedState?.lesson?.status ||
    preview?.normalizedPlan?.targetStatus ||
    '-'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="private-lesson-status-action-modal-title"
      data-testid="private-lesson-status-action-modal"
      onClick={(event) => {
        if (event.target === event.currentTarget && !previewBusy) onClose?.()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 95,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'rgba(0,0,0,0.58)',
      }}
    >
      <section
        style={{
          width: 'min(760px, 100%)',
          maxHeight: '88vh',
          overflow: 'auto',
          borderRadius: 16,
          border: '1px solid #2e3240',
          background: '#151922',
          color: 'white',
          padding: 20,
          boxShadow: '0 20px 60px rgba(0,0,0,0.38)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 id="private-lesson-status-action-modal-title" style={{ margin: 0 }}>
              개인 수업 처리 미리보기
            </h2>
            <p style={{ margin: '8px 0 0 0', opacity: 0.78, fontSize: 14 }}>
              아직 저장하지 않습니다. 서버 기준으로 수업완료/노쇼 처리 가능 여부만
              확인합니다. 실제 처리는 다음 단계에서 제공합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={previewBusy}
            aria-label="닫기"
            style={{
              height: 34,
              borderRadius: 8,
              border: '1px solid #3b4254',
              background: '#222938',
              color: 'white',
              cursor: previewBusy ? 'not-allowed' : 'pointer',
            }}
          >
            닫기
          </button>
        </div>

        <div
          style={{
            marginTop: 16,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 10,
            fontSize: 13,
          }}
        >
          <FieldBlock label="학생" value={getStudentName(row) || row.studentName || row.studentId} />
          <FieldBlock label="선생님" value={getTeacherName(row) || row.teacherName || row.teacher} />
          <FieldBlock label="예약" value={row.id || row.reservationId || '-'} />
          <FieldBlock label="수업/시간" value={[row.date, row.time, row.subject].filter(Boolean).join(' ')} />
        </div>

        <fieldset
          style={{
            margin: '16px 0 0 0',
            border: '1px solid #2c3447',
            borderRadius: 12,
            padding: 14,
          }}
        >
          <legend style={{ padding: '0 6px', fontWeight: 700 }}>처리 유형</legend>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginRight: 18 }}>
            <input
              type="radio"
              name="privateLessonStatusActionType"
              value="complete"
              checked={actionType === 'complete'}
              onChange={() => setActionType?.('complete')}
              disabled={previewBusy}
              data-testid="private-lesson-status-action-type-complete"
            />
            수업완료
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <input
              type="radio"
              name="privateLessonStatusActionType"
              value="no_show"
              checked={actionType === 'no_show'}
              onChange={() => setActionType?.('no_show')}
              disabled={previewBusy}
              data-testid="private-lesson-status-action-type-no-show"
            />
            노쇼
          </label>
        </fieldset>

        <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onPreview}
            disabled={previewBusy || !actionType}
            data-testid="private-lesson-status-action-preview-submit"
            style={{
              padding: '9px 14px',
              borderRadius: 10,
              border: '1px solid #3c7a5f',
              background: '#1e3a2d',
              color: 'white',
              fontWeight: 700,
              cursor: previewBusy || !actionType ? 'not-allowed' : 'pointer',
            }}
          >
            {previewBusy ? '미리보기 중...' : '서버 기준 미리보기'}
          </button>
          <span style={{ alignSelf: 'center', opacity: 0.75, fontSize: 13 }}>
            {'이번 단계에서는 실제 처리하지 않습니다. 수업/예약/수강권/차감 기록은 수정되지 않습니다.'}
          </span>
        </div>

        {previewError ? (
          <section
            data-testid="private-lesson-status-action-preview-error"
            style={{
              marginTop: 14,
              border: '1px solid #734141',
              borderRadius: 12,
              background: '#2a1719',
              padding: 14,
              color: '#ffc9c9',
            }}
          >
            <strong>미리보기 실패</strong>
            <p style={{ margin: '8px 0 0 0' }}>{previewError}</p>
          </section>
        ) : null}

        {preview ? (
          <section
            data-testid="private-lesson-status-action-preview-result"
            style={{
              marginTop: 16,
              display: 'grid',
              gap: 12,
            }}
          >
            <div
              style={{
                border: blockedReasons.length > 0 ? '1px solid #765233' : '1px solid #375c45',
                borderRadius: 12,
                background: blockedReasons.length > 0 ? '#2b2117' : '#14251c',
                padding: 14,
              }}
            >
              <strong>{blockedReasons.length > 0 ? '처리 차단 사유가 있습니다' : '서버 미리보기 통과'}</strong>
              <p style={{ margin: '8px 0 0 0', opacity: 0.82, fontSize: 13 }}>
                actionType: {ACTION_LABELS[preview.actionType] || preview.actionType || actionType}
                {' · '}현재: {currentStatus}
                {' · '}예상: {proposedStatus}
              </p>
              {blockedReasons.length > 0 ? (
                <p style={{ margin: '8px 0 0 0', color: '#ffd2a8', fontSize: 13 }}>
                  차감 처리가 필요한 수업은 이번 preview-only UI에서 실제 처리하지 않습니다.
                </p>
              ) : null}
            </div>

            <ListBlock title="처리 차단 사유" items={blockedReasons} />
            <ListBlock title="주의/안내" items={warnings} />

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 10,
              }}
            >
              <FieldBlock label="currentState" value={preview.currentState} />
              <FieldBlock label="proposedState" value={preview.proposedState} />
              <FieldBlock label="packageImpact" value={preview.packageImpact} />
              <FieldBlock label="creditTransactionPreview" value={preview.creditTransactionPreview} />
              <FieldBlock label="normalizedPlan" value={preview.normalizedPlan} />
              <FieldBlock label="target / payload" value={{ target: preview.target, payload: previewPayload }} />
            </div>

            <FieldBlock label="nextStep" value={preview.nextStep} />
          </section>
        ) : null}
      </section>
    </div>
  )
}
