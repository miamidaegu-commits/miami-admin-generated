export default function FixedPrivateLessonActionModal({
  lesson,
  busy = false,
  onClose,
  onAction,
}) {
  if (!lesson) return null

  function handleAction(cancellationType) {
    const result = onAction?.(lesson, cancellationType)
    if (result && typeof result.finally === 'function') {
      result.finally(() => onClose?.())
    } else {
      onClose?.()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fixed-private-lesson-action-title"
      data-testid="fixed-private-lesson-action-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1005,
        padding: 16,
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          background: '#151922',
          border: '1px solid #2e3240',
          borderRadius: 12,
          padding: 20,
          color: 'white',
          boxSizing: 'border-box',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="fixed-private-lesson-action-title"
          style={{ margin: '0 0 10px 0', fontSize: '1.1rem', fontWeight: 700 }}
        >
          고정수업 처리
        </h2>
        <p style={{ margin: '0 0 16px 0', opacity: 0.76, fontSize: 13, lineHeight: 1.5 }}>
          {lesson.date || '-'} {lesson.time || '-'} ·{' '}
          {lesson.studentName || lesson.student || lesson.studentId || '-'}
        </p>

        <div style={{ display: 'grid', gap: 12 }}>
          <button
            type="button"
            onClick={() => handleAction('seat_released')}
            disabled={busy}
            data-testid="fixed-private-lesson-action-release-button"
            style={{
              textAlign: 'left',
              padding: 14,
              borderRadius: 10,
              border: '1px solid #4a6fff55',
              background: '#1f2a44',
              color: 'white',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            <strong style={{ display: 'block', marginBottom: 6 }}>
              {busy ? '처리 중...' : '자리 공개'}
            </strong>
            <span style={{ display: 'block', fontSize: 13, opacity: 0.82, lineHeight: 1.5 }}>
              학생이 못 오는 경우 사용합니다. 이 고정수업을 취소하고 같은 시간대를 다른 학생이
              예약할 수 있게 엽니다.
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleAction('lesson_cancelled')}
            disabled={busy}
            data-testid="fixed-private-lesson-action-cancel-button"
            style={{
              textAlign: 'left',
              padding: 14,
              borderRadius: 10,
              border: '1px solid #665533',
              background: '#3a321f',
              color: '#ffe8b8',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            <strong style={{ display: 'block', marginBottom: 6 }}>
              {busy ? '처리 중...' : '수업 취소'}
            </strong>
            <span style={{ display: 'block', fontSize: 13, opacity: 0.86, lineHeight: 1.5 }}>
              선생님/학원 사정으로 수업 자체가 없는 경우 사용합니다. 같은 시간대는 다른 학생에게
              공개되지 않습니다.
            </span>
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            data-testid="fixed-private-lesson-action-close-button"
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #555',
              background: 'transparent',
              color: 'white',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
