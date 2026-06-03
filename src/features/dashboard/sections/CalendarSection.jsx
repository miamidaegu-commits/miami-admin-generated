import { useState } from 'react'
import {
  formatLessonDateLabel,
  formatLessonSessionNumber,
  formatLessonTimeLabel,
  getLessonDate,
  getLessonStorageDateString,
  getStudentName,
  getTeacherName,
  getTodayStorageDateString,
  getStorageDateStringFromDate,
  isSameStorageDate,
} from '../dashboardViewUtils.js'
import {
  computePrivateTeacherPackageUsage,
  findPrivatePackageForTeacherContext,
  findStudentPrivatePackageContexts,
} from '../privatePackageHelpers.js'

function calendarTimestampToMillis(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') {
    const millis = value.toMillis()
    return Number.isFinite(millis) ? millis : null
  }
  if (typeof value.toDate === 'function') {
    const millis = value.toDate().getTime()
    return Number.isFinite(millis) ? millis : null
  }
  if (value instanceof Date) {
    const millis = value.getTime()
    return Number.isFinite(millis) ? millis : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const millis = Date.parse(value)
    return Number.isFinite(millis) ? millis : null
  }
  return null
}

function seoulDateTimeToMillis(dateValue, timeValue) {
  const date = String(dateValue || '').trim()
  const time = String(timeValue || '').trim()
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const timeMatch = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!dateMatch || !timeMatch) return null
  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  return Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0)
}

function getPrivateReservationEndMillis(row) {
  const startMillis =
    calendarTimestampToMillis(row?.startAt) ||
    seoulDateTimeToMillis(row?.date, row?.time)
  if (startMillis == null) return null
  const duration = Number(row?.durationMinutes)
  const durationMinutes = Number.isFinite(duration) && duration > 0 ? duration : 50
  return startMillis + durationMinutes * 60 * 1000
}

