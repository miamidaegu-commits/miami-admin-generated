import { useState } from 'react'
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
  isAdmin,
  outcomePreviewBusy,
  outcomePreviewError,
  outcomePreviewResult,
  outcomePreviewPayload,
  outcomePreviewPlanHash,
  commitBusy,
  commitError,
  commitResult,
  onPreview,
  onOutcomePreview,
  onCommit,
  onClose,
}) {
  const [commitConfirmed, setCommitConfirmed] = useState(false)
  if (!target) return null
  const blockedReasons = Array.isArray(preview?.blockedReasons) ? preview.blockedReasons : []
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : []
  const outcomeBlockedReasons = Array.isArray(outcomePreviewResult?.blockedReasons)
    ? outcomePreviewResult.blockedReasons
    : []
  const outcomeWarnings = Array.isArray(outcomePreviewResult?.warnings)
    ? outcomePreviewResult.warnings
    : []
  const row = target || {}
  const reservationId = String(row.reservationId || row.privateReservationId || row.id || '').trim()
  const currentStatus = preview?.currentState?.status || row.status || '-'
  const proposedStatus =
    preview?.proposedState?.reservation?.status ||
    preview?.proposedState?.lesson?.status ||
    preview?.normalizedPlan?.targetStatus ||
    '-'
  const previewPassed = preview?.ok === true && preview?.allowed === true && blockedReasons.length === 0
  const hasPackageOrCreditWriteRequirement = blockedReasons.includes(
    'package_or_credit_write_required'
  )
  const showOutcomePreviewEntry =
    Boolean(preview) &&
    hasPackageOrCreditWriteRequirement &&
    ['complete', 'no_show'].includes(actionType) &&
    Boolean(reservationId) &&
    isAdmin === true &&
    !outcomePreviewBusy
  const outcomePackageImpact = outcomePreviewResult?.packageImpact || {}
  const outcomeCreditTransactionPreview = outcomePreviewResult?.creditTransactionPreview || {}
  const outcomePreviewBlocked =
    Boolean(outcomePreviewResult) &&
    (outcomePreviewResult.ok !== true ||
      outcomePreviewResult.allowed !== true ||
      outcomeBlockedReasons.length > 0)
  const commitDisabled =
    !previewPassed ||
    !previewPayload ||
    !commitConfirmed ||
    previewBusy ||
    commitBusy ||
    Boolean(commitResult)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="private-lesson-status-action-modal-title"
      data-testid="private-lesson-status-action-modal"
      onClick={(event) => {
        if (
          event.target === event.currentTarget &&
          !previewBusy &&
          !outcomePreviewBusy &&
          !commitBusy
        ) {
          onClose?.()
        }
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
            disabled={previewBusy || outcomePreviewBusy || commitBusy}
            aria-label="닫기"
            style={{
              height: 34,
              borderRadius: 8,
              border: '1px solid #3b4254',
              background: '#222938',
              color: 'white',
              cursor: previewBusy || outcomePreviewBusy || commitBusy ? 'not-allowed' : 'pointer',
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
              onChange={() => {
                setCommitConfirmed(false)
                setActionType?.('complete')
              }}
              disabled={
                previewBusy || outcomePreviewBusy || commitBusy || Boolean(commitResult)
              }
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
              onChange={() => {
                setCommitConfirmed(false)
                setActionType?.('no_show')
              }}
              disabled={
                previewBusy || outcomePreviewBusy || commitBusy || Boolean(commitResult)
              }
              data-testid="private-lesson-status-action-type-no-show"
            />
            노쇼
          </label>
        </fieldset>

        <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => {
              setCommitConfirmed(false)
              onPreview?.()
            }}
            disabled={
              previewBusy ||
              outcomePreviewBusy ||
              commitBusy ||
              Boolean(commitResult) ||
              !actionType
            }
            data-testid="private-lesson-status-action-preview-submit"
            style={{
              padding: '9px 14px',
              borderRadius: 10,
              border: '1px solid #3c7a5f',
              background: '#1e3a2d',
              color: 'white',
              fontWeight: 700,
              cursor:
                previewBusy || outcomePreviewBusy || commitBusy || commitResult || !actionType
                  ? 'not-allowed'
                  : 'pointer',
            }}
          >
            {previewBusy ? '미리보기 중...' : '서버 기준 미리보기'}
          </button>
          <span style={{ alignSelf: 'center', opacity: 0.75, fontSize: 13 }}>
            먼저 서버 기준 미리보기를 실행한 뒤, 통과한 결과만 실제 처리할 수 있습니다.
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

        {showOutcomePreviewEntry ? (
          <section
            style={{
              marginTop: 14,
              border: '1px solid #7a6237',
              borderRadius: 12,
              background: '#2a2415',
              padding: 14,
            }}
          >
            <strong>수강권 차감이 필요한 수업입니다</strong>
            <p style={{ margin: '8px 0 0 0', color: '#ffe1a8', fontSize: 13, lineHeight: 1.5 }}>
              이 수업은 수강권 차감과 차감 기록 생성이 필요한 수업입니다. 차감 포함
              미리보기에서 변경 내용을 먼저 확인하세요.
            </p>
            <button
              type="button"
              onClick={onOutcomePreview}
              disabled={outcomePreviewBusy}
              data-testid="private-lesson-outcome-preview-button"
              style={{
                marginTop: 12,
                padding: '9px 14px',
                borderRadius: 10,
                border: '1px solid #9b7433',
                background: '#4b3515',
                color: 'white',
                fontWeight: 700,
                cursor: outcomePreviewBusy ? 'not-allowed' : 'pointer',
              }}
            >
              차감 포함 미리보기
            </button>
          </section>
        ) : null}

        {outcomePreviewBusy ? (
          <section
            style={{
              marginTop: 14,
              border: '1px solid #3c5f7a',
              borderRadius: 12,
              background: '#142331',
              padding: 14,
            }}
          >
            차감 포함 미리보기 실행 중...
          </section>
        ) : null}

        {outcomePreviewError ? (
          <section
            data-testid="private-lesson-outcome-preview-error"
            style={{
              marginTop: 14,
              border: '1px solid #734141',
              borderRadius: 12,
              background: '#2a1719',
              padding: 14,
              color: '#ffc9c9',
            }}
          >
            <strong>차감 포함 미리보기 실패</strong>
            <p style={{ margin: '8px 0 0 0' }}>{outcomePreviewError}</p>
            <p style={{ margin: '8px 0 0 0', opacity: 0.82, fontSize: 13 }}>
              서버 기준 미리보기를 다시 실행한 뒤 차감 포함 미리보기를 재실행하세요.
            </p>
          </section>
        ) : null}

        {outcomePreviewResult ? (
          <section
            data-testid="private-lesson-outcome-preview-result"
            style={{
              marginTop: 16,
              display: 'grid',
              gap: 12,
            }}
          >
            <div
              style={{
                border: outcomePreviewBlocked ? '1px solid #765233' : '1px solid #375c45',
                borderRadius: 12,
                background: outcomePreviewBlocked ? '#2b2117' : '#14251c',
                padding: 14,
              }}
            >
              <strong>
                {outcomePreviewBlocked
                  ? '차감 포함 미리보기 처리 차단 사유가 있습니다'
                  : '차감 포함 미리보기 통과'}
              </strong>
              <p style={{ margin: '8px 0 0 0', opacity: 0.82, fontSize: 13 }}>
                actionType: {outcomePreviewResult.actionType || actionType}
                {' · '}normalizedOutcome: {outcomePreviewResult.normalizedOutcome || '-'}
                {' · '}requestId:{' '}
                {outcomePreviewResult.requestId || outcomePreviewPayload?.requestId || '-'}
              </p>
              {outcomePreviewBlocked ? (
                <p style={{ margin: '8px 0 0 0', color: '#ffd2a8', fontSize: 13 }}>
                  실제 처리는 제공하지 않습니다. 차단 사유를 확인하고 서버 기준 미리보기부터
                  다시 실행하세요.
                </p>
              ) : null}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 10,
              }}
            >
              <FieldBlock
                label="current reservation status"
                value={outcomePreviewResult.currentState?.reservation?.status}
              />
              <FieldBlock
                label="proposed reservation status"
                value={outcomePreviewResult.proposedState?.reservation?.nextStatus}
              />
              <FieldBlock label="package id" value={outcomePackageImpact.packageId} />
              <FieldBlock
                label="currentUsedCount → nextUsedCount"
                value={{
                  currentUsedCount: outcomePackageImpact.currentUsedCount,
                  nextUsedCount: outcomePackageImpact.nextUsedCount,
                }}
              />
              <FieldBlock
                label="currentRemainingCount → nextRemainingCount"
                value={{
                  currentRemainingCount: outcomePackageImpact.currentRemainingCount,
                  nextRemainingCount: outcomePackageImpact.nextRemainingCount,
                }}
              />
              <FieldBlock
                label="usedCountDelta / remainingCountDelta"
                value={{
                  usedCountDelta: outcomePackageImpact.usedCountDelta,
                  remainingCountDelta: outcomePackageImpact.remainingCountDelta,
                }}
              />
              <FieldBlock
                label="current package status → next package status"
                value={{
                  currentStatus: outcomePackageImpact.currentStatus,
                  nextStatus: outcomePackageImpact.nextStatus,
                }}
              />
              <FieldBlock
                label="creditTransactionPreview.wouldCreate"
                value={outcomeCreditTransactionPreview.wouldCreate}
              />
              <FieldBlock
                label="creditTransactionId"
                value={outcomeCreditTransactionPreview.creditTransactionId}
              />
              <FieldBlock
                label="sourceType / sourceId"
                value={{
                  sourceType: outcomeCreditTransactionPreview.sourceType,
                  sourceId: outcomeCreditTransactionPreview.sourceId,
                }}
              />
              <FieldBlock
                label="deltaCount / duplicateExists"
                value={{
                  deltaCount: outcomeCreditTransactionPreview.deltaCount,
                  duplicateExists: outcomeCreditTransactionPreview.duplicateExists,
                }}
              />
            </div>

            <ListBlock title="차감 포함 처리 차단 사유" items={outcomeBlockedReasons} />
            <ListBlock title="차감 포함 주의/안내" items={outcomeWarnings} />
            <FieldBlock label="normalizedPlan" value={outcomePreviewResult.normalizedPlan} />
            <FieldBlock
              label="planHash"
              value={outcomePreviewPlanHash || outcomePreviewResult.planHash}
            />
            <FieldBlock label="nextStep" value={outcomePreviewResult.nextStep} />
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

            <section
              data-testid="private-lesson-status-action-final-confirmation"
              style={{
                border: previewPassed ? '1px solid #3c7a5f' : '1px solid #665044',
                borderRadius: 12,
                background: previewPassed ? '#12251a' : '#252016',
                padding: 14,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 15 }}>실제 처리 전 최종 확인</h3>
              <p style={{ margin: '8px 0 0 0', opacity: 0.82, fontSize: 13, lineHeight: 1.5 }}>
                실제 처리 버튼을 누르면 예약 상태가 {ACTION_LABELS[actionType] || actionType}로
                저장됩니다. 차감취소/차감복구/완료취소는 이번 단계에 포함하지 않습니다.
              </p>
              <p style={{ margin: '8px 0 0 0', opacity: 0.78, fontSize: 13 }}>
                {'같은 요청을 반복해서 누르지 마세요. 변경이 필요하면 서버 기준 미리보기를 다시 실행하세요.'}
              </p>
              {!previewPassed ? (
                <p style={{ margin: '8px 0 0 0', color: '#ffd2a8', fontSize: 13 }}>
                  서버 미리보기를 통과하고 처리 차단 사유가 없어야 실제 처리를 실행할 수
                  있습니다.
                </p>
              ) : null}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  marginTop: 12,
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                <input
                  type="checkbox"
                  checked={commitConfirmed}
                  onChange={(event) => setCommitConfirmed(event.target.checked)}
                  disabled={!previewPassed || commitBusy || Boolean(commitResult)}
                  data-testid="private-lesson-status-action-commit-confirm"
                />
                이 미리보기 결과로 실제 수업 상태를 처리합니다.
              </label>
              <button
                type="button"
                onClick={onCommit}
                disabled={commitDisabled}
                data-testid="private-lesson-status-action-commit-button"
                style={{
                  marginTop: 12,
                  padding: '9px 14px',
                  borderRadius: 10,
                  border: '1px solid #7a513c',
                  background: '#3a241d',
                  color: 'white',
                  fontWeight: 700,
                  cursor: commitDisabled ? 'not-allowed' : 'pointer',
                  opacity: commitDisabled ? 0.68 : 1,
                }}
              >
                {commitBusy ? '실제 처리 중...' : '위 내용으로 수업 처리'}
              </button>
            </section>
          </section>
        ) : null}

        {commitError ? (
          <section
            data-testid="private-lesson-status-action-commit-error"
            style={{
              marginTop: 14,
              border: '1px solid #734141',
              borderRadius: 12,
              background: '#2a1719',
              padding: 14,
              color: '#ffc9c9',
            }}
          >
            <strong>실제 처리 실패</strong>
            <p style={{ margin: '8px 0 0 0' }}>{commitError}</p>
          </section>
        ) : null}

        {commitResult ? (
          <section
            data-testid="private-lesson-status-action-commit-result"
            style={{
              marginTop: 14,
              border: '1px solid #375c45',
              borderRadius: 12,
              background: '#14251c',
              padding: 14,
            }}
          >
            <strong>실제 처리가 완료되었습니다</strong>
            <p style={{ margin: '8px 0 0 0', opacity: 0.82, fontSize: 13 }}>
              actionType: {ACTION_LABELS[commitResult.actionType] || commitResult.actionType || actionType}
              {' · '}requestId: {commitResult.requestId || previewPayload?.requestId || '-'}
              {' · '}committed: {commitResult.committed === true ? 'true' : 'false'}
              {' · '}batchId: {commitResult.batchId || '-'}
              {' · '}idempotentReplay: {commitResult.idempotentReplay === true ? 'true' : 'false'}
            </p>
            <div
              style={{
                marginTop: 12,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 10,
              }}
            >
              <FieldBlock label="updated" value={commitResult.updated} />
              <FieldBlock label="normalizedPlan" value={commitResult.normalizedPlan} />
              <FieldBlock label="nextStep" value={commitResult.nextStep} />
            </div>
          </section>
        ) : null}
      </section>
    </div>
  )
}
