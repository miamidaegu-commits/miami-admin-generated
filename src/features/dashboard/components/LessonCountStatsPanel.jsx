function formatCount(value) {
  const count = Number(value)
  return Number.isFinite(count) ? count : 0
}

function SummaryCard({ label, value }) {
  return (
    <div
      data-testid="teacher-lesson-count-total-item"
      style={{
        border: '1px solid #283042',
        borderRadius: 8,
        background: '#1a1f2b',
        padding: '8px 10px',
      }}
    >
      <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>{label}</span>
      <strong style={{ fontSize: 16 }}>{formatCount(value)}</strong>
    </div>
  )
}

export default function LessonCountStatsPanel({
  rows,
  totalStats,
  monthLabel,
  loading = false,
}) {
  const teacherRows = Array.isArray(rows) ? rows : []
  const stats = totalStats || {}

  return (
    <section
      data-testid="teacher-lesson-count-stats-panel"
      style={{
        border: '1px solid #2e3240',
        borderRadius: 10,
        background: '#151922',
        padding: 18,
        marginTop: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>선생님별 수업 통계</h2>
          <p style={{ margin: '6px 0 0', opacity: 0.72, fontSize: 12 }}>
            {monthLabel || '선택 월'} 기준, 현재 월은 오늘까지 누적합니다.
          </p>
        </div>
      </div>

      <div
        data-testid="teacher-lesson-count-total"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(116px, 1fr))',
          gap: 8,
          marginTop: 12,
        }}
      >
        <SummaryCard label="오늘 수업" value={stats.todayLessonCount} />
        <SummaryCard label="이번 달 누적 수업" value={stats.monthlyLessonCount} />
        <SummaryCard label="1:1" value={stats.monthlyPrivateLessonCount} />
        <SummaryCard label="단체수업" value={stats.monthlyGroupLessonCount} />
      </div>

      {loading ? (
        <p style={{ opacity: 0.8, marginBottom: 0 }}>불러오는 중...</p>
      ) : teacherRows.length === 0 ? (
        <p data-testid="teacher-lesson-count-empty" style={{ opacity: 0.78, marginBottom: 0 }}>
          표시할 선생님 통계가 없습니다.
        </p>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: 14 }}>
          <table
            data-testid="teacher-lesson-count-table"
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
          >
            <thead>
              <tr style={{ color: '#aab3c5', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px', borderBottom: '1px solid #283042' }}>
                  선생님명
                </th>
                <th style={{ padding: '8px 10px', borderBottom: '1px solid #283042' }}>
                  오늘 수업
                </th>
                <th style={{ padding: '8px 10px', borderBottom: '1px solid #283042' }}>
                  이번 달 누적 수업
                </th>
                <th style={{ padding: '8px 10px', borderBottom: '1px solid #283042' }}>
                  1:1
                </th>
                <th style={{ padding: '8px 10px', borderBottom: '1px solid #283042' }}>
                  단체수업
                </th>
              </tr>
            </thead>
            <tbody>
              {teacherRows.map((row) => (
                <tr key={row.teacherId || row.teacherName} data-testid="teacher-lesson-count-row">
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #222838' }}>
                    {row.teacherName || '-'}
                  </td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #222838' }}>
                    {formatCount(row.todayLessonCount)}
                  </td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #222838' }}>
                    {formatCount(row.monthlyLessonCount)}
                  </td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #222838' }}>
                    {formatCount(row.monthlyPrivateLessonCount)}
                  </td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #222838' }}>
                    {formatCount(row.monthlyGroupLessonCount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
