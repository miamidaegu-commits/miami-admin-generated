export default function TodaySchedulePanel({
  items,
  summary,
  loading = false,
  showStudent = true,
}) {
  const rows = Array.isArray(items) ? items : []
  const summaryItems = [
    ['개인 수업', summary?.privateLessonCount],
    ['단체수업', summary?.groupLessonCount],
    ['차감취소', summary?.deductCancelledCount],
    ['마지막 수업', summary?.lastLessonCount],
  ].filter(([, value]) => Number.isFinite(Number(value)))

  return (
    <section
      data-testid="today-schedule-panel"
      style={{
        border: '1px solid #2e3240',
        borderRadius: 10,
        background: '#151922',
        padding: 18,
      }}
    >
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>오늘의 일정</h2>
      {summaryItems.length > 0 ? (
        <div
          data-testid="today-schedule-summary"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
            gap: 8,
            marginTop: 12,
          }}
        >
          {summaryItems.map(([label, value]) => (
            <div
              key={label}
              data-testid="today-schedule-summary-item"
              style={{
                border: '1px solid #283042',
                borderRadius: 8,
                background: '#1a1f2b',
                padding: '8px 10px',
              }}
            >
              <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>
                {label}
              </span>
              <strong style={{ fontSize: 16 }}>{Number(value) || 0}</strong>
            </div>
          ))}
        </div>
      ) : null}

      {loading ? (
        <p style={{ opacity: 0.8, marginBottom: 0 }}>불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p data-testid="today-schedule-empty" style={{ opacity: 0.78, marginBottom: 0 }}>
          오늘 예정된 수업이 없습니다.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
          {rows.map((item) => (
            <article
              key={item.id}
              data-testid="today-schedule-row"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))',
                gap: 10,
                alignItems: 'center',
                padding: 10,
                borderRadius: 8,
                border: '1px solid #283042',
                background: '#1a1f2b',
                fontSize: 13,
              }}
            >
              <span>
                <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>날짜</span>
                {item.date || '-'}
              </span>
              <span>
                <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>시간</span>
                {item.time || '-'}
              </span>
              <span>
                <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>수업 종류</span>
                {item.typeLabel || '-'}
              </span>
              {item.sessionLabel ? (
                <span>
                  <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>
                    회차
                  </span>
                  <span
                    data-testid="today-schedule-session-badge"
                    style={{
                      display: 'inline-block',
                      border: '1px solid rgba(120, 140, 200, 0.45)',
                      borderRadius: 4,
                      padding: '2px 6px',
                      background: 'rgba(60, 120, 90, 0.35)',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.sessionLabel}
                  </span>
                </span>
              ) : null}
              {showStudent ? (
                <span>
                  <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>학생</span>
                  {item.studentLabel || '-'}
                </span>
              ) : null}
              <span>
                <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>선생님</span>
                {item.teacherLabel || '-'}
              </span>
              <span>
                <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>반/수업명</span>
                {item.title || '-'}
              </span>
              <span>
                <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>상태</span>
                {item.statusLabel || '수업 예정'}
              </span>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
