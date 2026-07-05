export default function PostPrivateLessonScheduleModal({
  postPrivateLessonScheduleModalData,
  closePostPrivateLessonScheduleModal,
  goToFixedPrivateAssignmentFromPostPrivateLessonScheduleModal,
  busyPostPrivateLessonSchedule,
}) {
  const data = postPrivateLessonScheduleModalData
  const isTopUp = data?.action === 'topUp'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-private-lesson-schedule-title"
      data-testid="post-private-lesson-schedule-modal"
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
        if (e.target === e.currentTarget) closePostPrivateLessonScheduleModal()
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
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="post-private-lesson-schedule-title"
          style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
        >
          주간 시간에 학생 고정 배정으로 이동할까요?
        </h2>
        <p style={{ margin: '0 0 12px 0', fontSize: 13, opacity: 0.88, lineHeight: 1.5 }}>
          {isTopUp
            ? '기존 개인 수강권에 추가 등록했습니다.'
            : '새 개인 수강권이 발급되었습니다.'}{' '}
          고정 수업 일정은 1:1 예약 시간 관리 &gt; 주간 시간에 학생 고정 배정에서
          예약하세요.
        </p>

        <div
          style={{
            padding: 12,
            borderRadius: 8,
            border: '1px solid #333',
            background: '#1a1d26',
            fontSize: 12,
            lineHeight: 1.55,
            marginBottom: 14,
          }}
        >
          <div>
            <span style={{ opacity: 0.75 }}>학생</span>{' '}
            <strong>{data?.studentName || '-'}</strong>
          </div>
          <div>
            <span style={{ opacity: 0.75 }}>수강권</span>{' '}
            <strong>{String(data?.packageTitle || '').trim() || '—'}</strong>
          </div>
          <div>
            <span style={{ opacity: 0.75 }}>남은 / 총</span>{' '}
            <strong>
              {data?.remainingCount != null ? String(data.remainingCount) : '-'} /{' '}
              {data?.totalCount != null ? String(data.totalCount) : '-'}
            </strong>
          </div>
        </div>

        <p
          style={{
            margin: '0',
            fontSize: 12,
            opacity: 0.82,
            lineHeight: 1.55,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #3d4a7a',
            background: 'rgba(40, 55, 110, 0.25)',
          }}
        >
          이 수강권은 횟수만 늘립니다. 실제 고정 수업은 선생님 주간 1:1 시간표에서
          학생을 고정 배정하면 같은 수강권에 계속 연결됩니다.
        </p>

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
            onClick={closePostPrivateLessonScheduleModal}
            disabled={busyPostPrivateLessonSchedule}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #555',
              background: 'transparent',
              color: 'white',
              cursor: busyPostPrivateLessonSchedule ? 'not-allowed' : 'pointer',
            }}
          >
            나중에 하기
          </button>
          <button
            type="button"
            onClick={goToFixedPrivateAssignmentFromPostPrivateLessonScheduleModal}
            disabled={busyPostPrivateLessonSchedule}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #4a6fff55',
              background: '#1f2a44',
              color: 'white',
              cursor: busyPostPrivateLessonSchedule ? 'not-allowed' : 'pointer',
            }}
          >
            주간 시간에 학생 고정 배정으로 이동
          </button>
        </div>
      </div>
    </div>
  )
}
