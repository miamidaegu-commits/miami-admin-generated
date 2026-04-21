
export default function PostGroupReEnrollModal({
  postGroupReEnrollModalData,
  postGroupReEnrollStartDate,
  setPostGroupReEnrollStartDate,
  postGroupReEnrollMinStartYmd,
  postGroupReEnrollErrors,
  closePostGroupReEnrollModal,
  busyPostGroupReEnroll,
  submitPostGroupReEnroll,
}) {
  const isReenrollFlow = postGroupReEnrollModalData?.isReenrollFlow !== false

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-group-re-enroll-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1003,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closePostGroupReEnrollModal()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
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
          id="post-group-re-enroll-modal-title"
          style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
        >
          {isReenrollFlow ? '같은 반에 다시 등록할까요?' : '이 반에 바로 등록할까요?'}
        </h2>
        <p style={{ margin: '0 0 10px 0', fontSize: 14, opacity: 0.9, lineHeight: 1.5 }}>
          {isReenrollFlow
            ? '새 수강권이 만들어졌습니다. 시작일을 확인하면 이전과 같은 반에 다시 등록합니다.'
            : '새 그룹 수강권이 만들어졌습니다. 시작일을 확인하면 이 학생을 반 수강생으로 등록합니다.'}
        </p>
        <p
          style={{
            margin: `0 0 ${
              postGroupReEnrollModalData.showNextLessonAutoHint ? 10 : 16
            }px 0`,
            fontSize: 13,
            opacity: 0.88,
          }}
        >
          학생: <strong>{postGroupReEnrollModalData.studentName || '-'}</strong>
          {' · '}
          반: <strong>{postGroupReEnrollModalData.groupClassName || '-'}</strong>
          {' · '}
          총 횟수:{' '}
          <strong>
            {postGroupReEnrollModalData.totalCount != null
              ? String(postGroupReEnrollModalData.totalCount)
              : '-'}
            회
          </strong>
        </p>
        {postGroupReEnrollModalData.showNextLessonAutoHint ? (
          <p style={{ margin: '0 0 16px 0', fontSize: 12, opacity: 0.75, lineHeight: 1.45 }}>
            다음 수업일이 자동으로 선택되었습니다.
          </p>
        ) : null}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          <span style={{ opacity: 0.85 }}>
            {isReenrollFlow ? '시작일 (기본: 다음 수업일)' : '반 등록 시작일'}
          </span>
          <input
            type="date"
            value={postGroupReEnrollStartDate}
            min={
              postGroupReEnrollMinStartYmd &&
              /^\d{4}-\d{2}-\d{2}$/.test(postGroupReEnrollMinStartYmd)
                ? postGroupReEnrollMinStartYmd
                : undefined
            }
            onChange={(e) => setPostGroupReEnrollStartDate(e.target.value)}
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #444',
              background: '#1f1f1f',
              color: 'white',
            }}
          />
          {postGroupReEnrollErrors.startDate ? (
            <span style={{ color: '#f08080', fontSize: 12 }}>
              {postGroupReEnrollErrors.startDate}
            </span>
          ) : null}
        </label>

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
            onClick={closePostGroupReEnrollModal}
            disabled={busyPostGroupReEnroll}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #555',
              background: 'transparent',
              color: 'white',
              cursor: busyPostGroupReEnroll ? 'not-allowed' : 'pointer',
            }}
          >
            {isReenrollFlow ? '나중에 하기' : '나중에 등록'}
          </button>
          <button
            type="button"
            onClick={submitPostGroupReEnroll}
            disabled={busyPostGroupReEnroll}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #4a6fff55',
              background: '#1f2a44',
              color: 'white',
              cursor: busyPostGroupReEnroll ? 'not-allowed' : 'pointer',
            }}
          >
            {busyPostGroupReEnroll ? '처리 중...' : isReenrollFlow ? '다시 등록' : '지금 등록'}
          </button>
        </div>
      </div>
    </div>
  )
}
