import { useEffect, useMemo, useState } from 'react'
import { signOut } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../../../firebase'
import { useAuth } from '../../../AuthContext'

function getFunctionErrorMessage(error) {
  const message = String(error?.message || '').trim()
  if (message) return message
  return '처리 중 문제가 발생했습니다.'
}

export default function StudentGroupBookingPage() {
  const { user, studentName, studentId } = useAuth()
  const [lessons, setLessons] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyLessonId, setBusyLessonId] = useState('')
  const [message, setMessage] = useState('')

  const listBookableGroupLessons = useMemo(
    () => httpsCallable(functions, 'listBookableGroupLessons'),
    []
  )
  const reserveGroupLesson = useMemo(
    () => httpsCallable(functions, 'reserveGroupLesson'),
    []
  )
  const cancelGroupLessonReservation = useMemo(
    () => httpsCallable(functions, 'cancelGroupLessonReservation'),
    []
  )

  async function loadLessons() {
    setLoading(true)
    setMessage('')
    try {
      const result = await listBookableGroupLessons({})
      setLessons(Array.isArray(result.data?.lessons) ? result.data.lessons : [])
    } catch (error) {
      setMessage(getFunctionErrorMessage(error))
      setLessons([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLessons()
  }, [])

  async function handleReserve(lesson) {
    setBusyLessonId(lesson.id)
    setMessage('')
    try {
      await reserveGroupLesson({ lessonId: lesson.id })
      setMessage('예약되었습니다.')
      await loadLessons()
    } catch (error) {
      setMessage(getFunctionErrorMessage(error))
    } finally {
      setBusyLessonId('')
    }
  }

  async function handleCancel(lesson) {
    setBusyLessonId(lesson.id)
    setMessage('')
    try {
      await cancelGroupLessonReservation({
        reservationId: lesson.ownReservationId,
        lessonId: lesson.id,
      })
      setMessage('예약을 취소했습니다.')
      await loadLessons()
    } catch (error) {
      setMessage(getFunctionErrorMessage(error))
    } finally {
      setBusyLessonId('')
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#10131a',
        color: 'white',
        padding: 24,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            marginBottom: 20,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: '1.6rem' }}>그룹 수업 예약</h1>
            <p style={{ margin: '6px 0 0 0', opacity: 0.72, fontSize: 13 }}>
              {studentName || user?.email || studentId || '-'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => signOut(auth)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #444',
              background: 'transparent',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            로그아웃
          </button>
        </header>

        {message ? (
          <div
            role="status"
            style={{
              border: '1px solid #38506f',
              background: '#172131',
              borderRadius: 8,
              padding: '10px 12px',
              marginBottom: 14,
              fontSize: 13,
            }}
          >
            {message}
          </div>
        ) : null}

        {loading ? (
          <p style={{ opacity: 0.8 }}>불러오는 중...</p>
        ) : lessons.length === 0 ? (
          <p style={{ opacity: 0.8 }}>예약 가능한 그룹 수업이 없습니다.</p>
        ) : (
          <div className="activity-table">
            <div
              className="table-head"
              style={{ gridTemplateColumns: '1fr 0.8fr 1fr 0.8fr 0.8fr 1fr' }}
            >
              <span>날짜</span>
              <span>시간</span>
              <span>반 / 과목</span>
              <span>정원</span>
              <span>잔여</span>
              <span>작업</span>
            </div>
            {lessons.map((lesson) => {
              const busy = busyLessonId === lesson.id
              const reserved = Boolean(lesson.ownReservationId)
              const disabled = busy || lesson.isFull || lesson.fixedSelf
              return (
                <div
                  key={lesson.id}
                  className="table-row"
                  data-testid="student-bookable-lesson-row"
                  data-lesson-id={lesson.id}
                  style={{
                    gridTemplateColumns: '1fr 0.8fr 1fr 0.8fr 0.8fr 1fr',
                  }}
                >
                  <span>{lesson.date || '-'}</span>
                  <span>{lesson.time || '-'}</span>
                  <span>
                    {lesson.groupClassName || '-'} · {lesson.subject || '-'}
                  </span>
                  <span>{lesson.capacity}</span>
                  <span>{reserved ? '예약됨' : lesson.isFull ? '마감' : lesson.remainingSeats}</span>
                  <span>
                    {reserved ? (
                      <button
                        type="button"
                        onClick={() => handleCancel(lesson)}
                        disabled={busy}
                        style={{
                          padding: '7px 11px',
                          borderRadius: 8,
                          border: '1px solid #665044',
                          background: '#3a2c24',
                          color: 'white',
                          cursor: busy ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {busy ? '처리 중' : '예약 취소'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleReserve(lesson)}
                        disabled={disabled}
                        style={{
                          padding: '7px 11px',
                          borderRadius: 8,
                          border: '1px solid #335566',
                          background: disabled ? '#2a2a2a' : '#1a3338',
                          color: 'white',
                          cursor: disabled ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {busy ? '처리 중' : lesson.isFull ? '마감' : '예약'}
                      </button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
