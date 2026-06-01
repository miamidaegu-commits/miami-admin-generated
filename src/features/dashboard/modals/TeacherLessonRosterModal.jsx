import { useMemo } from 'react'
import { buildTeacherLessonRoster } from '../teacherLessonRosterHelpers.js'

function cleanText(value, fallback = '-') {
  const text = String(value || '').trim()
  return text || fallback
}

function RosterTable({ rows, emptyLabel, testIdPrefix }) {
  if (!rows.length) {
    return (
      <p data-testid={`${testIdPrefix}-empty`} style={{ margin: 0, opacity: 0.72, fontSize: 13 }}>
        {emptyLabel}
      </p>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {rows.map((row) => (
        <article
          key={row.id}
          data-testid="teacher-lesson-roster-row"
          data-roster-row-id={row.id}
          style={{
            border: '1px solid #2e3240',
            borderRadius: 10,
            padding: '10px 12px',
            background: '#101521',
            display: 'grid',
            gap: 4,
            fontSize: 13,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <strong>
              {row.date} · {row.time}
            </strong>
            <span style={{ color: '#9ee6b2' }}>{row.statusLabel}</span>
          </div>
          <div>{cleanText(row.studentName)}</div>
          <div style={{ opacity: 0.82 }}>
            {row.lessonTypeLabel}
            {row.ticketContextLabel ? ` · ${row.ticketContextLabel}` : ''}
            {' · '}
            {cleanText(row.subject)}
          </div>
          {row.directCancelLabel ? (
            <div
              data-testid="teacher-lesson-roster-cancel-count"
              style={{ opacity: 0.78, fontSize: 12 }}
            >
              {row.directCancelLabel}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  )
}

export default function TeacherLessonRosterModal({
  teacher,
  academyId,
  lessons,
  privateLessonReservations,
  privateLessonSlots,
  privateStudents,
  studentPackages,
  studentPrivateBookingStats = [],
  loading,
  onClose,
}) {
  const teacherName = cleanText(teacher?.name || teacher?.teacherName, '선생님')
  const teacherKey = cleanText(
    teacher?.teacherKey || teacher?.teacherName || teacher?.name,
    '-'
  )

  const roster = useMemo(() => {
    if (!teacher) {
      return { upcoming: [], past: [], cancelled: [], teacherScopeKeys: [] }
    }
    return buildTeacherLessonRoster({
      academyId,
      teacher,
      lessons,
      privateLessonReservations,
      privateLessonSlots,
      privateStudents,
      studentPackages,
      studentPrivateBookingStats,
    })
  }, [
    academyId,
    teacher,
    lessons,
    privateLessonReservations,
    privateLessonSlots,
    privateStudents,
    studentPackages,
    studentPrivateBookingStats,
  ])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="teacher-lesson-roster-title"
      data-testid="teacher-lesson-roster-modal"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(0, 0, 0, 0.55)',
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 760,
          maxHeight: '85vh',
          overflow: 'auto',
          border: '1px solid #2e3240',
          borderRadius: 12,
          background: '#151922',
          color: 'white',
          padding: 20,
          boxSizing: 'border-box',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'flex-start',
            marginBottom: 16,
          }}
        >
          <div>
            <h2
              id="teacher-lesson-roster-title"
              data-testid="teacher-lesson-roster-title"
              style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600 }}
            >
              {teacherName} 수업 현황
            </h2>
            <div style={{ marginTop: 6, opacity: 0.75, fontSize: 12 }}>
              teacherKey: {teacherKey}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="teacher-lesson-roster-close-button"
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #555',
              background: 'transparent',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            닫기
          </button>
        </div>

        {loading ? (
          <p data-testid="teacher-lesson-roster-loading">불러오는 중...</p>
        ) : (
          <div style={{ display: 'grid', gap: 20 }}>
            <section data-testid="teacher-lesson-roster-upcoming-section">
              <h3 style={{ margin: '0 0 10px 0', fontSize: 14 }}>예정 수업</h3>
              <RosterTable
                rows={roster.upcoming}
                emptyLabel="예정 수업 없음"
                testIdPrefix="teacher-lesson-roster-upcoming"
              />
            </section>

            <section data-testid="teacher-lesson-roster-past-section">
              <h3 style={{ margin: '0 0 10px 0', fontSize: 14 }}>지난 수업</h3>
              <RosterTable
                rows={roster.past}
                emptyLabel="지난 수업 없음"
                testIdPrefix="teacher-lesson-roster-past"
              />
            </section>

            <section data-testid="teacher-lesson-roster-cancelled-section">
              <h3 style={{ margin: '0 0 10px 0', fontSize: 14 }}>취소/차감취소 수업</h3>
              <RosterTable
                rows={roster.cancelled}
                emptyLabel="취소/차감취소 수업 없음"
                testIdPrefix="teacher-lesson-roster-cancelled"
              />
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
