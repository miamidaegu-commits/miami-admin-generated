import {
  buildAutoGroupStudentPackageTitle,
  buildAutoPrivateStudentPackageTitle,
  computePrivateRegularTotalCount,
  formatGroupStudentStartDate,
} from '../dashboardViewUtils.js'

export default function StudentPackageModal({
  studentPackageModalStudent,
  studentPackageForm,
  setStudentPackageForm,
  studentPackageFormErrors,
  sortedGroupClasses,
  nextGroupLessonDateByGroupId,
  studentPackageGroupAutoSummary,
  studentPackageModalActiveSameScopeDuplicates,
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
  const autoTotalCount = isGroupPackage
    ? String(studentPackageGroupAutoSummary?.computedTotalCount ?? 0)
    : isPrivateRegular
      ? String(privateRegularComputed || 0)
      : String(studentPackageForm.totalCount || '')

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
                저장 후 첫 수업 예약 또는 반 등록을 이어서 할 수 있습니다.
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

              {isPrivatePackage ? (
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
                      정기등록
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
                      횟수권
                    </button>
                  </div>

                  {isPrivateRegular ? (
                    <>
                      <label
                        style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}
                      >
                        <span style={{ opacity: 0.85 }}>시작일</span>
                        <input
                          type="date"
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
                      setStudentPackageForm((prev) => ({
                        ...prev,
                        groupClassId: nextGid,
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
                    <span style={{ opacity: 0.85 }}>시작일</span>
                    <input
                      type="date"
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
            </div>

            {studentPackageModalActiveSameScopeDuplicates.length > 0 ? (
              <div
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
                  같은 범위의 사용 중 수강권이 이미 있습니다.
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, opacity: 0.9 }}>
                  {studentPackageModalActiveSameScopeDuplicates.map((p) => (
                    <li key={p.id} style={{ marginBottom: 6 }}>
                      <span style={{ opacity: 0.85 }}>제목</span> {String(p.title || '').trim() || '-'}
                      {' · '}
                      <span style={{ opacity: 0.85 }}>남은</span>{' '}
                      {p.remainingCount != null && p.remainingCount !== ''
                        ? String(p.remainingCount)
                        : '-'}
                      {' · '}
                      <span style={{ opacity: 0.85 }}>만료</span>{' '}
                      {formatGroupStudentStartDate(p.expiresAt)}
                    </li>
                  ))}
                </ul>
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
                {isStudentPackageModalSubmitting ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>

  )
}
