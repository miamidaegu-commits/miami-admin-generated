import { Fragment } from 'react'
import {
  formatDate,
  formatGroupStudentStartDate,
  formatStudentPackageDetailAmountPaid,
  formatStudentPackageDetailMemo,
  formatStudentPackageDetailStatusLabel,
  formatStudentPackageDetailTypeLabel,
  getLessonDate,
  getLessonStorageDateString,
  getTeacherName,
  formatTime,
  isStudentPackageRowActive,
  sanitizePhoneForTel,
  parseYmdToLocalDate,
} from '../dashboardViewUtils.js'

export default function StudentsSection({
  loading,
  privateStudents,
  filteredSortedPrivateStudents,
  studentSearchQuery,
  setStudentSearchQuery,
  studentTeacherFilter,
  setStudentTeacherFilter,
  studentRegistrationFilter,
  setStudentRegistrationFilter,
  studentPrivatePackageFilter,
  setStudentPrivatePackageFilter,
  studentGroupPackageFilter,
  setStudentGroupPackageFilter,
  studentNextLessonFilter,
  setStudentNextLessonFilter,
  studentAttentionFilter,
  setStudentAttentionFilter,
  studentSortKey,
  setStudentSortKey,
  studentTodayLessonOnly,
  setStudentTodayLessonOnly,
  studentListKpis,
  studentListTeacherOptions,
  isAdmin,
  studentPackageTableSummaryByStudentId,
  studentPackagesSortedByStudentId,
  expandedStudentPackageStudentId,
  setExpandedStudentPackageStudentId,
  showAllStudentPackagesInDetail,
  setShowAllStudentPackagesInDetail,
  studentAttentionFlagsByStudentId,
  activeGroupRegistrationsByStudentId,
  nextPrivateLessonByStudentId,
  nextGroupLessonByStudentId,
  groupClasses,
  studentPackages,
  busyStudentId,
  busyStudentPackageSubmit,
  busyStudentPackageActionId,
  canAddStudent,
  canEditStudent,
  canDeleteStudent,
  copiedStudentPhoneId,
  copyStudentPhone,
  openStudentAddModal,
  openStudentEditModal,
  handleDeleteStudent,
  openStudentPackageModal,
  openStudentPackageEditModal,
  endStudentPackage,
  openStudentPackageHistoryModal,
  openStudentPackageReRegisterModal,
  formatStudentFirstRegisteredForTable,
  formatStudentPackageCellSummary,
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
        학생 관리
      </h2>
      {canAddStudent ? (
        <button
          type="button"
          onClick={openStudentAddModal}
          disabled={busyStudentId === '__add__' || loading}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid #444',
            background: '#1f2a44',
            color: 'white',
            cursor:
              busyStudentId === '__add__' || loading ? 'not-allowed' : 'pointer',
          }}
        >
          {busyStudentId === '__add__' ? '추가 중...' : '학생 추가'}
        </button>
      ) : null}
    </div>

    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 14,
      }}
    >
      {(
        [
          {
            key: 'total',
            title: '전체 학생',
            value: studentListKpis.totalStudents,
            hint: '등록된 학생',
            selected:
              studentAttentionFilter === 'all' &&
              studentRegistrationFilter === 'all' &&
              studentNextLessonFilter === 'all' &&
              !studentTodayLessonOnly,
            onClick: () => {
              setStudentAttentionFilter('all')
              setStudentRegistrationFilter('all')
              setStudentNextLessonFilter('all')
              setStudentTodayLessonOnly(false)
            },
          },
          {
            key: 'renewal',
            title: '재등록 필요',
            value: studentListKpis.renewalNeededCount,
            hint: '주의 기준',
            selected: studentAttentionFilter === 'renewal' && !studentTodayLessonOnly,
            onClick: () => {
              setStudentAttentionFilter('renewal')
              setStudentTodayLessonOnly(false)
            },
          },
          {
            key: 'expiring',
            title: '만료 임박',
            value: studentListKpis.expiringSoonCount,
            hint: '14일 이내',
            selected: studentAttentionFilter === 'expiring' && !studentTodayLessonOnly,
            onClick: () => {
              setStudentAttentionFilter('expiring')
              setStudentTodayLessonOnly(false)
            },
          },
          {
            key: 'registered',
            title: '현재 등록',
            value: studentListKpis.activeGroupRegistrationStudentCount,
            hint: '활성 그룹 등록',
            selected: studentRegistrationFilter === 'has' && !studentTodayLessonOnly,
            onClick: () => {
              setStudentRegistrationFilter('has')
              setStudentAttentionFilter('all')
              setStudentTodayLessonOnly(false)
            },
          },
          {
            key: 'today',
            title: '오늘 수업',
            value: studentListKpis.todayLessonStudentCount,
            hint: '개인·그룹',
            selected: studentTodayLessonOnly,
            onClick: () => {
              setStudentTodayLessonOnly(true)
            },
          },
        ]
      ).map((card) => (
        <button
          key={card.key}
          type="button"
          onClick={card.onClick}
          disabled={loading}
          style={{
            flex: '1 1 120px',
            minWidth: 108,
            maxWidth: 200,
            padding: '12px 14px',
            borderRadius: 10,
            border: card.selected ? '1px solid #5a7fd0' : '1px solid var(--border)',
            background: card.selected ? 'rgba(40, 55, 90, 0.45)' : 'var(--surface2)',
            color: 'inherit',
            textAlign: 'left',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.65 : 1,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.78, marginBottom: 4 }}>{card.title}</div>
          <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{card.value}</div>
          <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>{card.hint}</div>
        </button>
      ))}
    </div>

    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        alignItems: 'center',
        marginBottom: 14,
      }}
    >
      <input
        type="search"
        value={studentSearchQuery}
        onChange={(e) => setStudentSearchQuery(e.target.value)}
        placeholder="이름, 전화번호, 차번호, 수강 목적 검색"
        disabled={loading}
        style={{
          flex: '1 1 220px',
          minWidth: 180,
          maxWidth: 420,
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'inherit',
          fontSize: 13,
        }}
      />
      {isAdmin ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>선생님</span>
          <select
            value={studentTeacherFilter}
            onChange={(e) => setStudentTeacherFilter(e.target.value)}
            disabled={loading}
            style={{
              padding: '6px 8px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'inherit',
              fontSize: 13,
            }}
          >
            <option value="">전체</option>
            {studentListTeacherOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>등록</span>
        <select
          value={studentRegistrationFilter}
          onChange={(e) => setStudentRegistrationFilter(e.target.value)}
          disabled={loading}
          style={{
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'inherit',
            fontSize: 13,
          }}
        >
          <option value="all">전체</option>
          <option value="has">등록 있음</option>
          <option value="none">등록 없음</option>
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>개인권</span>
        <select
          value={studentPrivatePackageFilter}
          onChange={(e) => setStudentPrivatePackageFilter(e.target.value)}
          disabled={loading}
          style={{
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'inherit',
            fontSize: 13,
          }}
        >
          <option value="all">전체</option>
          <option value="has">있음</option>
          <option value="none">없음</option>
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>그룹권</span>
        <select
          value={studentGroupPackageFilter}
          onChange={(e) => setStudentGroupPackageFilter(e.target.value)}
          disabled={loading}
          style={{
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'inherit',
            fontSize: 13,
          }}
        >
          <option value="all">전체</option>
          <option value="has">있음</option>
          <option value="none">없음</option>
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>다음 수업</span>
        <select
          value={studentNextLessonFilter}
          onChange={(e) => setStudentNextLessonFilter(e.target.value)}
          disabled={loading}
          style={{
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'inherit',
            fontSize: 13,
          }}
        >
          <option value="all">전체</option>
          <option value="has">예정 있음</option>
          <option value="none">예정 없음</option>
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>주의</span>
        <select
          value={studentAttentionFilter}
          onChange={(e) => setStudentAttentionFilter(e.target.value)}
          disabled={loading}
          style={{
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'inherit',
            fontSize: 13,
          }}
        >
          <option value="all">전체</option>
          <option value="renewal">재등록 필요</option>
          <option value="expiring">만료 임박</option>
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>정렬</span>
        <select
          value={studentSortKey}
          onChange={(e) => setStudentSortKey(e.target.value)}
          disabled={loading}
          style={{
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'inherit',
            fontSize: 13,
          }}
        >
          <option value="name">이름순</option>
          <option value="firstRegisteredDesc">첫 등록일 최신순</option>
          <option value="nextLessonAsc">다음 수업 빠른순</option>
        </select>
      </label>
    </div>

    {loading ? (
      <p>불러오는 중...</p>
    ) : privateStudents.length === 0 ? (
      <p style={{ opacity: 0.8 }}>등록된 학생이 없습니다.</p>
    ) : filteredSortedPrivateStudents.length === 0 ? (
      <p style={{ opacity: 0.8 }}>조건에 맞는 학생이 없습니다.</p>
    ) : (
      <div className="activity-table">
        <div
          className="table-head"
          style={{
            gridTemplateColumns:
              'minmax(72px, 0.95fr) minmax(72px, 0.95fr) minmax(100px, 1.05fr) minmax(96px, 0.85fr) minmax(120px, 1.15fr) minmax(120px, 1.15fr) minmax(240px, auto)',
          }}
        >
          <span>이름</span>
          <span>선생님</span>
          <span>전화번호</span>
          <span>첫 등록일</span>
          <span>개인 수강권</span>
          <span>그룹 수강권</span>
          <span>작업</span>
        </div>

        {filteredSortedPrivateStudents.map((student) => {
          const rowBusy = busyStudentId === student.id
          const studentPhoneTrim =
            student.phone != null && String(student.phone).trim()
              ? String(student.phone).trim()
              : ''
          const phoneTel = sanitizePhoneForTel(student.phone)
          const pkgSum = studentPackageTableSummaryByStudentId.get(student.id) ?? {
            privateCount: 0,
            privateRemainingTotal: 0,
            groupCount: 0,
            groupRemainingTotal: 0,
          }
          const pkgListAll = studentPackagesSortedByStudentId.get(student.id) ?? []
          const isPkgDetailExpanded = expandedStudentPackageStudentId === student.id
          const att = studentAttentionFlagsByStudentId.get(student.id) ?? {
            hasRenewalNeeded: false,
            hasExpiringSoon: false,
          }

          return (
            <Fragment key={student.id}>
            <div
              className="table-row"
              style={{
                gridTemplateColumns:
                  'minmax(72px, 0.95fr) minmax(72px, 0.95fr) minmax(100px, 1.05fr) minmax(96px, 0.85fr) minmax(120px, 1.15fr) minmax(120px, 1.15fr) minmax(240px, auto)',
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                <span>{student.name || '-'}</span>
                {att.hasRenewalNeeded || att.hasExpiringSoon ? (
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {att.hasRenewalNeeded ? (
                      <span
                        style={{
                          fontSize: 10,
                          lineHeight: 1.3,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'rgba(180, 100, 40, 0.35)',
                          border: '1px solid rgba(220, 140, 60, 0.45)',
                          color: 'inherit',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        재등록 필요
                      </span>
                    ) : null}
                    {att.hasExpiringSoon ? (
                      <span
                        style={{
                          fontSize: 10,
                          lineHeight: 1.3,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'rgba(80, 120, 180, 0.35)',
                          border: '1px solid rgba(100, 140, 200, 0.45)',
                          color: 'inherit',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        만료 임박
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
              <span>{student.teacher || '-'}</span>
              <span>
                {studentPhoneTrim ? studentPhoneTrim : '-'}
              </span>
              <span>{formatStudentFirstRegisteredForTable(student.firstRegisteredAt)}</span>
              <span>
                {formatStudentPackageCellSummary(
                  pkgSum.privateCount,
                  pkgSum.privateRemainingTotal
                )}
              </span>
              <span>
                {formatStudentPackageCellSummary(
                  pkgSum.groupCount,
                  pkgSum.groupRemainingTotal
                )}
              </span>
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {studentPhoneTrim ? (
                  <button
                    type="button"
                    onClick={() => copyStudentPhone(student)}
                    disabled={rowBusy || busyStudentId === '__add__' || busyStudentPackageSubmit}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #3a4a66',
                      background:
                        copiedStudentPhoneId === student.id ? 'rgba(90, 127, 208, 0.35)' : '#1a2338',
                      color: 'white',
                      cursor:
                        rowBusy || busyStudentId === '__add__' || busyStudentPackageSubmit
                          ? 'not-allowed'
                          : 'pointer',
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {copiedStudentPhoneId === student.id ? '복사됨' : '복사'}
                  </button>
                ) : null}
                {phoneTel ? (
                  <a
                    href={`tel:${phoneTel}`}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #335544',
                      background: '#243528',
                      color: 'white',
                      fontSize: 12,
                      textDecoration: 'none',
                      whiteSpace: 'nowrap',
                      display: 'inline-block',
                    }}
                  >
                    전화
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    setExpandedStudentPackageStudentId((cur) =>
                      cur === student.id ? null : student.id
                    )
                  }
                  disabled={rowBusy || busyStudentId === '__add__'}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: '1px solid #4a6fff44',
                    background: '#1a2238',
                    color: 'white',
                    cursor:
                      rowBusy || busyStudentId === '__add__'
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                >
                  {isPkgDetailExpanded ? '접기' : '수강권 보기'}
                </button>
                {canEditStudent ? (
                  <button
                    type="button"
                    onClick={() => openStudentEditModal(student)}
                    disabled={
                      rowBusy ||
                      busyStudentId === '__add__' ||
                      busyStudentPackageSubmit
                    }
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #555',
                      background: '#1f2a44',
                      color: 'white',
                      cursor:
                        rowBusy || busyStudentId === '__add__' || busyStudentPackageSubmit
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    {rowBusy ? '처리 중...' : '수정'}
                  </button>
                ) : null}
                {canDeleteStudent ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteStudent(student)}
                    disabled={
                      rowBusy ||
                      busyStudentId === '__add__' ||
                      busyStudentPackageSubmit
                    }
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #553333',
                      background: '#4a2a2a',
                      color: 'white',
                      cursor:
                        rowBusy || busyStudentId === '__add__' || busyStudentPackageSubmit
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    {rowBusy ? '처리 중...' : '삭제'}
                  </button>
                ) : null}
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => openStudentPackageModal(student)}
                    disabled={
                      rowBusy ||
                      busyStudentId === '__add__' ||
                      busyStudentPackageSubmit
                    }
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #335533',
                      background: '#2a3d2a',
                      color: 'white',
                      cursor:
                        rowBusy || busyStudentId === '__add__' || busyStudentPackageSubmit
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    수강권 추가
                  </button>
                ) : null}
              </span>
            </div>
            {isPkgDetailExpanded ? (
              <div
                style={{
                  padding: '14px 1.25rem',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--surface2)',
                }}
              >
                {(() => {
                  const regRows =
                    activeGroupRegistrationsByStudentId.get(student.id) ?? []
                  const nextPrivateLesson = nextPrivateLessonByStudentId.get(student.id)
                  const nextGroupLesson = nextGroupLessonByStudentId.get(student.id)
                  const nextPrivateDateObj = nextPrivateLesson
                    ? getLessonDate(nextPrivateLesson)
                    : null
                  const nextPrivateDateLabel =
                    nextPrivateDateObj && Number.isFinite(nextPrivateDateObj.getTime())
                      ? formatDate(nextPrivateDateObj)
                      : nextPrivateLesson
                        ? getLessonStorageDateString(nextPrivateLesson) || '-'
                        : '-'
                  const nextPrivateTimeLabel =
                    nextPrivateDateObj && Number.isFinite(nextPrivateDateObj.getTime())
                      ? formatTime(nextPrivateDateObj)
                      : nextPrivateLesson
                        ? String(nextPrivateLesson.time || '').trim() || '-'
                        : '-'
                  const nextGroupClassName = nextGroupLesson
                    ? (() => {
                        const gid = String(nextGroupLesson.groupClassId || '').trim()
                        const gc = groupClasses.find((g) => g.id === gid)
                        return gc?.name != null && String(gc.name).trim()
                          ? String(gc.name).trim()
                          : '-'
                      })()
                    : '-'
                  const nextGroupDateStr = nextGroupLesson
                    ? String(nextGroupLesson.date || '').trim()
                    : ''
                  const nextGroupDateLabel =
                    nextGroupDateStr && /^\d{4}-\d{2}-\d{2}$/.test(nextGroupDateStr)
                      ? (() => {
                          const d = parseYmdToLocalDate(nextGroupDateStr)
                          return d ? formatDate(d) : nextGroupDateStr
                        })()
                      : '-'
                  const nextGroupTimeLabel = nextGroupLesson
                    ? String(nextGroupLesson.time || '').trim() || '-'
                    : '-'
                  const nextGroupSubjectLabel = nextGroupLesson
                    ? String(nextGroupLesson.subject || '').trim() || '-'
                    : '-'

                  return (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 14,
                        marginBottom: 16,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            marginBottom: 8,
                            opacity: 0.95,
                          }}
                        >
                          현재 등록
                        </div>
                        {regRows.length === 0 ? (
                          <p style={{ margin: 0, fontSize: 13, opacity: 0.82 }}>
                            현재 등록된 반이 없습니다.
                          </p>
                        ) : (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 8,
                            }}
                          >
                            {regRows.map((row) => (
                              <div
                                key={row.key}
                                style={{
                                  fontSize: 13,
                                  lineHeight: 1.55,
                                  padding: '8px 10px',
                                  borderRadius: 8,
                                  border: '1px solid var(--border)',
                                  background: 'var(--surface)',
                                }}
                              >
                                <div>
                                  <span style={{ opacity: 0.72 }}>반 이름</span>{' '}
                                  {row.className}
                                </div>
                                <div>
                                  <span style={{ opacity: 0.72 }}>시작일</span>{' '}
                                  {row.startDisplay}
                                </div>
                                <div>
                                  <span style={{ opacity: 0.72 }}>수강권</span>{' '}
                                  {row.packageTitle}
                                </div>
                                <div>
                                  <span style={{ opacity: 0.72 }}>남은 횟수</span>{' '}
                                  {row.remainingDisplay}
                                </div>
                                {row.operationalLabel ? (
                                  <div style={{ marginTop: 6 }}>
                                    <span
                                      style={{
                                        fontSize: 11,
                                        fontWeight: 600,
                                        padding: '3px 8px',
                                        borderRadius: 6,
                                        border: '1px solid #4a4a6a',
                                        background: 'rgba(80, 90, 140, 0.25)',
                                        color: 'rgba(230, 235, 255, 0.95)',
                                      }}
                                    >
                                      {row.operationalLabel}
                                    </span>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            marginBottom: 8,
                            opacity: 0.95,
                          }}
                        >
                          다음 개인 수업
                        </div>
                        {!nextPrivateLesson ? (
                          <p style={{ margin: 0, fontSize: 13, opacity: 0.82 }}>
                            예정된 개인 수업이 없습니다.
                          </p>
                        ) : (
                          <div
                            style={{
                              fontSize: 13,
                              lineHeight: 1.55,
                              padding: '8px 10px',
                              borderRadius: 8,
                              border: '1px solid var(--border)',
                              background: 'var(--surface)',
                            }}
                          >
                            <div>
                              <span style={{ opacity: 0.72 }}>날짜</span>{' '}
                              {nextPrivateDateLabel}
                            </div>
                            <div>
                              <span style={{ opacity: 0.72 }}>시간</span>{' '}
                              {nextPrivateTimeLabel}
                            </div>
                            <div>
                              <span style={{ opacity: 0.72 }}>과목</span>{' '}
                              {String(nextPrivateLesson.subject || '').trim() || '-'}
                            </div>
                            <div>
                              <span style={{ opacity: 0.72 }}>선생님</span>{' '}
                              {getTeacherName(nextPrivateLesson)}
                            </div>
                          </div>
                        )}
                      </div>

                      <div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            marginBottom: 8,
                            opacity: 0.95,
                          }}
                        >
                          다음 그룹 수업
                        </div>
                        {!nextGroupLesson ? (
                          <p style={{ margin: 0, fontSize: 13, opacity: 0.82 }}>
                            예정된 그룹 수업이 없습니다.
                          </p>
                        ) : (
                          <div
                            style={{
                              fontSize: 13,
                              lineHeight: 1.55,
                              padding: '8px 10px',
                              borderRadius: 8,
                              border: '1px solid var(--border)',
                              background: 'var(--surface)',
                            }}
                          >
                            <div>
                              <span style={{ opacity: 0.72 }}>반 이름</span>{' '}
                              {nextGroupClassName}
                            </div>
                            <div>
                              <span style={{ opacity: 0.72 }}>날짜</span>{' '}
                              {nextGroupDateLabel}
                            </div>
                            <div>
                              <span style={{ opacity: 0.72 }}>시간</span>{' '}
                              {nextGroupTimeLabel}
                            </div>
                            <div>
                              <span style={{ opacity: 0.72 }}>과목</span>{' '}
                              {nextGroupSubjectLabel}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}
                {pkgListAll.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 14, opacity: 0.88 }}>
                    등록된 수강권이 없습니다.
                  </p>
                ) : (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 10,
                      }}
                    >
                      <div
                        style={{
                          display: 'inline-flex',
                          borderRadius: 8,
                          border: '1px solid var(--border)',
                          overflow: 'hidden',
                          fontSize: 12,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setShowAllStudentPackagesInDetail(false)}
                          style={{
                            padding: '6px 12px',
                            border: 'none',
                            background: !showAllStudentPackagesInDetail
                              ? 'rgba(90, 127, 208, 0.35)'
                              : 'transparent',
                            color: 'inherit',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          사용 중만 보기
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAllStudentPackagesInDetail(true)}
                          style={{
                            padding: '6px 12px',
                            border: 'none',
                            borderLeft: '1px solid var(--border)',
                            background: showAllStudentPackagesInDetail
                              ? 'rgba(90, 127, 208, 0.35)'
                              : 'transparent',
                            color: 'inherit',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          전체 보기
                        </button>
                      </div>
                    </div>
                    {(() => {
                      const pkgListActive = pkgListAll.filter((p) =>
                        isStudentPackageRowActive(p)
                      )
                      const displayedPkgList = showAllStudentPackagesInDetail
                        ? pkgListAll
                        : pkgListActive
                      if (!showAllStudentPackagesInDetail && pkgListActive.length === 0) {
                        return (
                          <p style={{ margin: 0, fontSize: 14, opacity: 0.88 }}>
                            사용 중인 수강권이 없습니다. 전체 보기를 켜면 지난 수강권을 볼 수 있습니다.
                          </p>
                        )
                      }
                      return (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                    }}
                  >
                    {displayedPkgList.map((pkg) => (
                      <div
                        key={pkg.id}
                        style={{
                          padding: 12,
                          borderRadius: 10,
                          border: '1px solid var(--border)',
                          background: 'var(--surface)',
                        }}
                      >
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(92px, 0.38fr) 1fr',
                            gap: '6px 14px',
                            fontSize: 13,
                            alignItems: 'start',
                          }}
                        >
                          <span style={{ opacity: 0.72 }}>유형</span>
                          <span>{formatStudentPackageDetailTypeLabel(pkg.packageType)}</span>
                          <span style={{ opacity: 0.72 }}>제목</span>
                          <span>{pkg.title != null && String(pkg.title).trim() ? String(pkg.title) : '-'}</span>
                          <span style={{ opacity: 0.72 }}>상태</span>
                          <span>{formatStudentPackageDetailStatusLabel(pkg.status)}</span>
                          <span style={{ opacity: 0.72 }}>연결 반</span>
                          <span>
                            {pkg.groupClassName != null && String(pkg.groupClassName).trim()
                              ? String(pkg.groupClassName)
                              : '-'}
                          </span>
                          <span style={{ opacity: 0.72 }}>총 횟수</span>
                          <span>
                            {pkg.totalCount != null && pkg.totalCount !== ''
                              ? String(pkg.totalCount)
                              : '-'}
                          </span>
                          <span style={{ opacity: 0.72 }}>사용 횟수</span>
                          <span>
                            {pkg.usedCount != null && pkg.usedCount !== ''
                              ? String(pkg.usedCount)
                              : '-'}
                          </span>
                          <span style={{ opacity: 0.72 }}>남은 횟수</span>
                          <span>
                            {pkg.remainingCount != null && pkg.remainingCount !== ''
                              ? String(pkg.remainingCount)
                              : '-'}
                          </span>
                          <span style={{ opacity: 0.72 }}>만료일</span>
                          <span>{formatGroupStudentStartDate(pkg.expiresAt)}</span>
                          <span style={{ opacity: 0.72 }}>결제 금액</span>
                          <span>{formatStudentPackageDetailAmountPaid(pkg.amountPaid)}</span>
                          <span style={{ opacity: 0.72 }}>메모</span>
                          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {formatStudentPackageDetailMemo(pkg.memo)}
                          </span>
                        </div>
                        {isAdmin ? (
                          <div
                            style={{
                              display: 'flex',
                              gap: 8,
                              marginTop: 12,
                              flexWrap: 'wrap',
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => openStudentPackageEditModal(pkg)}
                              disabled={
                                busyStudentPackageActionId != null || busyStudentPackageSubmit
                              }
                              style={{
                                padding: '6px 12px',
                                borderRadius: 8,
                                border: '1px solid #555',
                                background: '#1f2a44',
                                color: 'white',
                                cursor:
                                  busyStudentPackageActionId != null || busyStudentPackageSubmit
                                    ? 'not-allowed'
                                    : 'pointer',
                                fontSize: 13,
                              }}
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              onClick={() => openStudentPackageHistoryModal(pkg)}
                              disabled={
                                busyStudentPackageActionId != null || busyStudentPackageSubmit
                              }
                              style={{
                                padding: '6px 12px',
                                borderRadius: 8,
                                border: '1px solid #3a4a66',
                                background: '#1a2338',
                                color: 'white',
                                cursor:
                                  busyStudentPackageActionId != null || busyStudentPackageSubmit
                                    ? 'not-allowed'
                                    : 'pointer',
                                fontSize: 13,
                              }}
                            >
                              이력 보기
                            </button>
                            <button
                              type="button"
                              onClick={() => endStudentPackage(pkg)}
                              disabled={
                                String(pkg.status || '').toLowerCase() === 'ended' ||
                                busyStudentPackageActionId != null ||
                                busyStudentPackageSubmit
                              }
                              style={{
                                padding: '6px 12px',
                                borderRadius: 8,
                                border: '1px solid #664422',
                                background: '#3d2e1f',
                                color: 'white',
                                cursor:
                                  String(pkg.status || '').toLowerCase() === 'ended' ||
                                  busyStudentPackageActionId != null ||
                                  busyStudentPackageSubmit
                                    ? 'not-allowed'
                                    : 'pointer',
                                fontSize: 13,
                              }}
                            >
                              종료
                            </button>
                            {String(pkg.status || 'active').toLowerCase() === 'exhausted' ||
                            String(pkg.status || 'active').toLowerCase() === 'ended' ? (
                              <button
                                type="button"
                                onClick={() => openStudentPackageReRegisterModal(pkg)}
                                disabled={
                                  busyStudentPackageActionId != null || busyStudentPackageSubmit
                                }
                                style={{
                                  padding: '6px 12px',
                                  borderRadius: 8,
                                  border: '1px solid #335544',
                                  background: '#243528',
                                  color: 'white',
                                  cursor:
                                    busyStudentPackageActionId != null || busyStudentPackageSubmit
                                      ? 'not-allowed'
                                      : 'pointer',
                                  fontSize: 13,
                                }}
                              >
                                재등록
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                      )
                    })()}
                  </>
                )}
              </div>
            ) : null}
            </Fragment>
          )
        })}
      </div>
    )}
  </section>
  );
}
