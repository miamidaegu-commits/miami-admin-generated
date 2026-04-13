
export default function GroupLessonPurgeModal({
  selectedGroupClass,
  groupLessonPurgeFromDate,
  setGroupLessonPurgeFromDate,
  groupLessonPurgeFormErrors,
  closeGroupLessonPurgeModal,
  submitGroupLessonPurgeFromDate,
  busyGroupLessonPurge,
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-lesson-purge-modal-title"
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
        if (e.target === e.currentTarget) closeGroupLessonPurgeModal()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
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
          id="group-lesson-purge-modal-title"
          style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
        >
          이후 일정 삭제
        </h2>
        <p style={{ margin: '0 0 10px 0', fontSize: 13, opacity: 0.85 }}>
          {selectedGroupClass.name || '-'}
        </p>
        <p style={{ margin: '0 0 14px 0', fontSize: 12, opacity: 0.68, lineHeight: 1.45 }}>
          기준일 이후(당일 포함)의 이 반 수업 일정만 삭제합니다. 기준일보다 이른 날짜 일정은
          그대로 둡니다.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          <span style={{ opacity: 0.85 }}>삭제 기준일</span>
          <input
            type="date"
            value={groupLessonPurgeFromDate}
            onChange={(e) =>
              setGroupLessonPurgeFromDate(e.target.value)
            }
            disabled={busyGroupLessonPurge}
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #444',
              background: '#1f1f1f',
              color: 'white',
            }}
          />
          {groupLessonPurgeFormErrors.purgeDate ? (
            <span style={{ color: '#f08080', fontSize: 12 }}>
              {groupLessonPurgeFormErrors.purgeDate}
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
            onClick={closeGroupLessonPurgeModal}
            disabled={busyGroupLessonPurge}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #555',
              background: 'transparent',
              color: 'white',
              cursor: busyGroupLessonPurge ? 'not-allowed' : 'pointer',
            }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={submitGroupLessonPurgeFromDate}
            disabled={busyGroupLessonPurge}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #664444',
              background: '#4a2a2a',
              color: 'white',
              cursor: busyGroupLessonPurge ? 'not-allowed' : 'pointer',
            }}
          >
            {busyGroupLessonPurge ? '삭제 중...' : '삭제 실행'}
          </button>
        </div>
      </div>
    </div>
  )
}
