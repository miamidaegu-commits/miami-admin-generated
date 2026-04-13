import { formatGroupStudentStartDate, formatGroupWeekdaysDisplay } from '../dashboardViewUtils.js'

export default function GroupsSection({
  canManageGroupClasses,
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
  canCreateLessonDirectly,
  openGroupLessonSeriesModal,
  isAdmin,
  openGroupLessonPurgeModal,
  busyGroupLessonPurge,
  sortedGroupStudentsForSelectedClass,
  handleRemoveGroupStudent,
  sortedGroupLessonsForSelectedClass,
  busyGroupAttendanceStudentId,
  canManageAttendance,
  openGroupLessonAttendanceModal,
  canEditLesson,
  openGroupLessonEditModal,
  canDeleteLesson,
  handleDeleteGroupLesson,
  getGroupStudentDisplayName,
  openGroupStudentManageModal,
  busyGroupStudentManageId,
}) {
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
        반 관리
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
              gridTemplateColumns: '1.2fr 1.2fr 0.9fr minmax(140px, auto)',
            }}
          >
            <span>이름</span>
            <span>선생님</span>
            <span>최대 인원</span>
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
                onClick={() => setSelectedGroupClass(group)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelectedGroupClass(group)
                  }
                }}
                style={{
                  gridTemplateColumns: '1.2fr 1.2fr 0.9fr minmax(140px, auto)',
                  cursor: 'pointer',
                  outline: isSelected ? '2px solid #6b8cff' : undefined,
                  outlineOffset: -2,
                }}
              >
                <span>{group.name || '-'}</span>
                <span>{group.teacher || '-'}</span>
                <span>{group.maxStudents ?? '-'}</span>
                <span
                  style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {canManageGroupClasses ? (
                    <button
                      type="button"
                      onClick={() => openGroupEditModal(group)}
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
                  {canManageGroupClasses ? (
                    <button
                      type="button"
                      onClick={() => handleDeleteGroup(group)}
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
                      {rowBusy ? '처리 중...' : '삭제'}
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
              {selectedGroupClass.maxStudents ?? '-'}명
            </p>
            <p style={{ margin: '6px 0 0 0', opacity: 0.68, fontSize: 12 }}>
              기본 시간 {selectedGroupClass.time || '—'} · 과목{' '}
              {selectedGroupClass.subject || '—'} · 요일{' '}
              {formatGroupWeekdaysDisplay(selectedGroupClass.weekdays) || '—'}
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
              <button
                type="button"
                onClick={openGroupLessonAddModal}
                disabled={
                  !canUseDirectLessonCreation ||
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
                    !canUseDirectLessonCreation ||
                    busyGroupLessonId === '__add__' ||
                    busyGroupLessonSeries ||
                    groupLessonsLoading ||
                    busyGroupId === '__add__' ||
                    busyGroupId === selectedGroupClass.id
                      ? 'not-allowed'
                      : 'pointer',
                }}
                title={
                  requiresLessonApproval
                    ? '승인 절차가 필요해 직접 수업 생성을 사용할 수 없습니다.'
                    : !canCreateLessonDirectly
                    ? '직접 수업 생성 권한이 없습니다.'
                    : undefined
                }
              >
                {busyGroupLessonId === '__add__' ? '추가 중...' : '특별 수업 추가'}
              </button>
              <button
                type="button"
                onClick={openGroupLessonSeriesModal}
                disabled={
                  !canUseDirectLessonCreation ||
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
                    !canUseDirectLessonCreation ||
                    busyGroupLessonId === '__add__' ||
                    busyGroupLessonSeries ||
                    groupLessonsLoading ||
                    busyGroupId === '__add__' ||
                    busyGroupId === selectedGroupClass.id
                      ? 'not-allowed'
                      : 'pointer',
                }}
                title={
                  requiresLessonApproval
                    ? '승인 절차가 필요해 직접 수업 생성을 사용할 수 없습니다.'
                    : !canCreateLessonDirectly
                    ? '직접 수업 생성 권한이 없습니다.'
                    : '관리자용: 기간을 지정해 일정을 추가로 만듭니다.'
                }
              >
                {busyGroupLessonSeries ? '생성 중...' : '추가 일정 생성'}
              </button>
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
              특별 수업 추가: 보강·특강 등 날짜 한 건 · 추가 일정 생성: 관리자용으로 기간을 정해 같은
              규칙으로 일정을 더 만듭니다.
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
                  <span>결제 횟수</span>
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
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            <div style={{ height: 20 }} />

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
                    gridTemplateColumns: '1fr 0.7fr 1.2fr minmax(200px, auto)',
                  }}
                >
                  <span>날짜</span>
                  <span>시간</span>
                  <span>과목</span>
                  <span>작업</span>
                </div>

                {sortedGroupLessonsForSelectedClass.map((gl) => {
                  const rowBusy = busyGroupLessonId === gl.id
                  const attendanceBusyThisLesson =
                    Boolean(busyGroupAttendanceStudentId) &&
                    busyGroupAttendanceStudentId.startsWith(`${gl.id}__`)
                  return (
                    <div
                      key={gl.id}
                      className="table-row"
                      style={{
                        gridTemplateColumns: '1fr 0.7fr 1.2fr minmax(200px, auto)',
                      }}
                    >
                      <span>{gl.date || '-'}</span>
                      <span>{gl.time || '-'}</span>
                      <span>{gl.subject || '-'}</span>
                      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
        ) : null}
      </>
    )}
  </section>
  );
}
