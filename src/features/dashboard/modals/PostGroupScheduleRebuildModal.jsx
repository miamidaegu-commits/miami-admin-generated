import { formatGroupWeekdaysDisplay } from '../dashboardViewUtils.js'

export default function PostGroupScheduleRebuildModal({
  postGroupScheduleRebuildModalData,
  postGroupScheduleRebuildFromDate,
  setPostGroupScheduleRebuildFromDate,
  postGroupScheduleRebuildErrors,
  closePostGroupScheduleRebuildModal,
  busyPostGroupScheduleRebuild,
  submitPostGroupScheduleRebuild,
}) {
  const d = postGroupScheduleRebuildModalData
  const oldRule = [
    formatGroupWeekdaysDisplay(d.oldWeekdays),
    d.oldTime,
    d.oldSubject,
  ]
    .filter(Boolean)
    .join(' ')
  const newRule = [
    formatGroupWeekdaysDisplay(d.newWeekdays),
    d.newTime,
    d.newSubject,
  ]
    .filter(Boolean)
    .join(' ')
  const today = new Date()
  const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`
  const enteredFromYmd = String(postGroupScheduleRebuildFromDate || '').trim()
  const effectiveFromYmd = enteredFromYmd ? (enteredFromYmd >= todayYmd ? enteredFromYmd : todayYmd) : todayYmd

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-group-schedule-rebuild-title"
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
        if (e.target === e.currentTarget) closePostGroupScheduleRebuildModal()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
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
          id="post-group-schedule-rebuild-title"
          style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
        >
          해당 날짜부터 이후 수업을 다시 만들까요?
        </h2>
        <p style={{ margin: '0 0 12px 0', fontSize: 14, opacity: 0.9, lineHeight: 1.5 }}>
          반: <strong>{d.groupName || '-'}</strong>
        </p>
        <p style={{ margin: '0 0 12px 0', fontSize: 13, opacity: 0.82, lineHeight: 1.55 }}>
          반 수정 화면에서 지정한 날짜를 기준으로 이후 수업을 다시 만듭니다. 아래에서 날짜를
          조정할 수도 있습니다.
        </p>
        <div
          style={{
            margin: '0 0 14px 0',
            fontSize: 13,
            opacity: 0.88,
            lineHeight: 1.55,
            padding: '10px 12px',
            borderRadius: 8,
            background: '#1a1f2e',
            border: '1px solid #2e3240',
          }}
        >
          <div style={{ marginBottom: 6 }}>
            <span style={{ opacity: 0.75 }}>이전: </span>
            {oldRule || '-'}
          </div>
          <div>
            <span style={{ opacity: 0.75 }}>새 규칙: </span>
            {newRule || '-'}
          </div>
        </div>
        <ul
          style={{
            margin: '0 0 14px 1em',
            padding: 0,
            fontSize: 12,
            opacity: 0.78,
            lineHeight: 1.55,
          }}
        >
          <li>입력한 날짜와 오늘 중 더 늦은 날짜부터 이후 수업을 다시 만듭니다.</li>
          <li>과거 수업은 유지됩니다.</li>
          <li>해당 날짜 이후의 미래 정규 수업만 새 규칙으로 다시 생성합니다.</li>
          <li>
            기존에 직접 추가한 특별 수업이 섞여 있다면 저장 후 확인이 필요할 수 있습니다.
          </li>
        </ul>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          <span style={{ opacity: 0.85 }}>다시 생성 시작일</span>
          <input
            type="date"
            value={postGroupScheduleRebuildFromDate}
            onChange={(e) => setPostGroupScheduleRebuildFromDate(e.target.value)}
            disabled={busyPostGroupScheduleRebuild}
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #444',
              background: '#1f1f1f',
              color: 'white',
            }}
          />
          {postGroupScheduleRebuildErrors.fromDate ? (
            <span style={{ color: '#f08080', fontSize: 12 }}>
              {postGroupScheduleRebuildErrors.fromDate}
            </span>
          ) : null}
        </label>
        <div
          style={{
            marginTop: 10,
            padding: '10px 12px',
            borderRadius: 8,
            background: '#1a1f2e',
            border: '1px solid #2e3240',
            fontSize: 12,
            lineHeight: 1.55,
            opacity: 0.9,
          }}
        >
          <div>
            입력한 기준 날짜: <strong>{enteredFromYmd || '-'}</strong>
          </div>
          <div>
            실제 적용 기준일: <strong>{effectiveFromYmd}</strong>
          </div>
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
            onClick={() => closePostGroupScheduleRebuildModal()}
            disabled={busyPostGroupScheduleRebuild}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #555',
              background: 'transparent',
              color: 'white',
              cursor: busyPostGroupScheduleRebuild ? 'not-allowed' : 'pointer',
            }}
          >
            그대로 유지
          </button>
          <button
            type="button"
            onClick={submitPostGroupScheduleRebuild}
            disabled={busyPostGroupScheduleRebuild}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #4a6fff55',
              background: '#1f2a44',
              color: 'white',
              cursor: busyPostGroupScheduleRebuild ? 'not-allowed' : 'pointer',
            }}
          >
            {busyPostGroupScheduleRebuild ? '처리 중...' : '해당 날짜부터 다시 생성'}
          </button>
        </div>
      </div>
    </div>
  )
}
