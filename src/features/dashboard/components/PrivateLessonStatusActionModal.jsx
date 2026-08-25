import { useEffect, useRef, useState } from 'react'
import { getStudentName, getTeacherName } from '../dashboardViewUtils.js'
import { useTranslation } from '../../../i18n/LocalizationProvider.jsx'
import { installDialogFocusContainment } from '../../../preferences/layout.js'

const ACTION_LABELS = {
  complete: '수업완료',
  no_show: '결석',
  reverse_deduction: '결석 취소',
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

function getOutcomeCommitErrorGuidance(error) {
  const searchable = [
    error?.code,
    error?.message,
    ...(Array.isArray(error?.blockedReasons) ? error.blockedReasons : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const guidanceByMarker = [
    {
      markers: ['preview_stale', 'stale preview', 'planhash'],
      message:
        'stale preview / planHash mismatch: 예약 또는 수강권 상태가 바뀌었습니다. 두 미리보기를 다시 실행하세요.',
    },
    {
      markers: ['request_id_conflict', 'payloadhash', 'already-exists'],
      message:
        'payloadHash conflict: 같은 requestId에 다른 payload를 사용할 수 없습니다. 새 미리보기부터 시작하세요.',
    },
    {
      markers: ['reservation', 'reservation changed'],
      message: 'reservation changed: 예약 최신 상태를 다시 불러온 뒤 두 미리보기를 다시 실행하세요.',
    },
    {
      markers: ['package', 'package changed'],
      message: 'package changed: 수강권 최신 상태를 기준으로 차감 포함 미리보기를 다시 실행하세요.',
    },
    {
      markers: ['credit_transaction', 'credit transaction already exists'],
      message:
        'credit transaction already exists / duplicate deduction: 기존 차감 기록을 확인하고 재실행하지 마세요.',
    },
  ]
  return (
    guidanceByMarker.find(({ markers }) => markers.some((marker) => searchable.includes(marker)))
      ?.message ||
    '서버가 현재 상태에서 처리를 거부했습니다. 오류 진단을 확인하고 두 미리보기를 다시 실행하세요.'
  )
}

function getFixedOutcomeErrorGuidance(error) {
  if (error?.retryWithSamePayload === true) {
    return '네트워크/시간초과/알 수 없는 전송 오류입니다. 미리보기 payload, requestId, planHash를 유지했습니다. 같은 확정 버튼으로 동일 payload를 재전송해 idempotent 결과를 확인하세요.'
  }
  const searchable = [
    error?.code,
    error?.message,
    ...(Array.isArray(error?.blockedReasons) ? error.blockedReasons : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (searchable.includes('preview_stale') || searchable.includes('planhash')) {
    return 'preview_stale: 연결 문서나 수강권 원장이 변경되었습니다. 새 requestId로 미리보기부터 다시 실행하세요.'
  }
  if (searchable.includes('request_id_conflict') || searchable.includes('already-exists')) {
    return 'request_id_conflict: 같은 requestId를 재사용하지 말고 새 미리보기부터 시작하세요.'
  }
  if (
    searchable.includes('package_aggregate_conflict') ||
    searchable.includes('inconsistent_ledger_markers')
  ) {
    return '원장 진단 충돌입니다. 고정 회차의 lesson/reservation/slot/package 연결을 관리자가 먼저 확인해야 합니다.'
  }
  if (searchable.includes('permission') || searchable.includes('teacher_not_owner')) {
    return '권한 또는 선생님 소유권이 일치하지 않습니다. 현재 학원 멤버십과 회차 담당 선생님을 확인하세요.'
  }
  return error?.requiresFreshPreview === true
    ? '결정적 서버 거부입니다. 기존 미리보기는 폐기되었습니다. 오류와 원장 진단을 확인한 뒤 새 미리보기를 실행하세요.'
    : '전송 결과를 확정할 수 없습니다. 기존 payload를 유지한 채 동일 요청으로 결과를 다시 확인하세요.'
}

function getFixedOutcomeTargetIds(row) {
  const rowKind = String(row?._calendarRowKind || '').trim()
  return {
    lessonId: String(
      rowKind === 'privateReservation'
        ? row?.lessonId || row?.fixedLessonId || row?.sourceLessonId || ''
        : row?.id || row?.lessonId || row?.fixedLessonId || ''
    ).trim(),
    reservationId: String(
      rowKind === 'privateReservation'
        ? row?.id ||
            row?.reservationId ||
            row?.privateLessonReservationId ||
            row?.privateReservationId ||
            ''
        : row?.reservationId ||
            row?.privateLessonReservationId ||
            row?.privateReservationId ||
            ''
    ).trim(),
    slotId: String(row?.slotId || row?.privateLessonSlotId || row?.privateSlotId || '').trim(),
    packageId: String(
      row?.packageId ||
        row?.deductionPackageId ||
        row?.linkedPackageId ||
        row?.fixedPrivatePackageId ||
        ''
    ).trim(),
  }
}

function FixedPrivateLessonOutcomeMode({
  target,
  actionType,
  setActionType,
  reversalReason,
  setReversalReason,
  fixedLocalGatePassed,
  fixedOutcomePreviewBusy,
  fixedOutcomePreviewError,
  fixedOutcomePreviewResult,
  fixedOutcomePreviewPayload,
  fixedOutcomePreviewPlanHash,
  fixedOutcomeCommitBusy,
  fixedOutcomeCommitError,
  fixedOutcomeCommitResult,
  fixedOutcomeCommitConfirmed,
  setFixedOutcomeCommitConfirmed,
  onFixedOutcomePreview,
  onFixedOutcomeCommit,
  onClose,
  teacherPortal = false,
}) {
  const { t } = useTranslation()
  const dialogRef = useRef(null)
  const closeRef = useRef(null)
  const text = (key, fallback) => (teacherPortal ? t(key) : fallback)
  const ids = getFixedOutcomeTargetIds(target)
  const preview = fixedOutcomePreviewResult || null
  const payload = fixedOutcomePreviewPayload || null
  const blockedReasons = Array.isArray(preview?.blockedReasons) ? preview.blockedReasons : []
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : []
  const classification = preview?.ledgerClassification || {}
  const diagnostics = preview?.ledgerDiagnostics || {}
  const packageImpact = preview?.packageImpact || {}
  const creditPreview = preview?.creditTransactionPreview || {}
  const normalizedPlan = preview?.normalizedPlan || {}
  const requestId = String(payload?.requestId || '').trim()
  const planHash = String(fixedOutcomePreviewPlanHash || '').trim()
  const isFixedNoShowReversal = actionType === 'reverse_deduction'
  const originalDeductionId = String(
    normalizedPlan.activeDeductionId ||
      normalizedPlan.originalCreditTransactionId ||
      target?.deductionCreditTransactionId ||
      target?.deductionTransactionId ||
      ''
  ).trim()
  const studentLabel = String(
    target?.studentName || target?.student || target?.studentId || '-'
  ).trim()
  const teacherLabel = String(
    target?.teacherDisplayName ||
      target?.teacherName ||
      target?.teacher ||
      target?.teacherUid ||
      '-'
  ).trim()
  const lessonDateTimeLabel = [
    String(target?.date || '').trim(),
    String(target?.time || '').trim(),
  ]
    .filter(Boolean)
    .join(' ') || '-'
  const previewMatchesTargetAndAction =
    Boolean(payload && requestId && planHash) &&
    payload.lessonId === ids.lessonId &&
    payload.reservationId === ids.reservationId &&
    payload.slotId === ids.slotId &&
    payload.packageId === ids.packageId &&
    payload.actionType === actionType &&
    preview?.requestId === requestId &&
    preview?.actionType === actionType &&
    String(preview?.planHash || '').trim() === planHash &&
    normalizedPlan.lessonId === ids.lessonId &&
    normalizedPlan.reservationId === ids.reservationId &&
    normalizedPlan.slotId === ids.slotId &&
    normalizedPlan.packageId === ids.packageId
  const previewPassed =
    Boolean(preview) &&
    preview.ok === true &&
    preview.allowed === true &&
    blockedReasons.length === 0 &&
    creditPreview.duplicateExists === false &&
    fixedLocalGatePassed === true &&
    previewMatchesTargetAndAction
  const interactionBusy = fixedOutcomePreviewBusy || fixedOutcomeCommitBusy
  const locked = Boolean(fixedOutcomeCommitResult)
  const commitDisabled =
    !previewPassed ||
    fixedOutcomeCommitConfirmed !== true ||
    interactionBusy ||
    locked
  const errorPlan = fixedOutcomeCommitError?.normalizedPlan || {}
  const successPlan = fixedOutcomeCommitResult?.normalizedPlan || {}
  useEffect(() => {
    return installDialogFocusContainment({
      container: dialogRef.current,
      initialFocus: closeRef.current,
      onClose: () => {
        if (!interactionBusy) onClose?.()
      },
    })
  }, [interactionBusy, onClose])

  return (
    <div
      role="presentation"
      data-testid="fixed-private-lesson-outcome-modal"
      className="teacher-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !interactionBusy) onClose?.()
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fixed-private-lesson-outcome-modal-title"
        tabIndex={-1}
        className="teacher-dialog-panel teacher-outcome-sheet"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(820px, 100%)',
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
            <h2 id="fixed-private-lesson-outcome-modal-title" style={{ margin: 0 }}>
              {isFixedNoShowReversal
                ? t('teacher.outcome.fixedReversal.title')
                : text('teacher.outcome.title', '고정 1:1 회차 결과 처리')}
            </h2>
            <p style={{ margin: '8px 0 0 0', opacity: 0.78, fontSize: 14 }}>
              {isFixedNoShowReversal
                ? t('teacher.outcome.fixedReversal.description')
                : text(
                    'teacher.outcome.description',
                    '고정 회차의 3-way 링크와 원장 전환을 서버에서 미리 확인한 뒤 처리합니다.'
                  )}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={interactionBusy}
            data-testid="fixed-private-lesson-outcome-close-button"
            style={{
              height: 34,
              borderRadius: 8,
              border: '1px solid #3b4254',
              background: '#222938',
              color: 'white',
              cursor: interactionBusy ? 'not-allowed' : 'pointer',
            }}
          >
            {text('teacher.common.close', '닫기')}
          </button>
        </div>

        <div
          style={{
            marginTop: 16,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
          }}
        >
          <FieldBlock label="lessonId" value={ids.lessonId} />
          <FieldBlock label="linked reservationId" value={ids.reservationId} />
          <FieldBlock label="slotId" value={ids.slotId} />
          <FieldBlock label="packageId" value={ids.packageId} />
        </div>

        {isFixedNoShowReversal ? (
          <div
            data-testid="fixed-private-no-show-reversal-context"
            style={{
              marginTop: 12,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 10,
            }}
          >
            <FieldBlock label={t('teacher.outcome.fixedReversal.student')} value={studentLabel} />
            <FieldBlock label={t('teacher.outcome.fixedReversal.teacher')} value={teacherLabel} />
            <FieldBlock
              label={t('teacher.outcome.fixedReversal.lessonDateTime')}
              value={lessonDateTimeLabel}
            />
            <FieldBlock
              label={t('teacher.outcome.fixedReversal.originalDeductionId')}
              value={originalDeductionId || '-'}
            />
          </div>
        ) : null}

        {!fixedLocalGatePassed ? (
          <section
            data-testid="fixed-private-lesson-outcome-local-gate-error"
            style={{
              marginTop: 14,
              border: '1px solid #734141',
              borderRadius: 12,
              background: '#2a1719',
              padding: 14,
              color: '#ffc9c9',
            }}
          >
            {text(
              'teacher.outcome.localGateError',
              '관리자이거나, 활성 교사 멤버십에 canManageOwnLessonDeductions 권한이 있고 담당 선생님 별칭이 일치해야 합니다.'
            )}
          </section>
        ) : null}

        {isFixedNoShowReversal ? (
          <section
            data-testid="fixed-private-no-show-reversal-mode"
            style={{
              marginTop: 16,
              border: '1px solid #8b6842',
              borderRadius: 12,
              background: '#2a2415',
              padding: 14,
              fontWeight: 700,
            }}
          >
            {t('teacher.outcome.fixedReversal.cancelNoShow')}
          </section>
        ) : (
          <fieldset
            style={{
              margin: '16px 0 0 0',
              border: '1px solid #2c3447',
              borderRadius: 12,
              padding: 14,
            }}
          >
            <legend style={{ padding: '0 6px', fontWeight: 700 }}>
              {text('teacher.outcome.actionType', '처리 유형')}
            </legend>
            {[
              ['complete', text('teacher.outcome.complete', '수업완료')],
              ['no_show', text('teacher.outcome.noShow', '노쇼')],
            ].map(([value, label]) => (
              <label
                key={value}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginRight: 18 }}
              >
                <input
                  type="radio"
                  name="fixedPrivateLessonOutcomeActionType"
                  value={value}
                  checked={actionType === value}
                  onChange={() => setActionType?.(value)}
                  disabled={interactionBusy || locked}
                  data-testid={`fixed-private-lesson-outcome-type-${value}`}
                />
                {label}
              </label>
            ))}
          </fieldset>
        )}

        <button
          type="button"
          onClick={onFixedOutcomePreview}
          disabled={!fixedLocalGatePassed || interactionBusy || locked}
          data-testid="fixed-private-lesson-outcome-preview-submit"
          style={{
            marginTop: 14,
            padding: '9px 14px',
            borderRadius: 10,
            border: '1px solid #3c7a5f',
            background: '#1e3a2d',
            color: 'white',
            fontWeight: 700,
            cursor: !fixedLocalGatePassed || interactionBusy || locked ? 'not-allowed' : 'pointer',
          }}
        >
          {fixedOutcomePreviewBusy
            ? text('teacher.outcome.previewing', '고정 회차 미리보기 중...')
            : isFixedNoShowReversal
              ? t('teacher.outcome.fixedReversal.preview')
              : text('teacher.outcome.preview', '고정 회차 서버 미리보기')}
        </button>

        {fixedOutcomePreviewError ? (
          <section
            data-testid="fixed-private-lesson-outcome-preview-error"
            style={{
              marginTop: 14,
              border: '1px solid #734141',
              borderRadius: 12,
              background: '#2a1719',
              padding: 14,
              color: '#ffc9c9',
            }}
          >
            <strong>{text('teacher.outcome.previewFailed', '고정 회차 미리보기 실패')}</strong>
            <p style={{ margin: '8px 0 0 0' }}>{fixedOutcomePreviewError}</p>
          </section>
        ) : null}

        {preview ? (
          <section
            data-testid="fixed-private-lesson-outcome-preview-result"
            style={{ marginTop: 16, display: 'grid', gap: 12 }}
          >
            <div
              style={{
                border: previewPassed ? '1px solid #375c45' : '1px solid #765233',
                borderRadius: 12,
                background: previewPassed ? '#14251c' : '#2b2117',
                padding: 14,
              }}
            >
              <strong>
                {previewPassed
                  ? text('teacher.outcome.previewPassed', '고정 회차 미리보기 통과')
                  : text('teacher.outcome.previewBlocked', '고정 회차 처리 차단')}
              </strong>
              <p style={{ margin: '8px 0 0 0', fontSize: 13, opacity: 0.82 }}>
                requestId: {requestId || '-'} · actionType: {preview.actionType || actionType}
              </p>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 10,
              }}
            >
              <FieldBlock
                label="3-way IDs"
                value={{
                  lessonId: normalizedPlan.lessonId,
                  reservationId: normalizedPlan.reservationId,
                  slotId: normalizedPlan.slotId,
                }}
              />
              <FieldBlock
                label="ledger classification (canonical vs legacy)"
                value={classification}
              />
              <FieldBlock
                label="package current → next counts"
                value={{
                  currentUsedCount: packageImpact.currentUsedCount,
                  nextUsedCount: packageImpact.nextUsedCount,
                  currentRemainingCount: packageImpact.currentRemainingCount,
                  nextRemainingCount: packageImpact.nextRemainingCount,
                }}
              />
              <FieldBlock
                label="package deltas"
                value={{
                  usedCountDelta: packageImpact.usedCountDelta,
                  remainingCountDelta: packageImpact.remainingCountDelta,
                }}
              />
              <FieldBlock label="credit preview" value={creditPreview} />
              <FieldBlock label="ledger diagnostics" value={diagnostics} />
            </div>

            {isFixedNoShowReversal ? (
              <section
                data-testid="fixed-private-no-show-reversal-package-impact"
                style={{
                  border: '1px solid #3c7a5f',
                  borderRadius: 12,
                  background: '#14251c',
                  padding: 14,
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: 10,
                  }}
                >
                  <FieldBlock
                    label={t('teacher.outcome.fixedReversal.currentUsedCount')}
                    value={packageImpact.currentUsedCount}
                  />
                  <FieldBlock
                    label={t('teacher.outcome.fixedReversal.nextUsedCount')}
                    value={packageImpact.nextUsedCount}
                  />
                  <FieldBlock
                    label={t('teacher.outcome.fixedReversal.currentRemainingCount')}
                    value={packageImpact.currentRemainingCount}
                  />
                  <FieldBlock
                    label={t('teacher.outcome.fixedReversal.nextRemainingCount')}
                    value={packageImpact.nextRemainingCount}
                  />
                  <FieldBlock
                    label={t('teacher.outcome.fixedReversal.packageChange')}
                    value={t('teacher.outcome.fixedReversal.restoreAmount', {
                      count: Number(packageImpact.remainingCountDelta || 0),
                    })}
                  />
                  <FieldBlock
                    label={t('teacher.outcome.fixedReversal.reversalCredit')}
                    value={
                      Number(creditPreview.deltaCount || 0) > 0
                        ? `+${Number(creditPreview.deltaCount)}`
                        : Number(creditPreview.deltaCount || 0)
                    }
                  />
                </div>
                <p style={{ margin: '12px 0 0 0', color: '#c9f2d5' }}>
                  {t('teacher.outcome.fixedReversal.accountingDescription')}
                </p>
              </section>
            ) : null}

            {classification.mode === 'legacy' ? (
              <section
                data-testid="fixed-private-lesson-outcome-legacy-net-zero-warning"
                style={{
                  border: '1px solid #9b7433',
                  borderRadius: 12,
                  background: '#2a2415',
                  padding: 14,
                  color: '#ffe1a8',
                }}
              >
                {text(
                  'teacher.outcome.legacyWarning',
                  'legacy 원장 전환: 기존 lesson 기여분을 reservation 원장으로 옮기므로 package net delta zero(순변화 0)일 수 있습니다.'
                )}
              </section>
            ) : null}

            <ListBlock title="blockedReasons" items={blockedReasons} />
            <ListBlock title="warnings" items={warnings} />
            <FieldBlock label="normalizedPlan" value={normalizedPlan} />
            <FieldBlock label="planHash" value={planHash} />
            <FieldBlock label="nextStep" value={preview.nextStep} />

            {previewPassed ? (
              <section
                data-testid="fixed-private-lesson-outcome-final-confirmation"
                style={{
                  border: '1px solid #9b7433',
                  borderRadius: 12,
                  background: '#2a2415',
                  padding: 14,
                }}
              >
                <h3 style={{ margin: 0, fontSize: 15 }}>
                  {isFixedNoShowReversal
                    ? t('teacher.outcome.fixedReversal.finalTitle')
                    : text('teacher.outcome.finalTitle', '고정 회차 실제 처리 전 최종 확인')}
                </h3>
                <p style={{ margin: '8px 0 0 0', color: '#ffe1a8', fontSize: 13 }}>
                  {text(
                    'teacher.outcome.finalDescription',
                    'lesson/reservation 상태, slot 원장 표식, 수강권 횟수와 차감 기록을 함께 변경합니다. 결과가 표시될 때까지 반복 클릭하거나 창을 닫지 마세요.'
                  )}
                </p>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    marginTop: 12,
                    fontSize: 13,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={fixedOutcomeCommitConfirmed === true}
                    onChange={(event) => setFixedOutcomeCommitConfirmed?.(event.target.checked)}
                    disabled={interactionBusy || locked}
                    data-testid="fixed-private-lesson-outcome-commit-checkbox"
                  />
                  {isFixedNoShowReversal
                    ? t('teacher.outcome.fixedReversal.confirm')
                    : text(
                        'teacher.outcome.confirm',
                        '미리보기의 대상, 원장 분류, 횟수 변화와 차감 기록을 확인했습니다.'
                      )}
                </label>
                <button
                  type="button"
                  onClick={onFixedOutcomeCommit}
                  disabled={commitDisabled}
                  data-testid="fixed-private-lesson-outcome-commit-button"
                  style={{
                    marginTop: 12,
                    padding: '9px 14px',
                    borderRadius: 10,
                    border: '1px solid #a96d44',
                    background: '#57311d',
                    color: 'white',
                    fontWeight: 700,
                    cursor: commitDisabled ? 'not-allowed' : 'pointer',
                    opacity: commitDisabled ? 0.68 : 1,
                  }}
                >
                  {fixedOutcomeCommitBusy
                    ? text('teacher.outcome.committing', '고정 회차 실제 처리 중...')
                    : isFixedNoShowReversal
                      ? t('teacher.outcome.fixedReversal.commit')
                      : text('teacher.outcome.commit', '고정 회차 결과 확정')}
                </button>
              </section>
            ) : null}
          </section>
        ) : null}

        {fixedOutcomeCommitError ? (
          <section
            data-testid="fixed-private-lesson-outcome-commit-error"
            data-retry-mode={
              fixedOutcomeCommitError.retryWithSamePayload === true
                ? 'same-payload'
                : 'fresh-preview'
            }
            style={{
              marginTop: 14,
              display: 'grid',
              gap: 12,
              border: '1px solid #8d4444',
              borderRadius: 12,
              background: '#2a1719',
              padding: 14,
              color: '#ffc9c9',
            }}
          >
            <div>
              <strong>{text('teacher.outcome.commitFailed', '고정 회차 실제 처리 실패')}</strong>
              <p style={{ margin: '8px 0 0 0' }}>{fixedOutcomeCommitError.message}</p>
              <p style={{ margin: '8px 0 0 0', fontSize: 13 }}>
                {teacherPortal
                  ? fixedOutcomeCommitError.retryWithSamePayload === true
                    ? t('teacher.outcome.retrySamePayload')
                    : t('teacher.outcome.retryFreshPreview')
                  : getFixedOutcomeErrorGuidance(fixedOutcomeCommitError)}
              </p>
              <p style={{ margin: '8px 0 0 0', fontSize: 13, opacity: 0.82 }}>
                {fixedOutcomeCommitError.retryWithSamePayload === true
                  ? text(
                      'teacher.outcome.payloadPreserved',
                      '보존됨: 동일 requestId / planHash / preview payload'
                    )
                  : text(
                      'teacher.outcome.payloadDiscarded',
                      '폐기됨: 새 미리보기와 새 requestId 필요'
                    )}
              </p>
            </div>
            <FieldBlock
              label="batch / replay / IDs"
              value={{
                batchId: fixedOutcomeCommitError.batchId || '-',
                idempotentReplay: fixedOutcomeCommitError.idempotentReplay === true,
                lessonId: errorPlan.lessonId || ids.lessonId,
                reservationId: errorPlan.reservationId || ids.reservationId,
                slotId: errorPlan.slotId || ids.slotId,
                packageId: errorPlan.packageId || ids.packageId,
                creditTransactionId:
                  errorPlan.creditTransactionId ||
                  fixedOutcomeCommitError.creditTransactionPreview?.id ||
                  '-',
              }}
            />
            <FieldBlock
              label="requestId / planHash"
              value={{
                requestId: fixedOutcomeCommitError.requestId,
                planHash: fixedOutcomeCommitError.planHash,
                actualPlanHash: fixedOutcomeCommitError.actualPlanHash,
              }}
            />
            <ListBlock title="commit blockedReasons" items={fixedOutcomeCommitError.blockedReasons} />
            <ListBlock title="commit warnings" items={fixedOutcomeCommitError.warnings} />
            <FieldBlock
              label="ledger classification / diagnostics"
              value={{
                ledgerClassification: fixedOutcomeCommitError.ledgerClassification,
                ledgerDiagnostics: fixedOutcomeCommitError.ledgerDiagnostics,
              }}
            />
          </section>
        ) : null}

        {fixedOutcomeCommitResult ? (
          <section
            data-testid="fixed-private-lesson-outcome-commit-result"
            style={{
              marginTop: 14,
              display: 'grid',
              gap: 12,
              border: '1px solid #3c7a5f',
              borderRadius: 12,
              background: '#14251c',
              padding: 14,
            }}
          >
            <div>
              <strong>
                {isFixedNoShowReversal
                  ? t('teacher.outcome.fixedReversal.commitSucceeded')
                  : text(
                      'teacher.outcome.commitSucceeded',
                      '고정 회차 실제 처리가 완료되었습니다'
                    )}
              </strong>
              <p style={{ margin: '8px 0 0 0', fontSize: 13, opacity: 0.82 }}>
                batchId: {fixedOutcomeCommitResult.batchId || '-'} · idempotentReplay:{' '}
                {fixedOutcomeCommitResult.idempotentReplay === true ? 'true' : 'false'}
              </p>
            </div>
            <FieldBlock
              label="lesson / reservation / slot / package / credit IDs"
              value={{
                lessonId: successPlan.lessonId || ids.lessonId,
                reservationId: successPlan.reservationId || ids.reservationId,
                slotId: successPlan.slotId || ids.slotId,
                packageId: fixedOutcomeCommitResult.packageId || successPlan.packageId,
                creditTransactionId:
                  fixedOutcomeCommitResult.creditTransactionId || successPlan.creditTransactionId,
              }}
            />
            <FieldBlock
              label="ledger classification"
              value={fixedOutcomeCommitResult.ledgerClassification}
            />
            <FieldBlock
              label="ledger diagnostics"
              value={fixedOutcomeCommitResult.ledgerDiagnostics}
            />
            <FieldBlock label="updated" value={fixedOutcomeCommitResult.updated} />
            <FieldBlock label="normalizedPlan" value={successPlan} />
            <FieldBlock label="nextStep" value={fixedOutcomeCommitResult.nextStep} />
            <p style={{ margin: 0, fontSize: 13, opacity: 0.82 }}>
              {text(
                'teacher.outcome.successLocked',
                '이 요청은 성공 상태로 잠겼습니다. 새 작업은 창을 닫은 뒤 시작하세요.'
              )}
            </p>
          </section>
        ) : null}
      </section>
    </div>
  )
}

export default function PrivateLessonStatusActionModal({
  target,
  fixedOccurrenceMode = false,
  fixedLocalGatePassed = false,
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
  outcomeCommitBusy,
  outcomeCommitError,
  outcomeCommitResult,
  outcomeCommitConfirmed,
  setOutcomeCommitConfirmed,
  commitBusy,
  commitError,
  commitResult,
  onPreview,
  onOutcomePreview,
  onOutcomeCommit,
  fixedOutcomePreviewBusy,
  fixedOutcomePreviewError,
  fixedOutcomePreviewResult,
  fixedOutcomePreviewPayload,
  fixedOutcomePreviewPlanHash,
  fixedOutcomeCommitBusy,
  fixedOutcomeCommitError,
  fixedOutcomeCommitResult,
  fixedOutcomeCommitConfirmed,
  setFixedOutcomeCommitConfirmed,
  onFixedOutcomePreview,
  onFixedOutcomeCommit,
  onCommit,
  onClose,
  teacherPortal = false,
}) {
  const [commitConfirmed, setCommitConfirmed] = useState(false)
  const { t } = useTranslation()
  const text = (key, fallback) => (teacherPortal ? t(key) : fallback)
  if (!target) return null
  if (fixedOccurrenceMode) {
    return (
      <FixedPrivateLessonOutcomeMode
        target={target}
        actionType={actionType}
        setActionType={setActionType}
        fixedLocalGatePassed={fixedLocalGatePassed}
        fixedOutcomePreviewBusy={fixedOutcomePreviewBusy}
        fixedOutcomePreviewError={fixedOutcomePreviewError}
        fixedOutcomePreviewResult={fixedOutcomePreviewResult}
        fixedOutcomePreviewPayload={fixedOutcomePreviewPayload}
        fixedOutcomePreviewPlanHash={fixedOutcomePreviewPlanHash}
        fixedOutcomeCommitBusy={fixedOutcomeCommitBusy}
        fixedOutcomeCommitError={fixedOutcomeCommitError}
        fixedOutcomeCommitResult={fixedOutcomeCommitResult}
        fixedOutcomeCommitConfirmed={fixedOutcomeCommitConfirmed}
        setFixedOutcomeCommitConfirmed={setFixedOutcomeCommitConfirmed}
        onFixedOutcomePreview={onFixedOutcomePreview}
        onFixedOutcomeCommit={onFixedOutcomeCommit}
        onClose={onClose}
        teacherPortal={teacherPortal}
      />
    )
  }
  const blockedReasons = Array.isArray(preview?.blockedReasons) ? preview.blockedReasons : []
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : []
  const outcomeBlockedReasons = Array.isArray(outcomePreviewResult?.blockedReasons)
    ? outcomePreviewResult.blockedReasons
    : []
  const outcomeWarnings = Array.isArray(outcomePreviewResult?.warnings)
    ? outcomePreviewResult.warnings
    : []
  const row = target || {}
  const isRegularAbsenceReversal = actionType === 'reverse_deduction'
  const reservationId = String(row.reservationId || row.privateReservationId || row.id || '').trim()
  const currentStatus = preview?.currentState?.status || row.status || '-'
  const proposedStatus =
    preview?.proposedState?.reservation?.status ||
    preview?.proposedState?.lesson?.status ||
    preview?.normalizedPlan?.targetStatus ||
    '-'
  const reversalPlanHash = String(preview?.planHash || '').trim()
  const previewPassed =
    preview?.ok === true &&
    preview?.allowed === true &&
    blockedReasons.length === 0 &&
    (!isRegularAbsenceReversal || /^[a-f0-9]{64}$/.test(reversalPlanHash))
  const hasPackageOrCreditWriteRequirement = blockedReasons.includes(
    'package_or_credit_write_required'
  )
  const showOutcomePreviewEntry =
    Boolean(preview) &&
    hasPackageOrCreditWriteRequirement &&
    ['complete', 'no_show'].includes(actionType) &&
    Boolean(reservationId) &&
    isAdmin === true &&
    !outcomePreviewBusy &&
    !outcomeCommitBusy &&
    !outcomeCommitResult
  const outcomePackageImpact = outcomePreviewResult?.packageImpact || {}
  const outcomeCreditTransactionPreview = outcomePreviewResult?.creditTransactionPreview || {}
  const reusesExistingDeduction = [
    'reuse_existing_auto_deduction',
    'reuse_existing_active_deduction',
  ].includes(outcomePreviewResult?.normalizedPlan?.deductionMode)
  const additionalPackageDeduction = Number(
    outcomePackageImpact.additionalPackageDeduction ??
      (outcomePackageImpact.remainingCountDelta === -1 ? 1 : 0)
  )
  const outcomePackageImpactText =
    additionalPackageDeduction === 0
      ? text(
          'teacher.outcome.packageImpact.noAdditional',
          '추가 수강권 차감 없음 · 기존 활성 차감 기록을 유지합니다.'
        )
      : text('teacher.outcome.packageImpact.deduct.one', '수강권 1회를 차감합니다.')
  const outcomePreviewBlocked =
    Boolean(outcomePreviewResult) &&
    (outcomePreviewResult.ok !== true ||
      outcomePreviewResult.allowed !== true ||
      outcomeBlockedReasons.length > 0)
  const outcomePreviewRequestId = String(outcomePreviewPayload?.requestId || '').trim()
  const outcomePreviewTargetReservationId = String(
    outcomePreviewResult?.target?.reservation?.id ||
      outcomePreviewResult?.normalizedPlan?.reservationId ||
      ''
  ).trim()
  const outcomePreviewMatchesCurrentTargetAndAction =
    Boolean(outcomePreviewRequestId) &&
    outcomePreviewPayload?.reservationId === reservationId &&
    outcomePreviewPayload?.actionType === actionType &&
    outcomePreviewResult?.requestId === outcomePreviewRequestId &&
    outcomePreviewResult?.actionType === actionType &&
    String(outcomePreviewResult?.planHash || '').trim() ===
      String(outcomePreviewPlanHash || '').trim() &&
    (!outcomePreviewTargetReservationId || outcomePreviewTargetReservationId === reservationId)
  const outcomePreviewPassed =
    Boolean(outcomePreviewResult) &&
    outcomePreviewResult.ok === true &&
    outcomePreviewResult.allowed === true &&
    outcomeBlockedReasons.length === 0 &&
    (outcomeCreditTransactionPreview.duplicateExists !== true ||
      reusesExistingDeduction) &&
    Boolean(outcomePackageImpact?.packageId) &&
    Boolean(outcomePreviewPlanHash) &&
    outcomePreviewMatchesCurrentTargetAndAction
  const showOutcomeCommitConfirmation =
    hasPackageOrCreditWriteRequirement && outcomePreviewPassed
  const outcomeCommitDisabled =
    !outcomePreviewPassed ||
    !outcomeCommitConfirmed ||
    previewBusy ||
    outcomePreviewBusy ||
    outcomeCommitBusy ||
    commitBusy ||
    Boolean(outcomeCommitResult)
  const commitDisabled =
    !previewPassed ||
    !previewPayload ||
    !commitConfirmed ||
    (isRegularAbsenceReversal && String(reversalReason || '').trim().length < 2) ||
    previewBusy ||
    outcomePreviewBusy ||
    outcomeCommitBusy ||
    commitBusy ||
    Boolean(commitResult) ||
    Boolean(outcomeCommitResult)

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
          !outcomeCommitBusy &&
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
              먼저 서버 기준 처리 가능 여부를 확인합니다. 차감 포함 미리보기를 통과한 예약은
              별도 최종 확인 후 실제 처리할 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={previewBusy || outcomePreviewBusy || outcomeCommitBusy || commitBusy}
            aria-label="닫기"
            style={{
              height: 34,
              borderRadius: 8,
              border: '1px solid #3b4254',
              background: '#222938',
              color: 'white',
              cursor:
                previewBusy || outcomePreviewBusy || outcomeCommitBusy || commitBusy
                  ? 'not-allowed'
                  : 'pointer',
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
          {isRegularAbsenceReversal ? (
            <strong data-testid="private-lesson-regular-absence-reversal-label">결석 취소</strong>
          ) : (
            <>
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
                previewBusy ||
                outcomePreviewBusy ||
                outcomeCommitBusy ||
                commitBusy ||
                Boolean(commitResult) ||
                Boolean(outcomeCommitResult)
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
                previewBusy ||
                outcomePreviewBusy ||
                outcomeCommitBusy ||
                commitBusy ||
                Boolean(commitResult) ||
                Boolean(outcomeCommitResult)
              }
              data-testid="private-lesson-status-action-type-no-show"
            />
            결석
          </label>
            </>
          )}
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
              outcomeCommitBusy ||
              commitBusy ||
              Boolean(commitResult) ||
              Boolean(outcomeCommitResult) ||
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
                previewBusy ||
                outcomePreviewBusy ||
                outcomeCommitBusy ||
                commitBusy ||
                commitResult ||
                outcomeCommitResult ||
                !actionType
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
            <strong>
              {row.regularAbsenceFromAuto === true
                ? '기존 자동 차감을 유지하고 결석으로 변경합니다'
                : '수강권 차감이 필요한 수업입니다'}
            </strong>
            <p style={{ margin: '8px 0 0 0', color: '#ffe1a8', fontSize: 13, lineHeight: 1.5 }}>
              {row.regularAbsenceFromAuto === true
                ? '이미 적용된 수강권 1회 차감과 기존 차감 기록을 재사용합니다. 추가 차감이나 보충 크레딧은 만들지 않습니다.'
                : '이 수업은 수강권 차감과 차감 기록 생성이 필요한 수업입니다. 차감 포함 미리보기에서 변경 내용을 먼저 확인하세요.'}
            </p>
            <button
              type="button"
              onClick={onOutcomePreview}
              disabled={
                previewBusy ||
                outcomePreviewBusy ||
                outcomeCommitBusy ||
                commitBusy ||
                Boolean(outcomeCommitResult)
              }
              data-testid="private-lesson-outcome-preview-button"
              style={{
                marginTop: 12,
                padding: '9px 14px',
                borderRadius: 10,
                border: '1px solid #9b7433',
                background: '#4b3515',
                color: 'white',
                fontWeight: 700,
                cursor:
                  previewBusy ||
                  outcomePreviewBusy ||
                  outcomeCommitBusy ||
                  commitBusy ||
                  outcomeCommitResult
                    ? 'not-allowed'
                    : 'pointer',
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
              {!outcomePreviewBlocked ? (
                <p
                  data-testid="private-lesson-outcome-package-impact-wording"
                  style={{ margin: '8px 0 0 0', color: '#c9f7d8', fontSize: 13 }}
                >
                  {outcomePackageImpactText}
                </p>
              ) : null}
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

        {showOutcomeCommitConfirmation ? (
          <section
            data-testid="private-lesson-outcome-commit-confirm"
            style={{
              marginTop: 16,
              border: '1px solid #9b7433',
              borderRadius: 12,
              background: '#2a2415',
              padding: 14,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 15 }}>차감 포함 실제 처리 전 최종 확인</h3>
            <p style={{ margin: '8px 0 0 0', color: '#ffe1a8', fontSize: 13, lineHeight: 1.55 }}>
              {reusesExistingDeduction
                ? text(
                    'teacher.outcome.packageImpact.noAdditionalDetail',
                    '실제 처리하면 예약 상태만 변경됩니다. 기존 활성 차감은 유지되며 추가 차감이나 새 차감 기록은 만들지 않습니다.'
                  )
                : text(
                    'teacher.outcome.packageImpact.deductDetail.one',
                    '실제 처리하면 예약 상태가 변경되고, 수강권 1회가 차감되며, 차감 기록이 생성됩니다.'
                  )}
            </p>
            <p style={{ margin: '8px 0 0 0', opacity: 0.82, fontSize: 13 }}>
              같은 요청을 반복해서 누르지 마세요. 처리 결과가 나타날 때까지 창을 닫지 마세요.
            </p>
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
                checked={outcomeCommitConfirmed === true}
                onChange={(event) => setOutcomeCommitConfirmed?.(event.target.checked)}
                disabled={outcomeCommitBusy || Boolean(outcomeCommitResult)}
                data-testid="private-lesson-outcome-commit-checkbox"
              />
              위 변경 내용을 확인했습니다.
            </label>
            <button
              type="button"
              onClick={onOutcomeCommit}
              disabled={outcomeCommitDisabled}
              data-testid="private-lesson-outcome-commit-button"
              style={{
                marginTop: 12,
                padding: '9px 14px',
                borderRadius: 10,
                border: '1px solid #a96d44',
                background: '#57311d',
                color: 'white',
                fontWeight: 700,
                cursor: outcomeCommitDisabled ? 'not-allowed' : 'pointer',
                opacity: outcomeCommitDisabled ? 0.68 : 1,
              }}
            >
              {outcomeCommitBusy ? '차감 포함 실제 처리 중...' : '차감 포함 수업 처리'}
            </button>
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

            {isRegularAbsenceReversal ? (
              <FieldBlock label="planHash" value={preview.planHash} />
            ) : null}
            <FieldBlock label="nextStep" value={preview.nextStep} />

            {hasPackageOrCreditWriteRequirement ? (
              <section
                data-testid="private-lesson-status-action-final-confirmation"
                style={{
                  border: '1px solid #665044',
                  borderRadius: 12,
                  background: '#252016',
                  padding: 14,
                }}
              >
                <h3 style={{ margin: 0, fontSize: 15 }}>상태만 처리 경로</h3>
                <p style={{ margin: '8px 0 0 0', color: '#ffd2a8', fontSize: 13 }}>
                  수강권 차감이 필요하여 사용할 수 없습니다. 차감 포함 미리보기와 전용 최종
                  확인을 사용하세요.
                </p>
              </section>
            ) : (
              <section
                data-testid="private-lesson-status-action-final-confirmation"
                style={{
                  border: previewPassed ? '1px solid #3c7a5f' : '1px solid #665044',
                  borderRadius: 12,
                  background: previewPassed ? '#12251a' : '#252016',
                  padding: 14,
                }}
              >
                <h3 style={{ margin: 0, fontSize: 15 }}>
                  {isRegularAbsenceReversal ? '결석 취소 전 최종 확인' : '실제 처리 전 최종 확인'}
                </h3>
                <p style={{ margin: '8px 0 0 0', opacity: 0.82, fontSize: 13, lineHeight: 1.5 }}>
                  {isRegularAbsenceReversal
                    ? text(
                        'teacher.outcome.packageImpact.restore.one',
                        '결석 취소를 확정하면 수강권 1회가 복구됩니다. 과거 차감·복원 기록은 보존됩니다.'
                      )
                    : `실제 처리 버튼을 누르면 예약 상태가 ${
                        ACTION_LABELS[actionType] || actionType
                      }로 저장됩니다. 결석 처리는 수강권 1회만 차감하며 보충 크레딧은 만들지 않습니다.`}
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
                {isRegularAbsenceReversal ? (
                  <label
                    style={{ display: 'grid', gap: 6, marginTop: 12, fontSize: 13 }}
                  >
                    결석 취소 사유
                    <textarea
                      value={reversalReason || ''}
                      onChange={(event) => setReversalReason?.(event.target.value)}
                      disabled={commitBusy || Boolean(commitResult)}
                      rows={3}
                      data-testid="private-lesson-regular-absence-reversal-reason"
                    />
                  </label>
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
                  {isRegularAbsenceReversal
                    ? '수강권 1회 복구와 보충 크레딧 0회를 확인했습니다.'
                    : '이 미리보기 결과로 실제 수업 상태를 처리합니다.'}
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
                  {commitBusy
                    ? isRegularAbsenceReversal
                      ? '결석 취소 중...'
                      : '실제 처리 중...'
                    : isRegularAbsenceReversal
                      ? '결석 취소'
                      : actionType === 'no_show'
                        ? '결석 처리'
                        : '위 내용으로 수업 처리'}
                </button>
              </section>
            )}
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

        {outcomeCommitError ? (
          <section
            data-testid="private-lesson-outcome-commit-error"
            style={{
              marginTop: 14,
              display: 'grid',
              gap: 12,
              border: '1px solid #8d4444',
              borderRadius: 12,
              background: '#2a1719',
              padding: 14,
              color: '#ffc9c9',
            }}
          >
            <div>
              <strong>차감 포함 실제 처리 실패</strong>
              <p style={{ margin: '8px 0 0 0' }}>{outcomeCommitError.message}</p>
              <p style={{ margin: '8px 0 0 0', fontSize: 13, lineHeight: 1.5 }}>
                {getOutcomeCommitErrorGuidance(outcomeCommitError)}
              </p>
              <p style={{ margin: '8px 0 0 0', opacity: 0.82, fontSize: 13, lineHeight: 1.5 }}>
                같은 요청을 다시 클릭하지 마세요. 서버 기준 미리보기와 차감 포함 미리보기를
                다시 실행하세요.
              </p>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 10,
              }}
            >
              <FieldBlock
                label="message / code"
                value={{ message: outcomeCommitError.message, code: outcomeCommitError.code }}
              />
              <FieldBlock
                label="requestId / planHash"
                value={{
                  requestId: outcomeCommitError.requestId,
                  planHash: outcomeCommitError.planHash,
                  actualPlanHash: outcomeCommitError.actualPlanHash,
                }}
              />
              <FieldBlock label="currentState" value={outcomeCommitError.currentState} />
              <FieldBlock label="packageImpact" value={outcomeCommitError.packageImpact} />
              <FieldBlock
                label="creditTransactionPreview"
                value={outcomeCommitError.creditTransactionPreview}
              />
              <FieldBlock label="normalizedPlan" value={outcomeCommitError.normalizedPlan} />
              <FieldBlock
                label="statusOnlyPolicy / diagnostics"
                value={{
                  statusOnlyPolicy: outcomeCommitError.statusOnlyPolicy,
                  proposedState: outcomeCommitError.proposedState,
                }}
              />
            </div>
            <ListBlock
              title="차감 포함 실제 처리 차단 사유"
              items={outcomeCommitError.blockedReasons}
            />
          </section>
        ) : null}

        {outcomeCommitResult ? (
          <section
            data-testid="private-lesson-outcome-commit-result"
            style={{
              marginTop: 14,
              display: 'grid',
              gap: 12,
              border: '1px solid #3c7a5f',
              borderRadius: 12,
              background: '#14251c',
              padding: 14,
            }}
          >
            <div>
              <strong>차감 포함 실제 처리가 완료되었습니다</strong>
              <p style={{ margin: '8px 0 0 0', opacity: 0.82, fontSize: 13 }}>
                committed: {outcomeCommitResult.committed === true ? 'true' : 'false'}
                {' · '}batchId: {outcomeCommitResult.batchId || '-'}
                {' · '}idempotentReplay:{' '}
                {outcomeCommitResult.idempotentReplay === true ? 'true' : 'false'}
              </p>
              <p style={{ margin: '8px 0 0 0', opacity: 0.82, fontSize: 13 }}>
                actionType: {outcomeCommitResult.actionType || actionType}
                {' · '}normalizedOutcome: {outcomeCommitResult.normalizedOutcome || '-'}
                {' · '}reservationId: {outcomePreviewPayload?.reservationId || reservationId || '-'}
              </p>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 10,
              }}
            >
              <FieldBlock label="packageId" value={outcomeCommitResult.packageId} />
              <FieldBlock
                label="creditTransactionId"
                value={outcomeCommitResult.creditTransactionId}
              />
              <FieldBlock
                label="usedCountDelta / remainingCountDelta"
                value={{
                  usedCountDelta: outcomePackageImpact.usedCountDelta,
                  remainingCountDelta: outcomePackageImpact.remainingCountDelta,
                }}
              />
              <FieldBlock
                label="updated reservation/package/credit transaction"
                value={outcomeCommitResult.updated}
              />
              <FieldBlock label="normalizedPlan" value={outcomeCommitResult.normalizedPlan} />
              <FieldBlock label="nextStep" value={outcomeCommitResult.nextStep} />
            </div>
            <p style={{ margin: 0, opacity: 0.82, fontSize: 13, lineHeight: 1.5 }}>
              이 요청은 잠겼습니다. 새 작업은 창을 닫은 뒤 시작하세요. 목록이 즉시 갱신되지
              않으면 새로고침하세요.
            </p>
          </section>
        ) : null}
      </section>
    </div>
  )
}
