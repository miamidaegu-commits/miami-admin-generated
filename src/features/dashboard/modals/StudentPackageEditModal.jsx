
import {
  DEFAULT_GROUP_COURSE_TYPE,
  GROUP_COURSE_TYPE_OPTIONS,
  getGroupCourseTypeLabel,
  normalizeGroupCourseType,
} from '../../group-booking/groupCourseTypes.js'
import { formatGroupStudentStartDate } from '../dashboardViewUtils.js'

export default function StudentPackageEditModal({
  studentPackageEditModalPackage,
  studentPackageEditForm,
  setStudentPackageEditForm,
  studentPackageEditFormErrors,
  busyStudentPackageActionId,
  studentPackageEditMode = 'admin',
  canViewPaymentFields = false,
  closeStudentPackageEditModal,
  submitStudentPackageEditModal,
}) {
  const countOnly = studentPackageEditMode === 'teacherCount'
  const showAdminFields = !countOnly
  const showBillingFields = showAdminFields && canViewPaymentFields
  const packageType = String(studentPackageEditModalPackage.packageType || '').trim()
  const isRegisteredGroupPackage = packageType === 'group'
  const isOpenGroupPackage = packageType === 'openGroup'
  const showGroupFreeBookingField = showAdminFields && packageType === 'group'
  const showGroupCancelLimitField =
    showAdminFields && (packageType === 'group' || packageType === 'openGroup')

  return (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-package-edit-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1002,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeStudentPackageEditModal()
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
              id="student-package-edit-modal-title"
              style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
            >
              수강권 수정
            </h2>
            {countOnly ? (
              <p style={{ margin: '0 0 14px 0', fontSize: 12, opacity: 0.78, lineHeight: 1.5 }}>
                학생: {studentPackageEditModalPackage.studentName || '-'}
                <br />
                수강권: {studentPackageEditModalPackage.title || '개인 수강권'}
              </p>
            ) : (
              <p style={{ margin: '0 0 14px 0', fontSize: 12, opacity: 0.78, lineHeight: 1.5 }}>
                studentId: {studentPackageEditModalPackage.studentId || '-'} · studentName:{' '}
                {studentPackageEditModalPackage.studentName || '-'}
                <br />
                teacher: {studentPackageEditModalPackage.teacher || '-'} · packageType:{' '}
                {String(studentPackageEditModalPackage.packageType || '-')}
                <br />
                groupClassId: {studentPackageEditModalPackage.groupClassId || '-'} ·
                groupClassName: {studentPackageEditModalPackage.groupClassName || '-'}
                <br />
                groupCourseType:{' '}
                {getGroupCourseTypeLabel(studentPackageEditModalPackage.groupCourseType) || '-'}
              </p>
            )}
            <p style={{ margin: '0 0 12px 0', fontSize: 13, opacity: 0.85 }}>
              사용 횟수(usedCount): {Number(studentPackageEditModalPackage.usedCount ?? 0)} (수정
              불가)
              <br />
              수강권 시작일:{' '}
              {formatGroupStudentStartDate(
                studentPackageEditModalPackage.registrationStartDate ||
                  studentPackageEditModalPackage.startDate
              )}
            </p>
            {countOnly ? (
              <p
                data-testid="student-package-count-edit-limited-note"
                style={{
                  margin: '0 0 12px 0',
                  padding: 10,
                  borderRadius: 8,
                  border: '1px solid #335544',
                  background: '#17251d',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                선생님 권한으로는 총 횟수만 수정할 수 있습니다.
              </p>
            ) : null}

            <form
              id="student-package-edit-form"
              onSubmit={(event) => {
                event.preventDefault()
                submitStudentPackageEditModal()
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              {showAdminFields ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ opacity: 0.85 }}>제목</span>
                  <input
                    type="text"
                    value={studentPackageEditForm.title}
                    onChange={(e) =>
                      setStudentPackageEditForm((prev) => ({ ...prev, title: e.target.value }))
                    }
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                    }}
                  />
                  {studentPackageEditFormErrors.title ? (
                    <span style={{ color: '#f08080', fontSize: 12 }}>
                      {studentPackageEditFormErrors.title}
                    </span>
                  ) : null}
                </label>
              ) : null}

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span style={{ opacity: 0.85 }}>총 횟수 (totalCount)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={studentPackageEditForm.totalCount}
                  onChange={(e) =>
                    setStudentPackageEditForm((prev) => ({
                      ...prev,
                      totalCount: e.target.value,
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
                {studentPackageEditFormErrors.totalCount ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {studentPackageEditFormErrors.totalCount}
                  </span>
                ) : null}
              </label>

              {showAdminFields && isOpenGroupPackage ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ opacity: 0.85 }}>코스 유형</span>
                  <select
                    aria-label="코스 유형"
                    data-testid="student-package-edit-open-group-course-type-select"
                    value={
                      normalizeGroupCourseType(studentPackageEditForm.groupCourseType) ||
                      DEFAULT_GROUP_COURSE_TYPE
                    }
                    onChange={(e) =>
                      setStudentPackageEditForm((prev) => ({
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
                  {studentPackageEditFormErrors.groupCourseType ? (
                    <span style={{ color: '#f08080', fontSize: 12 }}>
                      {studentPackageEditFormErrors.groupCourseType}
                    </span>
                  ) : null}
                </label>
              ) : null}

              {showAdminFields && isRegisteredGroupPackage ? (
                <div
                  data-testid="student-package-edit-group-course-type-readonly"
                  style={{
                    display: 'grid',
                    gap: 5,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #3a4a66',
                    background: '#182033',
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ opacity: 0.85 }}>코스 유형</div>
                  <div style={{ fontWeight: 700 }}>
                    {getGroupCourseTypeLabel(studentPackageEditForm.groupCourseType) ||
                      getGroupCourseTypeLabel(studentPackageEditModalPackage.groupCourseType) ||
                      '-'}
                  </div>
                  <div style={{ opacity: 0.72 }}>
                    반의 코스 유형을 변경하려면 단체반 관리 &gt; 반 수정에서 변경하세요.
                    저장 시 연결된 반의 코스 유형으로 수강권 값이 자동 동기화됩니다.
                  </div>
                </div>
              ) : null}

              {showGroupFreeBookingField ? (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    fontSize: 13,
                    lineHeight: 1.45,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={studentPackageEditForm.allowGroupFreeBooking === true}
                    onChange={(e) =>
                      setStudentPackageEditForm((prev) => ({
                        ...prev,
                        allowGroupFreeBooking: e.target.checked,
                      }))
                    }
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    반 등록 수업 외 남은 횟수로 자유 예약 허용
                    <br />
                    <span style={{ opacity: 0.72 }}>
                      켜면 반 등록 수업에 배정되지 않은 남은 횟수로 같은 코스 유형 수업을
                      선착순 예약할 수 있습니다.
                    </span>
                  </span>
                </label>
              ) : null}

              {showGroupCancelLimitField ? (
                <div
                  style={{
                    display: 'grid',
                    gap: 10,
                    padding: 12,
                    borderRadius: 10,
                    border: '1px solid #2e3a55',
                    background: '#182033',
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      fontSize: 13,
                      lineHeight: 1.45,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={studentPackageEditForm.groupCancelLimitEnabled === true}
                      onChange={(e) =>
                        setStudentPackageEditForm((prev) => ({
                          ...prev,
                          groupCancelLimitEnabled: e.target.checked,
                        }))
                      }
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      자유 예약 취소 가능 횟수 제한
                      <br />
                      <span style={{ opacity: 0.72 }}>
                        학생이 직접 취소하는 자유 예약에만 적용됩니다.
                      </span>
                    </span>
                  </label>

                  {studentPackageEditForm.groupCancelLimitEnabled === true ? (
                    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
                      <label
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          fontSize: 13,
                        }}
                      >
                        <span style={{ opacity: 0.85 }}>취소 가능 횟수</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={studentPackageEditForm.groupCancelLimitCount}
                          onChange={(e) =>
                            setStudentPackageEditForm((prev) => ({
                              ...prev,
                              groupCancelLimitCount: e.target.value,
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
                        {studentPackageEditFormErrors.groupCancelLimitCount ? (
                          <span style={{ color: '#f08080', fontSize: 12 }}>
                            {studentPackageEditFormErrors.groupCancelLimitCount}
                          </span>
                        ) : null}
                      </label>

                      <label
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          fontSize: 13,
                        }}
                      >
                        <span style={{ opacity: 0.85 }}>제한 기간</span>
                        <select
                          value={studentPackageEditForm.groupCancelLimitPeriod}
                          onChange={(e) =>
                            setStudentPackageEditForm((prev) => ({
                              ...prev,
                              groupCancelLimitPeriod: e.target.value,
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
                          <option value="calendarMonth">월별</option>
                          <option value="packagePeriod">수강권 기간</option>
                        </select>
                      </label>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {showAdminFields ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ opacity: 0.85 }}>만료일 (선택)</span>
                  <input
                    type="date"
                    value={studentPackageEditForm.expiresAt}
                    onChange={(e) =>
                      setStudentPackageEditForm((prev) => ({
                        ...prev,
                        expiresAt: e.target.value,
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
                  {studentPackageEditFormErrors.expiresAt ? (
                    <span style={{ color: '#f08080', fontSize: 12 }}>
                      {studentPackageEditFormErrors.expiresAt}
                    </span>
                  ) : null}
                </label>
              ) : null}

              {showBillingFields ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ opacity: 0.85 }}>결제일 (선택)</span>
                  <input
                    type="date"
                    aria-label="결제일 (선택)"
                    data-testid="student-package-payment-date-input"
                    value={studentPackageEditForm.paymentDate}
                    onChange={(e) =>
                      setStudentPackageEditForm((prev) => ({
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
                  <span style={{ fontSize: 12, lineHeight: 1.45, opacity: 0.72 }}>
                    결제일은 실제 결제한 날짜입니다. 수강권 시작일과 다를 수 있습니다.
                  </span>
                  {studentPackageEditFormErrors.paymentDate ? (
                    <span style={{ color: '#f08080', fontSize: 12 }}>
                      {studentPackageEditFormErrors.paymentDate}
                    </span>
                  ) : null}
                </label>
              ) : null}

              {showBillingFields ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ opacity: 0.85 }}>결제 금액 (선택)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={studentPackageEditForm.amountPaid}
                    onChange={(e) =>
                      setStudentPackageEditForm((prev) => ({
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
                  {studentPackageEditFormErrors.amountPaid ? (
                    <span style={{ color: '#f08080', fontSize: 12 }}>
                      {studentPackageEditFormErrors.amountPaid}
                    </span>
                  ) : null}
                </label>
              ) : null}

              {showBillingFields ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ opacity: 0.85 }}>메모 (선택)</span>
                  <textarea
                    value={studentPackageEditForm.memo}
                    onChange={(e) =>
                      setStudentPackageEditForm((prev) => ({ ...prev, memo: e.target.value }))
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
                onClick={closeStudentPackageEditModal}
                disabled={busyStudentPackageActionId === studentPackageEditModalPackage.id}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor:
                    busyStudentPackageActionId === studentPackageEditModalPackage.id
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                취소
              </button>
              <button
                type="submit"
                disabled={busyStudentPackageActionId === studentPackageEditModalPackage.id}
                data-testid="student-package-edit-save-button"
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #4a6fff55',
                  background: '#1f2a44',
                  color: 'white',
                  cursor:
                    busyStudentPackageActionId === studentPackageEditModalPackage.id
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                {busyStudentPackageActionId === studentPackageEditModalPackage.id
                  ? '저장 중...'
                  : '저장'}
              </button>
            </div>
            </form>
          </div>
        </div>

  )
}
