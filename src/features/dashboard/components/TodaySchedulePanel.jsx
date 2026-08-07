import { useTranslation } from '../../../i18n/LocalizationProvider.jsx'

export default function TodaySchedulePanel({
  items,
  summary,
  lessonStats,
  loading = false,
  showStudent = true,
  summaryVariant = 'default',
  title = '오늘의 일정',
  localize = false,
}) {
  const { t } = useTranslation()
  const text = (key, fallback, values) => (localize ? t(key, values) : fallback)
  const rows = Array.isArray(items) ? items : []
  const typeLabel = (item) => {
    if (!localize) return item.typeLabel || '-'
    const keyBySource = {
      privateLesson: 'teacher.today.type.privateLesson',
      groupLesson: 'teacher.today.type.groupLesson',
      groupReservation: 'teacher.today.type.groupReservation',
      privateReservation: 'teacher.today.type.privateReservation',
    }
    return keyBySource[item.sourceKind] ? t(keyBySource[item.sourceKind]) : item.typeLabel || '-'
  }
  const statusLabel = (item) => {
    if (!localize) return item.statusLabel || '수업 예정'
    const keyByStatus = {
      '수업 예정': 'teacher.today.status.scheduled',
      '차감취소': 'teacher.calendar.status.deductionCancelled',
      '휴강 · 차감 없음': 'teacher.calendar.status.cancelledNoDeduction',
      '예약 완료': 'teacher.calendar.status.reserved',
    }
    return keyByStatus[item.statusLabel]
      ? t(keyByStatus[item.statusLabel])
      : item.statusLabel || t('teacher.today.status.scheduled')
  }
  const sessionLabel = (item) => {
    if (!localize) return item.sessionLabel
    const match = String(item.sessionLabel || '').match(/^(\d+)회차$/)
    return match
      ? t('teacher.calendar.sessionNumber', { count: match[1] })
      : item.sessionLabel
  }
  const titleLabel = (item) => {
    if (!localize || item.titleIsSystemFallback !== true) return item.title || '-'
    return item.sourceKind === 'privateLesson' || item.sourceKind === 'privateReservation'
      ? t('teacher.today.type.privateLesson')
      : t('teacher.today.type.groupLesson')
  }
  const teacherLabel = (item) =>
    localize && item.teacherLabel === '선생님 선택 필요'
      ? t('teacher.groups.teacherRequired')
      : item.teacherLabel || '-'
  const hideSummary = summaryVariant === 'hidden'
  const isTeacherPrivateSummary = summaryVariant === 'teacherPrivate'
  const summaryItems = (hideSummary
    ? []
    : isTeacherPrivateSummary
    ? [
        [text('teacher.today.summary.privateToday', '오늘 1:1'), lessonStats?.today?.privateCount ?? summary?.todayPrivateLessonCount],
        [text('teacher.today.summary.privateMonth', '이번 달 1:1 누적'), lessonStats?.month?.privateCount ?? summary?.monthlyPrivateLessonCount],
        [text('teacher.today.summary.deductionCancelled', '차감취소'), summary?.deductCancelledCount],
        [text('teacher.today.summary.lastLesson', '마지막 수업'), summary?.lastLessonCount],
      ]
    : [
        [text('teacher.today.summary.todayLessons', '오늘 수업'), lessonStats?.today?.total ?? summary?.todayLessonCount],
        [text('teacher.today.summary.monthLessons', '이번 달 누적 수업'), lessonStats?.month?.total ?? summary?.monthlyLessonCount],
        [text('teacher.today.summary.monthPrivate', '이번 달 1:1'), lessonStats?.month?.privateCount ?? summary?.monthlyPrivateLessonCount],
        [text('teacher.today.summary.monthGroup', '이번 달 단체수업'), lessonStats?.month?.groupCount ?? summary?.monthlyGroupLessonCount],
        [text('teacher.today.summary.private', '개인 수업'), summary?.privateLessonCount],
        [text('teacher.today.summary.group', '단체수업'), summary?.groupLessonCount],
        [text('teacher.today.summary.deductionCancelled', '차감취소'), summary?.deductCancelledCount],
        [text('teacher.today.summary.lastLesson', '마지막 수업'), summary?.lastLessonCount],
      ]).filter(([, value]) => Number.isFinite(Number(value)))

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
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{title}</h2>
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
        <p style={{ opacity: 0.8, marginBottom: 0 }}>
          {text('teacher.common.loading', '불러오는 중...')}
        </p>
      ) : rows.length === 0 ? (
        <p data-testid="today-schedule-empty" style={{ opacity: 0.78, marginBottom: 0 }}>
          {text('teacher.today.empty', '오늘 예정된 수업이 없습니다.')}
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
                <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>
                  {text('teacher.common.date', '날짜')}
                </span>
                {item.date || '-'}
              </span>
              <span>
                <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>
                  {text('teacher.common.time', '시간')}
                </span>
                {item.time || '-'}
              </span>
              <span>
                <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>
                  {text('teacher.today.field.type', '수업 종류')}
                </span>
                {typeLabel(item)}
              </span>
              {item.sessionLabel ? (
                <span>
                  <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>
                    {text('teacher.common.session', '회차')}
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
                    {sessionLabel(item)}
                  </span>
                </span>
              ) : null}
              {showStudent ? (
                <span>
                  <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>
                    {text('teacher.common.student', '학생')}
                  </span>
                  {item.studentLabel || '-'}
                </span>
              ) : null}
              <span>
                <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>
                  {text('teacher.common.teacher', '선생님')}
                </span>
                {teacherLabel(item)}
              </span>
              <span>
                <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>
                  {text('teacher.today.field.title', '반/수업명')}
                </span>
                {titleLabel(item)}
              </span>
              <span>
                <span style={{ opacity: 0.58, display: 'block', fontSize: 11 }}>
                  {text('teacher.common.status', '상태')}
                </span>
                {statusLabel(item)}
              </span>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
