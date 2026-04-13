import { formatGroupWeekdaysDisplay } from '../dashboardViewUtils.js'

export default function GroupLessonSeriesModal({
  selectedGroupClass,
  groupLessonSeriesForm,
  setGroupLessonSeriesForm,
  groupLessonSeriesFormErrors,
  groupLessonSeriesPlannedCount,
  closeGroupLessonSeriesModal,
  submitGroupLessonSeriesModal,
  isGroupLessonSeriesSubmitting,
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-lesson-series-modal-title"
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
        if (e.target === e.currentTarget) closeGroupLessonSeriesModal()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 460,
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
          id="group-lesson-series-modal-title"
          style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
        >
          추가 일정 생성
        </h2>
        <p style={{ margin: '0 0 4px 0', fontSize: 12, opacity: 0.62, lineHeight: 1.4 }}>
          관리자 보조: 기간을 지정해 같은 반 규칙으로 일정을 더 만듭니다.
        </p>
        <p style={{ margin: '0 0 16px 0', fontSize: 13, opacity: 0.8 }}>
          {selectedGroupClass.name || '-'}
        </p>

        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            padding: 12,
            borderRadius: 8,
            border: '1px solid #333',
            background: '#1a1d26',
            marginBottom: 12,
            opacity: 0.95,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>이 반의 수업 정보 (읽기 전용)</div>
          <div>시간: {selectedGroupClass.time || '—'}</div>
          <div>과목: {selectedGroupClass.subject || '—'}</div>
          <div>
            요일:{' '}
            {formatGroupWeekdaysDisplay(selectedGroupClass.weekdays) || '—'}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>시작일</span>
            <input
              type="date"
              value={groupLessonSeriesForm.startDate}
              onChange={(e) =>
                setGroupLessonSeriesForm((prev) => ({
                  ...prev,
                  startDate: e.target.value,
                }))
              }
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
              }}
            />
            {groupLessonSeriesFormErrors.startDate ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>
                {groupLessonSeriesFormErrors.startDate}
              </span>
            ) : null}
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>종료일</span>
            <input
              type="date"
              value={groupLessonSeriesForm.endDate}
              onChange={(e) =>
                setGroupLessonSeriesForm((prev) => ({
                  ...prev,
                  endDate: e.target.value,
                }))
              }
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
              }}
            />
            {groupLessonSeriesFormErrors.endDate ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>
                {groupLessonSeriesFormErrors.endDate}
              </span>
            ) : null}
          </label>

          {groupLessonSeriesPlannedCount != null ? (
            <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
              이 기간·요일 기준 생성 후보: <strong>{groupLessonSeriesPlannedCount}</strong>건
              (이미 같은 날짜·시간 수업이 있으면 건너뜁니다)
            </p>
          ) : null}
        </div>

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
            onClick={closeGroupLessonSeriesModal}
            disabled={isGroupLessonSeriesSubmitting}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #555',
              background: 'transparent',
              color: 'white',
              cursor: isGroupLessonSeriesSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={submitGroupLessonSeriesModal}
            disabled={isGroupLessonSeriesSubmitting}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #4a6fff55',
              background: '#1f2a44',
              color: 'white',
              cursor: isGroupLessonSeriesSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            {isGroupLessonSeriesSubmitting ? '생성 중...' : '일정 생성'}
          </button>
        </div>
      </div>
    </div>
  )
}
