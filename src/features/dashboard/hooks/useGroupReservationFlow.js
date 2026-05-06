import { useEffect, useState } from 'react'
import {
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../../../firebase'
import { debugLog } from '../../../utils/debugLog.js'
import {
  assertSameAcademy,
  isValidOperationalAcademyId,
  requireCurrentAcademyId,
} from '../academyScope.js'
import {
  getGroupLessonGroupId,
  normalizeText,
} from '../dashboardViewUtils.js'

export function buildGroupLessonReservationId({ academyId, lessonId, studentId }) {
  return `${academyId}__${lessonId}__${studentId}`
}

function logReservationEvent(type, payload) {
  debugLog(`[group-reservation] ${type}`, payload)
}

function getGroupStudentGroupId(groupStudentRow) {
  return String(groupStudentRow?.groupClassId || groupStudentRow?.classID || '').trim()
}

function getStudentDisplayName(groupStudentRow) {
  return (
    normalizeText(groupStudentRow?.studentName || '') ||
    normalizeText(groupStudentRow?.name || '') ||
    '-'
  )
}

function ensureReservationInputs({ lesson, groupStudentRow, currentAcademyId }) {
  const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
  if (!lesson?.id) throw new Error('수업 일정을 찾을 수 없습니다.')
  if (!groupStudentRow?.id) throw new Error('그룹 학생 정보를 찾을 수 없습니다.')
  assertSameAcademy(lesson, scopedAcademyId, '그룹 수업')
  assertSameAcademy(groupStudentRow, scopedAcademyId, '그룹 학생')

  const studentId = String(groupStudentRow.studentId || '').trim()
  if (!studentId) throw new Error('그룹 학생에 학생 정보가 없습니다.')

  return {
    scopedAcademyId,
    studentId,
    reservationId: buildGroupLessonReservationId({
      academyId: scopedAcademyId,
      lessonId: lesson.id,
      studentId,
    }),
  }
}

function validateLessonBookingState(lesson, mode) {
  const capacity = Number(lesson?.capacity ?? 0)
  const bookedCount = Number(lesson?.bookedCount ?? 0)

  if (!Number.isFinite(capacity) || capacity <= 0) {
    throw new Error('예약 불가 수업입니다.')
  }
  if (!Number.isFinite(bookedCount) || bookedCount < 0) {
    throw new Error('예약 수가 올바르지 않습니다.')
  }
  if (bookedCount > capacity) {
    throw new Error('예약 수가 정원을 초과했습니다.')
  }
  if (mode === 'reserve') {
    if (lesson?.isBookable !== true) throw new Error('예약 불가 수업입니다.')
    if (bookedCount >= capacity) throw new Error('정원 마감')
    return
  }
  if (bookedCount <= 0) {
    throw new Error('예약 수가 올바르지 않습니다.')
  }
}

export default function useGroupReservationFlow({
  activeSection,
  userProfile,
  currentAcademyId,
}) {
  const [groupReservationModal, setGroupReservationModal] = useState(null)
  const [busyGroupReservationId, setBusyGroupReservationId] = useState(null)

  useEffect(() => {
    if (activeSection !== 'groups') {
      setGroupReservationModal(null)
      setBusyGroupReservationId(null)
    }
  }, [activeSection])

  useEffect(() => {
    if (!groupReservationModal) return

    function onKeyDown(e) {
      if (e.key === 'Escape' && !busyGroupReservationId) setGroupReservationModal(null)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busyGroupReservationId, groupReservationModal])

  function canManageGroupReservations() {
    return userProfile?.role === 'admin' || userProfile?.role === 'teacher'
  }

  function openGroupLessonReservationAddModal(lesson) {
    if (!isValidOperationalAcademyId(currentAcademyId)) {
      alert('현재 학원 컨텍스트가 없어 예약할 수 없습니다.')
      return
    }
    if (!canManageGroupReservations()) {
      alert('예약 관리 권한이 없습니다.')
      return
    }
    setGroupReservationModal({ type: 'add', lesson })
  }

  function openGroupLessonReservationViewModal(lesson) {
    if (!isValidOperationalAcademyId(currentAcademyId)) {
      alert('현재 학원 컨텍스트가 없어 예약을 볼 수 없습니다.')
      return
    }
    if (!canManageGroupReservations()) {
      alert('예약 관리 권한이 없습니다.')
      return
    }
    setGroupReservationModal({ type: 'view', lesson })
  }

  function closeGroupLessonReservationModal() {
    if (busyGroupReservationId) return
    setGroupReservationModal(null)
  }

  async function reserveGroupLessonSeat({ lesson, groupStudentRow }) {
    if (!canManageGroupReservations()) {
      alert('예약 관리 권한이 없습니다.')
      return
    }

    const { scopedAcademyId, studentId, reservationId } = ensureReservationInputs({
      lesson,
      groupStudentRow,
      currentAcademyId,
    })
    validateLessonBookingState(lesson, 'reserve')
    const busyKey = `${lesson.id}__${studentId}__reserve`

    try {
      setBusyGroupReservationId(busyKey)
      await runTransaction(db, async (transaction) => {
        const lessonRef = doc(db, 'groupLessons', lesson.id)
        const groupStudentRef = doc(db, 'groupStudents', groupStudentRow.id)
        const reservationRef = doc(db, 'groupLessonReservations', reservationId)

        const lessonSnap = await transaction.get(lessonRef)
        const groupStudentSnap = await transaction.get(groupStudentRef)
        const reservationSnap = await transaction.get(reservationRef)

        if (!lessonSnap.exists()) throw new Error('수업 일정을 찾을 수 없습니다.')
        if (!groupStudentSnap.exists()) throw new Error('그룹 학생 정보를 찾을 수 없습니다.')

        const lessonData = { id: lessonSnap.id, ...lessonSnap.data() }
        const groupStudentData = { id: groupStudentSnap.id, ...groupStudentSnap.data() }

        assertSameAcademy(lessonData, scopedAcademyId, '그룹 수업')
        assertSameAcademy(groupStudentData, scopedAcademyId, '그룹 학생')
        validateLessonBookingState(lessonData, 'reserve')

        if (String(groupStudentData.status || 'active') !== 'active') {
          throw new Error('비활성 학생')
        }

        const capacity = Number(lessonData.capacity ?? 0)
        const bookedCount = Number(lessonData.bookedCount ?? 0)

        const lessonGroupId = getGroupLessonGroupId(lessonData)
        const groupStudentGroupId = getGroupStudentGroupId(groupStudentData)
        if (!lessonGroupId || groupStudentGroupId !== lessonGroupId) {
          throw new Error('현재 학원 불일치')
        }

        if (String(groupStudentData.studentId || '').trim() !== studentId) {
          throw new Error('현재 학원 불일치')
        }

        if (reservationSnap.exists()) {
          const reservationData = reservationSnap.data()
          assertSameAcademy(reservationData, scopedAcademyId, '예약')
          if (reservationData.status === 'active') throw new Error('이미 예약됨')
        }

        transaction.set(reservationRef, {
          academyId: scopedAcademyId,
          lessonId: lesson.id,
          groupClassId: lessonGroupId,
          studentId,
          studentName: getStudentDisplayName(groupStudentData),
          teacher: normalizeText(lessonData.teacher || ''),
          status: 'active',
          createdAt: reservationSnap.exists()
            ? reservationSnap.data().createdAt || serverTimestamp()
            : serverTimestamp(),
          updatedAt: serverTimestamp(),
          cancelledAt: null,
          source: 'dashboard',
        })
        transaction.update(lessonRef, {
          bookedCount: bookedCount + 1,
          updatedAt: serverTimestamp(),
        })
      })
      logReservationEvent('reserve_success', {
        academyId: scopedAcademyId,
        lessonId: lesson.id,
        studentId,
      })
    } catch (error) {
      console.error('그룹 수업 예약 실패:', error)
      logReservationEvent('reserve_failure', {
        academyId: scopedAcademyId,
        lessonId: lesson.id,
        studentId,
        message: error?.message || 'unknown',
      })
      alert(`그룹 수업 예약 실패: ${error.message}`)
    } finally {
      setBusyGroupReservationId(null)
    }
  }

  async function cancelGroupLessonSeat({ lesson, groupStudentRow }) {
    if (!canManageGroupReservations()) {
      alert('예약 관리 권한이 없습니다.')
      return
    }

    const { scopedAcademyId, studentId, reservationId } = ensureReservationInputs({
      lesson,
      groupStudentRow,
      currentAcademyId,
    })
    validateLessonBookingState(lesson, 'cancel')
    const busyKey = `${lesson.id}__${studentId}__cancel`

    try {
      setBusyGroupReservationId(busyKey)
      await runTransaction(db, async (transaction) => {
        const lessonRef = doc(db, 'groupLessons', lesson.id)
        const groupStudentRef = doc(db, 'groupStudents', groupStudentRow.id)
        const reservationRef = doc(db, 'groupLessonReservations', reservationId)

        const lessonSnap = await transaction.get(lessonRef)
        const groupStudentSnap = await transaction.get(groupStudentRef)
        const reservationSnap = await transaction.get(reservationRef)

        if (!lessonSnap.exists()) throw new Error('수업 일정을 찾을 수 없습니다.')
        if (!groupStudentSnap.exists()) throw new Error('그룹 학생 정보를 찾을 수 없습니다.')
        if (!reservationSnap.exists() || reservationSnap.data().status !== 'active') {
          throw new Error('활성 예약을 찾을 수 없습니다.')
        }

        const lessonData = { id: lessonSnap.id, ...lessonSnap.data() }
        const groupStudentData = { id: groupStudentSnap.id, ...groupStudentSnap.data() }
        const reservationData = reservationSnap.data()

        assertSameAcademy(lessonData, scopedAcademyId, '그룹 수업')
        assertSameAcademy(groupStudentData, scopedAcademyId, '그룹 학생')
        assertSameAcademy(reservationData, scopedAcademyId, '예약')
        validateLessonBookingState(lessonData, 'cancel')

        const lessonGroupId = getGroupLessonGroupId(lessonData)
        const groupStudentGroupId = getGroupStudentGroupId(groupStudentData)
        if (!lessonGroupId || groupStudentGroupId !== lessonGroupId) {
          throw new Error('현재 학원 불일치')
        }
        if (
          reservationData.lessonId !== lesson.id ||
          reservationData.studentId !== studentId ||
          reservationData.groupClassId !== lessonGroupId
        ) {
          throw new Error('현재 학원 불일치')
        }

        const bookedCount = Number(lessonData.bookedCount ?? 0)

        transaction.update(reservationRef, {
          status: 'cancelled',
          cancelledAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        transaction.update(lessonRef, {
          bookedCount: bookedCount - 1,
          updatedAt: serverTimestamp(),
        })
      })
      logReservationEvent('cancel_success', {
        academyId: scopedAcademyId,
        lessonId: lesson.id,
        studentId,
      })
    } catch (error) {
      console.error('그룹 수업 예약 취소 실패:', error)
      logReservationEvent('cancel_failure', {
        academyId: scopedAcademyId,
        lessonId: lesson.id,
        studentId,
        message: error?.message || 'unknown',
      })
      alert(`그룹 수업 예약 취소 실패: ${error.message}`)
    } finally {
      setBusyGroupReservationId(null)
    }
  }

  return {
    groupReservationModal,
    busyGroupReservationId,
    canManageGroupReservations: canManageGroupReservations(),
    openGroupLessonReservationAddModal,
    openGroupLessonReservationViewModal,
    closeGroupLessonReservationModal,
    reserveGroupLessonSeat,
    cancelGroupLessonSeat,
  }
}
