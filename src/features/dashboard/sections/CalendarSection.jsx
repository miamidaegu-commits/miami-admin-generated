import {
  formatDate,
  formatTime,
  getLessonDate,
  getLessonStorageDateString,
  getStudentName,
  getTeacherName,
  getTodayStorageDateString,
  getStorageDateStringFromDate,
  isSameStorageDate,
} from '../dashboardViewUtils.js'

/**
 * view="month": 월 달력 그리드
 * view="lessons": 전체/선택일 수업 목록 + 상단 액션(캘린더 탭에서만 일부 노출)
 */
export default function CalendarSection(props) {
  if (props.view === 'month') {
    const {
      setCalendarMonth,
      calendarMonthLabel,
      calendarDays,
      lessonsCountByDate,
      calendarMonth,
      selectedDate,
      setSelectedDate,
      setShowOnlySelectedDate,
    } = props

    return (
      <section className="activity-section" style={{ marginBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
            gap: 12,
          }}
        >
          <button
            onClick={() =>
              setCalendarMonth(
                (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
              )
            }
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #444',
              background: '#1f1f1f',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            ←
          </button>

          <h2 className="section-title" style={{ margin: 0 }}>
            {calendarMonthLabel}
          </h2>

          <button
            onClick={() =>
              setCalendarMonth(
                (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
              )
            }
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #444',
              background: '#1f1f1f',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            →
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 8,
            marginBottom: 8,
            fontSize: 12,
            opacity: 0.8,
          }}
        >
          {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
            <div key={day} style={{ textAlign: 'center' }}>
              {day}
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 8,
          }}
        >
          {calendarDays.map((day) => {
            const dateKey = getStorageDateStringFromDate(day)
            const count = lessonsCountByDate.get(dateKey) || 0
            const isCurrentMonth = day.getMonth() === calendarMonth.getMonth()
            const isSelected = isSameStorageDate(day, selectedDate)

            return (
              <button
                key={dateKey}
                onClick={() => {
                  setSelectedDate(day)
                  setShowOnlySelectedDate(true)
                }}
                style={{
                  minHeight: 72,
                  borderRadius: 10,
                  border: isSelected ? '1px solid #6b8cff' : '1px solid #2e3240',
                  background: isSelected ? '#1f2a44' : '#151922',
                  color: isCurrentMonth ? 'white' : '#666',
                  padding: 8,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600 }}>{day.getDate()}</div>
                {count > 0 ? (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      opacity: 0.9,
                    }}
                  >
                    수업 {count}개
                  </div>
                ) : null}
              </button>
            )
          })}
        </div>
      </section>
    )
  }

  const {
    activeSection,
    showOnlySelectedDate,
    selectedDateDisplayString,
    setShowOnlySelectedDate,
    showPrivateLessonAddInCalendar,
    openPrivateLessonModal,
    loading,
    isPrivateLessonModalSubmitting,
    sortedPrivateStudentsLength,
    enableLegacyLessonMigrationButton,
    isAdmin,
    handleMigrateLessons,
    migrating,
    displayedLessons,
    getMatchedStudent,
    getMatchedStudentId,
    studentPackages,
    handleDeductionToggle,
    canManageAttendance,
    busyLessonId,
    busyPrivateLessonCrudId,
    busyPrivateLessonAdd,
    openPrivateLessonEditModal,
    handleDeletePrivateLesson,
    canEditLesson,
    canDeleteLesson,
  } = props

  return (
    <section className="activity-section">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>
            {showOnlySelectedDate ? `${selectedDateDisplayString} 수업` : '전체 수업'}
          </h2>
          <p style={{ margin: '6px 0 0 0', opacity: 0.75, fontSize: 13 }}>
            {showOnlySelectedDate
              ? '선택한 날짜의 수업만 표시 중'
              : '전체 수업 표시 중'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowOnlySelectedDate((prev) => !prev)}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              border: '1px solid #444',
              background: '#1f1f1f',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            {showOnlySelectedDate ? '전체 보기' : '선택 날짜만 보기'}
          </button>

          {activeSection === 'calendar' && showPrivateLessonAddInCalendar ? (
            <button
              type="button"
              onClick={openPrivateLessonModal}
              disabled={
                loading || isPrivateLessonModalSubmitting || sortedPrivateStudentsLength === 0
              }
              title={
                sortedPrivateStudentsLength === 0
                  ? '표시할 개인 학생이 없습니다.'
                  : undefined
              }
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid #444',
                background: '#1f2a44',
                color: 'white',
                cursor:
                  loading || isPrivateLessonModalSubmitting || sortedPrivateStudentsLength === 0
                    ? 'not-allowed'
                    : 'pointer',
              }}
            >
              개인 수업 추가
            </button>
          ) : null}

          {enableLegacyLessonMigrationButton && isAdmin ? (
            <button
              type="button"
              onClick={handleMigrateLessons}
              disabled={migrating}
              title="예전 수업 데이터 일괄 보정(관리자 전용). 상단 코드의 ENABLE_LEGACY_LESSON_MIGRATION_BUTTON 참고."
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
                cursor: migrating ? 'not-allowed' : 'pointer',
              }}
            >
              {migrating ? '변환 중...' : '예전 수업 데이터 일괄 보정'}
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <p>불러오는 중...</p>
      ) : displayedLessons.length === 0 ? (
        <p>등록된 수업이 없습니다.</p>
      ) : (
        <div className="activity-table">
          <div className="table-head">
            <span>날짜</span>
            <span>시간</span>
            <span>학생</span>
            <span>선생님</span>
            <span>과목</span>
            <span>남은 횟수</span>
            <span>상태</span>
            <span>작업</span>
          </div>

          {displayedLessons.map((lesson) => {
            const lessonDate = getLessonDate(lesson)
            const matchedStudent = getMatchedStudent(lesson)
            const pkgForRemaining = lesson.packageId
              ? studentPackages.find((p) => p.id === lesson.packageId)
              : null
            const remainingLessons =
              lesson.packageId && pkgForRemaining
                ? Number(pkgForRemaining.remainingCount ?? 0)
                : matchedStudent
                  ? Number(matchedStudent.paidLessons || 0) -
                    Number(matchedStudent.attendanceCount || 0)
                  : '-'
            const canDeductionAction =
              canManageAttendance &&
              (lesson.packageId
                ? Boolean(pkgForRemaining && pkgForRemaining.packageType === 'private')
                : Boolean(getMatchedStudentId(lesson)))
            const todayString = getTodayStorageDateString()
            const lessonDateStr = getLessonStorageDateString(lesson)
            const statusLabel = lesson.isDeductCancelled
              ? '차감취소'
              : lessonDateStr && lessonDateStr <= todayString
                ? '정상 차감'
                : '예정'
            const rowPrivateCrudBusy = busyPrivateLessonCrudId === lesson.id
            const rowLessonActionBusy =
              busyLessonId === lesson.id || rowPrivateCrudBusy || busyPrivateLessonAdd
            return (
              <div key={lesson.id} className="table-row">
                <span>{formatDate(lessonDate)}</span>
                <span>{formatTime(lessonDate)}</span>
                <span>{getStudentName(lesson)}</span>
                <span>{getTeacherName(lesson)}</span>
                <span>{lesson.subject || '-'}</span>
                <span>{remainingLessons}</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>{statusLabel}</span>
                  {lesson.deductMemo ? (
                    <span style={{ fontSize: 12, opacity: 0.8 }}>
                      메모: {lesson.deductMemo}
                    </span>
                  ) : null}
                </span>
                <span
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    alignItems: 'flex-start',
                  }}
                >
                  {canManageAttendance ? (
                    <button
                      onClick={() => handleDeductionToggle(lesson)}
                      disabled={busyLessonId === lesson.id || !canDeductionAction}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #555',
                        background: lesson.isDeductCancelled ? '#4a2a2a' : '#1f2a44',
                        color: 'white',
                        cursor:
                          busyLessonId === lesson.id || !canDeductionAction
                            ? 'not-allowed'
                            : 'pointer',
                      }}
                    >
                      {busyLessonId === lesson.id
                        ? '처리 중...'
                        : lesson.isDeductCancelled
                          ? '차감복구'
                          : '차감취소'}
                    </button>
                  ) : null}
                  {activeSection === 'calendar' && canEditLesson ? (
                    <button
                      type="button"
                      onClick={() => openPrivateLessonEditModal(lesson)}
                      disabled={rowLessonActionBusy}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #555',
                        background: '#1f2a44',
                        color: 'white',
                        cursor: rowLessonActionBusy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {rowPrivateCrudBusy ? '처리 중...' : '수정'}
                    </button>
                  ) : null}
                  {activeSection === 'calendar' && canDeleteLesson ? (
                    <button
                      type="button"
                      onClick={() => handleDeletePrivateLesson(lesson)}
                      disabled={rowLessonActionBusy}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #553333',
                        background: '#4a2a2a',
                        color: 'white',
                        cursor: rowLessonActionBusy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {rowPrivateCrudBusy ? '처리 중...' : '삭제'}
                    </button>
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
