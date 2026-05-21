import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../../../../firebase.js'
import { normalizeText } from '../dashboardViewUtils.js'
import {
  buildTeacherPrivateLessonRequestPlans,
  parsePositiveInteger,
} from '../teacherPrivateLessonRequestPlanning.js'

const SUCCESS_MESSAGE = '수업 요청이 완료되었습니다.'

const mutedTextColor = '#aab5c4'
const readableMutedTextColor = '#c4cedd'
const panelBorder = '1px solid var(--border)'

const cardStyle = {
  border: panelBorder,
  borderRadius: 12,
  padding: 18,
  background: 'var(--surface)',
  color: 'var(--text)',
  boxShadow: '0 18px 44px rgba(0, 0, 0, 0.24)',
}

const labelStyle = {
  display: 'grid',
  gap: 6,
  color: readableMutedTextColor,
  fontSize: 13,
  fontWeight: 600,
}

const controlStyle = {
  width: '100%',
  minHeight: 40,
  border: '1px solid #343b4d',
  borderRadius: 8,
  padding: '9px 11px',
  background: 'var(--surface2)',
  color: 'var(--text)',
  font: 'inherit',
  outline: 'none',
  colorScheme: 'dark',
}

const fieldsetStyle = {
  border: panelBorder,
  borderRadius: 10,
  padding: 12,
  margin: 0,
  display: 'grid',
  gap: 10,
  background: 'rgba(28, 32, 41, 0.72)',
}

const legendStyle = {
  padding: '0 6px',
  color: 'var(--text)',
  fontWeight: 700,
}

const radioLabelStyle = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  color: 'var(--text)',
  fontSize: 13,
  lineHeight: 1.45,
}

const slotCardStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 12,
  border: panelBorder,
  borderRadius: 10,
  padding: 12,
  background: 'rgba(28, 32, 41, 0.72)',
}

const disabledCardStyle = {
  border: '1px dashed #4b5568',
  borderRadius: 12,
  padding: 16,
  background: 'rgba(21, 24, 32, 0.78)',
  color: mutedTextColor,
}

function makeEmptySlot() {
  return {
    date: '',
    time: '',
    subject: '',
  }
}

function makeSlotsForFrequency(frequency) {
  const count = Math.max(1, Math.min(Number(frequency) || 1, 3))
  return Array.from({ length: count }, () => makeEmptySlot())
}

