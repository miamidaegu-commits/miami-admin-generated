import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions as firebaseFunctions } from '../../../../firebase'
import { debugLog } from '../../../utils/debugLog.js'
import {
  assertSameAcademy,
  isValidOperationalAcademyId,
  requireCurrentAcademyId,
} from '../academyScope.js'

export function buildGroupLessonReservationId({ academyId, lessonId, studentId }) {
  return `${academyId}__${lessonId}__${studentId}`
}

function logReservationEvent(type, payload) {
  debugLog(`[group-reservation] ${type}`, payload)
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
    return userProfile?.role === 'admin'
  }

  function canViewGroupReservations() {
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
    if (!canViewGroupReservations()) {
      alert('예약 조회 권한이 없습니다.')
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

    const { scopedAcademyId, studentId } = ensureReservationInputs({
      lesson,
      groupStudentRow,
      currentAcademyId,
    })
    validateLessonBookingState(lesson, 'reserve')
    const busyKey = `${lesson.id}__${studentId}__reserve`

    try {
      setBusyGroupReservationId(busyKey)
      const reserveGroupLessonSeatCallable = httpsCallable(
        firebaseFunctions,
        'reserveGroupLessonSeat'
      )
      await reserveGroupLessonSeatCallable({
        academyId: scopedAcademyId,
        lessonId: lesson.id,
        groupStudentId: groupStudentRow.id,
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

    const { scopedAcademyId, studentId } = ensureReservationInputs({
      lesson,
      groupStudentRow,
      currentAcademyId,
    })
    validateLessonBookingState(lesson, 'cancel')
    const busyKey = `${lesson.id}__${studentId}__cancel`

    try {
      setBusyGroupReservationId(busyKey)
      const cancelGroupLessonSeatCallable = httpsCallable(
        firebaseFunctions,
        'cancelGroupLessonSeat'
      )
      await cancelGroupLessonSeatCallable({
        academyId: scopedAcademyId,
        lessonId: lesson.id,
        groupStudentId: groupStudentRow.id,
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
