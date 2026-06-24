import {
  formatGroupStudentStartDate,
  formatGroupWeekdaysDisplay,
  isNoDeductionCancelledGroupLesson,
} from '../dashboardViewUtils.js'
import { getGroupCourseTypeLabel } from '../../group-booking/groupCourseTypes.js'

function getLessonReservationStatusLabel(lesson, seatAvailability) {
  if (isNoDeductionCancelledGroupLesson(lesson)) return '휴강'
  if (lesson?.isBookable !== true) return '비활성'
  if (seatAvailability) return seatAvailability.isFull ? '마감' : '예약 가능'
  const capacity = Number(lesson?.capacity ?? 0)
  const bookedCount = Number(lesson?.bookedCount ?? 0)
  if (!Number.isFinite(capacity) || capacity <= 0) return '비활성'
  if (Number.isFinite(bookedCount) && bookedCount >= capacity) return '마감'
  return '예약 가능'
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

function getReservationStatusLabel(status) {
  return status === 'active' ? '예약 완료' : '예약 취소'
}

function getReservationSourceLabel(source) {
  return source === 'student' ? '학생 예약' : '관리자 예약'
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
}) {
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
  const modalCandidateGroupStudents = Array.isArray(sortedGroupStudentsForSelectedClass)
    ? sortedGroupStudentsForSelectedClass.filter((row) => {
        const studentId = getGroupStudentStudentId(row)
        return (
          studentId &&
          String(row.status || 'active') === 'active' &&
          getGroupStudentGroupId(row) === selectedGroupClass?.id &&
          !modalActiveStudentIds.has(studentId)
        )
      })
    : []

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
      <h2 className="section-title" style={{ margin: 0 }}>
        {sectionTitle}
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
      <p>불러오는 중...</p>
    ) : sortedGroupClasses.length === 0 ? (
      <p style={{ opacity: 0.8 }}>등록된 반이 없습니다. 위에서 반을 만들 수 있습니다.</p>
    ) : (
      <>
        <div className="activity-table">
          <div
            className="table-head"
            style={{
              gridTemplateColumns: '1.2fr 1.2fr 1fr 0.9fr 0.8fr minmax(140px, auto)',
            }}
          >
            <span>이름</span>
            <span>선생님</span>
            <span>코스 유형</span>
            <span>최대 인원</span>
            <span>상태</span>
            <span>작업</span>
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
                <span>{group.name || '-'}</span>
                <span>{group.teacher || group.teacherName || '-'}</span>
                <span>{getGroupCourseTypeLabel(group.groupCourseType) || '-'}</span>
                <span>{group.maxStudents ?? '-'}</span>
                <span>{getGroupClassStatusLabel(group.status)}</span>
                <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
            반을 선택하면 학생과 수업 일정을 관리할 수 있습니다.
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
              등록 학생 — {selectedGroupClass.name || '-'}
            </h3>
            <p style={{ margin: '8px 0 0 0', opacity: 0.78, fontSize: 13 }}>
              담당 선생님 {selectedGroupClass.teacher || '-'} · 정원{' '}
              {activeFixedStudentCount} / {selectedGroupClass.maxStudents ?? '-'}명 · 상태{' '}
              {getGroupClassStatusLabel(selectedGroupClass.status)}
            </p>
            <p style={{ margin: '6px 0 0 0', opacity: 0.68, fontSize: 12 }}>
              기본 시간 {selectedGroupClass.time || '—'} · 과목{' '}
              {selectedGroupClass.subject || '—'} · 요일{' '}
              {formatGroupWeekdaysDisplay(selectedGroupClass.weekdays) || '—'} · 코스{' '}
              {getGroupCourseTypeLabel(selectedGroupClass.groupCourseType) || '—'}
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
                : '학생 등록과 수강권 관리는 관리자에게 요청해 주세요.'}
              {isAdmin ? ' · 이후 일정 삭제: 폐강·일정 정리 시 기준일 이후 일정만 일괄 삭제(관리자).' : ''}
            </p>

            {groupStudentsLoading ? (
              <p style={{ opacity: 0.85 }}>학생 목록 불러오는 중...</p>
            ) : sortedGroupStudentsForSelectedClass.length === 0 ? (
              <p style={{ opacity: 0.8 }}>이 반에 등록된 학생이 없습니다.</p>
            ) : (
              <div className="activity-table">
                <div
                  className="table-head"
                  style={{
                    gridTemplateColumns:
                      '1.1fr 0.75fr 0.75fr 1fr minmax(200px, auto)',
                  }}
                >
                  <span>학생 이름</span>
                  <span>차감 횟수</span>
                  <span>{canViewPaymentFields ? '결제 횟수' : '총 횟수'}</span>
                  <span>시작일</span>
                  <span>작업</span>
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
                      <span>{getGroupStudentDisplayName(gs)}</span>
                      <span>{attended}</span>
                      <span>{paid}</span>
                      <span>{formatGroupStudentStartDate(gs.startDate)}</span>
                      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>수업 일정</h3>
                <p style={{ margin: '6px 0 0 0', opacity: 0.75, fontSize: 13 }}>
                  이 반에서 실제로 진행되는 날짜별 수업입니다.
                </p>
              </div>

              {groupLessonsLoading ? (
                <p style={{ opacity: 0.85 }}>수업 일정을 불러오는 중...</p>
              ) : sortedGroupLessonsForSelectedClass.length === 0 ? (
                <p style={{ opacity: 0.8 }}>등록된 수업 일정이 없습니다.</p>
              ) : (
                <div className="activity-table">
                  <div
                    className="table-head"
                    style={{
                      gridTemplateColumns: '0.9fr 0.6fr 1fr 1fr 1.6fr 0.75fr minmax(260px, auto)',
                    }}
                  >
                    <span>날짜</span>
                    <span>시간</span>
                    <span>과목</span>
                    <span>코스 유형</span>
                    <span>정원</span>
                    <span>예약 상태</span>
                    <span>작업</span>
                  </div>

                  {sortedGroupLessonsForSelectedClass.map((gl) => {
                    const rowBusy = busyGroupLessonId === gl.id
                    const isNoDeductionCancelled = isNoDeductionCancelledGroupLesson(gl)
                    const seatAvailability = groupLessonSeatAvailabilityById[gl.id] || null
                    const reservationStatusLabel = getLessonReservationStatusLabel(gl, seatAvailability)
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
                        data-lesson-subject={gl.subject || ''}
                        style={{
                          gridTemplateColumns: '0.9fr 0.6fr 1fr 1fr 1.6fr 0.75fr minmax(260px, auto)',
                        }}
                      >
                        <span>{gl.date || '-'}</span>
                        <span>{gl.time || '-'}</span>
                        <span>{gl.subject || '-'}</span>
                        <span>{getGroupCourseTypeLabel(gl.groupCourseType) || '-'}</span>
                        <span
                          data-testid="group-lesson-seat-summary"
                          style={{ display: 'grid', gap: 3, fontSize: 12, lineHeight: 1.35 }}
                        >
                          <span>정원 {seatAvailability?.capacity ?? Number(gl.capacity ?? 0)}명</span>
                          <span data-testid="group-lesson-fixed-attending-count">
                            고정 참석 예정 {seatAvailability?.fixedAttendingCount ?? '-'}명
                          </span>
                          <span data-testid="group-lesson-released-seat-count">
                            고정 결석/차감취소 {seatAvailability?.releasedFixedSeatCount ?? '-'}명
                          </span>
                          <span data-testid="group-lesson-guest-reserved-count">
                            추가 예약 {seatAvailability?.guestReservedCount ?? Number(gl.bookedCount ?? 0)}명
                          </span>
                          <span data-testid="group-lesson-remaining-seats">
                            남은 자리 {seatAvailability?.remainingSeats ?? '-'}명
                          </span>
                        </span>
                        <span style={{ display: 'grid', gap: 3 }}>
                          <span>{reservationStatusLabel}</span>
                          {isNoDeductionCancelled ? (
                            <span style={{ fontSize: 12, color: '#f1d38a', fontWeight: 700 }}>
                              차감 없음
                            </span>
                          ) : null}
                        </span>
                        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {canManageGroupReservations ? (
                            <button
                              type="button"
                              onClick={() => openGroupLessonReservationAddModal(gl)}
                              disabled={
                                rowBusy ||
                                busyGroupReservationId?.startsWith(`${gl.id}__`) ||
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
                            예약 보기
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
                              {attendanceBusyThisLesson ? '처리 중' : '출결/차감'}
                            </button>
                          ) : null}
                          {isAdmin && canEditLesson && !isNoDeductionCancelled ? (
                            <button
                              type="button"
                              onClick={() => openGroupLessonNoDeductionCancelModal(gl)}
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
                              휴강 처리
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-reservation-modal-title"
        data-testid="group-reservation-modal"
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
            {groupReservationModal.type === 'add' ? '예약 추가' : '예약 보기'}
          </h2>
          <p style={{ margin: '0 0 16px 0', fontSize: 13, opacity: 0.8 }}>
            {[modalLesson.date, modalLesson.time, modalLesson.subject].filter(Boolean).join(' · ')}
            {' '}· 정원 {getLessonCapacityLabel(modalLesson, modalLessonSeatAvailability)}
            {modalLessonSeatAvailability
              ? ` · 남은 자리 ${modalLessonSeatAvailability.remainingSeats}명`
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
                <p style={{ margin: 0, opacity: 0.78, fontSize: 13 }}>예약 내역이 없습니다.</p>
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
                          {getReservationSourceLabel(reservation.source)}
                          {' · '}
                          {getReservationStatusLabel(reservation.status)}
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
              닫기
            </button>
          </div>
        </div>
      </div>
    ) : null}
  </section>
  );
}
