import { useEffect, useRef } from 'react'
import { useTranslation } from '../../../i18n/LocalizationProvider.jsx'
import { installDialogFocusContainment } from '../../../preferences/layout.js'
import {
  formatGroupStudentStartDate,
  formatGroupWeekdaysDisplay,
  getTodayStorageDateString,
  isGroupStudentOperationallyEligibleOnYmd,
  isNoDeductionCancelledGroupLesson,
  resolveTeacherDisplayName,
} from '../dashboardViewUtils.js'
import { getGroupCourseTypeLabel } from '../../group-booking/groupCourseTypes.js'
import {
  getGroupClassBookingCapacitySummary,
  resolveGroupLessonSubject,
} from '../groupClassRoomUtils.js'

function getLessonReservationStatusLabel(lesson, seatAvailability, text = (_key, fallback) => fallback) {
  if (isNoDeductionCancelledGroupLesson(lesson)) {
    return text('teacher.groups.status.cancelled', '휴강')
  }
  if (seatAvailability) {
    return seatAvailability.isFull
      ? text('teacher.groups.status.full', '마감')
      : text('teacher.groups.status.open', '예약 가능')
  }
  const capacity = Number(lesson?.capacity ?? 0)
  const bookedCount = Number(lesson?.bookedCount ?? 0)
  if (!Number.isFinite(capacity) || capacity <= 0) {
    return text('teacher.groups.status.full', '마감')
  }
  if (Number.isFinite(bookedCount) && bookedCount >= capacity) {
    return text('teacher.groups.status.full', '마감')
  }
  return text('teacher.groups.status.open', '예약 가능')
}

function getLessonBookableBadgeLabel(lesson, text = (_key, fallback) => fallback) {
  return lesson?.isBookable === true
    ? text('teacher.calendar.studentBookingEnabled', '학생 직접 예약: 가능')
    : text('teacher.calendar.studentBookingDisabled', '학생 직접 예약: 비활성')
}

