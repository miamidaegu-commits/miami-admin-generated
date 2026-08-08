import { useTranslation } from '../../../i18n/LocalizationProvider.jsx'

function formatCount(value) {
  const count = Number(value)
  return Number.isFinite(count) ? count : 0
}

function StatusCard({ label, value }) {
  return (
    <div
      className="today-schedule-summary-card"
      data-testid="group-class-status-card"
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

export default function GroupClassStatusPanel({ stats }) {
  const { t } = useTranslation()
  const snapshot = stats || {}
  const cards = [
    [
      t('teacher.groupClassOverview.todaySessions'),
      snapshot.todayGroupSessionCount,
    ],
    [
      t('teacher.groupClassOverview.monthSessions'),
      snapshot.currentMonthGroupSessionCount,
    ],
    [
      t('teacher.groupClassOverview.attendanceNotStarted'),
      snapshot.attendanceNotStartedTodayCount,
    ],
    [
      t('teacher.groupClassOverview.classesClosed'),
      snapshot.classesClosedThisMonthCount,
    ],
  ]

  return (
    <section
      data-testid="group-class-status-panel"
      style={{
        border: '1px solid #2e3240',
        borderRadius: 10,
        background: '#151922',
        padding: 18,
        marginBottom: 14,
      }}
    >
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
        {t('teacher.groupClassOverview.title')}
      </h2>
      <div
        className="today-schedule-summary-grid"
        data-testid="group-class-status-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 8,
          marginTop: 12,
        }}
      >
        {cards.map(([label, value]) => (
          <StatusCard key={label} label={label} value={value} />
        ))}
      </div>
    </section>
  )
}