function makeSeriesId() {
  return `teacher_fixed_private_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function getStudentName(student) {
  return String(student?.name || student?.studentName || student?.student || '').trim()
}

function cleanText(value, fallback = '-') {
  const text = String(value || '').trim()
  return text || fallback
}

function timestampSortValue(value) {
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function dateSortValue(value) {
  const text = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return 0
  const date = new Date(`${text}T00:00:00`)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function sortRequestHistoryRows(rows) {
  return rows.slice().sort((a, b) => {
    const createdAtCompare = timestampSortValue(b.createdAt) - timestampSortValue(a.createdAt)
    if (createdAtCompare !== 0) return createdAtCompare
    const dateCompare = dateSortValue(b.date) - dateSortValue(a.date)
    if (dateCompare !== 0) return dateCompare
    return String(b.id || '').localeCompare(String(a.id || ''))
  })
}

function getApprovalStatusLabel(status) {
  const normalizedStatus = String(status || 'pending').trim().toLowerCase()
  if (normalizedStatus === 'approved') return '승인됨'
  if (normalizedStatus === 'rejected') return '거절됨'
  return '대기'
}

function getRepeatSummary(request) {
  const repeatWeeks = Number.parseInt(String(request?.repeatWeeks ?? '1'), 10)
  const safeRepeatWeeks = Number.isInteger(repeatWeeks) && repeatWeeks > 0 ? repeatWeeks : 1
  return request?.repeatWeekly === true ? `매주 반복 · ${safeRepeatWeeks}주` : '반복 없음'
}

export default function TeacherPrivateLessonRequestsSection({
  currentAcademyId,
  user,
  userProfile,
  privateStudents,
}) {
  const teacherName = normalizeText(userProfile?.teacherName || '')
  const [studentMode, setStudentMode] = useState('existing')
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [newStudentName, setNewStudentName] = useState('')
  const [paidLessons, setPaidLessons] = useState('')
  const [weeklyFrequency, setWeeklyFrequency] = useState('1')
  const [slots, setSlots] = useState(() => makeSlotsForFrequency(1))
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [requestHistory, setRequestHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')

  const teacherPrivateStudents = useMemo(() => {
    const rows = Array.isArray(privateStudents) ? privateStudents : []
    return rows
      .filter((student) => normalizeText(student?.teacher || '') === teacherName)
      .slice()
      .sort((a, b) => getStudentName(a).localeCompare(getStudentName(b), 'ko'))
  }, [privateStudents, teacherName])

  useEffect(() => {
    if (!currentAcademyId || !teacherName) {
      setRequestHistory([])
      setHistoryLoading(false)
      setHistoryError('')
      return undefined
    }

    setHistoryLoading(true)
    setHistoryError('')
    const rowsBySource = {
      teacher: new Map(),
      teacherName: new Map(),
    }
    let teacherSnapshotReady = false
    let teacherNameSnapshotReady = false

    function syncRows(snapshot, sourceField) {
      const nextSourceRows = new Map()
      snapshot.docs.forEach((docItem) => {
        const data = docItem.data() || {}
        const requestTeacher = normalizeText(data.teacher || '')
        const requestTeacherName = normalizeText(data.teacherName || '')
        if (data.academyId !== currentAcademyId) return
        if (requestTeacher !== teacherName && requestTeacherName !== teacherName) return
        nextSourceRows.set(docItem.id, { id: docItem.id, ...data })
      })

      rowsBySource[sourceField] = nextSourceRows
      if (sourceField === 'teacher') teacherSnapshotReady = true
      if (sourceField === 'teacherName') teacherNameSnapshotReady = true
      if (teacherSnapshotReady && teacherNameSnapshotReady) {
        const rowsById = new Map([
          ...rowsBySource.teacher.entries(),
          ...rowsBySource.teacherName.entries(),
        ])
        setRequestHistory(sortRequestHistoryRows(Array.from(rowsById.values())))
        setHistoryLoading(false)
      }
    }

    function handleError(error) {
      console.error('내 1:1 요청 내역 불러오기 실패:', error)
      setRequestHistory([])
      setHistoryError('요청 내역을 불러오지 못했습니다.')
      setHistoryLoading(false)
    }

    const baseCollection = collection(db, 'lessonRequests')
    const unsubscribeTeacher = onSnapshot(
      query(
        baseCollection,
        where('academyId', '==', currentAcademyId),
        where('teacher', '==', teacherName)
      ),
      (snapshot) => syncRows(snapshot, 'teacher'),
      handleError
    )
    const unsubscribeTeacherName = onSnapshot(
      query(
        baseCollection,
        where('academyId', '==', currentAcademyId),
        where('teacherName', '==', teacherName)
      ),
      (snapshot) => syncRows(snapshot, 'teacherName'),
      handleError
    )

    return () => {
      unsubscribeTeacher()
      unsubscribeTeacherName()
    }
  }, [currentAcademyId, teacherName])

  function updateWeeklyFrequency(nextValue) {
    const nextFrequency = String(nextValue || '1')
    setWeeklyFrequency(nextFrequency)
    setSlots((prev) => {
      const targetLength = Math.max(1, Math.min(Number(nextFrequency) || 1, 3))
      const nextSlots = prev.slice(0, targetLength)
      while (nextSlots.length < targetLength) {
        nextSlots.push(makeEmptySlot())
      }
      return nextSlots
    })
  }

  function updateSlot(index, key, value) {
    setSlots((prev) =>
      prev.map((slot, slotIndex) => (slotIndex === index ? { ...slot, [key]: value } : slot))
    )
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')

    if (!currentAcademyId) {
      setErrorMessage('학원 정보를 확인할 수 없습니다.')
      return
    }
    if (!user?.uid || !teacherName) {
      setErrorMessage('선생님 계정 정보를 확인할 수 없습니다.')
      return
    }

    const normalizedSlots = slots.map((slot) => ({
      date: String(slot.date || '').trim(),
      time: String(slot.time || '').trim(),
      subject: String(slot.subject || '').trim(),
    }))
    const incompleteSlot = normalizedSlots.find(
      (slot) => !slot.date || !slot.time || !slot.subject
    )
    if (incompleteSlot) {
      setErrorMessage('날짜, 시간, 과목을 모두 입력해 주세요.')
      return
    }

    const frequency = Number(weeklyFrequency)
    if (![1, 2, 3].includes(frequency)) {
      setErrorMessage('주당 횟수는 1, 2, 3 중에서 선택해 주세요.')
      return
    }

    const paidLessonCount = parsePositiveInteger(paidLessons)
    const requestPlans = buildTeacherPrivateLessonRequestPlans({
      paidLessons: paidLessonCount,
      weeklyFrequency: frequency,
      normalizedSlots,
    })
    const seriesID = makeSeriesId()

    let studentId = ''
    let studentName = ''
    let newStudentRef = null

    if (studentMode === 'new') {
      studentName = String(newStudentName || '').trim()
      if (!studentName) {
        setErrorMessage('새 학생 이름을 입력해 주세요.')
        return
      }
      newStudentRef = doc(collection(db, 'privateStudents'))
      studentId = newStudentRef.id
    } else {
      const selectedStudent = teacherPrivateStudents.find((student) => student.id === selectedStudentId)
      if (!selectedStudent) {
        setErrorMessage('기존 학생을 선택하거나 새 학생 이름을 입력해 주세요.')
        return
      }
      studentId = selectedStudent.id
      studentName = getStudentName(selectedStudent)
    }

    try {
      setSubmitting(true)
      const batch = writeBatch(db)
      const timestamp = serverTimestamp()

      if (newStudentRef) {
        const studentPayload = {
          academyId: currentAcademyId,
          name: studentName,
          teacher: teacherName,
          status: 'active',
          studentStatus: 'active',
          profileStatus: 'incomplete',
          createdByUid: user.uid,
          createdByRole: 'teacher',
          createdAt: timestamp,
          updatedAt: timestamp,
          attendanceCount: 0,
          weeklyFrequency: frequency,
          slots: normalizedSlots,
        }
        if (paidLessonCount) {
          studentPayload.paidLessons = paidLessonCount
        }
        batch.set(newStudentRef, studentPayload)
      }

      requestPlans.forEach((plan) => {
        const requestRef = doc(collection(db, 'lessonRequests'))
        const requestPayload = {
          academyId: currentAcademyId,
          teacherUID: user.uid,
          teacherName,
          teacher: teacherName,
          studentID: studentId,
          studentId,
          studentName,
          student: studentName,
          date: plan.slot.date,
          time: plan.slot.time,
          subject: plan.slot.subject,
          repeatWeekly: plan.repeatWeekly,
          repeatWeeks: plan.repeatWeeks,
          approvalStatus: 'pending',
          createdAt: timestamp,
          rejectionReason: '',
          seriesID,
        }
        batch.set(requestRef, requestPayload)
      })

      await batch.commit()
      setSuccessMessage(SUCCESS_MESSAGE)
      setSelectedStudentId('')
      setNewStudentName('')
      setPaidLessons('')
      updateWeeklyFrequency('1')
      setStudentMode(teacherPrivateStudents.length > 0 ? 'existing' : 'new')
    } catch (error) {
      console.error('고정 1:1 수업 요청 실패:', error)
      setErrorMessage(`수업 요청 실패: ${error.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="activity-section">
      <style>
        {`
          .teacher-private-request-section input,
          .teacher-private-request-section select,
          .teacher-private-request-section textarea {
            caret-color: var(--text);
            transition: border-color 0.15s, background 0.15s, opacity 0.15s, box-shadow 0.15s;
          }

          .teacher-private-request-section input::placeholder,
          .teacher-private-request-section textarea::placeholder {
            color: #96a3b8;
            opacity: 1;
          }

          .teacher-private-request-section input:focus,
          .teacher-private-request-section select:focus,
          .teacher-private-request-section textarea:focus {
            border-color: var(--accent);
            background: #111827;
            box-shadow: 0 0 0 2px rgba(79, 142, 255, 0.18);
          }

          .teacher-private-request-section input:disabled,
          .teacher-private-request-section select:disabled,
          .teacher-private-request-section textarea:disabled {
            color: #9aa6b8;
            background: rgba(18, 23, 34, 0.82);
            border-color: #2a3140;
            cursor: not-allowed;
            opacity: 0.84;
          }

          .teacher-private-request-section input[type="radio"] {
            width: 16px;
            height: 16px;
            accent-color: var(--accent);
            flex: 0 0 auto;
          }

          .teacher-private-request-section input[type="date"]::-webkit-calendar-picker-indicator,
          .teacher-private-request-section input[type="time"]::-webkit-calendar-picker-indicator {
            filter: invert(1) opacity(0.72);
          }

          .teacher-private-request-section option {
            background: var(--surface);
            color: var(--text);
          }
        `}
      </style>
      <div style={{ display: 'grid', gap: 20 }}>
        <div>
          <h2 className="section-title" style={{ marginBottom: 8 }}>
            내 1:1 관리
          </h2>
          <p style={{ margin: 0, color: '#aab5c4' }}>
            고정 1:1 수업은 요청으로 접수되며, 관리자 승인 후 수업으로 생성됩니다.
          </p>
        </div>

        <div
          className="teacher-private-request-section"
          style={cardStyle}
        >
          <h3 style={{ marginTop: 0, marginBottom: 16, color: 'var(--text)' }}>
            고정 1:1 요청
          </h3>

          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
            <fieldset style={fieldsetStyle}>
              <legend style={legendStyle}>학생</legend>
              <label style={radioLabelStyle}>
                <input
                  type="radio"
                  name="teacher-private-student-mode"
                  checked={studentMode === 'existing'}
                  onChange={() => setStudentMode('existing')}
                  disabled={teacherPrivateStudents.length === 0}
                />
                기존 학생 선택
              </label>
              {studentMode === 'existing' ? (
                <label style={labelStyle}>
                  기존 개인 학생
                  <select
                    value={selectedStudentId}
                    onChange={(event) => setSelectedStudentId(event.target.value)}
                    disabled={teacherPrivateStudents.length === 0 || submitting}
                    style={controlStyle}
                  >
                    <option value="">학생 선택</option>
                    {teacherPrivateStudents.map((student) => (
                      <option key={student.id} value={student.id}>
                        {getStudentName(student)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label style={radioLabelStyle}>
                <input
                  type="radio"
                  name="teacher-private-student-mode"
                  checked={studentMode === 'new'}
                  onChange={() => setStudentMode('new')}
                />
                새 학생 빠른 등록
              </label>
              {studentMode === 'new' ? (
                <label style={labelStyle}>
                  새 학생 이름
                  <input
                    type="text"
                    value={newStudentName}
                    onChange={(event) => setNewStudentName(event.target.value)}
                    placeholder="학생 이름"
                    disabled={submitting}
                    style={controlStyle}
                  />
                </label>
              ) : null}
            </fieldset>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 12,
              }}
            >
              <label style={labelStyle}>
                결제 수업 수
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={paidLessons}
                  onChange={(event) => setPaidLessons(event.target.value)}
                  placeholder="선택 입력"
                  disabled={submitting}
                  style={controlStyle}
                />
              </label>
              <label style={labelStyle}>
                주당 횟수
                <select
                  value={weeklyFrequency}
                  onChange={(event) => updateWeeklyFrequency(event.target.value)}
                  disabled={submitting}
                  style={controlStyle}
                >
                  <option value="1">1회</option>
                  <option value="2">2회</option>
                  <option value="3">3회</option>
                </select>
              </label>
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              {slots.map((slot, index) => (
                <div
                  key={index}
                  style={slotCardStyle}
                >
                  <label style={labelStyle}>
                    날짜 {index + 1}
                    <input
                      type="date"
                      value={slot.date}
                      onChange={(event) => updateSlot(index, 'date', event.target.value)}
                      disabled={submitting}
                      style={controlStyle}
                    />
                  </label>
                  <label style={labelStyle}>
                    시간 {index + 1}
                    <input
                      type="time"
                      value={slot.time}
                      onChange={(event) => updateSlot(index, 'time', event.target.value)}
                      disabled={submitting}
                      style={controlStyle}
                    />
                  </label>
                  <label style={labelStyle}>
                    과목 {index + 1}
                    <input
                      type="text"
                      value={slot.subject}
                      onChange={(event) => updateSlot(index, 'subject', event.target.value)}
                      placeholder="예: 영어"
                      disabled={submitting}
                      style={controlStyle}
                    />
                  </label>
                </div>
              ))}
            </div>

            {errorMessage ? (
              <p role="alert" style={{ margin: 0, color: '#f4a7a7' }}>
                {errorMessage}
              </p>
            ) : null}
            {successMessage ? (
              <p role="status" style={{ margin: 0, color: 'var(--success)' }}>
                {successMessage}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              style={{
                justifySelf: 'start',
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid rgba(79, 142, 255, 0.45)',
                background: '#1f2a44',
                color: 'var(--text)',
                cursor: submitting ? 'not-allowed' : 'pointer',
                fontWeight: 700,
                opacity: submitting ? 0.72 : 1,
              }}
            >
              {submitting ? '요청 중...' : '고정 1:1 요청하기'}
            </button>
          </form>
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0, marginBottom: 16, color: 'var(--text)' }}>
            내 1:1 요청 내역
          </h3>

          {historyError ? (
            <p role="alert" style={{ margin: 0, color: '#f4a7a7' }}>
              {historyError}
            </p>
          ) : historyLoading ? (
            <p style={{ margin: 0, color: mutedTextColor }}>불러오는 중...</p>
          ) : requestHistory.length === 0 ? (
            <p style={{ margin: 0, color: mutedTextColor }}>아직 제출한 1:1 요청이 없습니다.</p>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {requestHistory.map((request) => {
                const isRejected = String(request.approvalStatus || '').toLowerCase() === 'rejected'
                return (
                  <article
                    key={request.id}
                    data-testid="teacher-private-request-history-card"
                    data-request-id={request.id}
                    style={{
                      border: panelBorder,
                      borderRadius: 10,
                      padding: 14,
                      background: 'rgba(28, 32, 41, 0.72)',
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                        gap: 12,
                        alignItems: 'start',
                      }}
                    >
                      <span>
                        <span style={{ display: 'block', color: mutedTextColor, fontSize: 12 }}>
                          학생
                        </span>
                        {cleanText(request.studentName || request.student)}
                      </span>
                      <span>
                        <span style={{ display: 'block', color: mutedTextColor, fontSize: 12 }}>
                          날짜
                        </span>
                        {cleanText(request.date)}
                      </span>
                      <span>
                        <span style={{ display: 'block', color: mutedTextColor, fontSize: 12 }}>
                          시간
                        </span>
                        {cleanText(request.time)}
                      </span>
                      <span>
                        <span style={{ display: 'block', color: mutedTextColor, fontSize: 12 }}>
                          과목
                        </span>
                        {cleanText(request.subject)}
                      </span>
                      <span>
                        <span style={{ display: 'block', color: mutedTextColor, fontSize: 12 }}>
                          반복
                        </span>
                        {getRepeatSummary(request)}
                      </span>
                      <span>
                        <span style={{ display: 'block', color: mutedTextColor, fontSize: 12 }}>
                          상태
                        </span>
                        {getApprovalStatusLabel(request.approvalStatus)}
                      </span>
                    </div>
                    {isRejected && cleanText(request.rejectionReason, '') ? (
                      <p style={{ margin: '12px 0 0 0', color: '#f4a7a7' }}>
                        거절 사유: {cleanText(request.rejectionReason, '')}
                      </p>
                    ) : null}
                  </article>
                )
              })}
            </div>
          )}
        </div>

        <div
          aria-disabled="true"
          style={disabledCardStyle}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              justifyContent: 'space-between',
              marginBottom: 8,
              flexWrap: 'wrap',
            }}
          >
            <h3 style={{ margin: 0, color: '#dce4ef' }}>유동 1:1 예약 시간</h3>
            <span
              style={{
                border: '1px solid rgba(79, 142, 255, 0.28)',
                borderRadius: 999,
                padding: '2px 8px',
                background: 'rgba(79, 142, 255, 0.1)',
                color: '#b8d1ff',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              준비 중
            </span>
          </div>
          <p style={{ margin: 0 }}>
            학생이 나중에 예약하는 유동 1:1 시간 열기는 현재 관리자 전용입니다.
          </p>
        </div>
      </div>
    </section>
  )
}