function isPastGroupLessonForAdmin(lesson) {
  const date = String(lesson?.date || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < getTodayStorageDateString()
}

function getGroupLessonAttendanceActionLabel(lesson) {
  return isPastGroupLessonForAdmin(lesson) ? '출결/차감' : '자리 공개 관리'
}

function getLessonCapacityLabel(lesson, seatAvailability) {
  if (seatAvailability) return `${seatAvailability.guestReservedCount} / ${seatAvailability.capacity}`
  const capacity = Number(lesson?.capacity ?? 0)
  const bookedCount = Number(lesson?.bookedCount ?? 0)
  const safeCapacity = Number.isFinite(capacity) && capacity >= 0 ? capacity : 0
  const safeBooked = Number.isFinite(bookedCount) && bookedCount >= 0 ? bookedCount : 0
  return `${safeBooked} / ${safeCapacity}`
}

function getGroupStudentStudentId(row) {
  return String(row?.studentId || '').trim()
}

function getGroupStudentGroupId(row) {
  return String(row?.groupClassId || row?.classID || '').trim()
}

function getReservationStudentName(row) {
  return String(row?.studentName || row?.name || '-').trim() || '-'
}

function getReservationStatusLabel(status, text = (_key, fallback) => fallback) {
  return status === 'active'
    ? text('teacher.groups.reservation.completed', '예약 완료')
    : text('teacher.groups.reservation.cancelled', '예약 취소')
}

function getReservationSourceLabel(source, text = (_key, fallback) => fallback) {
  return source === 'student'
    ? text('teacher.groups.reservation.student', '학생 예약')
    : text('teacher.groups.reservation.admin', '관리자 예약')
}

function getGroupClassStatusLabel(status) {
  const value = String(status || 'active').trim()
  if (value === 'active') return 'active'
  if (value === 'inactive') return 'inactive'
  if (value === 'closed') return 'closed'
  return value || 'active'
}

function countActiveGroupStudents(rows) {
  return (Array.isArray(rows) ? rows : []).filter(
    (row) => String(row?.status || 'active').trim() === 'active'
  ).length
}

export default function GroupsSection({
  sectionTitle = '단체반 관리',
  canManageGroupClasses,
  canDeleteGroupClasses = false,
  busyGroupId,
  groupClassesLoading,
  openGroupAddModal,
  sortedGroupClasses,
  setSelectedGroupClass,
  selectedGroupClass,
  openGroupEditModal,
  handleDeleteGroup,
  canAddStudent,
  openGroupStudentAddModal,
  busyGroupStudentId,
  groupStudentsLoading,
  canUseDirectLessonCreation,
  busyGroupLessonId,
  busyGroupLessonSeries,
  groupLessonsLoading,
  openGroupLessonAddModal,
  openGroupLessonSeriesModal,
  isAdmin,
  canViewPaymentFields = false,
  openGroupLessonPurgeModal,
  busyGroupLessonPurge,
  teacherSelectOptions = [],
  sortedGroupStudentsForSelectedClass,
  handleRemoveGroupStudent,
  sortedGroupLessonsForSelectedClass,
  groupLessonReservations,
  groupLessonReservationsLoading,
  groupLessonSeatAvailabilityById = {},
  groupReservationModal,
  busyGroupReservationId,
  canManageGroupReservations,
  openGroupLessonReservationAddModal,
  openGroupLessonReservationViewModal,
  closeGroupLessonReservationModal,
  reserveGroupLessonSeat,
  cancelGroupLessonSeat,
  busyGroupAttendanceStudentId,
  canManageAttendance,
  openGroupLessonAttendanceModal,
  canEditLesson,
  openGroupLessonEditModal,
  openGroupLessonNoDeductionCancelModal,
  canDeleteLesson,
  handleDeleteGroupLesson,
  getGroupStudentDisplayName,
  openGroupStudentManageModal,
  busyGroupStudentManageId,
  requiresLessonApproval,
  teacherPortal = false,
}) {
  const { t } = useTranslation()
  const reservationDialogRef = useRef(null)
  const reservationCloseRef = useRef(null)
  const text = (key, fallback, values) => (teacherPortal ? t(key, values) : fallback)
  const groupStatusLabel = (status) => {
    const raw = getGroupClassStatusLabel(status)
    if (!teacherPortal) return raw
    const keyByStatus = {
      active: 'teacher.groups.status.active',
      inactive: 'teacher.groups.status.inactive',
      closed: 'teacher.groups.status.closed',
    }
    return keyByStatus[raw] ? t(keyByStatus[raw]) : raw
  }
  const courseTypeLabel = (value) => {
    const raw = getGroupCourseTypeLabel(value)
    if (!teacherPortal) return raw
    const keyByCourse = {
      '일반 영어회화': 'teacher.groups.course.general',
      '초급 영어회화': 'teacher.groups.course.beginner',
      '중급 영어회화': 'teacher.groups.course.intermediate',
      '고급 영어회화': 'teacher.groups.course.advanced',
      '시험/특강': 'teacher.groups.course.special',
    }
    return keyByCourse[raw] ? t(keyByCourse[raw]) : raw
  }
  const weekdayDisplay = (weekdays) => {
    const raw = formatGroupWeekdaysDisplay(weekdays)
    if (!teacherPortal) return raw
    const keyByDay = {
      일: 'teacher.calendar.weekday.sun',
      월: 'teacher.calendar.weekday.mon',
      화: 'teacher.calendar.weekday.tue',
      수: 'teacher.calendar.weekday.wed',
      목: 'teacher.calendar.weekday.thu',
      금: 'teacher.calendar.weekday.fri',
      토: 'teacher.calendar.weekday.sat',
    }
    return raw
      .split(', ')
      .map((day) => (keyByDay[day] ? t(keyByDay[day]) : day))
      .join(', ')
  }
  const reservationActionBusy = Boolean(busyGroupReservationId)
  const modalLesson = groupReservationModal?.lesson
  const modalLessonSeatAvailability =
    modalLesson?.id ? groupLessonSeatAvailabilityById[modalLesson.id] || null : null
  const modalLessonActiveReservations = Array.isArray(groupLessonReservations)
    ? groupLessonReservations.filter(
        (reservation) => reservation.lessonId === modalLesson?.id && reservation.status === 'active'
      )
    : []
  const modalLessonReservations = Array.isArray(groupLessonReservations)
    ? groupLessonReservations.filter((reservation) => reservation.lessonId === modalLesson?.id)
    : []
  const modalActiveStudentIds = new Set(
    modalLessonActiveReservations.map((reservation) => String(reservation.studentId || '').trim())
  )
  const activeFixedStudentCount = countActiveGroupStudents(sortedGroupStudentsForSelectedClass)
  const selectedGroupCapacitySummary = selectedGroupClass
    ? getGroupClassBookingCapacitySummary({
        maxStudents: selectedGroupClass.maxStudents,
        activeFixedMemberCount: activeFixedStudentCount,
      })
    : null
  const modalLessonDate = String(modalLesson?.date || '').trim()
  const modalFixedMemberStudentIds = new Set(
    Array.isArray(sortedGroupStudentsForSelectedClass)
      ? sortedGroupStudentsForSelectedClass
          .filter((row) => {
            const studentId = getGroupStudentStudentId(row)
            return (
              studentId &&
              String(row.status || 'active') === 'active' &&
              getGroupStudentGroupId(row) === selectedGroupClass?.id &&
              isGroupStudentOperationallyEligibleOnYmd(row, modalLessonDate)
            )
          })
          .map((row) => getGroupStudentStudentId(row))
      : []
  )
  const modalCandidateGroupStudents = Array.isArray(sortedGroupStudentsForSelectedClass)
    ? sortedGroupStudentsForSelectedClass.filter((row) => {
        const studentId = getGroupStudentStudentId(row)
        return (
          studentId &&
          String(row.status || 'active') === 'active' &&
          getGroupStudentGroupId(row) === selectedGroupClass?.id &&
          !modalActiveStudentIds.has(studentId) &&
          !modalFixedMemberStudentIds.has(studentId)
        )
      })
    : []

  useEffect(() => {
    if (!groupReservationModal || !modalLesson) return undefined
    return installDialogFocusContainment({
      container: reservationDialogRef.current,
      initialFocus: reservationCloseRef.current,
      onClose: closeGroupLessonReservationModal,
    })
  }, [closeGroupLessonReservationModal, groupReservationModal, modalLesson])

  return (
  <section
    className={`activity-section${teacherPortal ? ' teacher-groups-section' : ''}`}
    data-testid={teacherPortal ? 'teacher-groups-section' : undefined}
  >
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
      <h2 className="section-title" style={{ margin: 0 }}>
        {teacherPortal ? t('nav.groups.teacher') : sectionTitle}
      </h2>
      {canManageGroupClasses ? (
        <button
          type="button"
          onClick={openGroupAddModal}
          disabled={busyGroupId === '__add__' || groupClassesLoading}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid #444',
            background: '#1f2a44',
            color: 'white',
            cursor:
              busyGroupId === '__add__' || groupClassesLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {busyGroupId === '__add__' ? '만드는 중...' : '정규반 만들기'}
        </button>
      ) : null}
    </div>

    {groupClassesLoading ? (
      <p>{text('teacher.groups.loading', '불러오는 중...')}</p>
    ) : sortedGroupClasses.length === 0 ? (
      <p style={{ opacity: 0.8 }}>{text('teacher.groups.empty', '등록된 반이 없습니다.')}</p>
    ) : (
      <>
        <div
          className={`activity-table${teacherPortal ? ' teacher-responsive-table teacher-group-cards' : ''}`}
          data-testid={teacherPortal ? 'teacher-group-card-list' : undefined}
        >
          <div
            className="table-head"
            style={{
              gridTemplateColumns: '1.2fr 1.2fr 1fr 0.9fr 0.8fr minmax(140px, auto)',
            }}
          >
            <span>{text('teacher.groups.header.name', '이름')}</span>
            <span>{text('teacher.common.teacher', '선생님')}</span>
            <span>{text('teacher.groups.header.courseType', '코스 유형')}</span>
            <span>{text('teacher.groups.header.capacity', '최대 인원')}</span>
            <span>{text('teacher.common.status', '상태')}</span>
            <span>{text('teacher.common.actions', '작업')}</span>
          </div>

          {sortedGroupClasses.map((group) => {
            const rowBusy = busyGroupId === group.id
            const isSelected = selectedGroupClass?.id === group.id

            return (
              <div
                key={group.id}
                role="button"
                tabIndex={0}
                className="table-row"
                data-testid="group-row"
                data-group-name={group.name || ''}
                onClick={() => setSelectedGroupClass(group)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelectedGroupClass(group)
                  }
                }}
                style={{
                  gridTemplateColumns: '1.2fr 1.2fr 1fr 0.9fr 0.8fr minmax(140px, auto)',
                  cursor: 'pointer',
                  outline: isSelected ? '2px solid #6b8cff' : undefined,
                  outlineOffset: -2,
                }}
              >
                <span data-label={text('teacher.groups.header.name', '이름')}>
                  {group.name || '-'}
                </span>
                <span data-label={text('teacher.common.teacher', '선생님')}>
                  {resolveTeacherDisplayName(
                    group,
                    teacherSelectOptions,
                    text('teacher.groups.teacherRequired', '선생님 선택 필요')
                  )}
                </span>
                <span data-label={text('teacher.groups.header.courseType', '코스 유형')}>
                  {courseTypeLabel(group.groupCourseType) || '-'}
                </span>
                <span data-label={text('teacher.groups.header.capacity', '최대 인원')}>
                  {group.maxStudents ?? '-'}
                </span>
                <span data-label={text('teacher.common.status', '상태')}>
                  {groupStatusLabel(group.status)}
                </span>
                <span
                  data-label={text('teacher.common.actions', '작업')}
                  className={teacherPortal ? 'teacher-card-actions' : undefined}
                  style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                >
                  {canManageGroupClasses ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        openGroupEditModal(group)
                      }}
                      disabled={rowBusy || busyGroupId === '__add__'}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #555',
                        background: '#1f2a44',
                        color: 'white',
                        cursor: rowBusy || busyGroupId === '__add__' ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {rowBusy ? '처리 중...' : '수정'}
                    </button>
                  ) : null}
                  {canDeleteGroupClasses ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteGroup(group)
                      }}
                      disabled={rowBusy || busyGroupId === '__add__'}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid #553333',
                        background: '#4a2a2a',
                        color: 'white',
                        cursor: rowBusy || busyGroupId === '__add__' ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {rowBusy ? '처리 중...' : '반 운영 종료'}
                    </button>
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>

        {!selectedGroupClass && sortedGroupClasses.length > 0 ? (
          <p style={{ marginTop: 16, opacity: 0.75, fontSize: 13 }}>
            {text(
              'teacher.groups.selectPrompt',
              '반을 선택하면 학생과 수업 일정을 관리할 수 있습니다.'
            )}
          </p>
        ) : null}

        {selectedGroupClass ? (
          <div
            data-testid="group-students-section"
            style={{
              marginTop: 24,
              padding: 20,
              borderRadius: 12,
              border: '1px solid #2e3240',
              background: '#151922',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
              {text(
                'teacher.groups.rosterTitle',
                `반 등록 학생 — ${selectedGroupClass.name || '-'}`,
                { name: selectedGroupClass.name || '-' }
              )}
            </h3>
            <p style={{ margin: '8px 0 0 0', opacity: 0.78, fontSize: 13 }}>
              {text('teacher.groups.assignedTeacher', '담당 선생님')} {resolveTeacherDisplayName(
                selectedGroupClass,
                teacherSelectOptions,
                text('teacher.groups.teacherRequired', '선생님 선택 필요')
              )} · {text(
                'teacher.groups.capacity',
                `정원 ${selectedGroupCapacitySummary?.capacity ?? selectedGroupClass.maxStudents ?? '-'}명`,
                { count: selectedGroupCapacitySummary?.capacity ?? selectedGroupClass.maxStudents ?? '-' }
              )} · {text(
                'teacher.groups.registeredCount',
                `반 등록 ${selectedGroupCapacitySummary?.fixedMemberCount ?? activeFixedStudentCount}명`,
                { count: selectedGroupCapacitySummary?.fixedMemberCount ?? activeFixedStudentCount }
              )} · {text(
                'teacher.groups.fcfsRemaining',
                `선착순 가능 ${selectedGroupCapacitySummary?.fcfsRemainingSeats ?? '-'}명`,
                { count: selectedGroupCapacitySummary?.fcfsRemainingSeats ?? '-' }
              )} · {text('teacher.common.status', '상태')} {groupStatusLabel(selectedGroupClass.status)}
            </p>
            <p style={{ margin: '6px 0 0 0', opacity: 0.68, fontSize: 12 }}>
              {text(
                'teacher.groups.rosterDescription',
                '단체반 수강권 발급 시 자동 등록되는 학생 목록입니다.'
              )}
            </p>
            <p style={{ margin: '6px 0 0 0', opacity: 0.68, fontSize: 12 }}>
              {text('teacher.groups.defaultTime', '기본 시간')} {selectedGroupClass.time || '—'} ·{' '}
              {text('teacher.groups.lessonName', '수업 표시명')}{' '}
              {resolveGroupLessonSubject({
                subject: selectedGroupClass.subject,
                groupClassName: selectedGroupClass.name,
                groupCourseType: selectedGroupClass.groupCourseType,
              }) || '—'} · {text('teacher.groups.weekdays', '요일')}{' '}
              {weekdayDisplay(selectedGroupClass.weekdays) || '—'} ·{' '}
              {text('teacher.groups.course', '코스')}{' '}
              {courseTypeLabel(selectedGroupClass.groupCourseType) || '—'}
            </p>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                marginTop: 14,
                marginBottom: 16,
                alignItems: 'center',
              }}
            >
              {canAddStudent ? (
                <button
                  type="button"
                  onClick={openGroupStudentAddModal}
                  disabled={
                    busyGroupStudentId === '__add__' ||
                    groupStudentsLoading ||
                    busyGroupId === '__add__' ||
                    busyGroupId === selectedGroupClass.id
                  }
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: '1px solid #444',
                    background: '#1f2a44',
                    color: 'white',
                    cursor:
                      busyGroupStudentId === '__add__' ||
                      groupStudentsLoading ||
                      busyGroupId === '__add__' ||
                      busyGroupId === selectedGroupClass.id
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                >
                  {busyGroupStudentId === '__add__' ? '등록 중...' : '학생 등록'}
                </button>
              ) : null}
              {canUseDirectLessonCreation ? (
                <button
                  type="button"
                  onClick={openGroupLessonAddModal}
                  disabled={
                    busyGroupLessonId === '__add__' ||
                    busyGroupLessonSeries ||
                    groupLessonsLoading ||
                    busyGroupId === '__add__' ||
                    busyGroupId === selectedGroupClass.id
                  }
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: '1px solid #444',
                    background: '#1f2a44',
                    color: 'white',
                    cursor:
                      busyGroupLessonId === '__add__' ||
                      busyGroupLessonSeries ||
                      groupLessonsLoading ||
                      busyGroupId === '__add__' ||
                      busyGroupId === selectedGroupClass.id
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                  title={requiresLessonApproval ? '승인 절차가 필요해 직접 수업 생성을 사용할 수 없습니다.' : undefined}
                >
                  {busyGroupLessonId === '__add__' ? '추가 중...' : '특별 수업 추가'}
                </button>
              ) : null}
              {canUseDirectLessonCreation ? (
                <button
                  type="button"
                  onClick={openGroupLessonSeriesModal}
                  disabled={
                    busyGroupLessonId === '__add__' ||
                    busyGroupLessonSeries ||
                    groupLessonsLoading ||
                    busyGroupId === '__add__' ||
                    busyGroupId === selectedGroupClass.id
                  }
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid #444',
                    background: 'transparent',
                    color: 'rgba(255,255,255,0.75)',
                    fontSize: 13,
                    cursor:
                      busyGroupLessonId === '__add__' ||
                      busyGroupLessonSeries ||
                      groupLessonsLoading ||
                      busyGroupId === '__add__' ||
                      busyGroupId === selectedGroupClass.id
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                  title={requiresLessonApproval ? '승인 절차가 필요해 직접 수업 생성을 사용할 수 없습니다.' : '관리자용: 기간을 지정해 일정을 추가로 만듭니다.'}
                >
                  {busyGroupLessonSeries ? '생성 중...' : '추가 일정 생성'}
                </button>
              ) : null}
              {isAdmin ? (
                <button
                  type="button"
                  onClick={openGroupLessonPurgeModal}
                  disabled={
                    busyGroupLessonPurge ||
                    busyGroupLessonId === '__add__' ||
                    busyGroupLessonSeries ||
                    groupLessonsLoading ||
                    busyGroupId === '__add__' ||
                    busyGroupId === selectedGroupClass.id
                  }
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid #664444',
                    background: '#3a2525',
                    color: 'rgba(255, 230, 230, 0.95)',
                    fontSize: 13,
                    cursor:
                      busyGroupLessonPurge ||
                      busyGroupLessonId === '__add__' ||
                      busyGroupLessonSeries ||
                      groupLessonsLoading ||
                      busyGroupId === '__add__' ||
                      busyGroupId === selectedGroupClass.id
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                  title="기준일 이후(당일 포함)의 이 반 수업 일정만 삭제합니다. 관리자 전용입니다."
                >
                  {busyGroupLessonPurge ? '처리 중...' : '이후 일정 삭제'}
                </button>
              ) : null}
            </div>
            <p style={{ margin: '-8px 0 16px 0', fontSize: 11, opacity: 0.6, lineHeight: 1.45 }}>
              {canUseDirectLessonCreation
                ? '특별 수업 추가: 보강·특강 등 날짜 한 건 · 추가 일정 생성: 관리자용으로 기간을 정해 같은 규칙으로 일정을 더 만듭니다.'
                : text(
                    'teacher.groups.readOnlyHelp',
                    '학생 등록과 수강권 관리는 관리자에게 요청해 주세요.'
                  )}
              {canAddStudent
                ? ' · 반 등록 학생은 단체반 수강권 발급으로 자동 등록됩니다. 아래 학생 등록은 예외 처리용입니다.'
                : ''}
              {isAdmin ? ' · 이후 일정 삭제: 폐강·일정 정리 시 기준일 이후 일정만 일괄 삭제(관리자).' : ''}
            </p>

            {groupStudentsLoading ? (
              <p style={{ opacity: 0.85 }}>
                {text('teacher.groups.rosterLoading', '학생 목록 불러오는 중...')}
              </p>
            ) : sortedGroupStudentsForSelectedClass.length === 0 ? (
              <p style={{ opacity: 0.8 }}>
                {text(
                  'teacher.groups.rosterEmpty',
                  '아직 반 등록 학생이 없습니다.'
                )}
              </p>
            ) : (
              <div
                className={`activity-table${teacherPortal ? ' teacher-responsive-table teacher-student-cards' : ''}`}
                data-testid={teacherPortal ? 'teacher-student-card-list' : undefined}
              >
                <div
                  className="table-head"
                  style={{
                    gridTemplateColumns:
                      '1.1fr 0.75fr 0.75fr 1fr minmax(200px, auto)',
                  }}
                >
                  <span>{text('teacher.groups.header.registeredStudent', '반 등록 학생')}</span>
                  <span>{text('teacher.groups.header.attendanceCount', '출석/차감 횟수')}</span>
                  <span>{canViewPaymentFields ? '결제 횟수' : text('teacher.groups.header.totalCount', '총 횟수')}</span>
                  <span>{text('teacher.groups.header.startDate', '반 등록 시작일')}</span>
                  <span>{text('teacher.common.actions', '작업')}</span>
                </div>

                {sortedGroupStudentsForSelectedClass.map((gs) => {
                  const gsBusy = busyGroupStudentId === gs.id
                  const manageBusy = busyGroupStudentManageId === gs.id
                  const paid = Number(gs.paidLessons ?? 0)
                  const attended = Number(gs.attendanceCount ?? 0)
                  const rowActionDisabled =
                    gsBusy ||
                    manageBusy ||
                    busyGroupStudentId === '__add__' ||
                    busyGroupId === '__add__' ||
                    busyGroupId === selectedGroupClass.id

                  return (
                    <div
                      key={gs.id}
                      className="table-row"
                      data-testid="group-student-row"
                      data-student-name={getGroupStudentDisplayName(gs)}
                      style={{
                        gridTemplateColumns:
                          '1.1fr 0.75fr 0.75fr 1fr minmax(200px, auto)',
                      }}
                    >
                      <span data-label={text('teacher.groups.header.registeredStudent', '반 등록 학생')}>
                        {getGroupStudentDisplayName(gs)}
                      </span>
                      <span data-label={text('teacher.groups.header.attendanceCount', '출석/차감 횟수')}>
                        {attended}
                      </span>
                      <span data-label={text('teacher.groups.header.totalCount', '총 횟수')}>
                        {paid}
                      </span>
                      <span data-label={text('teacher.groups.header.startDate', '반 등록 시작일')}>
                        {formatGroupStudentStartDate(gs.startDate)}
                      </span>
                      <span
                        data-label={text('teacher.common.actions', '작업')}
                        className={teacherPortal ? 'teacher-card-actions' : undefined}
                        style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
                      >
                        {isAdmin ? (
                          <button
                            type="button"
                            onClick={() => openGroupStudentManageModal(gs)}
                            disabled={rowActionDisabled}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: '1px solid #335566',
                              background: '#2a3548',
                              color: 'white',
                              cursor: rowActionDisabled ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {manageBusy ? '저장 중...' : '관리'}
                          </button>
                        ) : null}
                        {isAdmin ? (
                          <button
                            type="button"
                            onClick={() => handleRemoveGroupStudent(gs)}
                            disabled={rowActionDisabled}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: '1px solid #553333',
                              background: '#4a2a2a',
                              color: 'white',
                              cursor: rowActionDisabled ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {gsBusy ? '처리 중...' : '제거'}
                          </button>
                        ) : null}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            <div style={{ height: 20 }} />

            <div data-testid="group-lessons-section">
              <div style={{ marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                  {text('teacher.groups.scheduleTitle', '수업 일정')}
                </h3>
                <p style={{ margin: '6px 0 0 0', opacity: 0.75, fontSize: 13 }}>
                  {text(
                    'teacher.groups.scheduleDescription',
                    '이 반에서 실제로 진행되는 날짜별 수업입니다.'
                  )}
                </p>
              </div>

              {groupLessonsLoading ? (
                <p style={{ opacity: 0.85 }}>
                  {text('teacher.groups.scheduleLoading', '수업 일정을 불러오는 중...')}
                </p>
              ) : sortedGroupLessonsForSelectedClass.length === 0 ? (
                <p style={{ opacity: 0.8 }}>
                  {text('teacher.groups.scheduleEmpty', '등록된 수업 일정이 없습니다.')}
                </p>
              ) : (
                <div
                  className={`activity-table${teacherPortal ? ' teacher-responsive-table teacher-group-lesson-cards' : ''}`}
                  data-testid={teacherPortal ? 'teacher-group-lesson-card-list' : undefined}
                >
                  <div
                    className="table-head"
                    style={{
                      gridTemplateColumns: '0.9fr 0.6fr 1fr 1fr 1.6fr 0.75fr minmax(260px, auto)',
                    }}
                  >
                    <span>{text('teacher.common.date', '날짜')}</span>
                    <span>{text('teacher.common.time', '시간')}</span>
                    <span>{text('teacher.common.subject', '과목')}</span>
                    <span>{text('teacher.groups.header.courseType', '코스 유형')}</span>
                    <span>{text('teacher.groups.header.capacity', '정원')}</span>
                    <span>{text('teacher.groups.header.reservationStatus', '예약 상태')}</span>
                    <span>{text('teacher.common.actions', '작업')}</span>
                  </div>

                  {sortedGroupLessonsForSelectedClass.map((gl) => {
                    const rowBusy = busyGroupLessonId === gl.id
                    const isNoDeductionCancelled = isNoDeductionCancelledGroupLesson(gl)
                    const seatAvailability = groupLessonSeatAvailabilityById[gl.id] || null
                    const reservationStatusLabel = getLessonReservationStatusLabel(
                      gl,
                      seatAvailability,
                      text
                    )
                    const bookableBadgeLabel = getLessonBookableBadgeLabel(gl, text)
                    const lessonSubject = resolveGroupLessonSubject({
                      subject: gl.subject,
                      groupClassName: gl.groupClassName || selectedGroupClass.name,
                      groupCourseType: gl.groupCourseType || selectedGroupClass.groupCourseType,
                    })
                    const attendanceBusyThisLesson =
                      Boolean(busyGroupAttendanceStudentId) &&
                      busyGroupAttendanceStudentId.startsWith(`${gl.id}__`)
                    return (
                      <div
                        key={gl.id}
                        className="table-row"
                        data-testid="group-lesson-row"
                        data-lesson-id={gl.id || ''}
                        data-lesson-date={gl.date || ''}
                        data-lesson-time={gl.time || ''}
                        data-lesson-subject={lessonSubject}
                        style={{
                          gridTemplateColumns: '0.9fr 0.6fr 1fr 1fr 1.6fr 0.75fr minmax(260px, auto)',
                        }}
                      >
                        <span data-label={text('teacher.common.date', '날짜')}>{gl.date || '-'}</span>
                        <span data-label={text('teacher.common.time', '시간')}>{gl.time || '-'}</span>
                        <span data-label={text('teacher.common.subject', '과목')}>{lessonSubject || '-'}</span>
                        <span data-label={text('teacher.groups.header.courseType', '코스 유형')}>
                          {courseTypeLabel(gl.groupCourseType) || '-'}
                        </span>
                        <span
                          data-label={text('teacher.groups.header.capacity', '정원')}
                          data-testid="group-lesson-seat-summary"
                          style={{ display: 'grid', gap: 3, fontSize: 12, lineHeight: 1.35 }}
                        >
                          <span>{text('teacher.groups.capacity', `정원 ${seatAvailability?.capacity ?? Number(gl.capacity ?? 0)}명`, { count: seatAvailability?.capacity ?? Number(gl.capacity ?? 0) })}</span>
                          <span data-testid="group-lesson-fixed-attending-count">
                            {text('teacher.groups.fixedAttending', `반 등록 참석 예정 ${seatAvailability?.fixedAttendingCount ?? '-'}명`, { count: seatAvailability?.fixedAttendingCount ?? '-' })}
                          </span>
                          <span data-testid="group-lesson-released-seat-count">
                            {text('teacher.groups.releasedSeats', `반 등록 자리 공개 ${seatAvailability?.releasedFixedSeatCount ?? '-'}명`, { count: seatAvailability?.releasedFixedSeatCount ?? '-' })}
                          </span>
                          <span data-testid="group-lesson-guest-reserved-count">
                            {text('teacher.groups.guestReserved', `자유 예약 ${seatAvailability?.guestReservedCount ?? Number(gl.bookedCount ?? 0)}명`, { count: seatAvailability?.guestReservedCount ?? Number(gl.bookedCount ?? 0) })}
                          </span>
                          <span data-testid="group-lesson-remaining-seats">
                            {text('teacher.groups.remainingSeats', `남은 자리 ${seatAvailability?.remainingSeats ?? '-'}명`, { count: seatAvailability?.remainingSeats ?? '-' })}
                          </span>
                        </span>
                        <span
                          data-label={text('teacher.groups.header.reservationStatus', '예약 상태')}
                          style={{ display: 'grid', gap: 3 }}
                        >
                          <span>{text('teacher.groups.seat', `좌석: ${reservationStatusLabel}`, { status: reservationStatusLabel })}</span>
                          <span
                            data-testid="group-lesson-bookable-badge"
                            style={{
                              width: 'fit-content',
                              padding: '2px 7px',
                              borderRadius: 999,
                              border:
                                gl.isBookable === true
                                  ? '1px solid #4c7a5c'
                                  : '1px solid #665044',
                              background:
                                gl.isBookable === true
                                  ? 'rgba(52, 110, 70, 0.28)'
                                  : 'rgba(90, 65, 45, 0.28)',
                              color: gl.isBookable === true ? '#bde8c7' : '#f0c7a8',
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            {bookableBadgeLabel}
                          </span>
                          {isNoDeductionCancelled ? (
                            <span style={{ fontSize: 12, color: '#f1d38a', fontWeight: 700 }}>
                              {text('teacher.groups.noDeduction', '차감 없음')}
                            </span>
                          ) : null}
                        </span>
                        <span
                          data-label={text('teacher.common.actions', '작업')}
                          className={teacherPortal ? 'teacher-card-actions' : undefined}
                          style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                        >
                          <span
                            data-testid="group-lesson-action-seat-label"
                            style={{
                              alignSelf: 'center',
                              padding: '4px 8px',
                              borderRadius: 999,
                              border: '1px solid #3c4f68',
                              background: '#182234',
                              color: '#dbe8ff',
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            {text('teacher.groups.seat', `좌석: ${reservationStatusLabel}`, { status: reservationStatusLabel })}
                          </span>
                          <span
                            data-testid="group-lesson-action-bookable-label"
                            style={{
                              alignSelf: 'center',
                              padding: '4px 8px',
                              borderRadius: 999,
                              border:
                                gl.isBookable === true
                                  ? '1px solid #4c7a5c'
                                  : '1px solid #665044',
                              background:
                                gl.isBookable === true
                                  ? 'rgba(52, 110, 70, 0.28)'
                                  : 'rgba(90, 65, 45, 0.28)',
                              color: gl.isBookable === true ? '#bde8c7' : '#f0c7a8',
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            {bookableBadgeLabel}
                          </span>
                          {canManageGroupReservations ? (
                            <button
                              type="button"
                              onClick={() => openGroupLessonReservationAddModal(gl)}
                              disabled={
                                rowBusy ||
                                busyGroupReservationId?.startsWith(`${gl.id}__`) ||
                                gl.isBookable !== true ||
                                reservationStatusLabel !== '예약 가능' ||
                                groupLessonReservationsLoading ||
                                busyGroupLessonId === '__add__' ||
                                busyGroupId === '__add__' ||
                                busyGroupId === selectedGroupClass.id
                              }
                              data-testid="group-lesson-reserve-add-button"
                              style={{
                                padding: '6px 10px',
                                borderRadius: 8,
                                border: '1px solid #445c36',
                                background: '#20351f',
                                color: 'white',
                                cursor:
                                  rowBusy ||
                                  busyGroupReservationId?.startsWith(`${gl.id}__`) ||
                                  reservationStatusLabel !== '예약 가능' ||
                                  groupLessonReservationsLoading ||
                                  busyGroupLessonId === '__add__' ||
                                  busyGroupId === '__add__' ||
                                  busyGroupId === selectedGroupClass.id
                                    ? 'not-allowed'
                                    : 'pointer',
                              }}
                            >
                              예약 추가
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => openGroupLessonReservationViewModal(gl)}
                            disabled={groupLessonReservationsLoading}
                            data-testid="group-lesson-reserve-view-button"
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: '1px solid #454955',
                              background: '#252936',
                              color: 'white',
                              cursor: groupLessonReservationsLoading ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {text('teacher.groups.viewReservations', '예약 보기')}
                          </button>
                          {canManageAttendance ? (
                            <button
                              type="button"
                              onClick={() => openGroupLessonAttendanceModal(gl)}
                              disabled={
                                rowBusy ||
                                attendanceBusyThisLesson ||
                                busyGroupLessonId === '__add__' ||
                                busyGroupId === '__add__' ||
                                busyGroupId === selectedGroupClass.id
                              }
                              style={{
                                padding: '6px 10px',
                                borderRadius: 8,
                                border: '1px solid #335555',
                                background: '#1a3338',
                                color: 'white',
                                cursor:
                                  rowBusy ||
                                  attendanceBusyThisLesson ||
                                  busyGroupLessonId === '__add__' ||
                                  busyGroupId === '__add__' ||
                                  busyGroupId === selectedGroupClass.id
                                    ? 'not-allowed'
                                    : 'pointer',
                              }}
                            >
                              {attendanceBusyThisLesson ? '처리 중' : getGroupLessonAttendanceActionLabel(gl)}
                            </button>
                          ) : null}
                          {isAdmin && canEditLesson && !isNoDeductionCancelled ? (
                            <button
                              type="button"
                              onClick={() => openGroupLessonNoDeductionCancelModal(gl)}
                              title="자리 공개가 아니라 이 회차 전체를 차감 없이 닫습니다."
                              disabled={
                                rowBusy ||
                                busyGroupLessonId === '__add__' ||
                                busyGroupId === '__add__' ||
                                busyGroupId === selectedGroupClass.id
                              }
                              style={{
                                padding: '6px 10px',
                                borderRadius: 8,
                                border: '1px solid #665533',
                                background: '#3a321f',
                                color: '#ffe8b8',
                                cursor:
                                  rowBusy ||
                                  busyGroupLessonId === '__add__' ||
                                  busyGroupId === '__add__' ||
                                  busyGroupId === selectedGroupClass.id
                                    ? 'not-allowed'
                                    : 'pointer',
                              }}
                            >
                              수업 전체 휴강
                            </button>
                          ) : null}
                          {canEditLesson ? (
                            <button
                              type="button"
                              onClick={() => openGroupLessonEditModal(gl)}
                              disabled={
                                rowBusy ||
                                busyGroupLessonId === '__add__' ||
                                busyGroupId === '__add__' ||
                                busyGroupId === selectedGroupClass.id
                              }
                              style={{
                                padding: '6px 10px',
                                borderRadius: 8,
                                border: '1px solid #555',
                                background: '#1f2a44',
                                color: 'white',
                                cursor:
                                  rowBusy ||
                                  busyGroupLessonId === '__add__' ||
                                  busyGroupId === '__add__' ||
                                  busyGroupId === selectedGroupClass.id
                                    ? 'not-allowed'
                                    : 'pointer',
                              }}
                            >
                              {rowBusy ? '처리 중...' : '수정'}
                            </button>
                          ) : null}
                          {canDeleteLesson ? (
                            <button
                              type="button"
                              onClick={() => handleDeleteGroupLesson(gl)}
                              disabled={
                                rowBusy ||
                                busyGroupLessonId === '__add__' ||
                                busyGroupId === '__add__' ||
                                busyGroupId === selectedGroupClass.id
                              }
                              style={{
                                padding: '6px 10px',
                                borderRadius: 8,
                                border: '1px solid #553333',
                                background: '#4a2a2a',
                                color: 'white',
                                cursor:
                                  rowBusy ||
                                  busyGroupLessonId === '__add__' ||
                                  busyGroupId === '__add__' ||
                                  busyGroupId === selectedGroupClass.id
                                    ? 'not-allowed'
                                    : 'pointer',
                              }}
                            >
                              {rowBusy ? '처리 중...' : '삭제'}
                            </button>
                          ) : null}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </>
    )}
    {groupReservationModal && modalLesson ? (
      <div
        role="presentation"
        data-testid="group-reservation-modal"
        className="teacher-dialog-backdrop"
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
          if (e.target === e.currentTarget && !reservationActionBusy) {
            closeGroupLessonReservationModal()
          }
        }}
      >
        <div
          ref={reservationDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="group-reservation-modal-title"
          tabIndex={-1}
          className="teacher-dialog-panel"
          style={{
            width: '100%',
            maxWidth: 620,
            maxHeight: '88vh',
            overflowY: 'auto',
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
            id="group-reservation-modal-title"
            style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
          >
            {groupReservationModal.type === 'add'
              ? '예약 추가'
              : text('teacher.groups.modal.title', '예약 보기')}
          </h2>
          <p style={{ margin: '0 0 16px 0', fontSize: 13, opacity: 0.8 }}>
            {[
              modalLesson.date,
              modalLesson.time,
              resolveGroupLessonSubject({
                subject: modalLesson.subject,
                groupClassName: modalLesson.groupClassName || selectedGroupClass?.name,
                groupCourseType: modalLesson.groupCourseType || selectedGroupClass?.groupCourseType,
              }),
            ].filter(Boolean).join(' · ')}
            {' '}· {text('teacher.groups.capacity', `정원 ${getLessonCapacityLabel(modalLesson, modalLessonSeatAvailability)}`, { count: getLessonCapacityLabel(modalLesson, modalLessonSeatAvailability) })}
            {modalLessonSeatAvailability
              ? ` · ${text('teacher.groups.modal.remaining', `남은 자리 ${modalLessonSeatAvailability.remainingSeats}명`, { count: modalLessonSeatAvailability.remainingSeats })}`
              : ''}
          </p>

          {groupReservationModal.type === 'add' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {modalCandidateGroupStudents.length === 0 ? (
                <p style={{ margin: 0, opacity: 0.78, fontSize: 13 }}>
                  예약 가능한 active 등록 학생이 없습니다.
                </p>
              ) : (
                modalCandidateGroupStudents.map((row) => {
                  const studentId = getGroupStudentStudentId(row)
                  const busyKey = `${modalLesson.id}__${studentId}__reserve`
                  const isBusy = busyGroupReservationId === busyKey
                  return (
                    <div
                      key={row.id}
                      data-testid="group-reservation-candidate-row"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 0',
                        borderBottom: '1px solid #252a36',
                      }}
                    >
                      <span>
                        {getReservationStudentName(row)}
                        <span style={{ opacity: 0.65, fontSize: 12 }}>
                          {' '}· 시작일 {formatGroupStudentStartDate(row)}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => reserveGroupLessonSeat({ lesson: modalLesson, groupStudentRow: row })}
                        disabled={reservationActionBusy}
                        data-testid="group-reservation-confirm-button"
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          border: '1px solid #445c36',
                          background: '#20351f',
                          color: 'white',
                          cursor: reservationActionBusy ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {isBusy ? '예약 중...' : '예약'}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {modalLessonReservations.length === 0 ? (
                <p style={{ margin: 0, opacity: 0.78, fontSize: 13 }}>
                  {text('teacher.groups.modal.empty', '예약 내역이 없습니다.')}
                </p>
              ) : (
                modalLessonReservations
                  .slice()
                  .sort((a, b) => String(a.studentName || '').localeCompare(String(b.studentName || ''), 'ko'))
                  .map((reservation) => {
                    const groupStudentRow = sortedGroupStudentsForSelectedClass.find(
                      (row) => getGroupStudentStudentId(row) === String(reservation.studentId || '').trim()
                    )
                    const isActive = reservation.status === 'active'
                    const busyKey = `${modalLesson.id}__${reservation.studentId}__cancel`
                    const isBusy = busyGroupReservationId === busyKey
                    return (
                      <div
                        key={reservation.id}
                        data-testid="group-reservation-row"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr auto auto',
                          alignItems: 'center',
                          gap: 10,
                          padding: '10px 0',
                          borderBottom: '1px solid #252a36',
                        }}
                      >
                        <span>{reservation.studentName || '-'}</span>
                        <span style={{ opacity: 0.75, fontSize: 13 }}>
                          {getReservationSourceLabel(reservation.source, text)}
                          {' · '}
                          {getReservationStatusLabel(reservation.status, text)}
                        </span>
                        {isActive && canManageGroupReservations && groupStudentRow ? (
                          <button
                            type="button"
                            onClick={() =>
                              cancelGroupLessonSeat({ lesson: modalLesson, groupStudentRow })
                            }
                            disabled={reservationActionBusy}
                            data-testid="group-reservation-cancel-button"
                            style={{
                              padding: '8px 12px',
                              borderRadius: 8,
                              border: '1px solid #553333',
                              background: '#4a2a2a',
                              color: 'white',
                              cursor: reservationActionBusy ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {isBusy ? '취소 중...' : '예약 취소'}
                          </button>
                        ) : (
                          <span />
                        )}
                      </div>
                    )
                  })
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
            <button
              ref={reservationCloseRef}
              type="button"
              onClick={closeGroupLessonReservationModal}
              disabled={Boolean(busyGroupReservationId)}
              style={{
                padding: '10px 16px',
                borderRadius: 8,
                border: '1px solid #555',
                background: 'transparent',
                color: 'white',
                cursor: busyGroupReservationId ? 'not-allowed' : 'pointer',
              }}
            >
              {text('teacher.common.close', '닫기')}
            </button>
          </div>
        </div>
      </div>
    ) : null}
  </section>
  );
}
