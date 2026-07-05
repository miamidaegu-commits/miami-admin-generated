import { useMemo, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions as firebaseFunctions } from '../../../../firebase.js'
import { formatLessonStatsMonthLabel } from '../lessonOccurrenceStats.js'
import TeacherLessonRosterModal from '../modals/TeacherLessonRosterModal.jsx'

const TEACHER_INVITATION_APP_URL_BY_PROJECT_ID = {
  'daegu-miami-production': 'https://daegumiami.com',
  'miami-e2e': 'https://miami-e2e.web.app',
}

function getTeacherInvitationAppUrl() {
  const configuredUrl = String(import.meta.env.VITE_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
  if (configuredUrl) return configuredUrl

  const projectId = String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim()
  return TEACHER_INVITATION_APP_URL_BY_PROJECT_ID[projectId] || 'https://miami-e2e.web.app'
}

const TEACHER_INVITATION_APP_URL = getTeacherInvitationAppUrl()

function formatDateTime(value) {
  if (!value) return '-'
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(status) {
  return status === 'inactive' ? '비활성' : '활성'
}

function cleanText(value, fallback = '-') {
  const text = String(value || '').trim()
  return text || fallback
}

function getTeacherKey(teacher) {
  return String(teacher?.teacherKey || teacher?.teacherName || '').trim()
}

function statNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function TeacherLessonCountStatsSection({ lessonCountStats, loading }) {
  const rows = Array.isArray(lessonCountStats?.teacherRows)
    ? lessonCountStats.teacherRows
    : []
  const overall = lessonCountStats?.overall || null
  const monthLabel = formatLessonStatsMonthLabel(lessonCountStats?.range)

  return (
    <section
      data-testid="teacher-lesson-count-stats-section"
      style={{
        border: '1px solid #2e3240',
        borderRadius: 12,
        background: '#151922',
        padding: 16,
        marginBottom: 20,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 16 }}>선생님별 수업 통계</h3>
          <p style={{ margin: '4px 0 0 0', opacity: 0.72, fontSize: 12 }}>
            {monthLabel} 기준 · 현재 월은 오늘까지 누적
          </p>
        </div>
        <div
          data-testid="teacher-lesson-count-total"
          style={{
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            fontSize: 13,
          }}
        >
          <strong>전체 합계</strong>
          <span>오늘 수업 {statNumber(overall?.today?.total)}</span>
          <span>이번 달 누적 수업 {statNumber(overall?.month?.total)}</span>
        </div>
      </div>

      {loading ? (
        <p style={{ margin: 0, opacity: 0.72 }}>통계를 불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p style={{ margin: 0, opacity: 0.72 }}>표시할 선생님 통계가 없습니다.</p>
      ) : (
        <div className="activity-table">
          <div
            className="table-head"
            style={{
              gridTemplateColumns: '1.3fr repeat(4, minmax(96px, 0.7fr))',
            }}
          >
            <span>선생님명</span>
            <span>오늘 수업</span>
            <span>이번 달 누적 수업</span>
            <span>1:1</span>
            <span>단체수업</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.teacherId || row.teacherKey || row.teacherName}
              className="table-row"
              data-testid="teacher-lesson-count-stats-row"
              style={{
                gridTemplateColumns: '1.3fr repeat(4, minmax(96px, 0.7fr))',
              }}
            >
              <span>{cleanText(row.teacherName)}</span>
              <span>{statNumber(row.stats?.today?.total)}</span>
              <span>{statNumber(row.stats?.month?.total)}</span>
              <span>{statNumber(row.stats?.month?.privateCount)}</span>
              <span>{statNumber(row.stats?.month?.groupCount)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function buildTeacherInvitationMessage({ email, resetLink }) {
  return [
    '안녕하세요. 선생님 로그인 안내입니다.',
    '아래 링크를 눌러 비밀번호를 설정한 뒤 로그인해 주세요.',
    '',
    `로그인 이메일: ${String(email || '').trim()}`,
    `비밀번호 설정 링크: ${String(resetLink || '').trim()}`,
    `로그인 페이지: ${TEACHER_INVITATION_APP_URL}`,
  ].join('\n')
}

async function copyTextToClipboard(text) {
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (error) {
      console.warn('Clipboard API copy failed, falling back to selection copy:', error)
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-1000px'
  textarea.style.left = '-1000px'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }
}

function getTeacherInviteErrorMessage(error) {
  const message = String(error?.message || '').trim()
  if (error?.code === 'functions/unauthenticated') return '로그인이 필요합니다.'
  if (error?.code === 'functions/permission-denied') {
    return '관리자만 선생님 로그인 초대를 만들 수 있습니다.'
  }
  if (error?.code === 'functions/invalid-argument') {
    if (/teacher/i.test(message)) return '선택한 선생님 정보를 찾을 수 없습니다.'
    return message || '입력값을 확인해 주세요.'
  }
  if (error?.code === 'functions/failed-precondition') {
    if (/role|convert|membership/i.test(message)) {
      return '이미 다른 권한으로 연결된 이메일은 사용할 수 없습니다.'
    }
    return message || '이미 연결된 계정 정보를 확인해 주세요.'
  }
  return message || '선생님 로그인 초대에 실패했습니다.'
}

export default function TeacherManagementSection({
  currentAcademyId,
  teachers,
  teachersLoading,
  teacherForm,
  setTeacherForm,
  teacherFormErrors,
  isTeacherFormSubmitting,
  submitTeacherForm,
  editTeacher,
  cancelTeacherEdit,
  updateTeacherStatus,
  updateTeacherCountEditPermission,
  updateTeacherLessonDeductionPermission,
  busyTeacherId,
  lessons = [],
  privateLessonReservations = [],
  privateLessonSlots = [],
  privateStudents = [],
  studentPackages = [],
  studentPrivateBookingStats = [],
  lessonCountStats = null,
  rosterDataLoading = false,
}) {
  const isEditing = Boolean(teacherForm.id)
  const [inviteTeacher, setInviteTeacher] = useState(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteDisplayName, setInviteDisplayName] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteResult, setInviteResult] = useState(null)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [permissionMessage, setPermissionMessage] = useState('')
  const [permissionError, setPermissionError] = useState('')
  const [rosterTeacher, setRosterTeacher] = useState(null)

  const invitationMessage = useMemo(() => {
    const resetLink = String(inviteResult?.passwordResetLink || inviteResult?.resetLink || '').trim()
    if (!resetLink) return ''
    return buildTeacherInvitationMessage({
      email: inviteResult?.email || inviteEmail,
      resetLink,
    })
  }, [inviteEmail, inviteResult?.email, inviteResult?.passwordResetLink, inviteResult?.resetLink])

  function openInviteModal(teacher) {
    setInviteTeacher(teacher)
    setInviteEmail('')
    setInviteDisplayName(String(teacher?.name || teacher?.teacherName || '').trim())
    setInviteBusy(false)
    setInviteError('')
    setInviteResult(null)
    setInviteCopied(false)
  }

  function closeInviteModal() {
    if (inviteBusy) return
    setInviteTeacher(null)
    setInviteEmail('')
    setInviteDisplayName('')
    setInviteError('')
    setInviteResult(null)
    setInviteCopied(false)
  }

  async function submitTeacherInvite() {
    if (!inviteTeacher || inviteBusy) return
    const teacherKey = getTeacherKey(inviteTeacher)
    if (!teacherKey) {
      setInviteError('선택한 선생님 정보를 찾을 수 없습니다.')
      return
    }

    setInviteBusy(true)
    setInviteError('')
    setInviteResult(null)
    setInviteCopied(false)
    try {
      const linkTeacherAccount = httpsCallable(firebaseFunctions, 'linkTeacherAccount')
      const result = await linkTeacherAccount({
        academyId: currentAcademyId,
        teacherId: inviteTeacher.id,
        teacherKey,
        email: inviteEmail.trim(),
        displayName: inviteDisplayName.trim(),
      })
      setInviteResult(result.data)
    } catch (error) {
      console.error('선생님 로그인 초대 실패:', error)
      setInviteError(getTeacherInviteErrorMessage(error))
    } finally {
      setInviteBusy(false)
    }
  }

  async function copyInvitationMessage() {
    if (!invitationMessage) return
    try {
      await copyTextToClipboard(invitationMessage)
      setInviteCopied(true)
    } catch (error) {
      console.warn('선생님 로그인 초대 안내문 복사 실패:', error)
    }
  }

  async function toggleCountEditPermission(teacher) {
    if (!updateTeacherCountEditPermission) return
    const nextEnabled = teacher.countEditPermissionEnabled !== true
    setPermissionMessage('')
    setPermissionError('')
    try {
      await updateTeacherCountEditPermission(teacher, nextEnabled)
      setPermissionMessage(
        nextEnabled
          ? '학생 수강권 횟수 수정 권한을 허용했습니다.'
          : '학생 수강권 횟수 수정 권한을 차단했습니다.'
      )
    } catch (error) {
      console.error('학생 수강권 횟수 수정 권한 변경 실패:', error)
      setPermissionError('권한 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  async function toggleLessonDeductionPermission(teacher) {
    if (!updateTeacherLessonDeductionPermission) return
    const nextEnabled = teacher.lessonDeductionPermissionEnabled !== true
    setPermissionMessage('')
    setPermissionError('')
    try {
      await updateTeacherLessonDeductionPermission(teacher, nextEnabled)
      setPermissionMessage(
        nextEnabled
          ? '수업 차감 관리 권한을 허용했습니다.'
          : '수업 차감 관리 권한을 차단했습니다.'
      )
    } catch (error) {
      console.error('수업 차감 관리 권한 변경 실패:', error)
      setPermissionError('권한 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  return (
    <section className="activity-section" data-testid="teacher-management-section">
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
          선생님 관리
        </h2>
      </div>

      <TeacherLessonCountStatsSection
        lessonCountStats={lessonCountStats}
        loading={rosterDataLoading}
      />

      <form
        onSubmit={(event) => {
          event.preventDefault()
          submitTeacherForm()
        }}
        data-testid="teacher-management-form"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          padding: 16,
          border: '1px solid #2e3240',
          borderRadius: 12,
          background: '#151922',
          marginBottom: 20,
        }}
      >
        <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          선생님 이름
          <input
            type="text"
            value={teacherForm.name}
            onChange={(event) =>
              setTeacherForm((prev) => ({ ...prev, name: event.target.value }))
            }
            aria-label="선생님 이름"
            autoComplete="off"
          />
          {teacherFormErrors.name ? (
            <span style={{ color: '#f4a7a7' }}>{teacherFormErrors.name}</span>
          ) : null}
        </label>

        <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          teacherKey
          <input
            type="text"
            value={teacherForm.teacherKey}
            onChange={(event) =>
              setTeacherForm((prev) => ({ ...prev, teacherKey: event.target.value }))
            }
            aria-label="teacherKey"
            autoComplete="off"
            placeholder="비우면 이름 기준으로 자동 생성"
          />
          {teacherFormErrors.teacherKey ? (
            <span style={{ color: '#f4a7a7' }}>{teacherFormErrors.teacherKey}</span>
          ) : null}
        </label>

        <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          상태
          <select
            value={teacherForm.status}
            onChange={(event) =>
              setTeacherForm((prev) => ({ ...prev, status: event.target.value }))
            }
            aria-label="선생님 상태"
          >
            <option value="active">활성</option>
            <option value="inactive">비활성</option>
          </select>
        </label>

        <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
          <button
            type="submit"
            disabled={isTeacherFormSubmitting}
            data-testid="teacher-management-submit-button"
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              border: '1px solid #444',
              background: '#1f2a44',
              color: 'white',
              cursor: isTeacherFormSubmitting ? 'not-allowed' : 'pointer',
              width: '100%',
            }}
          >
            {isTeacherFormSubmitting
              ? '저장 중...'
              : isEditing
              ? '선생님 수정'
              : '선생님 추가'}
          </button>
          {isEditing ? (
            <button
              type="button"
              onClick={cancelTeacherEdit}
              disabled={isTeacherFormSubmitting}
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid #444',
                background: '#20242f',
                color: 'white',
                cursor: isTeacherFormSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              취소
            </button>
          ) : null}
        </div>
      </form>

      {teachersLoading ? (
        <p>불러오는 중...</p>
      ) : teachers.length === 0 ? (
        <p style={{ opacity: 0.8 }}>등록된 선생님이 없습니다.</p>
      ) : (
        <div className="activity-table">
          {permissionMessage ? (
            <p
              data-testid="teacher-count-edit-permission-success"
              style={{ margin: '0 0 10px 0', color: '#9ee6b2', fontSize: 13 }}
            >
              {permissionMessage}
            </p>
          ) : null}
          {permissionError ? (
            <p
              data-testid="teacher-count-edit-permission-error"
              style={{ margin: '0 0 10px 0', color: '#f4a7a7', fontSize: 13 }}
            >
              {permissionError}
            </p>
          ) : null}
          <div
            className="table-head"
            style={{
              gridTemplateColumns:
                '1fr 1fr 0.7fr 1fr minmax(180px, 1.1fr) minmax(180px, 1.1fr) minmax(150px, auto)',
            }}
          >
            <span>이름</span>
            <span>teacherKey</span>
            <span>상태</span>
            <span>수정일</span>
            <span>학생 수강권 횟수 수정 권한</span>
            <span>수업 차감 관리 권한</span>
            <span>작업</span>
          </div>
          {teachers.map((teacher) => {
            const teacherKey = getTeacherKey(teacher)
            const active = String(teacher.status || 'active') === 'active'
            const countEditEnabled = teacher.countEditPermissionEnabled === true
            const permissionBusy = busyTeacherId === `${teacher.id}__count_edit_permission`
            const lessonDeductionEnabled = teacher.lessonDeductionPermissionEnabled === true
            const lessonDeductionBusy =
              busyTeacherId === `${teacher.id}__lesson_deduction_permission`
            const hasLinkedMembership = Boolean(teacher.teacherMembershipId)
            return (
            <div
              key={teacher.id}
              className="table-row"
              style={{
                gridTemplateColumns:
                  '1fr 1fr 0.7fr 1fr minmax(180px, 1.1fr) minmax(180px, 1.1fr) minmax(150px, auto)',
              }}
              data-testid="teacher-management-row"
              data-teacher-key={teacherKey}
            >
              <span>{cleanText(teacher.name || teacher.teacherName)}</span>
              <span className="cell-user">{cleanText(teacherKey)}</span>
              <span>{statusLabel(teacher.status)}</span>
              <span className="cell-time">{formatDateTime(teacher.updatedAt)}</span>
              <span style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
                <span
                  data-testid="teacher-count-edit-permission-status"
                  style={{
                    fontSize: 12,
                    color: countEditEnabled ? '#9ee6b2' : '#f4c7a1',
                  }}
                >
                  {hasLinkedMembership
                    ? countEditEnabled
                      ? '횟수 수정 허용'
                      : '횟수 수정 차단'
                    : '로그인 연결 필요'}
                </span>
                <button
                  type="button"
                  onClick={() => toggleCountEditPermission(teacher)}
                  disabled={!hasLinkedMembership || permissionBusy}
                  data-testid="teacher-count-edit-permission-toggle"
                  style={{
                    padding: '7px 10px',
                    borderRadius: 8,
                    border: countEditEnabled ? '1px solid #7a3636' : '1px solid #335544',
                    background: countEditEnabled ? '#3f1f25' : '#243528',
                    color: 'white',
                    cursor: !hasLinkedMembership || permissionBusy ? 'not-allowed' : 'pointer',
                    opacity: !hasLinkedMembership ? 0.65 : 1,
                  }}
                >
                  {permissionBusy
                    ? '변경 중...'
                    : countEditEnabled
                    ? '횟수 수정 차단'
                    : '횟수 수정 허용'}
                </button>
              </span>
              <span style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
                <span
                  data-testid="teacher-lesson-deduction-permission-status"
                  style={{
                    fontSize: 12,
                    color: lessonDeductionEnabled ? '#9ee6b2' : '#f4c7a1',
                  }}
                >
                  {hasLinkedMembership
                    ? lessonDeductionEnabled
                      ? '차감 관리 허용'
                      : '차감 관리 차단'
                    : '로그인 연결 필요'}
                </span>
                <button
                  type="button"
                  onClick={() => toggleLessonDeductionPermission(teacher)}
                  disabled={!hasLinkedMembership || lessonDeductionBusy}
                  data-testid="teacher-lesson-deduction-permission-toggle"
                  style={{
                    padding: '7px 10px',
                    borderRadius: 8,
                    border: lessonDeductionEnabled ? '1px solid #7a3636' : '1px solid #335544',
                    background: lessonDeductionEnabled ? '#3f1f25' : '#243528',
                    color: 'white',
                    cursor: !hasLinkedMembership || lessonDeductionBusy ? 'not-allowed' : 'pointer',
                    opacity: !hasLinkedMembership ? 0.65 : 1,
                  }}
                >
                  {lessonDeductionBusy
                    ? '변경 중...'
                    : lessonDeductionEnabled
                    ? '차감 관리 차단'
                    : '차감 관리 허용'}
                </button>
              </span>
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setRosterTeacher(teacher)}
                  data-testid="teacher-lesson-roster-open-button"
                  style={{
                    padding: '7px 10px',
                    borderRadius: 8,
                    border: '1px solid #4b5875',
                    background: '#1a2438',
                    color: 'white',
                    cursor: 'pointer',
                  }}
                >
                  수업 현황
                </button>
                {active ? (
                  <button
                    type="button"
                    onClick={() => openInviteModal(teacher)}
                    disabled={busyTeacherId === teacher.id}
                    data-testid="teacher-invite-open-button"
                    style={{
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: '1px solid #4b5875',
                      background: '#20293d',
                      color: 'white',
                      cursor: busyTeacherId === teacher.id ? 'not-allowed' : 'pointer',
                    }}
                  >
                    로그인 초대
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => editTeacher(teacher)}
                  disabled={busyTeacherId === teacher.id}
                  style={{
                    padding: '7px 10px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: '#20242f',
                    color: 'white',
                    cursor: busyTeacherId === teacher.id ? 'not-allowed' : 'pointer',
                  }}
                >
                  수정
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateTeacherStatus(
                      teacher,
                      teacher.status === 'inactive' ? 'active' : 'inactive'
                    )
                  }
                  disabled={busyTeacherId === teacher.id}
                  style={{
                    padding: '7px 10px',
                    borderRadius: 8,
                    border: '1px solid #444',
                    background: teacher.status === 'inactive' ? '#1f2a44' : '#3a2830',
                    color: 'white',
                    cursor: busyTeacherId === teacher.id ? 'not-allowed' : 'pointer',
                  }}
                >
                  {teacher.status === 'inactive' ? '활성화' : '비활성화'}
                </button>
              </span>
            </div>
            )
          })}
        </div>
      )}

      {inviteTeacher ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="teacher-invite-modal-title"
          data-testid="teacher-invite-modal"
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
            if (event.target === event.currentTarget && !inviteBusy) closeInviteModal()
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 620,
              border: '1px solid #2e3240',
              borderRadius: 12,
              background: '#151922',
              color: 'white',
              padding: 20,
              boxSizing: 'border-box',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="teacher-invite-modal-title"
              style={{ margin: '0 0 12px 0', fontSize: '1.1rem', fontWeight: 600 }}
            >
              선생님 로그인 초대
            </h2>
            <div style={{ margin: '0 0 16px 0', opacity: 0.78, fontSize: 13 }}>
              <div>선생님: {cleanText(inviteTeacher.name || inviteTeacher.teacherName)}</div>
              <div>teacherKey: {cleanText(getTeacherKey(inviteTeacher))}</div>
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                <span style={{ opacity: 0.8 }}>이메일</span>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  disabled={inviteBusy}
                  data-testid="teacher-invite-email-input"
                  style={{
                    padding: '9px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'inherit',
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                <span style={{ opacity: 0.8 }}>표시 이름</span>
                <input
                  type="text"
                  value={inviteDisplayName}
                  onChange={(event) => setInviteDisplayName(event.target.value)}
                  disabled={inviteBusy}
                  data-testid="teacher-invite-display-name-input"
                  style={{
                    padding: '9px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'inherit',
                  }}
                />
              </label>

              {inviteError ? (
                <p
                  data-testid="teacher-invite-error"
                  style={{ margin: 0, color: '#f4a7a7', fontSize: 13 }}
                >
                  {inviteError}
                </p>
              ) : null}

              {inviteResult ? (
                <div
                  data-testid="teacher-invite-success"
                  style={{
                    border: '1px solid #355d3f',
                    borderRadius: 8,
                    background: '#15291a',
                    padding: 12,
                    fontSize: 13,
                    lineHeight: 1.7,
                  }}
                >
                  <strong>초대 링크 준비 완료</strong>
                  <div style={{ opacity: 0.85 }}>
                    선생님이 안내문 링크에서 비밀번호를 설정한 뒤 로그인할 수 있습니다.
                  </div>
                </div>
              ) : null}

              {invitationMessage ? (
                <div data-testid="teacher-invite-invitation-section">
                  <div style={{ opacity: 0.85, fontSize: 13, marginBottom: 6, fontWeight: 600 }}>
                    선생님에게 보낼 안내문
                  </div>
                  <pre
                    data-testid="teacher-invite-invitation-message"
                    style={{
                      margin: 0,
                      padding: 12,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      borderRadius: 8,
                      border: '1px solid #30394f',
                      background: '#101521',
                      color: '#dbe7ff',
                      fontSize: 12,
                      minHeight: 48,
                    }}
                  >
                    {invitationMessage}
                  </pre>
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
              <button
                type="button"
                onClick={closeInviteModal}
                disabled={inviteBusy}
                style={{
                  padding: '9px 14px',
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: 'transparent',
                  color: 'white',
                  cursor: inviteBusy ? 'not-allowed' : 'pointer',
                }}
              >
                닫기
              </button>
              <button
                type="button"
                onClick={copyInvitationMessage}
                disabled={!invitationMessage || inviteBusy}
                data-testid="teacher-invite-copy-button"
                style={{
                  padding: '9px 14px',
                  borderRadius: 8,
                  border: '1px solid #4b5875',
                  background: '#20293d',
                  color: 'white',
                  cursor: invitationMessage && !inviteBusy ? 'pointer' : 'not-allowed',
                }}
              >
                {inviteCopied ? '복사 완료' : '안내문 복사'}
              </button>
              <button
                type="button"
                onClick={submitTeacherInvite}
                disabled={!inviteEmail.trim() || inviteBusy}
                data-testid="teacher-invite-submit-button"
                style={{
                  padding: '9px 14px',
                  borderRadius: 8,
                  border: '1px solid #335544',
                  background: '#243528',
                  color: 'white',
                  cursor: inviteEmail.trim() && !inviteBusy ? 'pointer' : 'not-allowed',
                }}
              >
                {inviteBusy ? '초대 링크 만드는 중...' : '초대 링크 만들기'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rosterTeacher ? (
        <TeacherLessonRosterModal
          teacher={rosterTeacher}
          academyId={currentAcademyId}
          lessons={lessons}
          privateLessonReservations={privateLessonReservations}
          privateLessonSlots={privateLessonSlots}
          privateStudents={privateStudents}
          studentPackages={studentPackages}
          studentPrivateBookingStats={studentPrivateBookingStats}
          loading={rosterDataLoading}
          onClose={() => setRosterTeacher(null)}
        />
      ) : null}
    </section>
  )
}
