import {
  buildAutoGroupStudentPackageTitle,
  buildAutoPrivateStudentPackageTitle,
  computePrivateRegularTotalCount,
  formatGroupStudentStartDate,
} from '../dashboardViewUtils.js'
import {
  DEFAULT_GROUP_COURSE_TYPE,
  GROUP_COURSE_TYPE_OPTIONS,
  getGroupCourseTypeLabel,
  normalizeGroupCourseType,
} from '../../group-booking/groupCourseTypes.js'

function formatTeacherScopeLabel(row) {
  const display = String(row?.teacherName || row?.displayName || row?.name || '').trim()
  const key = String(row?.teacherKey || row?.teacher || '').trim()
  if (display && key && display !== key) return `${display} · ${key}`
  return display || key || '-'
}

export default function StudentPackageModal({
  studentPackageModalStudent,
  studentPackageForm,
  setStudentPackageForm,
  studentPackageFormErrors,
  canViewPaymentFields = false,
  sortedGroupClasses,
  nextGroupLessonDateByGroupId,
  studentPackageGroupAutoSummary,
  studentPackageModalActiveSameScopeDuplicates,
  openExistingStudentPackageFromAddModal,
  goToFixedPrivateAssignmentFromPackageModal,
  isStudentPackageModalSubmitting,
  closeStudentPackageModal,
  submitStudentPackageModal,
}) {
  const isGroupPackage =
    studentPackageForm.packageType === 'group' || studentPackageForm.packageType === 'openGroup'
  const isPrivatePackage = studentPackageForm.packageType === 'private'
  const isPrivateRegular =
    isPrivatePackage && studentPackageForm.privatePackageMode !== 'countBased'
  const selectedGroupClassName = (() => {
    const gid = String(studentPackageForm.groupClassId || '').trim()
    if (!gid) return ''
    const g = sortedGroupClasses.find((x) => x.id === gid)
    return g?.name != null && String(g.name).trim() ? String(g.name).trim() : ''
  })()
  const groupPackageTitlePlaceholder =
    isGroupPackage &&
    selectedGroupClassName &&
    String(studentPackageForm.registrationStartDate || '').trim() &&
    String(studentPackageForm.registrationWeeks || '').trim()
      ? buildAutoGroupStudentPackageTitle({
          groupClassName: selectedGroupClassName,
          registrationStartDate: studentPackageForm.registrationStartDate,
          registrationWeeks: studentPackageForm.registrationWeeks,
        })
      : isGroupPackage
        ? '반·시작일·주수를 선택하면 제목이 자동 제안됩니다'
        : ''
  const privateRegularComputed = isPrivateRegular
    ? computePrivateRegularTotalCount({
        registrationWeeks: studentPackageForm.registrationWeeks,
        weeklyFrequency: studentPackageForm.weeklyFrequency,
      })
    : 0
  const privateRegularTitlePlaceholder =
    isPrivateRegular && !String(studentPackageForm.title || '').trim()
      ? buildAutoPrivateStudentPackageTitle({
          studentName: studentPackageModalStudent?.name,
          registrationStartDate: studentPackageForm.registrationStartDate,
          registrationWeeks: studentPackageForm.registrationWeeks,
          weeklyFrequency: studentPackageForm.weeklyFrequency,
        })
      : ''
  const privateTeacherScopeLabel = formatTeacherScopeLabel(studentPackageModalStudent)
  const autoTotalCount = isGroupPackage
    ? String(studentPackageGroupAutoSummary?.computedTotalCount ?? 0)
    : isPrivateRegular
      ? String(privateRegularComputed || 0)
      : String(studentPackageForm.totalCount || '')
  const primaryDuplicatePackage = studentPackageModalActiveSameScopeDuplicates[0] || null
  const hasPrivateDuplicatePackage = isPrivatePackage && !!primaryDuplicatePackage
  const isPrivateTopUpFlow =
    hasPrivateDuplicatePackage &&
    String(studentPackageForm.privateDuplicateAction || 'topUp') !== 'new'
  const primaryDuplicateBalance = primaryDuplicatePackage?.privateAssignmentBalance || null
  const primaryDuplicateFixedScheduled = Math.max(
    0,
    Number(primaryDuplicateBalance?.futureFixedAllocatedCount) || 0
  )
  const primaryDuplicateActiveReservations = Math.max(
    0,
    Number(primaryDuplicateBalance?.activeFutureReservationCount) || 0
  )
  const primaryDuplicateAvailableForAssignment = Math.max(
    0,
    Number(primaryDuplicateBalance?.makeupAvailableCount) || 0
  )
  const topUpCountInput = String(studentPackageForm.totalCount || '').trim()
  const topUpCountPreview = /^[1-9]\d*$/.test(topUpCountInput)
    ? Number.parseInt(topUpCountInput, 10)
    : 0
  const topUpTotalCountPreview =
    (Number(primaryDuplicatePackage?.totalCount ?? 0) || 0) + topUpCountPreview
  const topUpAvailableForAssignmentPreview =
    primaryDuplicateAvailableForAssignment + topUpCountPreview
  const topUpRegistrationRound = Number(primaryDuplicatePackage?.nextRegistrationRound || 2)
  const hasMultiplePrivateDuplicatePackages =
    isPrivatePackage && studentPackageModalActiveSameScopeDuplicates.length > 1

  return (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-package-modal-title"
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
            if (e.target === e.currentTarget) closeStudentPackageModal()
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 480,
              background: '#151922',
              border: '1px solid #2e3240',
              borderRadius: 12,
              padding: 20,
              color: 'white',
              boxSizing: 'border-box',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="student-package-modal-title"
              style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
            >
              학생 수강권 추가
            </h2>
            <p style={{ margin: '0 0 16px 0', fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
              {studentPackageModalStudent.name || '-'} · {studentPackageModalStudent.teacher || '-'}
              <br />
              <span style={{ fontSize: 12, opacity: 0.78 }}>
                수강권은 수업을 들을 수 있는 횟수만 등록합니다.
                <br />
                고정 수업 일정은 1:1 예약 시간 관리 &gt; 고정 1:1 수업 배정에서 생성하세요.
              </span>
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>수강권 유형</span>
                <select
                  value={studentPackageForm.packageType}
                  onChange={(e) => {
                    const packageType = e.target.value
                    setStudentPackageForm((prev) => ({
                      ...prev,
                      packageType,
                      groupClassId:
                        packageType === 'private' ? '' : prev.groupClassId,
                      groupCourseType:
                        packageType === 'private'
                          ? ''
                          : normalizeGroupCourseType(prev.groupCourseType) ||
                            DEFAULT_GROUP_COURSE_TYPE,
                      registrationStartDate:
                        packageType === 'private'
                          ? ''
                          : prev.registrationStartDate,
                      registrationWeeks:
                        packageType === 'private' ? '4' : prev.registrationWeeks,
                      weeklyFrequency: packageType === 'private' ? '1' : prev.weeklyFrequency,
                      privatePackageMode:
                        packageType === 'private' ? 'regular' : prev.privatePackageMode,
                      totalCount: packageType === 'private' ? '1' : prev.totalCount,
                    }))
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                >
                  <option value="private">개인 (private)</option>
                  <option value="group">그룹 (group)</option>
                  <option value="openGroup">오픈 그룹 (openGroup)</option>
                </select>
              </label>

              {isPrivatePackage && !isPrivateTopUpFlow ? (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #333',
                    background: '#1a1d26',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.9 }}>수강권 모드</span>
                  <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, opacity: 0.8 }}>
                    개인 수강권 등록 후, 고정 수업은 기본 1:1 슬롯에 배정해 생성합니다.
                    <br />
                    개인 수강권은 선택한 선생님 수업에만 사용할 수 있습니다.
                    <br />
                    사용 가능 선생님: {privateTeacherScopeLabel}
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() =>
                        setStudentPackageForm((prev) => ({
                          ...prev,
                          privatePackageMode: 'regular',
                          registrationWeeks: prev.registrationWeeks || '4',
                          weeklyFrequency: prev.weeklyFrequency || '1',
                        }))
                      }
                      style={{
                        padding: '8px 14px',
                        borderRadius: 8,
                        border:
                          studentPackageForm.privatePackageMode !== 'countBased'
                            ? '1px solid #5f7dff'
                            : '1px solid #444',
                        background:
                          studentPackageForm.privatePackageMode !== 'countBased'
                            ? '#273a7a'
                            : '#1b1f29',
                        color: 'white',
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      정기 수강권
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setStudentPackageForm((prev) => ({
                          ...prev,
                          privatePackageMode: 'countBased',
                          totalCount: prev.totalCount || '1',
                        }))
                      }
                      style={{
                        padding: '8px 14px',
                        borderRadius: 8,
                        border:
                          studentPackageForm.privatePackageMode === 'countBased'
                            ? '1px solid #5f7dff'
                            : '1px solid #444',
                        background:
                          studentPackageForm.privatePackageMode === 'countBased'
                            ? '#273a7a'
                            : '#1b1f29',
                        color: 'white',
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      횟수 수강권
                    </button>
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.78 }}>
                    {isPrivateRegular
                      ? '주당 횟수와 등록 주수로 총 횟수를 자동 계산합니다.'
                      : '총 횟수를 직접 입력합니다.'}
                  </div>

                  {isPrivateRegular ? (
                    <>
                      <label
                        style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}
                      >
                        <span style={{ opacity: 0.85 }}>수강권 시작일</span>
                        <input
                          type="date"
                          aria-label="수강권 시작일"
                          data-testid="student-package-start-date-input"
                          value={studentPackageForm.registrationStartDate}
                          onChange={(e) =>
                            setStudentPackageForm((prev) => ({
                              ...prev,
                              registrationStartDate: e.target.value,
                            }))
                          }
                          style={{
                            padding: '10px 12px',
                            borderRadius: 8,
                            border: '1px solid #444',
                            background: '#1f1f1f',
                            color: 'white',
                          }}
                        />
                        {studentPackageFormErrors.registrationStartDate ? (
                          <span style={{ color: '#f08080', fontSize: 12 }}>
                            {studentPackageFormErrors.registrationStartDate}
                          </span>
                        ) : null}
                      </label>
                      <label
                        style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}
                      >
                        <span style={{ opacity: 0.85 }}>주당 횟수</span>
                        <select
                          value={String(studentPackageForm.weeklyFrequency ?? '1')}
                          onChange={(e) =>
                            setStudentPackageForm((prev) => ({
                              ...prev,
                              weeklyFrequency: e.target.value,
                            }))
                          }
                          style={{
                            padding: '10px 12px',
                            borderRadius: 8,
                            border: '1px solid #444',
                            background: '#1f1f1f',
                            color: 'white',
                          }}
                        >
                          <option value="1">주 1회</option>
                          <option value="2">주 2회</option>
                          <option value="3">주 3회</option>
                        </select>
                        {studentPackageFormErrors.weeklyFrequency ? (
                          <span style={{ color: '#f08080', fontSize: 12 }}>
                            {studentPackageFormErrors.weeklyFrequency}
                          </span>
                        ) : null}
                      </label>
                      <label
                        style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}
                      >
                        <span style={{ opacity: 0.85 }}>등록 주수</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={studentPackageForm.registrationWeeks}
                          onChange={(e) =>
                            setStudentPackageForm((prev) => ({
                              ...prev,
                              registrationWeeks: e.target.value,
                            }))
                          }
                          style={{
                            padding: '10px 12px',
                            borderRadius: 8,
                            border: '1px solid #444',
                            background: '#1f1f1f',
                            color: 'white',
                          }}
                        />
                        {studentPackageFormErrors.registrationWeeks ? (
                          <span style={{ color: '#f08080', fontSize: 12 }}>
                            {studentPackageFormErrors.registrationWeeks}
                          </span>
                        ) : null}
                      </label>
                      <div
                        style={{
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: '1px solid #2e3240',
                          fontSize: 12,
                          lineHeight: 1.5,
                          opacity: 0.92,
                        }}
                      >
                        주 {String(studentPackageForm.weeklyFrequency ?? '1')}회 ×{' '}
                        {String(studentPackageForm.registrationWeeks || '').trim() || '—'}주 ={' '}
                        {privateRegularComputed || 0}회
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}

              {!isPrivateTopUpFlow ? (
                <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>제목</span>
                <input
                  type="text"
                  value={studentPackageForm.title}
                  onChange={(e) =>
                    setStudentPackageForm((prev) => ({ ...prev, title: e.target.value }))
                  }
                  placeholder={
                    isGroupPackage
                      ? groupPackageTitlePlaceholder
                      : isPrivateRegular
                        ? privateRegularTitlePlaceholder
                        : ''
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {studentPackageFormErrors.title ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentPackageFormErrors.title}
                  </span>
                ) : null}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>
                  총 횟수 (totalCount)
                  {isPrivateRegular ? <span style={{ opacity: 0.65 }}> — 자동 계산</span> : null}
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={isGroupPackage || isPrivateRegular ? autoTotalCount : studentPackageForm.totalCount}
                  onChange={(e) =>
                    setStudentPackageForm((prev) => ({ ...prev, totalCount: e.target.value }))
                  }
                  readOnly={isGroupPackage || isPrivateRegular}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: isGroupPackage || isPrivateRegular ? '#252525' : '#1f1f1f',
                    color: 'white',
                    cursor: isGroupPackage || isPrivateRegular ? 'default' : 'text',
                  }}
                />
                {studentPackageFormErrors.totalCount ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentPackageFormErrors.totalCount}
                  </span>
                ) : null}
              </label>

              {studentPackageForm.packageType === 'group' ||
              studentPackageForm.packageType === 'openGroup' ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ opacity: 0.85 }}>그룹 수업</span>
                  <select
                    value={studentPackageForm.groupClassId}
                    onChange={(e) => {
                      const nextGid = String(e.target.value || '').trim()
                      const nextStartDate =
                        nextGroupLessonDateByGroupId?.get(nextGid) || studentPackageForm.registrationStartDate
                      const selectedGroup = sortedGroupClasses.find((g) => g.id === nextGid)
                      setStudentPackageForm((prev) => ({
                        ...prev,
                        groupClassId: nextGid,
                        groupCourseType:
                          normalizeGroupCourseType(selectedGroup?.groupCourseType) ||
                          normalizeGroupCourseType(prev.groupCourseType) ||
                          DEFAULT_GROUP_COURSE_TYPE,
                        registrationStartDate: nextGid ? nextStartDate || '' : '',
                        registrationWeeks: prev.registrationWeeks || '4',
                      }))
                    }}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                    }}
                  >
                    <option value="">그룹을 선택하세요</option>
                    {sortedGroupClasses.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name || '-'} ({g.teacher || '-'})
                        {getGroupCourseTypeLabel(g.groupCourseType)
                          ? ` · ${getGroupCourseTypeLabel(g.groupCourseType)}`
                          : ''}
                      </option>
                    ))}
                  </select>
                  {studentPackageFormErrors.groupClassId ? (
                    <span style={{ color: '#f08080', fontSize: 12 }}>
                      {studentPackageFormErrors.groupClassId}
                    </span>
                  ) : null}
                </label>
              ) : null}

              {isGroupPackage ? (
                <>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                    <span style={{ opacity: 0.85 }}>코스 유형</span>
                    <select
                      value={
                        normalizeGroupCourseType(studentPackageForm.groupCourseType) ||
                        DEFAULT_GROUP_COURSE_TYPE
                      }
                      onChange={(e) =>
                        setStudentPackageForm((prev) => ({
                          ...prev,
                          groupCourseType: e.target.value,
                        }))
                      }
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid #444',
                        background: '#1f1f1f',
                        color: 'white',
                      }}
                    >
                      {GROUP_COURSE_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {studentPackageFormErrors.groupCourseType ? (
                      <span style={{ color: '#f08080', fontSize: 12 }}>
                        {studentPackageFormErrors.groupCourseType}
                      </span>
                    ) : null}
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                    <span style={{ opacity: 0.85 }}>수강권 시작일</span>
                    <input
                      type="date"
                      aria-label="수강권 시작일"
                      data-testid="student-package-start-date-input"
                      value={studentPackageForm.registrationStartDate}
                      onChange={(e) =>
                        setStudentPackageForm((prev) => ({
                          ...prev,
                          registrationStartDate: e.target.value,
                        }))
                      }
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid #444',
                        background: '#1f1f1f',
                        color: 'white',
                      }}
                    />
                    {studentPackageFormErrors.registrationStartDate ? (
                      <span style={{ color: '#f08080', fontSize: 12 }}>
                        {studentPackageFormErrors.registrationStartDate}
                      </span>
                    ) : null}
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                    <span style={{ opacity: 0.85 }}>등록 주수</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={studentPackageForm.registrationWeeks}
                      onChange={(e) =>
                        setStudentPackageForm((prev) => ({
                          ...prev,
                          registrationWeeks: e.target.value,
                        }))
                      }
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid #444',
                        background: '#1f1f1f',
                        color: 'white',
                      }}
                    />
                    {studentPackageFormErrors.registrationWeeks ? (
                      <span style={{ color: '#f08080', fontSize: 12 }}>
                        {studentPackageFormErrors.registrationWeeks}
                      </span>
                    ) : null}
                  </label>

                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid #333',
                      background: '#1a1d26',
                      fontSize: 12,
                      lineHeight: 1.55,
                      opacity: 0.95,
                    }}
                  >
                    <div style={{ marginBottom: 6, fontWeight: 600 }}>
                      이 반은 주당 {studentPackageGroupAutoSummary?.weeklyClassCount ?? 1}회 수업입니다
                      {studentPackageGroupAutoSummary?.weekdayLabels
                        ? ` (${studentPackageGroupAutoSummary.weekdayLabels})`
                        : ''}
                    </div>
                    <div>
                      코스 유형: {getGroupCourseTypeLabel(studentPackageForm.groupCourseType) || '-'}
                    </div>
                    <div>
                      주당 {studentPackageGroupAutoSummary?.weeklyClassCount ?? 1}회 ×{' '}
                      {studentPackageGroupAutoSummary?.registrationWeeks ?? 0}주 ={' '}
                      {studentPackageGroupAutoSummary?.targetCount ?? 0}회
                    </div>
                    <div>
                      실제 일정:{' '}
                      {studentPackageGroupAutoSummary?.coverageStartDate
                        ? `${studentPackageGroupAutoSummary.coverageStartDate} ~ ${studentPackageGroupAutoSummary.coverageEndDate || studentPackageGroupAutoSummary.coverageStartDate}`
                        : '선택된 일정 없음'}
                    </div>
                    <div>
                      생성 예정 수업 {studentPackageGroupAutoSummary?.computedTotalCount ?? 0}건
                    </div>
                    {(studentPackageGroupAutoSummary?.computedTotalCount ?? 0) <
                    (studentPackageGroupAutoSummary?.targetCount ?? 0) ? (
                      <div style={{ marginTop: 4, color: '#f2c27a' }}>
                        실제 일정이 부족해 예상 횟수보다 적게 계산되었습니다.
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>만료일 (선택)</span>
                <input
                  type="date"
                  value={studentPackageForm.expiresAt}
                  onChange={(e) =>
                    setStudentPackageForm((prev) => ({ ...prev, expiresAt: e.target.value }))
                  }
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#1f1f1f',
                    color: 'white',
                  }}
                />
                {studentPackageFormErrors.expiresAt ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentPackageFormErrors.expiresAt}
                  </span>
                ) : null}
              </label>

              {canViewPaymentFields ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ opacity: 0.85 }}>결제일 (선택)</span>
                  <input
                    type="date"
                    aria-label="결제일 (선택)"
                    data-testid="student-package-payment-date-input"
                    value={studentPackageForm.paymentDate}
                    onChange={(e) =>
                      setStudentPackageForm((prev) => ({ ...prev, paymentDate: e.target.value }))
                    }
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                    }}
                  />
                  <span style={{ fontSize: 12, lineHeight: 1.45, opacity: 0.72 }}>
                    결제일은 실제 결제한 날짜입니다. 수강권 시작일과 다를 수 있습니다.
                  </span>
                  {studentPackageFormErrors.paymentDate ? (
                    <span style={{ color: '#f08080', fontSize: 12 }}>
                      {studentPackageFormErrors.paymentDate}
                    </span>
                  ) : null}
                </label>
              ) : null}

              {canViewPaymentFields ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ opacity: 0.85 }}>결제 금액 (선택)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={studentPackageForm.amountPaid}
                    onChange={(e) =>
                      setStudentPackageForm((prev) => ({ ...prev, amountPaid: e.target.value }))
                    }
                    placeholder="0"
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                    }}
                  />
                  {studentPackageFormErrors.amountPaid ? (
                    <span style={{ color: '#f08080', fontSize: 12 }}>
                      {studentPackageFormErrors.amountPaid}
                    </span>
                  ) : null}
                </label>
              ) : null}

              {canViewPaymentFields ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ opacity: 0.85 }}>메모 (선택)</span>
                  <textarea
                    value={studentPackageForm.memo}
                    onChange={(e) =>
                      setStudentPackageForm((prev) => ({ ...prev, memo: e.target.value }))
                    }
                    rows={3}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                      resize: 'vertical',
                    }}
                  />
                </label>
              ) : null}
                </>
              ) : null}
            </div>

            {studentPackageModalActiveSameScopeDuplicates.length > 0 ? (
              <div
                data-testid="student-package-duplicate-guidance"
                style={{
                  marginTop: 16,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(220, 140, 60, 0.55)',
                  background: 'rgba(80, 50, 20, 0.35)',
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 8, opacity: 0.95 }}>
                  {isPrivatePackage
                    ? '이미 사용 중인 개인 수강권이 있습니다.'
                    : '같은 범위의 사용 중 수강권이 이미 있습니다.'}
                </div>
                {isPrivatePackage ? (
                  <p style={{ margin: '0 0 10px 0', opacity: 0.9 }}>
                    기존 수강권에 추가 등록할 수 있습니다.
                  </p>
                ) : null}
                {hasMultiplePrivateDuplicatePackages ? (
                  <div
                    data-testid="student-package-multiple-duplicates-warning"
                    style={{
                      margin: '0 0 10px 0',
                      color: '#f2c27a',
                      fontSize: 12,
                      lineHeight: 1.5,
                    }}
                  >
                    같은 선생님 수강권이 여러 개 있습니다. 일반적으로 하나의 수강권에 추가
                    등록하는 것을 권장합니다.
                  </div>
                ) : null}
                {isPrivateTopUpFlow && primaryDuplicatePackage ? (
                  <div
                    data-testid="student-package-top-up-section"
                    style={{
                      marginBottom: 12,
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid rgba(90, 125, 255, 0.45)',
                      background: 'rgba(35, 52, 105, 0.28)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>기존 수강권에 추가 등록</div>
                    <div style={{ opacity: 0.92 }}>
                      현재 수강권:{' '}
                      <strong>{String(primaryDuplicatePackage.title || '').trim() || '-'}</strong>
                    </div>
                    <div>
                      총 {Number(primaryDuplicatePackage.totalCount ?? 0) || 0}회 · 사용{' '}
                      {Number(primaryDuplicatePackage.usedCount ?? 0) || 0}회 · 남은{' '}
                      {Number(primaryDuplicatePackage.remainingCount ?? 0) || 0}회
                    </div>
                    <div>
                      고정 예정 {primaryDuplicateFixedScheduled}회 · 예약{' '}
                      {primaryDuplicateActiveReservations}회 · 새 배정 가능{' '}
                      {primaryDuplicateAvailableForAssignment}회
                    </div>
                    <div>사용 가능 선생님: {formatTeacherScopeLabel(primaryDuplicatePackage)}</div>
                    <div style={{ opacity: 0.78 }}>
                      등록 회차: {Number.isFinite(topUpRegistrationRound) && topUpRegistrationRound > 0
                        ? `${topUpRegistrationRound}회차 등록`
                        : '추가 등록'}
                    </div>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ opacity: 0.85 }}>이번에 추가할 수업 횟수</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        data-testid="private-package-top-up-count-input"
                        value={studentPackageForm.totalCount}
                        onChange={(e) =>
                          setStudentPackageForm((prev) => ({ ...prev, totalCount: e.target.value }))
                        }
                        style={{
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: '1px solid #444',
                          background: '#1f1f1f',
                          color: 'white',
                        }}
                      />
                      {studentPackageFormErrors.totalCount ? (
                        <span style={{ color: '#f08080', fontSize: 12 }}>
                          {studentPackageFormErrors.totalCount}
                        </span>
                      ) : null}
                      <span style={{ fontSize: 12, lineHeight: 1.45, opacity: 0.72 }}>
                        4주 등록이면 4를 입력하세요. 예: 주1회 4주 등록 = 추가 횟수 4회.
                      </span>
                    </label>
                    <div
                      data-testid="private-package-top-up-preview"
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid #2e3240',
                        background: 'rgba(0, 0, 0, 0.18)',
                        fontSize: 12,
                        lineHeight: 1.55,
                      }}
                    >
                      <div>이번 추가: +{topUpCountPreview}회</div>
                      <div>저장 후 총 횟수: {topUpTotalCountPreview}회</div>
                      <div>저장 후 새 배정 가능: {topUpAvailableForAssignmentPreview}회</div>
                    </div>
                    {canViewPaymentFields ? (
                      <>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ opacity: 0.85 }}>결제일 (선택)</span>
                          <input
                            type="date"
                            aria-label="결제일 (선택)"
                            data-testid="student-package-payment-date-input"
                            value={studentPackageForm.paymentDate}
                            onChange={(e) =>
                              setStudentPackageForm((prev) => ({
                                ...prev,
                                paymentDate: e.target.value,
                              }))
                            }
                            style={{
                              padding: '10px 12px',
                              borderRadius: 8,
                              border: '1px solid #444',
                              background: '#1f1f1f',
                              color: 'white',
                            }}
                          />
                          {studentPackageFormErrors.paymentDate ? (
                            <span style={{ color: '#f08080', fontSize: 12 }}>
                              {studentPackageFormErrors.paymentDate}
                            </span>
                          ) : null}
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ opacity: 0.85 }}>결제 금액 (선택)</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            data-testid="private-package-top-up-amount-input"
                            value={studentPackageForm.amountPaid}
                            onChange={(e) =>
                              setStudentPackageForm((prev) => ({
                                ...prev,
                                amountPaid: e.target.value,
                              }))
                            }
                            placeholder="0"
                            style={{
                              padding: '10px 12px',
                              borderRadius: 8,
                              border: '1px solid #444',
                              background: '#1f1f1f',
                              color: 'white',
                            }}
                          />
                          {studentPackageFormErrors.amountPaid ? (
                            <span style={{ color: '#f08080', fontSize: 12 }}>
                              {studentPackageFormErrors.amountPaid}
                            </span>
                          ) : null}
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ opacity: 0.85 }}>메모 (선택)</span>
                          <textarea
                            data-testid="private-package-top-up-memo-input"
                            value={studentPackageForm.memo}
                            onChange={(e) =>
                              setStudentPackageForm((prev) => ({ ...prev, memo: e.target.value }))
                            }
                            rows={3}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 8,
                              border: '1px solid #444',
                              background: '#1f1f1f',
                              color: 'white',
                              resize: 'vertical',
                            }}
                          />
                        </label>
                      </>
                    ) : null}
                  </div>
                ) : null}
                <ul style={{ margin: 0, paddingLeft: 18, opacity: 0.9 }}>
                  {studentPackageModalActiveSameScopeDuplicates.map((p) => {
                    const balance = isPrivatePackage ? p.privateAssignmentBalance || null : null
                    const fixedScheduled = Math.max(
                      0,
                      Number(balance?.futureFixedAllocatedCount) || 0
                    )
                    const activeReservations = Math.max(
                      0,
                      Number(balance?.activeFutureReservationCount) || 0
                    )
                    const availableForAssignment = Math.max(
                      0,
                      Number(balance?.makeupAvailableCount) || 0
                    )
                    const startDate = formatGroupStudentStartDate(p.registrationStartDate)
                    const weeklyFrequency = Number(p.weeklyFrequency || 0)
                    const registrationWeeks = Number(p.registrationWeeks || 0)
                    const scheduleParts = []
                    if (startDate !== '-') scheduleParts.push(`${startDate} 시작`)
                    if (weeklyFrequency > 0) scheduleParts.push(`주${weeklyFrequency}회`)
                    if (registrationWeeks > 0) scheduleParts.push(`${registrationWeeks}주`)
                    return (
                      <li key={p.id} style={{ marginBottom: 8 }}>
                        <div>
                          <span style={{ opacity: 0.85 }}>현재 수강권:</span>{' '}
                          {String(p.title || '').trim() || '-'}
                          {scheduleParts.length > 0 ? ` · ${scheduleParts.join(' · ')}` : ''}
                        </div>
                        {isPrivatePackage ? (
                          <div>
                            총 {Number(p.totalCount ?? 0) || 0}회 · 사용{' '}
                            {Number(p.usedCount ?? 0) || 0}회 · 잔여{' '}
                            {Number(p.remainingCount ?? 0) || 0}회 · 고정 예정 {fixedScheduled}회 ·
                            예약 {activeReservations}회 · 새 배정 가능 {availableForAssignment}회
                          </div>
                        ) : (
                          <div>
                            총 {Number(p.totalCount ?? 0) || 0}회 · 사용{' '}
                            {Number(p.usedCount ?? 0) || 0}회 · 잔여{' '}
                            {Number(p.remainingCount ?? 0) || 0}회
                          </div>
                        )}
                        {p.expiresAt ? (
                          <div style={{ opacity: 0.82 }}>
                            만료 {formatGroupStudentStartDate(p.expiresAt)}
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
                {hasPrivateDuplicatePackage ? (
                  <div
                    data-testid="private-package-other-options"
                    style={{
                      marginTop: 12,
                      paddingTop: 10,
                      borderTop: '1px solid rgba(255, 255, 255, 0.12)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ fontWeight: 600, opacity: 0.86 }}>기타 옵션</div>
                    <div style={{ fontSize: 12, opacity: 0.78 }}>
                      일반적인 2회차/3회차 등록은 기존 수강권에 추가 등록을 사용하세요.
                    </div>
                    {isPrivateTopUpFlow ? (
                      <button
                        type="button"
                        onClick={() =>
                          setStudentPackageForm((prev) => ({
                            ...prev,
                            privateDuplicateAction: 'new',
                          }))
                        }
                        data-testid="private-package-force-new-button"
                        style={{
                          alignSelf: 'flex-start',
                          padding: '7px 10px',
                          borderRadius: 8,
                          border: '1px solid #665533',
                          background: '#2b281b',
                          color: '#ffe8b8',
                          cursor: 'pointer',
                        }}
                      >
                        새 수강권으로 발급
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setStudentPackageForm((prev) => ({
                            ...prev,
                            privateDuplicateAction: 'topUp',
                          }))
                        }
                        data-testid="private-package-use-top-up-button"
                        style={{
                          alignSelf: 'flex-start',
                          padding: '7px 10px',
                          borderRadius: 8,
                          border: '1px solid #4a6fff55',
                          background: '#1f2a44',
                          color: 'white',
                          cursor: 'pointer',
                        }}
                      >
                        기존 수강권에 추가 등록
                      </button>
                    )}
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  {primaryDuplicatePackage && openExistingStudentPackageFromAddModal ? (
                    <button
                      type="button"
                      onClick={() => openExistingStudentPackageFromAddModal(primaryDuplicatePackage)}
                      data-testid="student-package-edit-existing-button"
                      style={{
                        padding: '7px 10px',
                        borderRadius: 8,
                        border: '1px solid #665533',
                        background: '#2b281b',
                        color: '#ffe8b8',
                        cursor: 'pointer',
                      }}
                    >
                      기존 수강권 수정
                    </button>
                  ) : null}
                  {isPrivatePackage && goToFixedPrivateAssignmentFromPackageModal ? (
                    <button
                      type="button"
                      onClick={goToFixedPrivateAssignmentFromPackageModal}
                      data-testid="student-package-go-fixed-assignment-button"
                      style={{
                        padding: '7px 10px',
                        borderRadius: 8,
                        border: '1px solid #4a6fff55',
                        background: '#1f2a44',
                        color: 'white',
                        cursor: 'pointer',
                      }}
                    >
                      고정 1:1 수업 배정으로 이동
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 20,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={closeStudentPackageModal}
                disabled={isStudentPackageModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor: isStudentPackageModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitStudentPackageModal}
                disabled={isStudentPackageModalSubmitting}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #4a6fff55',
                  background: '#1f2a44',
                  color: 'white',
                  cursor: isStudentPackageModalSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                {isStudentPackageModalSubmitting
                  ? '저장 중...'
                  : isPrivateTopUpFlow
                    ? '기존 수강권에 추가 등록'
                    : hasPrivateDuplicatePackage &&
                        String(studentPackageForm.privateDuplicateAction || 'topUp') === 'new'
                      ? '새 수강권으로 발급'
                      : '저장'}
              </button>
            </div>
          </div>
        </div>

  )
}