function parseStorageDateToLocalDate(value) {
  const text = String(value || '').trim()
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function offsetStorageDate(value, offsetDays) {
  const base = parseStorageDateToLocalDate(value) || new Date()
  base.setDate(base.getDate() + offsetDays)
  return base
}

function formatSelectedDateControlLabel(value, fallback) {
  const text = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.replaceAll('-', '.')
  return fallback || '-'
}

function formatRemainingCountFromPackage(pkg) {
  if (!pkg || pkg.remainingCount == null || pkg.remainingCount === '') return '—'
  const count = Number(pkg.remainingCount)
  return Number.isFinite(count) ? count : '—'
}

function isPrivateLessonCancelledWithoutDeduction(lesson) {
  const status = String(lesson?.status || '').trim().toLowerCase()
  const cancellationType = String(lesson?.cancellationType || '').trim().toLowerCase()
  const cancelledReason = String(lesson?.cancelledReason || '').trim().toLowerCase()
  if (lesson?.noDeduction === true) return true
  if (cancellationType === 'no_deduction' || cancellationType === 'class_closure') return true
  if (['holiday', 'teacher_unavailable', 'academy_closed'].includes(cancelledReason)) return true
  return status === 'cancelled' || status === 'canceled'
}

function getFixedPrivateLessonCancellationLabel(lesson) {
  const status = String(lesson?.status || '').trim().toLowerCase()
  if (status !== 'cancelled' && status !== 'canceled') return ''
  const cancellationType = String(lesson?.cancellationType || '').trim().toLowerCase()
  if (cancellationType === 'seat_released' || lesson?.isSeatReleased === true) return '자리 공개'
  if (cancellationType === 'lesson_cancelled') return '수업 취소'
  return ''
}

function isFixedPrivateLesson(lesson) {
  return (
    String(lesson?.packageType || '').trim() === 'private' &&
    String(lesson?.sourceType || '').trim() === 'fixed-private-slot-assignment'
  )
}

function isFuturePrivateLesson(lesson) {
  const date = getLessonStorageDateString(lesson)
  const time = String(lesson?.time || '').trim()
  const millis = seoulDateTimeToMillis(date, time)
  if (Number.isFinite(millis)) return millis > Date.now()
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= getTodayStorageDateString()
}

function getPackageById(studentPackages, packageId) {
  const pid = String(packageId || '').trim()
  if (!pid) return null
  return (Array.isArray(studentPackages) ? studentPackages : []).find((p) => p.id === pid) || null
}

function getPrivateLessonPackageContext({
  lesson,
  studentPackages,
  academyId,
  matchedStudentId,
}) {
  const directPackageId = String(lesson?.packageId || '').trim()
  const linkedPackage = getPackageById(studentPackages, lesson?.packageId)
  const linkedPrivatePackage =
    linkedPackage && linkedPackage.packageType === 'private' ? linkedPackage : null
  const studentPrivatePackages = matchedStudentId
    ? findStudentPrivatePackageContexts({
        studentPackages,
        academyId,
        studentId: matchedStudentId,
      })
    : []
  const fallbackPackage =
    !linkedPrivatePackage && matchedStudentId
      ? findPrivatePackageForTeacherContext({
          studentPackages,
          academyId,
          studentId: matchedStudentId,
          teacher: getTeacherName(lesson),
        })
      : null
  const linkedPackageStub =
    !linkedPrivatePackage && directPackageId
      ? {
          id: directPackageId,
          academyId,
          studentId: matchedStudentId,
          teacher: getTeacherName(lesson),
          teacherName: getTeacherName(lesson),
          packageType: 'private',
          __packageStub: true,
        }
      : null
  const contextPackage = linkedPrivatePackage || fallbackPackage || linkedPackageStub
  return {
    linkedPrivatePackage: linkedPrivatePackage || linkedPackageStub,
    contextPackage,
    hasDirectPackageLink: Boolean(directPackageId && contextPackage),
    hasTeacherScopedPackage: Boolean(contextPackage),
    hasAnyPrivatePackage: Boolean(contextPackage || studentPrivatePackages.length > 0),
    hasPackageMatchIncomplete: Boolean(!contextPackage && studentPrivatePackages.length > 0),
  }
}

function getPrivatePackageStateLabel({
  contextPackage,
  packageUsage,
  hasAnyPrivatePackage,
  hasPackageMatchIncomplete,
  hasDirectPackageLink,
}) {
  if (!contextPackage) {
    return hasAnyPrivatePackage || hasPackageMatchIncomplete
      ? '수강권 연결 필요'
      : '수강권 등록 필요'
  }

  const remainingCount = Number(formatRemainingCountFromPackage(contextPackage))
  if (Number.isFinite(remainingCount) && remainingCount <= 0) return '소진'

  const makeupAvailableCount = Number(packageUsage?.makeupAvailableCount)
  if (Number.isFinite(makeupAvailableCount)) {
    return `보충 가능 ${Math.max(0, makeupAvailableCount)}회`
  }

  return hasDirectPackageLink ? '수강권 연결됨' : '수강권 자동 연결'
}

function CalendarPrivateLessonDetailModal({
  detail,
  busyLessonId,
  onClose,
  onToggleDeduction,
  onOpenPackageEdit,
}) {
  if (!detail) return null
  const canRunDeductionAction =
    detail.canManagePrivateLessonDeductions &&
    detail.hasLinkedPrivatePackage &&
    detail.canToggleDeduction
  const canEditPackageCount = detail.canEditPackageCount && detail.contextPackage
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="calendar-private-lesson-detail-title"
      data-testid="calendar-private-lesson-detail-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1003,
        padding: 16,
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
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
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="calendar-private-lesson-detail-title"
          style={{ margin: '0 0 12px 0', fontSize: '1.1rem' }}
        >
          수업 차감 상세
        </h2>
        <div style={{ display: 'grid', gap: 8, fontSize: 13, lineHeight: 1.5 }}>
          <div>학생: {detail.studentName || '-'}</div>
          <div>
            일시: {formatLessonDateLabel(detail.lesson)} {formatLessonTimeLabel(detail.lesson)}
          </div>
          <div>과목: {detail.subject || '-'}</div>
          <div>상태: {detail.statusLabel}</div>
          <div>남은 횟수: {detail.remainingLessons}</div>
          {detail.packageUsage ? (
            <>
              <div>총 횟수: {detail.packageUsage.totalCount}</div>
              <div>사용 횟수: {detail.packageUsage.usedDeductedCount}</div>
              <div>예정 고정수업: {detail.packageUsage.futureFixedAllocatedCount}</div>
              <div>예약된 보충수업: {detail.packageUsage.activeFutureReservationAllocatedCount}</div>
              <div>보충 가능: {detail.packageUsage.makeupAvailableCount}</div>
            </>
          ) : null}
          {detail.actionReason ? (
            <div
              data-testid="calendar-private-lesson-action-reason"
              style={{
                marginTop: 4,
                padding: 10,
                borderRadius: 8,
                border: '1px solid #554633',
                background: '#251f17',
                color: '#ffe0aa',
              }}
            >
              {detail.actionReason}
            </div>
          ) : null}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 18,
            flexWrap: 'wrap',
          }}
        >
          {canEditPackageCount && detail.contextPackage?.__packageStub !== true ? (
            <button
              type="button"
              data-testid="calendar-package-count-edit-button"
              onClick={() => onOpenPackageEdit(detail.contextPackage)}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #335544',
                background: '#243528',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              수강권 횟수 수정
            </button>
          ) : null}
          {canRunDeductionAction ? (
            <button
              type="button"
              data-testid="calendar-deduction-toggle-button"
              onClick={() => onToggleDeduction(detail.lesson)}
              disabled={busyLessonId === detail.lesson.id}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #555',
                background: detail.lesson.isDeductCancelled ? '#4a2a2a' : '#1f2a44',
                color: 'white',
                cursor: busyLessonId === detail.lesson.id ? 'not-allowed' : 'pointer',
              }}
            >
              {busyLessonId === detail.lesson.id
                ? '처리 중...'
                : detail.lesson.isDeductCancelled
                  ? '차감복구'
                  : '차감취소'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
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
      </div>
    </div>
  )
}

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
      lessonsPreviewByDate,
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
            const previews = lessonsPreviewByDate?.get(dateKey) || []
            const isCurrentMonth = day.getMonth() === calendarMonth.getMonth()
            const isSelected = isSameStorageDate(day, selectedDate)

            return (
              <button
                key={dateKey}
                data-testid="calendar-day-button"
                data-date={dateKey}
                onClick={() => {
                  setSelectedDate(day)
                  setShowOnlySelectedDate(true)
                }}
                style={{
                  minHeight: 96,
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
                {previews.slice(0, 2).map((preview) => (
                  <div
                    key={preview.id}
                    style={{
                      marginTop: 4,
                      fontSize: 11,
                      lineHeight: 1.35,
                      opacity: 0.82,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {preview.label}
                  </div>
                ))}
                {previews.length > 2 ? (
                  <div style={{ marginTop: 4, fontSize: 11, opacity: 0.62 }}>
                    +{previews.length - 2}
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
    selectedDateString,
    selectedDateDisplayString,
    setSelectedDate,
    setShowOnlySelectedDate,
    showPrivateLessonAddInCalendar,
    openPrivateLessonModal,
    loading,
    isPrivateLessonModalSubmitting,
    sortedPrivateStudentsLength,
    enableLegacyLessonMigrationButton,
    enableGroupLegacyBackfillTool,
    isAdmin,
    handleMigrateLessons,
    migrating,
    handleGroupLegacyBackfill,
    busyGroupLegacyBackfill,
    displayedLessons,
    getMatchedStudent,
    getMatchedStudentId,
    studentPackages,
    allPrivateLessons = [],
    privateLessonReservations = [],
    handleDeductionToggle,
    canManageAttendance,
    canManagePrivateLessonDeductions,
    busyLessonId,
    busyPrivateLessonCrudId,
    busyFixedPrivateLessonCancelId,
    busyPrivateLessonAdd,
    busyPrivateReservationOutcomeId,
    openPrivateLessonEditModal,
    handleDeletePrivateLesson,
    onCancelFixedPrivateLesson,
    onMarkPrivateReservationOutcome,
    onReversePrivateReservationOutcome,
    canEditLesson,
    canDeleteLesson,
    onOpenCalendarGroupLessonAttendance,
    onOpenGroupLessonNoDeductionCancel,
    openStudentPackageEditModal,
    canEditStudentPackageCountsForPackage = () => false,
  } = props
  const [privateLessonDetail, setPrivateLessonDetail] = useState(null)
  const displayedLessonRows =
    activeSection === 'groups'
      ? displayedLessons.filter((lesson) => lesson._calendarRowKind === 'group')
      : displayedLessons
  const emptyLessonMessage =
    activeSection === 'groups' && showOnlySelectedDate
      ? '선택한 날짜의 단체반 수업이 없습니다.'
      : '등록된 수업이 없습니다.'
  const showGroupSelectedDateControl = activeSection === 'groups'
  const selectedDateControlLabel = formatSelectedDateControlLabel(
    selectedDateString,
    selectedDateDisplayString
  )
  const changeSelectedDateBy = (offsetDays) => {
    setSelectedDate?.(offsetStorageDate(selectedDateString, offsetDays))
    setShowOnlySelectedDate(true)
  }
  const changeSelectedDateTo = (value) => {
    const nextDate = parseStorageDateToLocalDate(value)
    if (!nextDate) return
    setSelectedDate?.(nextDate)
    setShowOnlySelectedDate(true)
  }

  return (
    <section className="activity-section" data-testid="calendar-lessons-section">
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

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {showGroupSelectedDateControl ? (
            <div
              data-testid="group-selected-date-control"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                border: '1px solid #333b4f',
                borderRadius: 10,
                padding: 6,
                background: '#171c27',
              }}
            >
              <button
                type="button"
                aria-label="이전 날짜"
                onClick={() => changeSelectedDateBy(-1)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid #444',
                  background: '#1f1f1f',
                  color: 'white',
                  cursor: 'pointer',
                }}
              >
                이전 날짜
              </button>
              <label
                data-testid="group-selected-date-label"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  whiteSpace: 'nowrap',
                }}
              >
                <span>선택 날짜: {selectedDateControlLabel}</span>
                <input
                  type="date"
                  aria-label="선택 날짜"
                  value={selectedDateString || ''}
                  onChange={(event) => changeSelectedDateTo(event.target.value)}
                  style={{
                    colorScheme: 'dark',
                    border: '1px solid #444',
                    borderRadius: 8,
                    background: '#111722',
                    color: 'white',
                    padding: '7px 9px',
                  }}
                />
              </label>
              <button
                type="button"
                aria-label="다음 날짜"
                onClick={() => changeSelectedDateBy(1)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid #444',
                  background: '#1f1f1f',
                  color: 'white',
                  cursor: 'pointer',
                }}
              >
                다음 날짜
              </button>
            </div>
          ) : null}

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

          {enableGroupLegacyBackfillTool && isAdmin ? (
            <button
              type="button"
              onClick={handleGroupLegacyBackfill}
              disabled={busyGroupLegacyBackfill || migrating}
              title="그룹 레거시 필드 보정(관리자 전용). Dashboard.jsx의 ENABLE_GROUP_LEGACY_BACKFILL_TOOL 참고."
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
                cursor:
                  busyGroupLegacyBackfill || migrating ? 'not-allowed' : 'pointer',
              }}
            >
              {busyGroupLegacyBackfill ? '보정 중...' : '그룹 레거시 데이터 보정'}
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <p>불러오는 중...</p>
      ) : displayedLessonRows.length === 0 ? (
        <p>{emptyLessonMessage}</p>
      ) : (
        <div className="activity-table">
          <div
            className="table-head"
            style={{
              gridTemplateColumns:
                'minmax(96px, 1fr) minmax(72px, 0.85fr) minmax(120px, 1.25fr) minmax(64px, 0.7fr) minmax(80px, 1fr) minmax(72px, 1fr) minmax(72px, 0.85fr) minmax(96px, 1fr) minmax(140px, auto)',
            }}
          >
            <span>날짜</span>
            <span>시간</span>
            <span>학생 / 반</span>
            <span>회차</span>
            <span>선생님</span>
            <span>과목</span>
            <span>남은 횟수</span>
            <span>상태</span>
            <span>작업</span>
          </div>

          {displayedLessonRows.map((lesson) => {
            const isGroupRow = lesson._calendarRowKind === 'group'
            const isPrivateReservationRow = lesson._calendarRowKind === 'privateReservation'
            const lessonDate = getLessonDate(lesson)
            const matchedStudent = getMatchedStudent(lesson)
            const matchedStudentId = getMatchedStudentId(lesson)
            const {
              contextPackage,
              hasDirectPackageLink,
              hasTeacherScopedPackage,
              hasAnyPrivatePackage,
              hasPackageMatchIncomplete,
            } = getPrivateLessonPackageContext({
              lesson,
              studentPackages,
              academyId: lesson.academyId,
              matchedStudentId,
            })
            const hasLinkedPrivatePackage = Boolean(contextPackage)
            const packageUsage =
              contextPackage && matchedStudentId
                ? computePrivateTeacherPackageUsage({
                    privatePackage: contextPackage,
                    privateLessons: allPrivateLessons,
                    privateReservations: privateLessonReservations,
                    academyId: lesson.academyId,
                    studentId: matchedStudentId,
                    teacher: getTeacherName(lesson),
                  })
                : null
            const privatePackageStateLabel = getPrivatePackageStateLabel({
              contextPackage,
              packageUsage,
              hasAnyPrivatePackage,
              hasPackageMatchIncomplete,
              hasDirectPackageLink,
            })
            const remainingLessons = isGroupRow || isPrivateReservationRow
              ? '—'
              : contextPackage
                ? privatePackageStateLabel
                : matchedStudent
                  ? privatePackageStateLabel
                  : '-'
            const todayString = getTodayStorageDateString()
            const lessonDateStr = getLessonStorageDateString(lesson)
            const isNoDeductionPrivateLesson =
              !isGroupRow &&
              !isPrivateReservationRow &&
              isPrivateLessonCancelledWithoutDeduction(lesson)
            const fixedPrivateCancellationLabel =
              !isGroupRow && !isPrivateReservationRow
                ? getFixedPrivateLessonCancellationLabel(lesson)
                : ''
            const canCancelFixedPrivateLesson =
              activeSection === 'calendar' &&
              isAdmin &&
              !isGroupRow &&
              !isPrivateReservationRow &&
              isFixedPrivateLesson(lesson) &&
              isFuturePrivateLesson(lesson) &&
              !fixedPrivateCancellationLabel
            const isDeductedPrivateLesson =
              !isGroupRow &&
              !isPrivateReservationRow &&
              !isNoDeductionPrivateLesson &&
              hasLinkedPrivatePackage &&
              lesson.isDeductCancelled !== true &&
              Boolean(lessonDateStr && lessonDateStr <= todayString)
            const isPendingLinkedPrivateLesson =
              !isGroupRow &&
              !isPrivateReservationRow &&
              !isNoDeductionPrivateLesson &&
              hasLinkedPrivatePackage &&
              lesson.isDeductCancelled !== true &&
              Boolean(lessonDateStr && lessonDateStr > todayString)
            const canDeductionAction =
              !isGroupRow &&
              !isPrivateReservationRow &&
              canManagePrivateLessonDeductions &&
              (isDeductedPrivateLesson || lesson.isDeductCancelled === true) &&
              hasLinkedPrivatePackage
            const privateReservationStatus = String(lesson.status || '').trim()
            const privateReservationEndMillis = isPrivateReservationRow
              ? getPrivateReservationEndMillis(lesson)
              : null
            const privateReservationHasEnded =
              privateReservationEndMillis != null && Date.now() >= privateReservationEndMillis
            const statusLabel = isGroupRow
              ? lesson.calendarStatusLabel || '예정'
              : isPrivateReservationRow
                ? lesson.deductionSource === 'auto'
                  ? '자동 차감 완료'
                  : lesson.deductionApplied === true
                    ? '정상 차감'
                    : privateReservationStatus === 'completed'
                      ? '완료'
                      : privateReservationStatus === 'no_show'
                        ? '노쇼'
                        : '예약됨'
                : isNoDeductionPrivateLesson
                  ? fixedPrivateCancellationLabel || '휴강 · 차감 없음'
                  : lesson.isDeductCancelled
                  ? '차감취소'
                  : isDeductedPrivateLesson
                    ? '정상 차감'
                    : isPendingLinkedPrivateLesson
                      ? privatePackageStateLabel
                      : hasTeacherScopedPackage
                        ? privatePackageStateLabel
                      : hasPackageMatchIncomplete
                      ? '수강권 연결 필요'
                      : lessonDateStr && lessonDateStr <= todayString
                      ? '수강권 등록 필요'
                      : '예정'
            const actionReason = isGroupRow || isPrivateReservationRow
              ? ''
              : !canManagePrivateLessonDeductions
                ? '권한이 없습니다'
                : isNoDeductionPrivateLesson
                  ? '휴강 · 차감 없음'
                  : !hasAnyPrivatePackage
                    ? '수강권 등록 필요'
                    : !hasTeacherScopedPackage
                    ? '수강권 연결 필요'
                    : lesson.isDeductCancelled === true
                      ? ''
                      : isDeductedPrivateLesson
                        ? ''
                      : packageUsage && Number(packageUsage.makeupAvailableCount || 0) <= 0
                        ? '보충 가능 0회'
                        : '아직 차감된 수업이 아닙니다'
            const canEditPackageCount =
              !isGroupRow &&
              !isPrivateReservationRow &&
              Boolean(contextPackage && contextPackage.__packageStub !== true) &&
              canEditStudentPackageCountsForPackage(contextPackage)
            const rowPrivateCrudBusy = busyPrivateLessonCrudId === lesson.id
            const reservationCompleteBusy =
              busyPrivateReservationOutcomeId === `${lesson.id}:completed`
            const reservationNoShowBusy =
              busyPrivateReservationOutcomeId === `${lesson.id}:no_show`
            const reservationReverseBusy =
              busyPrivateReservationOutcomeId === `${lesson.id}:reverse`
            const reservationOutcomeBusy =
              reservationCompleteBusy || reservationNoShowBusy || reservationReverseBusy
            const rowLessonActionBusy =
              busyLessonId === lesson.id ||
              rowPrivateCrudBusy ||
              busyPrivateLessonAdd ||
              busyFixedPrivateLessonCancelId === lesson.id
            const sessionLabel = formatLessonSessionNumber(lesson)
            const badgeStyle = {
              display: 'inline-block',
              fontSize: 10,
              fontWeight: 600,
              lineHeight: 1.3,
              padding: '2px 6px',
              borderRadius: 4,
              marginRight: 6,
              verticalAlign: 'middle',
              border: '1px solid rgba(120, 140, 200, 0.45)',
              background: isGroupRow
                ? 'rgba(80, 100, 160, 0.35)'
                : isPrivateReservationRow
                  ? 'rgba(110, 100, 55, 0.36)'
                  : 'rgba(60, 120, 90, 0.35)',
              color: 'inherit',
              whiteSpace: 'nowrap',
            }
            const nameLabel = isGroupRow
              ? lesson.groupClassDisplayName || '-'
              : getStudentName(lesson)
            const rowGroupName = isGroupRow
              ? String(lesson.groupClassDisplayName || '').trim()
              : undefined
            const rowStudentName = !isGroupRow
              ? String(getStudentName(lesson) || '').trim()
              : undefined
            const canOpenGroupAttendance =
              isGroupRow && (isAdmin || canManageAttendance)
            const canOpenPrivateLessonDetail =
              activeSection === 'calendar' && !isGroupRow && !isPrivateReservationRow
            const privateLessonDetailPayload = canOpenPrivateLessonDetail
              ? {
                  lesson,
                  lessonDate,
                  studentName: getStudentName(lesson),
                  subject: lesson.subject || '-',
                  statusLabel,
                  remainingLessons,
                  actionReason,
                  canManagePrivateLessonDeductions,
                  canToggleDeduction: isDeductedPrivateLesson || lesson.isDeductCancelled === true,
                  hasLinkedPrivatePackage,
                  contextPackage,
                  packageUsage,
                  canEditPackageCount,
                }
              : null
            const rowKind = isGroupRow
              ? 'group'
              : isPrivateReservationRow
                ? 'privateReservation'
                : 'private'
            return (
              <div
                key={lesson.id}
                className="table-row"
                data-testid="calendar-lesson-row"
                data-row-kind={rowKind}
                data-lesson-kind={rowKind}
                data-lesson-id={lesson.id}
                data-reservation-id={isPrivateReservationRow ? lesson.id : undefined}
                data-group-name={rowGroupName || undefined}
                data-student-name={rowStudentName || undefined}
                data-student-id={!isGroupRow ? matchedStudentId || undefined : undefined}
                data-date={getLessonStorageDateString(lesson) || undefined}
                data-time={String(lesson.time || '').trim() || undefined}
                onClick={
                  canOpenGroupAttendance
                    ? () => onOpenCalendarGroupLessonAttendance?.(lesson)
                    : canOpenPrivateLessonDetail
                      ? () => setPrivateLessonDetail(privateLessonDetailPayload)
                      : undefined
                }
                style={{
                  gridTemplateColumns:
                    'minmax(96px, 1fr) minmax(72px, 0.85fr) minmax(120px, 1.25fr) minmax(64px, 0.7fr) minmax(80px, 1fr) minmax(72px, 1fr) minmax(72px, 0.85fr) minmax(96px, 1fr) minmax(140px, auto)',
                  cursor:
                    canOpenGroupAttendance || canOpenPrivateLessonDetail ? 'pointer' : 'default',
                  background:
                    canOpenGroupAttendance || canOpenPrivateLessonDetail
                      ? 'rgba(90, 127, 208, 0.08)'
                      : undefined,
                }}
              >
                <span>{formatLessonDateLabel(lesson)}</span>
                <span>{formatLessonTimeLabel(lesson)}</span>
                <span style={{ lineHeight: 1.45 }}>
                  <span style={badgeStyle}>
                    {isGroupRow ? '그룹' : isPrivateReservationRow ? '예약 1:1' : '개인'}
                  </span>
                  {nameLabel}
                </span>
                <span>{sessionLabel || '-'}</span>
                <span>{getTeacherName(lesson)}</span>
                <span>{lesson.subject || '-'}</span>
                <span>{remainingLessons}</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>{statusLabel}</span>
                  {!isGroupRow && !isPrivateReservationRow && lesson.deductMemo ? (
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
                  {canManagePrivateLessonDeductions &&
                  !isGroupRow &&
                  !isPrivateReservationRow &&
                  canDeductionAction ? (
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        handleDeductionToggle(lesson)
                      }}
                      disabled={busyLessonId === lesson.id}
                      data-testid="calendar-deduction-toggle-button"
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #555',
                        background: lesson.isDeductCancelled ? '#4a2a2a' : '#1f2a44',
                        color: 'white',
                        cursor: busyLessonId === lesson.id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {busyLessonId === lesson.id
                        ? '처리 중...'
                        : lesson.isDeductCancelled
                          ? '차감복구'
                          : '차감취소'}
                    </button>
                  ) : null}
                  {canManagePrivateLessonDeductions &&
                  !isGroupRow &&
                  !isPrivateReservationRow &&
                  !canDeductionAction &&
                  actionReason ? (
                    <span
                      data-testid="calendar-deduction-action-disabled-label"
                      style={{
                        fontSize: 12,
                        opacity: 0.72,
                        padding: '4px 0',
                      }}
                    >
                      {actionReason === '수강권이 연결되어 있지 않습니다'
                        ? '수강권 연결 필요'
                        : actionReason}
                    </span>
                  ) : null}
                  {activeSection === 'calendar' &&
                  !isGroupRow &&
                  !isPrivateReservationRow &&
                  canEditPackageCount ? (
                    <button
                      type="button"
                      data-testid="calendar-package-count-edit-button"
                      onClick={(event) => {
                        event.stopPropagation()
                        openStudentPackageEditModal?.(contextPackage)
                      }}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #335544',
                        background: '#243528',
                        color: 'white',
                        cursor: 'pointer',
                      }}
                    >
                      횟수 수정
                    </button>
                  ) : null}
                  {activeSection === 'calendar' &&
                  canCancelFixedPrivateLesson ? (
                    <>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onCancelFixedPrivateLesson?.(lesson, 'seat_released')
                        }}
                        disabled={rowLessonActionBusy}
                        data-testid="calendar-fixed-private-release-button"
                        style={{
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid #4a6fff55',
                          background: '#1f2a44',
                          color: 'white',
                          cursor: rowLessonActionBusy ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {busyFixedPrivateLessonCancelId === lesson.id ? '처리 중...' : '자리 공개'}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onCancelFixedPrivateLesson?.(lesson, 'lesson_cancelled')
                        }}
                        disabled={rowLessonActionBusy}
                        data-testid="calendar-fixed-private-cancel-button"
                        style={{
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid #665533',
                          background: '#3a321f',
                          color: '#ffe8b8',
                          cursor: rowLessonActionBusy ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {busyFixedPrivateLessonCancelId === lesson.id ? '처리 중...' : '수업 취소'}
                      </button>
                    </>
                  ) : null}
                  {activeSection === 'calendar' &&
                  canEditLesson &&
                  !isGroupRow &&
                  !isPrivateReservationRow ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        openPrivateLessonEditModal(lesson)
                      }}
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
                  {activeSection === 'calendar' &&
                  canDeleteLesson &&
                  !isGroupRow &&
                  !isPrivateReservationRow ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        handleDeletePrivateLesson(lesson)
                      }}
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
                  {isGroupRow ? (
                    <>
                      <span style={{ fontSize: 12, opacity: 0.65 }}>
                        읽기 전용
                        {canOpenGroupAttendance ? ' · 클릭해 출결 열기' : ''}
                      </span>
                      {isAdmin && canEditLesson && lesson.status !== 'cancelled' ? (
                        <button
                          type="button"
                          onClick={() => onOpenGroupLessonNoDeductionCancel?.(lesson)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 8,
                            border: '1px solid #665533',
                            background: '#3a321f',
                            color: '#ffe8b8',
                            cursor: 'pointer',
                          }}
                        >
                          휴강 처리
                        </button>
                      ) : null}
                    </>
                  ) : null}
                  {isPrivateReservationRow ? (
                    <span style={{ fontSize: 12, opacity: 0.65 }}>읽기 전용</span>
                  ) : null}
                  {activeSection === 'calendar' &&
                  isAdmin &&
                  isPrivateReservationRow &&
                  privateReservationStatus === 'active' ? (
                    <>
                      {privateReservationHasEnded ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onMarkPrivateReservationOutcome?.(lesson, 'completed')}
                            disabled={reservationOutcomeBusy}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: '1px solid #555',
                              background: '#1f2a44',
                              color: 'white',
                              cursor: reservationOutcomeBusy ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {reservationCompleteBusy ? '처리 중...' : '완료 처리'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onMarkPrivateReservationOutcome?.(lesson, 'no_show')}
                            disabled={reservationOutcomeBusy}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: '1px solid #553333',
                              background: '#4a2a2a',
                              color: 'white',
                              cursor: reservationOutcomeBusy ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {reservationNoShowBusy ? '처리 중...' : '노쇼 처리'}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled
                          style={{
                            padding: '6px 10px',
                            borderRadius: 8,
                            border: '1px solid #555',
                            background: '#2a2f3a',
                            color: 'white',
                            cursor: 'not-allowed',
                            opacity: 0.72,
                          }}
                        >
                          수업 종료 후 처리
                        </button>
                      )}
                    </>
                  ) : null}
                  {activeSection === 'calendar' &&
                  isAdmin &&
                  isPrivateReservationRow &&
                  ['completed', 'no_show'].includes(privateReservationStatus) ? (
                    <button
                      type="button"
                      onClick={() => onReversePrivateReservationOutcome?.(lesson)}
                      disabled={reservationOutcomeBusy}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #555',
                        background: '#1f2a44',
                        color: 'white',
                        cursor: reservationOutcomeBusy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {reservationReverseBusy ? '처리 중...' : '완료취소'}
                    </button>
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {privateLessonDetail ? (
        <CalendarPrivateLessonDetailModal
          detail={privateLessonDetail}
          busyLessonId={busyLessonId}
          onClose={() => setPrivateLessonDetail(null)}
          onToggleDeduction={handleDeductionToggle}
          onOpenPackageEdit={(pkg) => {
            openStudentPackageEditModal?.(pkg)
            setPrivateLessonDetail(null)
          }}
        />
      ) : null}
    </section>
  )
}
